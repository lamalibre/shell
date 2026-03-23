/**
 * Strip the ::ffff: prefix from IPv4-mapped IPv6 addresses so that
 * comparisons work consistently against plain IPv4 entries.
 */
function normalizeIp(ip: string): string {
  if (ip.startsWith('::ffff:')) {
    return ip.slice(7);
  }
  return ip;
}

/**
 * Convert an IPv4 address string to a 32-bit number.
 * Returns null if the address is invalid.
 */
function ipToNum(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    if (part === '' || (part.length > 1 && part.startsWith('0'))) return null;
    const n = Number(part);
    if (isNaN(n) || !Number.isInteger(n) || n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

/**
 * Check if an IPv4 address is within a CIDR range.
 */
function ipInCidr(ip: string, cidr: string): boolean {
  const slashIdx = cidr.indexOf('/');
  if (slashIdx === -1) return false;

  const range = cidr.slice(0, slashIdx);
  const bits = parseInt(cidr.slice(slashIdx + 1), 10);
  if (isNaN(bits) || bits < 1 || bits > 32) return false;

  const mask = ~(2 ** (32 - bits) - 1);
  const ipNum = ipToNum(ip);
  const rangeNum = ipToNum(range);
  if (ipNum === null || rangeNum === null) return false;

  return (ipNum & mask) === (rangeNum & mask);
}

/**
 * Check if an IP matches any entry in a list of IPs/CIDRs.
 */
function matchesAny(ip: string, list: readonly string[]): boolean {
  const normalized = normalizeIp(ip);
  for (const entry of list) {
    const normalizedEntry = normalizeIp(entry);
    if (normalizedEntry.includes('/')) {
      if (ipInCidr(normalized, normalizedEntry)) return true;
    } else {
      if (normalized === normalizedEntry) return true;
    }
  }
  return false;
}

/**
 * Check if an IP address is allowed by shell access control lists.
 *
 * Rules:
 * - deniedIps takes precedence over allowedIps
 * - Empty allowedIps means all IPs allowed
 * - If allowedIps has entries, only those IPs/CIDRs can connect
 */
export function isIpAllowed(
  ip: string,
  allowedIps: readonly string[],
  deniedIps: readonly string[],
): boolean {
  if (deniedIps.length > 0 && matchesAny(ip, deniedIps)) {
    return false;
  }
  if (allowedIps.length === 0) {
    return true;
  }
  return matchesAny(ip, allowedIps);
}
