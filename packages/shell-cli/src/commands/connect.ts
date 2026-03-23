import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import pc from 'picocolors';
import WebSocket from 'ws';
import type { CliConfig } from '../lib/config.js';
import { DEFAULT_API_KEY_PATH, resolveTildePath } from '../lib/api-client.js';

/**
 * Run the interactive shell connect command.
 * Connects to a remote agent's shell via the server WebSocket relay.
 * Supports both API key auth (via Authorization header) and mTLS.
 */
export async function runConnectCommand(label: string, config: CliConfig): Promise<void> {
  console.log('');
  console.log(pc.dim(`  Connecting to agent ${pc.bold(label)}...`));

  // Build WebSocket URL
  const wsPath = `/api/shell/connect/${encodeURIComponent(label)}`;
  const wsUrl = config.serverUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + wsPath;

  // Prepare WebSocket options
  let ca: Buffer | undefined;
  if (config.caPath) {
    ca = await readFile(resolveTildePath(config.caPath));
  }

  const headers: Record<string, string> = {};

  // Load API key if available
  const apiKeyPath = config.apiKeyPath ? resolveTildePath(config.apiKeyPath) : DEFAULT_API_KEY_PATH;

  if (existsSync(apiKeyPath)) {
    const apiKey = (await readFile(apiKeyPath, 'utf-8')).trim();
    if (apiKey.length > 0) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
  }

  const wsOptions: WebSocket.ClientOptions = {
    rejectUnauthorized: !!ca,
    headers,
  };

  // Load mTLS credentials if configured
  if (config.certPath) {
    wsOptions.cert = await readFile(resolveTildePath(config.certPath));
  }
  if (config.keyPath) {
    wsOptions.key = await readFile(resolveTildePath(config.keyPath));
  }
  if (ca) {
    wsOptions.ca = ca;
  }

  // Verify we have at least one auth mechanism
  const hasApiKey = headers['Authorization'] !== undefined;
  const hasCert = wsOptions.cert !== undefined;

  if (!hasApiKey && !hasCert) {
    console.error(
      pc.red(
        `\n  No authentication credentials found.\n` +
          `  Provide an API key at ${apiKeyPath}\n` +
          `  or configure certPath/keyPath in ~/.shell-cli/config.json\n`,
      ),
    );
    process.exit(1);
  }

  const ws = new WebSocket(wsUrl, wsOptions);

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
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      process.stdout.write(buf);
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
