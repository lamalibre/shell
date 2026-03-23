import { createWriteStream, fdatasyncSync, type WriteStream } from 'node:fs';
import { mkdir, readdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';

const LABEL_RE = /^[a-z0-9-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function validateLabel(label: string): void {
  if (!LABEL_RE.test(label)) {
    throw new Error(`Invalid label: must match /^[a-z0-9-]+$/, got "${label}"`);
  }
}

export interface RecordingStream {
  write(data: Buffer | string): void;
  close(): Promise<void>;
}

/**
 * Return the base directory for server-side recordings.
 */
export function recordingsBaseDir(stateDir: string): string {
  return path.join(stateDir, 'recordings');
}

/**
 * Return the directory for a specific agent's recordings.
 */
export function recordingsDir(stateDir: string, label: string): string {
  validateLabel(label);
  return path.join(recordingsBaseDir(stateDir), label);
}

/**
 * Return the file path for a specific recording.
 */
export function recordingFilePath(stateDir: string, label: string, sessionId: string): string {
  if (!UUID_RE.test(sessionId)) {
    throw new Error(`Invalid sessionId: must be a valid UUID, got "${sessionId}"`);
  }
  return path.join(recordingsDir(stateDir, label), `${sessionId}.log`);
}

/**
 * Create a recording stream for a session.
 * Writes output frames to {stateDir}/recordings/{label}/{sessionId}.log
 * using atomic file operations (write to .tmp, rename on close).
 */
export async function createRecordingStream(
  stateDir: string,
  label: string,
  sessionId: string,
): Promise<RecordingStream> {
  validateLabel(label);
  const dir = recordingsDir(stateDir, label);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const finalPath = recordingFilePath(stateDir, label, sessionId);
  const tmpPath = `${finalPath}.tmp`;

  const stream: WriteStream = createWriteStream(tmpPath, {
    flags: 'w',
    mode: 0o600,
    encoding: 'utf-8',
  });

  // Capture the file descriptor once the stream is open
  const fdReady = new Promise<number>((resolve, reject) => {
    stream.on('open', (fd) => resolve(fd));
    stream.on('error', (err) => reject(err));
  });

  return {
    write(data: Buffer | string): void {
      const content = typeof data === 'string' ? data : data.toString('utf-8');
      const timestamp = new Date().toISOString();
      stream.write(`[${timestamp}] ${content}\n`);
    },
    async close(): Promise<void> {
      const fd = await fdReady;
      await new Promise<void>((resolve, reject) => {
        stream.end(() => {
          // fsync before closing to ensure data is flushed to disk
          try {
            fdatasyncSync(fd);
          } catch (syncErr) {
            reject(syncErr);
            return;
          }
          stream.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      });
      // Atomic rename from .tmp to final path
      await rename(tmpPath, finalPath);
    },
  };
}

/**
 * Close a recording stream safely, ignoring errors.
 */
export async function closeRecordingStream(recording: RecordingStream | null): Promise<void> {
  if (!recording) return;
  try {
    await recording.close();
  } catch {
    /* best effort — recording may have already been closed or dir removed */
  }
}

/**
 * List available recording files for an agent.
 * Returns session IDs extracted from filenames.
 */
export async function listRecordingFiles(
  stateDir: string,
  label: string,
): Promise<string[]> {
  validateLabel(label);
  const dir = recordingsDir(stateDir, label);
  try {
    const entries = await readdir(dir);
    return entries
      .filter((f) => f.endsWith('.log') && !f.endsWith('.tmp'))
      .map((f) => f.replace(/\.log$/, ''))
      .filter((id) => UUID_RE.test(id));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Check if a recording file exists and return its stat info.
 */
export async function getRecordingStat(
  stateDir: string,
  label: string,
  sessionId: string,
): Promise<{ exists: true; size: number; path: string } | { exists: false }> {
  const filePath = recordingFilePath(stateDir, label, sessionId);
  try {
    const s = await stat(filePath);
    return { exists: true, size: s.size, path: filePath };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false };
    }
    throw err;
  }
}
