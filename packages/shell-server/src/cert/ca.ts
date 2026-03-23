import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import forge from 'node-forge';

const CA_CERT_FILE = 'ca.crt';
const CA_KEY_FILE = 'ca.key';
const SERVER_CERT_FILE = 'server.crt';
const SERVER_KEY_FILE = 'server.key';

/**
 * Ensure the CA root certificate and key exist.
 * Generates a new 10-year self-signed root CA if not found.
 */
export async function ensureCa(stateDir: string): Promise<{ caCertPem: string; caKeyPem: string }> {
  const certPath = path.join(stateDir, CA_CERT_FILE);
  const keyPath = path.join(stateDir, CA_KEY_FILE);

  if (existsSync(certPath) && existsSync(keyPath)) {
    const caCertPem = await readFile(certPath, 'utf-8');
    const caKeyPem = await readFile(keyPath, 'utf-8');
    return { caCertPem, caKeyPem };
  }

  await mkdir(stateDir, { recursive: true, mode: 0o700 });

  const keys = forge.pki.rsa.generateKeyPair(4096);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(16));
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 10);

  const attrs = [{ name: 'commonName', value: 'Shell Root CA' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    {
      name: 'keyUsage',
      keyCertSign: true,
      cRLSign: true,
    },
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  const caCertPem = forge.pki.certificateToPem(cert);
  const caKeyPem = forge.pki.privateKeyToPem(keys.privateKey);

  await writeFile(certPath, caCertPem, { encoding: 'utf-8', mode: 0o644 });
  await writeFile(keyPath, caKeyPem, { encoding: 'utf-8', mode: 0o600 });

  return { caCertPem, caKeyPem };
}

/**
 * Extract SANs (DNS hostnames + IP addresses) from an existing certificate.
 */
function extractSans(certPem: string): string[] {
  const cert = forge.pki.certificateFromPem(certPem);
  const sanExt = cert.getExtension('subjectAltName') as
    | { altNames?: Array<{ type: number; value?: string; ip?: string }> }
    | undefined;
  if (!sanExt?.altNames) return [];
  return sanExt.altNames
    .map((an) => {
      if (an.type === 2 && typeof an.value === 'string') return an.value;
      if (an.type === 7 && typeof an.ip === 'string') return an.ip;
      return undefined;
    })
    .filter((v): v is string => v !== undefined);
}

/**
 * Ensure the server TLS certificate exists.
 * Generates a new 1-year cert signed by the root CA for localhost/127.0.0.1.
 * When extraSANs are provided and differ from the existing cert, regenerates.
 */
export async function ensureServerCert(
  stateDir: string,
  extraSANs?: string[],
): Promise<{ certPem: string; keyPem: string }> {
  const certPath = path.join(stateDir, SERVER_CERT_FILE);
  const keyPath = path.join(stateDir, SERVER_KEY_FILE);

  if (existsSync(certPath) && existsSync(keyPath)) {
    // If extraSANs requested, check whether cert already has them
    if (extraSANs && extraSANs.length > 0) {
      const existingPem = await readFile(certPath, 'utf-8');
      const existingSans = extractSans(existingPem);
      const missing = extraSANs.some((san) => !existingSans.includes(san));
      if (missing) {
        // SANs mismatch — delete and regenerate
        await unlink(certPath);
        await unlink(keyPath);
      } else {
        const keyPem = await readFile(keyPath, 'utf-8');
        return { certPem: existingPem, keyPem };
      }
    } else {
      const certPem = await readFile(certPath, 'utf-8');
      const keyPem = await readFile(keyPath, 'utf-8');
      return { certPem, keyPem };
    }
  }

  const { caCertPem, caKeyPem } = await ensureCa(stateDir);
  const caCert = forge.pki.certificateFromPem(caCertPem);
  const caKey = forge.pki.privateKeyFromPem(caKeyPem);

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(16));
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);

  cert.setSubject([{ name: 'commonName', value: 'localhost' }]);
  cert.setIssuer(caCert.subject.attributes);

  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
    },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        { type: 7, ip: '::1' },
        ...(extraSANs ?? []).map((san) =>
          /^\d{1,3}(\.\d{1,3}){3}$/.test(san)
            ? { type: 7 as const, ip: san }
            : { type: 2 as const, value: san },
        ),
      ],
    },
  ]);

  cert.sign(caKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

  await writeFile(certPath, certPem, { encoding: 'utf-8', mode: 0o644 });
  await writeFile(keyPath, keyPem, { encoding: 'utf-8', mode: 0o600 });

  return { certPem, keyPem };
}

/**
 * Sign an agent CSR with the root CA.
 * Returns a 1-year certificate with CN=agent:<label>.
 */
export async function signAgentCsr(
  stateDir: string,
  csrPem: string,
  label: string,
): Promise<string> {
  const { caCertPem, caKeyPem } = await ensureCa(stateDir);
  const caCert = forge.pki.certificateFromPem(caCertPem);
  const caKey = forge.pki.privateKeyFromPem(caKeyPem);
  const csr = forge.pki.certificationRequestFromPem(csrPem);

  if (!csr.verify()) {
    throw new Error('Invalid CSR signature');
  }

  if (!csr.publicKey) {
    throw new Error('CSR has no public key');
  }

  const cert = forge.pki.createCertificate();
  cert.publicKey = csr.publicKey;
  cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(16));
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);

  cert.setSubject([{ name: 'commonName', value: `agent:${label}` }]);
  cert.setIssuer(caCert.subject.attributes);

  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'keyUsage',
      digitalSignature: true,
    },
    { name: 'extKeyUsage', clientAuth: true },
  ]);

  cert.sign(caKey, forge.md.sha256.create());

  return forge.pki.certificateToPem(cert);
}
