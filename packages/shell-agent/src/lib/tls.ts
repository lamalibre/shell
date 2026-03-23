import { readFileSync, existsSync } from 'node:fs';
import { mkdir, chmod, unlink } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { AGENT_DIR } from './platform.js';
import type {
  StandaloneAgentConfig,
  PluginAgentConfig,
  AgentConfig,
  TlsCredentials,
  ConnectionConfig,
  PemFiles,
} from '../types.js';

/** Default path for the CA certificate extracted from a P12 bundle. */
const CA_CERT_PATH = path.join(AGENT_DIR, 'ca.crt');

/**
 * Load TLS credentials for standalone mode.
 * Reads PEM files directly from disk — no extraction needed.
 */
export function loadStandaloneTls(config: StandaloneAgentConfig): TlsCredentials {
  const cert = readFileSync(config.certPath);
  const key = readFileSync(config.keyPath);
  const hasCa = existsSync(config.caPath);
  const tls: TlsCredentials = {
    cert,
    key,
    rejectUnauthorized: hasCa,
  };
  if (hasCa) {
    tls.ca = readFileSync(config.caPath);
  }
  return tls;
}

/**
 * Extract PEM certificate, key, and CA from a P12 bundle using the openssl CLI.
 * The P12 password is passed via environment variable to avoid exposure in
 * process listings.
 */
export async function extractPemFromP12(p12Path: string, p12Password: string): Promise<PemFiles> {
  const pemDir = path.join(AGENT_DIR, '.pem');
  await mkdir(pemDir, { recursive: true, mode: 0o700 });

  const certPath = path.join(pemDir, 'client-cert.pem');
  const keyPath = path.join(pemDir, 'client-key.pem');

  const opensslEnv = { ...process.env, SHELL_AGENT_P12_PASS: p12Password };

  // Extract client certificate
  await execa(
    'openssl',
    [
      'pkcs12',
      '-in',
      p12Path,
      '-clcerts',
      '-nokeys',
      '-out',
      certPath,
      '-passin',
      'env:SHELL_AGENT_P12_PASS',
      '-legacy',
    ],
    { env: opensslEnv },
  );

  // Extract private key
  await execa(
    'openssl',
    [
      'pkcs12',
      '-in',
      p12Path,
      '-nocerts',
      '-nodes',
      '-out',
      keyPath,
      '-passin',
      'env:SHELL_AGENT_P12_PASS',
      '-legacy',
    ],
    { env: opensslEnv },
  );

  // Restrict private key file permissions
  await chmod(keyPath, 0o600);

  // Extract CA certificate from the P12 bundle
  let caPath: string | null = null;
  try {
    await execa(
      'openssl',
      [
        'pkcs12',
        '-in',
        p12Path,
        '-cacerts',
        '-nokeys',
        '-out',
        CA_CERT_PATH,
        '-passin',
        'env:SHELL_AGENT_P12_PASS',
        '-legacy',
      ],
      { env: opensslEnv },
    );

    if (
      existsSync(CA_CERT_PATH) &&
      readFileSync(CA_CERT_PATH, 'utf8').includes('BEGIN CERTIFICATE')
    ) {
      await chmod(CA_CERT_PATH, 0o644);
      caPath = CA_CERT_PATH;
    } else if (existsSync(CA_CERT_PATH)) {
      await unlink(CA_CERT_PATH).catch(() => {});
    }
  } catch {
    // CA cert may not be present in the P12 — acceptable
  }

  const cleanup = async (): Promise<void> => {
    try {
      await unlink(certPath);
    } catch {
      // best-effort
    }
    try {
      await unlink(keyPath);
    } catch {
      // best-effort
    }
  };

  return { certPath, keyPath, caPath, cleanup };
}

/**
 * Load TLS credentials for plugin mode.
 * Extracts PEM from P12 and builds TLS options.
 */
export async function loadPluginTls(
  config: PluginAgentConfig,
): Promise<{ tls: TlsCredentials; cleanup: () => Promise<void> }> {
  if (config.authMethod === 'keychain') {
    throw new Error(
      'Shell agent is not yet supported with hardware-bound (Keychain) certificates.\n' +
        'Use a P12-enrolled agent for shell access.',
    );
  }

  if (!config.p12Path || !config.p12Password) {
    throw new Error('Plugin mode with P12 auth requires p12Path and p12Password');
  }

  const pem = await extractPemFromP12(config.p12Path, config.p12Password);

  const cert = readFileSync(pem.certPath);
  const key = readFileSync(pem.keyPath);
  const tls: TlsCredentials = {
    cert,
    key,
    // Self-signed server cert — skip verification for plugin mode
    rejectUnauthorized: false,
  };
  if (pem.caPath) {
    tls.ca = readFileSync(pem.caPath);
  }

  return { tls, cleanup: pem.cleanup };
}

/**
 * Convert an HTTPS/HTTP URL to WSS/WS.
 */
export function buildWsUrl(baseUrl: string, wsPath: string): string {
  return baseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + wsPath;
}

/**
 * Resolve the base HTTPS URL from an agent config.
 */
function resolveBaseUrl(config: AgentConfig): string {
  if (config.mode === 'standalone') {
    return config.serverUrl;
  }
  if (config.mode === 'tunnel') {
    return config.serverUrl;
  }
  return config.panelUrl;
}

/**
 * Build a complete ConnectionConfig from an AgentConfig.
 * Loads TLS credentials and resolves URLs for the given WebSocket path.
 */
export async function buildConnectionConfig(
  config: AgentConfig,
  wsPath: string,
): Promise<ConnectionConfig> {
  const baseUrl = resolveBaseUrl(config);

  if (config.mode === 'standalone') {
    const tls = loadStandaloneTls(config);
    return {
      wsUrl: buildWsUrl(baseUrl, wsPath),
      httpsUrl: baseUrl,
      tls,
      label: config.label,
    };
  }

  if (config.mode === 'tunnel') {
    // Tunnel mode: no client cert needed (ticket-based auth via public HTTPS)
    const tls: TlsCredentials = {
      cert: Buffer.alloc(0),
      key: Buffer.alloc(0),
      rejectUnauthorized: true,
    };
    return {
      wsUrl: buildWsUrl(baseUrl, wsPath),
      httpsUrl: baseUrl,
      tls,
      label: config.label,
    };
  }

  // Plugin mode
  const { tls, cleanup } = await loadPluginTls(config);
  const label = config.label ?? 'unknown';

  return {
    wsUrl: buildWsUrl(baseUrl, wsPath),
    httpsUrl: baseUrl,
    tls,
    label,
    cleanup,
  };
}
