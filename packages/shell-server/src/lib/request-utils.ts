import type { FastifyRequest } from 'fastify';

/**
 * Extract the client source IP from the request.
 * Uses Fastify's `request.ip` which respects the server's `trustProxy` setting.
 * Never reads raw proxy headers directly — proxy trust must be configured
 * via Fastify's `trustProxy` option at server creation time.
 */
export function extractSourceIp(request: FastifyRequest): string {
  return request.ip;
}
