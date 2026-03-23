export function formatDate(isoDate: string | undefined | null): string {
  try {
    if (!isoDate) return 'unknown';
    const d = new Date(isoDate);
    return d.toLocaleString();
  } catch {
    return isoDate ?? 'unknown';
  }
}

export function formatDuration(seconds: number | undefined | null): string {
  if (seconds == null) return 'ongoing';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

export function formatTimeRemaining(isoDate: string | undefined | null): string {
  if (!isoDate) return 'none';
  const now = Date.now();
  const target = new Date(isoDate).getTime();
  const diffMs = target - now;
  if (diffMs <= 0) return 'expired';
  const diffSeconds = Math.floor(diffMs / 1000);
  return formatDuration(diffSeconds);
}
