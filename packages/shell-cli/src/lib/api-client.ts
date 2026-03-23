import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { CliConfig } from './config.js';

export interface ApiClientOpts {
  serverUrl: string;
  apiKey?: string;
  cert?: Buffer;
  key?: Buffer;
  ca?: Buffer;
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  getRaw(path: string): Promise<{ statusCode: number; body: string }>;
}

/**
 * Perform a generic HTTPS request.
 * Supports both API key (Bearer token) and mTLS authentication.
 */
function request(
  opts: ApiClientOpts,
  method: string,
  reqPath: string,
  body?: unknown,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(reqPath, opts.serverUrl);

    const requestOptions: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      rejectUnauthorized: !!opts.ca,
    };

    if (opts.apiKey) {
      (requestOptions.headers as Record<string, string>)['Authorization'] = `Bearer ${opts.apiKey}`;
    }

    if (opts.cert) {
      requestOptions.cert = opts.cert;
    }
    if (opts.key) {
      requestOptions.key = opts.key;
    }
    if (opts.ca) {
      requestOptions.ca = opts.ca;
    }

    const req = https.request(requestOptions, (res) => {
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

    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Create an API client for communicating with the shell server.
 */
export function createApiClient(opts: ApiClientOpts): ApiClient {
  async function apiRequest<T>(method: string, reqPath: string, body?: unknown): Promise<T> {
    const { statusCode, body: responseBody } = await request(opts, method, reqPath, body);

    if (statusCode >= 400) {
      const parsed = tryParseJson(responseBody);
      const msg = (parsed as { error?: string } | null)?.error ?? `HTTP ${statusCode}`;
      throw new Error(msg);
    }

    return JSON.parse(responseBody) as T;
  }

  return {
    get: <T>(p: string) => apiRequest<T>('GET', p),
    post: <T>(p: string, body?: unknown) => apiRequest<T>('POST', p, body),
    patch: <T>(p: string, body?: unknown) => apiRequest<T>('PATCH', p, body),
    del: <T>(p: string) => apiRequest<T>('DELETE', p),
    getRaw: (p: string) => request(opts, 'GET', p),
  };
}

/** Default path for the API key file. */
export const DEFAULT_API_KEY_PATH = path.join(os.homedir(), '.shell', 'api-key');

/**
 * Build an API client from CLI config.
 * Reads the API key from disk and cert/key/ca if paths are configured.
 */
export async function buildApiClient(config: CliConfig): Promise<ApiClient> {
  const apiKeyPath = config.apiKeyPath ? resolveTildePath(config.apiKeyPath) : DEFAULT_API_KEY_PATH;

  let apiKey: string | undefined;
  if (existsSync(apiKeyPath)) {
    apiKey = (await readFile(apiKeyPath, 'utf-8')).trim();
  }

  let cert: Buffer | undefined;
  let key: Buffer | undefined;
  let ca: Buffer | undefined;

  if (config.certPath) {
    const certPath = resolveTildePath(config.certPath);
    cert = await readFile(certPath);
  }
  if (config.keyPath) {
    const keyPath = resolveTildePath(config.keyPath);
    key = await readFile(keyPath);
  }
  if (config.caPath) {
    const caPath = resolveTildePath(config.caPath);
    ca = await readFile(caPath);
  }

  if (!apiKey && !cert) {
    throw new Error(
      `No authentication credentials found.\n` +
        `  Provide an API key at ${apiKeyPath}\n` +
        `  or configure certPath/keyPath in ~/.shell-cli/config.json`,
    );
  }

  const opts: ApiClientOpts = { serverUrl: config.serverUrl };
  if (apiKey) opts.apiKey = apiKey;
  if (cert) opts.cert = cert;
  if (key) opts.key = key;
  if (ca) opts.ca = ca;

  return createApiClient(opts);
}

/**
 * Resolve a path that may start with ~ to the user's home directory.
 */
export function resolveTildePath(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}
