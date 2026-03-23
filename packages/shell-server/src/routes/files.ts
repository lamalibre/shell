import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteOpts } from '../types.js';
import '../types.js'; // ensure declaration merging is loaded
import { validateShellAccess } from '../lib/shell.js';
import { AgentLabelParamSchema, FilePathQuerySchema } from '../schemas.js';
import { extractSourceIp } from '../lib/request-utils.js';
import { z } from 'zod';

export default async function fileRoutes(fastify: FastifyInstance, opts: RouteOpts): Promise<void> {
  const { ctx, requireRole } = opts;

  // GET /file/:label — download a file from an agent
  fastify.get(
    '/file/:label',
    { preHandler: requireRole(['admin']) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { label } = AgentLabelParamSchema.parse(request.params);

      let query;
      try {
        query = FilePathQuerySchema.parse(request.query);
      } catch {
        return reply.code(400).send({ error: 'Invalid file path' });
      }

      const sourceIp = extractSourceIp(request);
      const access = await validateShellAccess(ctx, label, sourceIp);
      if (!access.ok) {
        return reply.code(access.statusCode).send({ error: access.error });
      }

      // Check if agent has an active session (WebSocket connected)
      if (!fastify.hasActiveSession(label)) {
        return reply.code(409).send({ error: 'Agent does not have an active session' });
      }

      const requestId = randomUUID();
      request.log.info({ label, path: query.path, requestId }, 'File download request via relay');

      try {
        const data = await fastify.sendFileRequest(label, query.path, requestId);
        const buffer = Buffer.from(data, 'base64');

        // Extract filename from path and sanitize to safe characters only
        const segments = query.path.split('/');
        const rawFilename = segments.filter(Boolean).pop() ?? 'download';
        const filename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'download';

        return reply
          .header('Content-Type', 'application/octet-stream')
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .header('Content-Length', buffer.length)
          .send(buffer);
      } catch (err) {
        request.log.error({ err, label, path: query.path }, 'File download failed');
        return reply.code(502).send({ error: 'File download failed' });
      }
    },
  );

  // POST /file/:label — upload a file to an agent
  fastify.post(
    '/file/:label',
    { preHandler: requireRole(['admin']) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { label } = AgentLabelParamSchema.parse(request.params);

      let query;
      try {
        query = FilePathQuerySchema.parse(request.query);
      } catch {
        return reply.code(400).send({ error: 'Invalid file path' });
      }

      const sourceIp = extractSourceIp(request);
      const access = await validateShellAccess(ctx, label, sourceIp);
      if (!access.ok) {
        return reply.code(access.statusCode).send({ error: access.error });
      }

      // Check if agent has an active session (WebSocket connected)
      if (!fastify.hasActiveSession(label)) {
        return reply.code(409).send({ error: 'Agent does not have an active session' });
      }

      // Read the request body as a buffer and encode as base64
      const body = request.body;
      let base64Data: string;

      if (Buffer.isBuffer(body)) {
        base64Data = body.toString('base64');
      } else if (typeof body === 'string') {
        base64Data = Buffer.from(body).toString('base64');
      } else {
        // For JSON bodies, validate with Zod
        const JsonUploadSchema = z.object({ data: z.string() });
        const parsed = JsonUploadSchema.safeParse(body);
        if (!parsed.success) {
          return reply.code(400).send({ error: 'Invalid upload body: expected { data: base64string }' });
        }
        base64Data = parsed.data.data;
      }

      const requestId = randomUUID();
      request.log.info({ label, path: query.path, requestId }, 'File upload request via relay');

      try {
        await fastify.sendFileUpload(label, query.path, base64Data, requestId);
        return { ok: true, path: query.path };
      } catch (err) {
        request.log.error({ err, label, path: query.path }, 'File upload failed');
        return reply.code(502).send({ error: 'File upload failed' });
      }
    },
  );
}
