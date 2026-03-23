import { randomUUID } from 'node:crypto';
import pc from 'picocolors';
import WebSocket from 'ws';
import type { ConnectionConfig, CommandBlocklist } from './types.js';
import {
  spawnTmuxSession,
  killTmuxSession,
  captureTmuxOutput,
  sendToTmux,
  sendSpecialKey,
  resizeTmux,
  writeBlocklist,
} from './tmux.js';
import type { TicketClient } from '@lamalibre/portlama-tickets';

/**
 * Connect to the shell server WebSocket relay and pipe data to/from tmux.
 * Returns a promise that resolves when the WebSocket closes.
 */
export async function connectRelay(conn: ConnectionConfig): Promise<void> {
  const sessionId = randomUUID();

  console.log(pc.dim(`  Connecting to relay: ${conn.wsUrl}`));

  const ws = new WebSocket(conn.wsUrl, {
    cert: conn.tls.cert,
    key: conn.tls.key,
    ca: conn.tls.ca,
    rejectUnauthorized: conn.tls.rejectUnauthorized,
  });

  let tmuxStarted = false;
  let outputPoller: ReturnType<typeof setInterval> | null = null;
  let lastOutput = '';

  ws.on('open', () => {
    console.log(pc.green('  Connected to relay.'));
    console.log(pc.dim('  Waiting for admin to connect...'));

    // Send ready message
    ws.send(JSON.stringify({ type: 'agent-ready', label: conn.label }));
  });

  ws.on('message', async (raw: WebSocket.RawData) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      // Binary data — treat as raw input
      if (tmuxStarted) {
        try {
          await sendToTmux(raw.toString());
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(pc.red(`  Failed to send to tmux: ${message}`));
        }
      }
      return;
    }

    switch (msg['type']) {
      case 'admin-connected': {
        if (!tmuxStarted) {
          try {
            await spawnTmuxSession(sessionId);
            tmuxStarted = true;
            console.log(pc.green(`  Session started: ${sessionId}`));

            // Start polling tmux output and sending to WebSocket
            outputPoller = setInterval(() => {
              void (async () => {
                try {
                  const output = await captureTmuxOutput();
                  if (output !== lastOutput) {
                    lastOutput = output;
                    ws.send(JSON.stringify({ type: 'output', data: output }));
                  }
                } catch {
                  // tmux may have died
                }
              })();
            }, 100);

            ws.send(JSON.stringify({ type: 'session-started', sessionId }));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(pc.red(`  Failed to start tmux: ${message}`));
            ws.send(JSON.stringify({ type: 'error', message: 'Failed to start shell session' }));
          }
        }
        break;
      }

      case 'input': {
        if (tmuxStarted && typeof msg['data'] === 'string') {
          try {
            await sendToTmux(msg['data']);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(pc.red(`  Failed to send to tmux: ${message}`));
          }
        }
        break;
      }

      case 'special-key': {
        if (tmuxStarted && typeof msg['key'] === 'string') {
          try {
            await sendSpecialKey(msg['key']);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(pc.red(`  Failed to send special key: ${message}`));
          }
        }
        break;
      }

      case 'resize': {
        if (tmuxStarted && msg['cols'] != null && msg['rows'] != null) {
          const cols = Number(msg['cols']);
          const rows = Number(msg['rows']);
          if (
            Number.isInteger(cols) &&
            Number.isInteger(rows) &&
            cols >= 1 &&
            cols <= 500 &&
            rows >= 1 &&
            rows <= 500
          ) {
            try {
              await resizeTmux(cols, rows);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error(pc.red(`  Failed to resize tmux: ${message}`));
            }
          }
        }
        break;
      }

      case 'admin-disconnected': {
        console.log(pc.yellow('  Admin disconnected.'));
        if (outputPoller) {
          clearInterval(outputPoller);
          outputPoller = null;
        }
        if (tmuxStarted) {
          await killTmuxSession();
          tmuxStarted = false;
          lastOutput = '';
        }
        console.log(pc.dim('  Waiting for admin to reconnect...'));
        break;
      }

      case 'time-window-expired': {
        console.log(pc.yellow('  Shell access time window expired.'));
        if (outputPoller) {
          clearInterval(outputPoller);
          outputPoller = null;
        }
        if (tmuxStarted) {
          await killTmuxSession();
          tmuxStarted = false;
        }
        ws.close(1000, 'Time window expired');
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', (code: number, reason: Buffer) => {
    console.log(pc.dim(`  WebSocket closed: ${code} ${reason.toString() || ''}`));
    if (outputPoller) {
      clearInterval(outputPoller);
      outputPoller = null;
    }
    if (tmuxStarted) {
      killTmuxSession().catch(() => {});
      tmuxStarted = false;
    }
  });

  ws.on('error', (err: Error) => {
    console.error(pc.red(`  WebSocket error: ${err.message}`));
  });

  // Return a promise that resolves when the WebSocket closes
  return new Promise<void>((resolve) => {
    ws.on('close', () => resolve());
  });
}

export interface RelayPanelSession {
  client: TicketClient;
  sessionId: string;
}

/**
 * Connect to shell-server via ticket-based auth (tunnel mode).
 * Sends ticketId as first message, waits for acceptance, then relays.
 */
export async function connectRelayWithTicket(
  wsUrl: string,
  label: string,
  ticketId: string,
  panelSession?: RelayPanelSession,
): Promise<void> {
  const sessionId = randomUUID();

  console.log(pc.dim(`  Connecting to relay (ticket): ${wsUrl}`));

  const ws = new WebSocket(wsUrl, {
    // Through tunnel — public HTTPS, no client cert
    rejectUnauthorized: true,
  });

  let tmuxStarted = false;
  let outputPoller: ReturnType<typeof setInterval> | null = null;
  let lastOutput = '';
  let panelHeartbeatInterval: ReturnType<typeof setInterval> | null = null;

  return new Promise<void>((resolve) => {
    let handshakeComplete = false;

    // Start panel session heartbeat using SDK TicketClient
    function startPanelHeartbeat(): void {
      if (!panelSession) return;
      panelHeartbeatInterval = setInterval(() => {
        void (async () => {
          try {
            const result = await panelSession.client.sendSessionHeartbeat(
              panelSession.sessionId,
            );
            if (!result.authorized) {
              const reason = result.reason ?? 'unknown';
              console.log(pc.yellow(`  Panel session terminated: ${reason}`));
              ws.close(1000, `Panel session terminated: ${reason}`);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(pc.yellow(`  Panel heartbeat failed: ${message}`));
          }
        })();
      }, 60_000);
    }

    function cleanup(): void {
      if (panelHeartbeatInterval) {
        clearInterval(panelHeartbeatInterval);
        panelHeartbeatInterval = null;
      }
      if (outputPoller) {
        clearInterval(outputPoller);
        outputPoller = null;
      }
    }

    ws.on('open', () => {
      console.log(pc.dim('  WebSocket connected, sending ticket...'));
      ws.send(JSON.stringify({ type: 'ticket', ticketId }));
    });

    ws.on('message', async (raw: WebSocket.RawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        // Binary data — treat as raw input
        if (tmuxStarted) {
          try {
            await sendToTmux(raw.toString());
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(pc.red(`  Failed to send to tmux: ${message}`));
          }
        }
        return;
      }

      // Handle ticket acceptance
      if (!handshakeComplete && msg['type'] === 'ticket-accepted') {
        handshakeComplete = true;
        console.log(pc.green('  Ticket accepted. Connected to relay.'));

        // Extract and write command blocklist if present
        if (msg['commandBlocklist'] && typeof msg['commandBlocklist'] === 'object') {
          try {
            await writeBlocklist(msg['commandBlocklist'] as CommandBlocklist);
            console.log(pc.dim('  Command blocklist written.'));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(pc.yellow(`  Failed to write blocklist: ${message}`));
          }
        }

        // Start panel heartbeat
        startPanelHeartbeat();

        console.log(pc.dim('  Waiting for admin to connect...'));
        ws.send(JSON.stringify({ type: 'agent-ready', label }));
        return;
      }

      if (!handshakeComplete && msg['type'] === 'error') {
        console.error(pc.red(`  Ticket rejected: ${String(msg['message'])}`));
        ws.close(1000);
        return;
      }

      switch (msg['type']) {
        case 'admin-connected': {
          if (!tmuxStarted) {
            try {
              await spawnTmuxSession(sessionId);
              tmuxStarted = true;
              console.log(pc.green(`  Session started: ${sessionId}`));

              outputPoller = setInterval(() => {
                void (async () => {
                  try {
                    const output = await captureTmuxOutput();
                    if (output !== lastOutput) {
                      lastOutput = output;
                      ws.send(JSON.stringify({ type: 'output', data: output }));
                    }
                  } catch {
                    // tmux may have died
                  }
                })();
              }, 100);

              ws.send(JSON.stringify({ type: 'session-started', sessionId }));
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error(pc.red(`  Failed to start tmux: ${message}`));
              ws.send(
                JSON.stringify({ type: 'error', message: 'Failed to start shell session' }),
              );
            }
          }
          break;
        }

        case 'input': {
          if (tmuxStarted && typeof msg['data'] === 'string') {
            try {
              await sendToTmux(msg['data']);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error(pc.red(`  Failed to send to tmux: ${message}`));
            }
          }
          break;
        }

        case 'special-key': {
          if (tmuxStarted && typeof msg['key'] === 'string') {
            try {
              await sendSpecialKey(msg['key']);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error(pc.red(`  Failed to send special key: ${message}`));
            }
          }
          break;
        }

        case 'resize': {
          if (tmuxStarted && msg['cols'] != null && msg['rows'] != null) {
            const cols = Number(msg['cols']);
            const rows = Number(msg['rows']);
            if (
              Number.isInteger(cols) &&
              Number.isInteger(rows) &&
              cols >= 1 &&
              cols <= 500 &&
              rows >= 1 &&
              rows <= 500
            ) {
              try {
                await resizeTmux(cols, rows);
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(pc.red(`  Failed to resize tmux: ${message}`));
              }
            }
          }
          break;
        }

        case 'admin-disconnected': {
          console.log(pc.yellow('  Admin disconnected.'));
          if (outputPoller) {
            clearInterval(outputPoller);
            outputPoller = null;
          }
          if (tmuxStarted) {
            await killTmuxSession();
            tmuxStarted = false;
            lastOutput = '';
          }
          console.log(pc.dim('  Waiting for admin to reconnect...'));
          break;
        }

        case 'time-window-expired': {
          console.log(pc.yellow('  Shell access time window expired.'));
          if (outputPoller) {
            clearInterval(outputPoller);
            outputPoller = null;
          }
          if (tmuxStarted) {
            await killTmuxSession();
            tmuxStarted = false;
          }
          ws.close(1000, 'Time window expired');
          break;
        }

        default:
          break;
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      console.log(pc.dim(`  WebSocket closed: ${code} ${reason.toString() || ''}`));
      cleanup();
      if (tmuxStarted) {
        killTmuxSession().catch(() => {});
        tmuxStarted = false;
      }
      resolve();
    });

    ws.on('error', (err: Error) => {
      console.error(pc.red(`  WebSocket error: ${err.message}`));
    });
  });
}
