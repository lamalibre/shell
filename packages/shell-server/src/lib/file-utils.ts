import { writeFile, rename, open } from 'node:fs/promises';

/**
 * Write JSON data to a file atomically.
 * Uses temp file → fsync → rename to survive power loss.
 */
export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  const content = JSON.stringify(data, null, 2) + '\n';

  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });

  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();

  await rename(tmpPath, filePath);
}
