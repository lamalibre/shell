import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { atomicWriteJson } from '../lib/file-utils.js';

export interface JoinToken {
  token: string;
  label: string;
  createdAt: string;
  expiresAt: string;
}

const TOKENS_FILE = 'join-tokens.json';

let tokenLock = Promise.resolve();
function withTokenLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = tokenLock.then(fn, fn);
  tokenLock = next.then(
    () => {},
    () => {},
  );
  return next;
}

async function loadTokens(stateDir: string): Promise<JoinToken[]> {
  try {
    const raw = await readFile(path.join(stateDir, TOKENS_FILE), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as JoinToken[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

async function saveTokens(stateDir: string, tokens: JoinToken[]): Promise<void> {
  await atomicWriteJson(path.join(stateDir, TOKENS_FILE), tokens);
}

/**
 * Remove expired tokens from the list.
 */
function pruneExpired(tokens: JoinToken[]): JoinToken[] {
  const now = Date.now();
  return tokens.filter((t) => new Date(t.expiresAt).getTime() > now);
}

/**
 * Create a one-time join token for agent enrollment.
 * Default TTL: 10 minutes.
 */
export function createJoinToken(
  stateDir: string,
  label: string,
  ttlMinutes = 10,
): Promise<JoinToken> {
  return withTokenLock(async () => {
    const tokens = pruneExpired(await loadTokens(stateDir));

    const token: JoinToken = {
      token: randomBytes(32).toString('hex'),
      label,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
    };

    tokens.push(token);
    await saveTokens(stateDir, tokens);

    return token;
  });
}

/**
 * Consume a join token. Returns the token data if valid, null otherwise.
 * The token is removed from storage after consumption.
 */
export function consumeJoinToken(stateDir: string, tokenValue: string): Promise<JoinToken | null> {
  return withTokenLock(async () => {
    const tokens = pruneExpired(await loadTokens(stateDir));
    const idx = tokens.findIndex((t) => {
      if (t.token.length !== tokenValue.length) return false;
      return timingSafeEqual(Buffer.from(t.token), Buffer.from(tokenValue));
    });

    if (idx === -1) return null;

    const consumed = tokens[idx]!;
    tokens.splice(idx, 1);
    await saveTokens(stateDir, tokens);

    return consumed;
  });
}
