import https from 'node:https';
import { writeFile } from 'node:fs/promises';
import type { TlsCredentials, AgentStatus, ShellSessionEntry } from '../types.js';

/**
 * Perform an HTTPS request with mTLS credentials.
 * Uses Node's built-in https module for client certificate support.
 */
function httpsRequest(
  url: string,
  tls: TlsCredentials,
  method: string = 'GET',
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method,
      cert: tls.cert,
      key: tls.key,
      ca: tls.ca,
      rejectUnauthorized: tls.rejectUnauthorized,
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error('Request timed out'));
    });
    req.end();
  });
}

/**
 * Fetch agent status from the shell server.
 * GET /api/shell/agent-status
 */
export async function fetchAgentStatus(
  httpsUrl: string,
  tls: TlsCredentials,
): Promise<AgentStatus> {
  const url = `${httpsUrl}/api/shell/agent-status`;
  const { statusCode, body } = await httpsRequest(url, tls);

  if (statusCode >= 400) {
    const parsed = tryParseJson(body);
    const msg = (parsed as { error?: string } | null)?.error ?? `HTTP ${statusCode}`;
    throw new Error(`Failed to fetch agent status: ${msg}`);
  }

  return JSON.parse(body) as AgentStatus;
}

/**
 * Fetch shell sessions from the server.
 * GET /api/shell/sessions
 */
export async function fetchSessions(
  httpsUrl: string,
  tls: TlsCredentials,
): Promise<{ sessions: ShellSessionEntry[] }> {
  const url = `${httpsUrl}/api/shell/sessions`;
  const { statusCode, body } = await httpsRequest(url, tls);

  if (statusCode >= 400) {
    const parsed = tryParseJson(body);
    const msg = (parsed as { error?: string } | null)?.error ?? `HTTP ${statusCode}`;
    throw new Error(`Failed to fetch sessions: ${msg}`);
  }

  return JSON.parse(body) as { sessions: ShellSessionEntry[] };
}

/**
 * Download a session recording from the server.
 * GET /api/shell/recordings/:label/:sessionId
 */
export async function downloadRecording(
  httpsUrl: string,
  tls: TlsCredentials,
  label: string,
  sessionId: string,
  outputPath: string,
): Promise<void> {
  const url = `${httpsUrl}/api/shell/recordings/${encodeURIComponent(label)}/${encodeURIComponent(sessionId)}`;
  const { statusCode, body } = await httpsRequest(url, tls);

  if (statusCode >= 400) {
    const parsed = tryParseJson(body);
    const msg = (parsed as { error?: string } | null)?.error ?? `HTTP ${statusCode}`;
    throw new Error(`Failed to download recording: ${msg}`);
  }

  await writeFile(outputPath, body, 'utf-8');
}

/**
 * Perform an HTTPS POST with mTLS credentials.
 */
function httpsPost(
  url: string,
  tls: TlsCredentials,
  body: Record<string, unknown>,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = JSON.stringify(body);

    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      cert: tls.cert.length > 0 ? tls.cert : undefined,
      key: tls.key.length > 0 ? tls.key : undefined,
      ca: tls.ca,
      rejectUnauthorized: tls.rejectUnauthorized,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error('Request timed out'));
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Acquire a ticket from the shell server (standalone mode).
 * POST /api/shell/ticket
 */
export async function acquireTicketFromServer(
  httpsUrl: string,
  tls: TlsCredentials,
): Promise<{ ticket: string; expiresIn: number }> {
  const url = `${httpsUrl}/api/shell/ticket`;
  const { statusCode, body } = await httpsPost(url, tls, {});

  if (statusCode >= 400) {
    const parsed = tryParseJson(body);
    const msg = (parsed as { error?: string } | null)?.error ?? `HTTP ${statusCode}`;
    throw new Error(`Failed to acquire ticket from server: ${msg}`);
  }

  return JSON.parse(body) as { ticket: string; expiresIn: number };
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
