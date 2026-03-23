/**
 * Format a date string for display.
 */
export function formatDate(isoDate: string | undefined | null): string {
  try {
    if (!isoDate) return 'unknown';
    const d = new Date(isoDate);
    return d.toLocaleString();
  } catch {
    return isoDate ?? 'unknown';
  }
}

/**
 * Format duration in seconds to human-readable.
 */
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

/**
 * Format time remaining from an ISO date string to a human-readable duration.
 * Returns null if the date is in the past.
 */
export function formatTimeRemaining(isoDate: string): string | null {
  const target = new Date(isoDate).getTime();
  const now = Date.now();
  const diffMs = target - now;
  if (diffMs <= 0) return null;
  const diffSec = Math.floor(diffMs / 1000);
  return formatDuration(diffSec);
}
