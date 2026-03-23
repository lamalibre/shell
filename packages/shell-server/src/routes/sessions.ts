import { createReadStream } from 'node:fs';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteOpts } from '../types.js';
import '../types.js'; // ensure declaration merging is loaded
import { readShellSessions } from '../lib/shell.js';
import { AgentLabelParamSchema, RecordingParamSchema } from '../schemas.js';
import { listRecordingFiles, getRecordingStat } from '../lib/recordings.js';
import { z } from 'zod';

const SessionIdParamSchema = z.object({
  sessionId: z.string().uuid('Session ID must be a valid UUID'),
});

export default async function sessionRoutes(
  fastify: FastifyInstance,
  opts: RouteOpts,
): Promise<void> {
  const { ctx, requireRole } = opts;

  // GET /sessions — list shell session audit log
  fastify.get('/sessions', { preHandler: requireRole(['admin']) }, async () => {
    const sessions = await readShellSessions(ctx.stateDir);
    return { sessions };
  });

  // DELETE /sessions/:sessionId — terminate an active session (admin-only)
  fastify.delete(
    '/sessions/:sessionId',
    { preHandler: requireRole(['admin']) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId } = SessionIdParamSchema.parse(request.params);

      const terminated = await fastify.terminateSession(sessionId);
      if (!terminated) {
        return reply.code(404).send({ error: 'Active session not found' });
      }

      request.log.info({ sessionId }, 'Session terminated by admin');
      return { ok: true, sessionId };
    },
  );

  // GET /recordings/:label — list session recordings for an agent
  fastify.get(
    '/recordings/:label',
    { preHandler: requireRole(['admin']) },
    async (request: FastifyRequest) => {
      const { label } = AgentLabelParamSchema.parse(request.params);

      // Get recordings from session audit log
      const sessions = await readShellSessions(ctx.stateDir);
      const agentSessions = sessions
        .filter((s) => s.agentLabel === label)
        .map((s) => ({
          sessionId: s.id,
          startedAt: s.startedAt,
          endedAt: s.endedAt ?? null,
          duration: s.duration ?? null,
          status: s.status,
        }));

      // Check server-side recordings directory for available files
      const recordingFiles = await listRecordingFiles(ctx.stateDir, label);
      const recordingFileSet = new Set(recordingFiles);

      // Annotate sessions with recording availability
      const recordings = agentSessions.map((s) => ({
        ...s,
        hasRecording: recordingFileSet.has(s.sessionId),
      }));

      return { recordings };
    },
  );

  // GET /recordings/:label/:sessionId — download a specific recording
  fastify.get(
    '/recordings/:label/:sessionId',
    { preHandler: requireRole(['admin']) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = RecordingParamSchema.parse(request.params);

      // Verify the session exists in the audit log for this agent
      const sessions = await readShellSessions(ctx.stateDir);
      const session = sessions.find(
        (s) => s.id === params.sessionId && s.agentLabel === params.label,
      );

      if (!session) {
        return reply.code(404).send({ error: 'Recording not found for this agent and session' });
      }

      // Check if a server-side recording file exists
      const recordingStat = await getRecordingStat(ctx.stateDir, params.label, params.sessionId);
      if (!recordingStat.exists) {
        return reply.code(404).send({ error: 'Recording file not available on server' });
      }

      request.log.info(
        { label: params.label, sessionId: params.sessionId, size: recordingStat.size },
        'Recording download requested',
      );

      const filename = `${params.label}-${params.sessionId}.log`;
      const stream = createReadStream(recordingStat.path);

      return reply
        .header('Content-Type', 'text/plain')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Content-Length', recordingStat.size)
        .send(stream);
    },
  );
}
