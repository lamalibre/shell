import * as https from 'node:https';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { PortlamaConfig } from './detect.js';

export interface CreateTunnelResult {
  id: string;
  subdomain: string;
  fqdn: string;
  port: number;
  enabled: boolean;
  createdAt: string;
}

/**
 * Create a Portlama tunnel via the panel API.
 * Uses P12 mTLS auth.
 */
export async function createTunnel(
  config: PortlamaConfig,
  subdomain: string,
  port: number,
  options: { authelia?: boolean } = {},
): Promise<CreateTunnelResult> {
  if (!config.p12Path || !config.p12Password) {
    throw new Error('P12 credentials required for tunnel creation');
  }

  const body = {
    subdomain,
    port,
    authelia: options.authelia ?? true,
  };

  const result = await httpsPostP12(
    `${config.panelUrl}/api/tunnels`,
    config.p12Path,
    config.p12Password,
    body,
  );

  if (result.statusCode === 409) {
    throw new ConflictError(`Subdomain "${subdomain}" is already taken`);
  }

  if (result.statusCode >= 400) {
    let msg: string;
    try {
      const parsed = JSON.parse(result.body) as { error?: string };
      msg = parsed.error ?? `HTTP ${result.statusCode}`;
    } catch {
      msg = `HTTP ${result.statusCode}`;
    }
    throw new Error(`Failed to create tunnel: ${msg}`);
  }

  return JSON.parse(result.body) as CreateTunnelResult;
}

/**
 * Create a tunnel with automatic retry on subdomain conflicts.
 */
export async function createTunnelWithRetry(
  config: PortlamaConfig,
  port: number,
  maxAttempts: number = 3,
): Promise<CreateTunnelResult & { subdomain: string }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const subdomain = randomBytes(3).toString('hex') + '-shell';
    try {
      const result = await createTunnel(config, subdomain, port, { authelia: false });
      return { ...result, subdomain };
    } catch (err) {
      if (err instanceof ConflictError && attempt < maxAttempts - 1) {
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to create tunnel after max attempts');
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

function httpsPostP12(
  url: string,
  p12Path: string,
  p12Password: string,
  body: Record<string, unknown>,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = JSON.stringify(body);
    const pfx = readFileSync(p12Path);

    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      pfx,
      passphrase: p12Password,
      rejectUnauthorized: false,
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

    req.on('error', (err) => reject(new Error(`Connection failed: ${err.message}`)));
    req.setTimeout(30_000, () => req.destroy(new Error('Request timed out')));
    req.write(payload);
    req.end();
  });
}
