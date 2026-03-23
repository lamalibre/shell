import https from 'node:https';
import pc from 'picocolors';
import forge from 'node-forge';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AGENT_DIR } from './lib/platform.js';
import { saveAgentConfig } from './lib/config.js';
import type { StandaloneAgentConfig } from './types.js';

export interface EnrollOpts {
  server: string;
  token: string;
  label?: string | undefined;
}

interface EnrollResponse {
  cert: string;
  ca: string;
  label: string;
}

/**
 * POST JSON to a URL, skipping TLS verification for self-signed server certs.
 */
function httpsPost(
  url: string,
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
      rejectUnauthorized: false, // Self-signed server cert during enrollment
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
 * Generate an RSA 2048 keypair and CSR with CN=agent:<label>.
 */
function generateCsr(label: string): { privateKeyPem: string; csrPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  csr.setSubject([{ name: 'commonName', value: `agent:${label}` }]);
  csr.sign(keys.privateKey, forge.md.sha256.create());

  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    csrPem: forge.pki.certificationRequestToPem(csr),
  };
}

/**
 * Enroll this agent with a standalone shell server.
 * Generates a CSR, sends it with the join token, receives signed cert + CA.
 */
export async function runEnroll(opts: EnrollOpts): Promise<void> {
  const { server, token } = opts;
  const label = opts.label ?? `agent-${Date.now()}`;

  console.log('');
  console.log(pc.dim(`  Enrolling with server: ${server}`));
  console.log(pc.dim(`  Agent label: ${label}`));

  // Generate keypair + CSR
  console.log(pc.dim('  Generating RSA 2048 keypair...'));
  const { privateKeyPem, csrPem } = generateCsr(label);

  // Send enrollment request
  console.log(pc.dim('  Sending enrollment request...'));
  const enrollUrl = `${server}/api/shell/enroll`;
  const { statusCode, body } = await httpsPost(enrollUrl, { token, csr: csrPem });

  if (statusCode >= 400) {
    let errorMsg: string;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      errorMsg = parsed.error ?? `HTTP ${statusCode}`;
    } catch {
      errorMsg = `HTTP ${statusCode}: ${body}`;
    }
    console.error(pc.red(`\n  Enrollment failed: ${errorMsg}\n`));
    process.exit(1);
  }

  const response = JSON.parse(body) as EnrollResponse;

  // Save certificate files
  await mkdir(AGENT_DIR, { recursive: true, mode: 0o700 });

  const certPath = path.join(AGENT_DIR, 'cert.pem');
  const keyPath = path.join(AGENT_DIR, 'key.pem');
  const caPath = path.join(AGENT_DIR, 'ca.crt');

  await writeFile(certPath, response.cert, { encoding: 'utf-8', mode: 0o644 });
  await writeFile(keyPath, privateKeyPem, { encoding: 'utf-8', mode: 0o600 });
  await writeFile(caPath, response.ca, { encoding: 'utf-8', mode: 0o644 });

  // Save agent config
  const agentConfig: StandaloneAgentConfig = {
    mode: 'standalone',
    serverUrl: server,
    label: response.label,
    certPath,
    keyPath,
    caPath,
  };
  await saveAgentConfig(agentConfig);

  console.log('');
  console.log(pc.green(`  Enrolled successfully as "${response.label}".`));
  console.log(pc.dim(`  Config saved to ${path.relative(process.cwd(), AGENT_DIR)}/`));
  console.log(pc.dim(`  Certificate: ${certPath}`));
  console.log(pc.dim(`  CA:          ${caPath}`));
  console.log('');
  console.log(pc.dim('  Start the agent with:'));
  console.log(`  ${pc.cyan('shell-agent serve')}`);
  console.log('');
}
