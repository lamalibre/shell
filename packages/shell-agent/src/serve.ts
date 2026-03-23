import pc from 'picocolors';
import { execa } from 'execa';
import type { AgentConfig, TunnelAgentConfig } from './types.js';
import { assertSupportedPlatform } from './lib/platform.js';
import { buildConnectionConfig } from './lib/tls.js';
import { fetchAgentStatus } from './lib/api.js';
import { installShellWrapper, writeBlocklist, killTmuxSession } from './tmux.js';
import { connectRelay, connectRelayWithTicket } from './relay.js';
import { TicketClient, createTicketDispatcher } from '@lamalibre/portlama-tickets';
import { createConsoleTicketLogger } from './lib/panel-api.js';

const POLL_INTERVAL_MS = 10_000;
const RECONNECT_DELAY_MS = 5_000;
const INBOX_POLL_INTERVAL_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run the shell agent daemon: poll for shell config, connect when enabled.
 */
export async function runServe(config: AgentConfig): Promise<never> {
  assertSupportedPlatform();

  console.log('');
  console.log(pc.bold('  Shell Agent'));
  console.log(pc.dim('  ' + '\u2500'.repeat(28)));

  // Verify tmux is installed
  try {
    await execa('which', ['tmux']);
  } catch {
    console.error(pc.red('  tmux is not installed.'));
    console.error('');
    if (process.platform === 'darwin') {
      console.error(pc.dim('  Install with: brew install tmux'));
    } else {
      console.error(pc.dim('  Install with: sudo apt install tmux'));
    }
    console.error('');
    console.error(pc.dim('  tmux is required for remote shell sessions.'));
    process.exit(1);
  }

  // Keychain check for plugin mode
  if (config.mode === 'plugin' && config.authMethod === 'keychain') {
    console.error(
      pc.red('  Shell agent is not yet supported with hardware-bound (Keychain) certificates.'),
    );
    console.error(pc.dim('  Use a P12-enrolled agent for shell access.'));
    process.exit(1);
  }

  // Tunnel mode uses a different connection flow
  if (config.mode === 'tunnel') {
    return runTunnelServe(config);
  }

  // Build connection config (loads TLS once)
  let conn;
  try {
    const wsPath = `/api/shell/agent/${encodeURIComponent(config.mode === 'standalone' ? config.label : (config.label ?? 'unknown'))}`;
    conn = await buildConnectionConfig(config, wsPath);
    console.log(pc.dim('  TLS credentials loaded.'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`  Failed to load credentials: ${message}`));
    process.exit(1);
  }

  // Install the shell wrapper script
  try {
    await installShellWrapper();
    console.log(pc.dim('  Shell wrapper installed.'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.yellow(`  Could not install shell wrapper: ${message}`));
    console.log(pc.dim('  Falling back to /bin/bash for shell sessions.'));
  }

  // Handle graceful shutdown
  let running = true;
  const shutdown = async (): Promise<void> => {
    running = false;
    console.log(pc.dim('\n  Shutting down shell agent...'));
    await killTmuxSession();
    if (conn.cleanup) {
      await conn.cleanup();
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  console.log(pc.dim('  Polling for shell access configuration...'));
  console.log('');

  // Main loop: poll for agent status, connect when enabled
  while (running) {
    let agentStatus;
    try {
      agentStatus = await fetchAgentStatus(conn.httpsUrl, conn.tls);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.yellow(`  Could not reach server: ${message}`));
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!agentStatus.globalEnabled) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!agentStatus.shellEnabled) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const agentLabel = agentStatus.label;
    console.log(pc.green(`  Shell access enabled for agent: ${agentLabel}`));

    // Write blocklist if provided
    if (agentStatus.commandBlocklist) {
      try {
        await writeBlocklist(agentStatus.commandBlocklist);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(pc.yellow(`  Failed to write blocklist: ${message}`));
      }
    }

    // Update connection wsUrl with actual label from server
    const wsPath = `/api/shell/agent/${encodeURIComponent(agentLabel)}`;
    const baseUrl = conn.httpsUrl;
    conn.wsUrl = baseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + wsPath;

    // Connect to the relay
    try {
      await connectRelay(conn);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`  Relay connection failed: ${message}`));
    }

    if (!running) break;

    // Reconnect after a delay
    console.log(pc.dim(`  Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`));
    await sleep(RECONNECT_DELAY_MS);
  }

  // TypeScript needs this to satisfy Promise<never>
  process.exit(0);
}

/**
 * Tunnel mode serve loop: polls ticket inbox via SDK, connects via ticket handshake.
 */
async function runTunnelServe(config: TunnelAgentConfig): Promise<never> {
  const logger = createConsoleTicketLogger('ticket');

  // Create SDK dispatcher and client for panel communication
  let dispatcher: Awaited<ReturnType<typeof createTicketDispatcher>>;
  let client: TicketClient;
  try {
    dispatcher = await createTicketDispatcher({
      certs: {
        p12Path: config.portlamaP12Path,
        p12Password: config.portlamaP12Password,
      },
    });
    client = new TicketClient({
      panelUrl: config.panelUrl,
      dispatcher,
      logger,
    });
    console.log(pc.dim('  Ticket client initialized (P12 mTLS).'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`  Failed to initialize ticket client: ${message}`));
    process.exit(1);
  }

  console.log(pc.dim('  Tunnel mode — polling ticket inbox via panel.'));

  // Install the shell wrapper script
  try {
    await installShellWrapper();
    console.log(pc.dim('  Shell wrapper installed.'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.yellow(`  Could not install shell wrapper: ${message}`));
    console.log(pc.dim('  Falling back to /bin/bash for shell sessions.'));
  }

  // Handle graceful shutdown
  let running = true;
  const shutdown = async (): Promise<void> => {
    running = false;
    console.log(pc.dim('\n  Shutting down shell agent (tunnel mode)...'));
    await killTmuxSession();
    await dispatcher.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  console.log(pc.dim('  Polling ticket inbox for shell:connect tickets...'));
  console.log('');

  while (running) {
    // Poll inbox for shell:connect tickets
    let tickets;
    try {
      tickets = await client.fetchInbox();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.yellow(`  Could not reach panel: ${message}`));
      await sleep(INBOX_POLL_INTERVAL_MS);
      continue;
    }

    // Find a shell:connect ticket
    const shellTicket = tickets.find((t) => t.scope === 'shell:connect');
    if (!shellTicket) {
      await sleep(INBOX_POLL_INTERVAL_MS);
      continue;
    }

    console.log(pc.green(`  Received shell:connect ticket from ${shellTicket.source}`));

    // Validate the ticket with the panel (marks it as used)
    let validation;
    try {
      validation = await client.validateTicket(shellTicket.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`  Ticket validation failed: ${message}`));
      await sleep(RECONNECT_DELAY_MS);
      continue;
    }

    if (!validation.valid) {
      console.error(pc.red('  Ticket is not valid.'));
      await sleep(RECONNECT_DELAY_MS);
      continue;
    }

    // Report session creation to panel (server generates session ID)
    let panelSessionId: string | undefined;
    try {
      const result = await client.reportSessionCreation(shellTicket.id);
      panelSessionId = result.session.sessionId;
      console.log(pc.dim(`  Session reported to panel: ${panelSessionId}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.yellow(`  Failed to report session to panel: ${message}`));
      // Non-fatal — continue with connection
    }

    // Connect to relay via ticket handshake
    const wsPath = `/api/shell/agent-ticket/${encodeURIComponent(config.label)}`;
    const wsUrl = config.serverUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + wsPath;

    try {
      const panelSession = panelSessionId
        ? { client, sessionId: panelSessionId }
        : undefined;
      await connectRelayWithTicket(wsUrl, config.label, shellTicket.id, panelSession);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`  Relay connection failed: ${message}`));
    }

    if (!running) break;

    // Reconnect after a delay
    console.log(pc.dim(`  Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`));
    await sleep(RECONNECT_DELAY_MS);
  }

  process.exit(0);
}
