import pc from 'picocolors';
import WebSocket from 'ws';
import type { AgentConfig } from './types.js';
import { buildConnectionConfig } from './lib/tls.js';

/**
 * Run the interactive shell client.
 * Connects to a remote agent's shell via the server WebSocket relay.
 */
export async function runConnect(label: string, config: AgentConfig): Promise<void> {
  console.log('');
  console.log(pc.dim(`  Connecting to agent ${pc.bold(label)}...`));

  let conn;
  try {
    const wsPath = `/api/shell/connect/${encodeURIComponent(label)}`;
    conn = await buildConnectionConfig(config, wsPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`\n  Failed to load credentials: ${message}\n`));
    process.exit(1);
  }

  const ws = new WebSocket(conn.wsUrl, {
    cert: conn.tls.cert,
    key: conn.tls.key,
    ca: conn.tls.ca,
    rejectUnauthorized: conn.tls.rejectUnauthorized,
  });

  let connected = false;
  let rawModeSet = false;

  const cleanup = (code: number = 0): void => {
    if (rawModeSet && process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000);
    }
    if (conn.cleanup) {
      conn.cleanup().catch(() => {});
    }
    console.log('');
    process.exit(code);
  };

  ws.on('open', () => {
    console.log(pc.green(`  Connected to ${label}.`));
    console.log(pc.dim('  Waiting for shell session to start...'));
    console.log(pc.dim('  Press Ctrl+] to disconnect.'));
    console.log('');
  });

  ws.on('message', (raw: WebSocket.RawData) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      // Binary data — write directly to stdout
      process.stdout.write(raw as Buffer);
      return;
    }

    switch (msg['type']) {
      case 'session-started': {
        connected = true;
        console.log(pc.green(`  Shell session started (${String(msg['sessionId'])}).`));
        console.log('');

        // Enter raw mode for interactive terminal
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
          rawModeSet = true;
        }
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        process.stdin.on('data', (data: string) => {
          // Ctrl+] (0x1d) to disconnect
          if (data === '\x1d') {
            console.log(pc.dim('\n  Disconnecting...'));
            cleanup(0);
            return;
          }

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input', data }));
          }
        });

        // Send initial terminal size
        if (process.stdout.isTTY) {
          const cols = process.stdout.columns;
          const rows = process.stdout.rows;
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }

        // Handle terminal resize events
        process.stdout.on('resize', () => {
          if (ws.readyState === WebSocket.OPEN) {
            const cols = process.stdout.columns;
            const rows = process.stdout.rows;
            ws.send(JSON.stringify({ type: 'resize', cols, rows }));
          }
        });

        break;
      }

      case 'output': {
        if (typeof msg['data'] === 'string') {
          // Clear screen and write full pane content for clean rendering
          process.stdout.write('\x1b[2J\x1b[H');
          process.stdout.write(msg['data']);
        }
        break;
      }

      case 'agent-disconnected': {
        console.log(pc.yellow('\n  Agent disconnected.'));
        cleanup(1);
        break;
      }

      case 'time-window-expired': {
        console.log(pc.yellow('\n  Shell access time window has expired.'));
        cleanup(0);
        break;
      }

      case 'error': {
        console.error(pc.red(`\n  Error: ${String(msg['message'])}`));
        cleanup(1);
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', (code: number, reason: Buffer) => {
    if (!connected) {
      console.error(
        pc.red(`\n  Connection failed: ${reason.toString() || 'agent may not be available'}\n`),
      );
    }
    cleanup(code === 1000 ? 0 : 1);
  });

  ws.on('error', (err: Error) => {
    console.error(pc.red(`\n  Connection error: ${err.message}\n`));
    cleanup(1);
  });

  // Keep the process alive — the event handlers above manage lifecycle
  await new Promise(() => {});
}
