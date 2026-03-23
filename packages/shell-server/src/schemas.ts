import { z } from 'zod';
import path from 'node:path';

export const IpEntrySchema = z
  .string()
  .min(1)
  .max(45)
  .regex(
    /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/,
    'Must be an IPv4 address or CIDR (e.g. 192.168.1.0/24)',
  )
  .refine((v) => {
    if (!v.includes('/')) return true;
    const prefix = parseInt(v.split('/')[1]!, 10);
    return prefix >= 1 && prefix <= 32;
  }, 'CIDR prefix length must be between 1 and 32');

export const CommandBlocklistSchema = z.object({
  hardBlocked: z.array(z.string().min(1).max(200)).optional(),
  restricted: z.record(z.string(), z.boolean()).optional(),
});

export const PolicyIdSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9-]+$/, 'Policy ID must contain only lowercase letters, numbers, and hyphens');

export const CreatePolicySchema = z.object({
  id: PolicyIdSchema.optional(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  allowedIps: z.array(IpEntrySchema).default([]),
  deniedIps: z.array(IpEntrySchema).default([]),
  maxFileSize: z
    .number()
    .int()
    .min(1024)
    .max(500 * 1024 * 1024)
    .optional(),
  inactivityTimeout: z.number().int().min(60).max(7200).optional(),
  commandBlocklist: CommandBlocklistSchema.optional(),
});

export const UpdatePolicySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  allowedIps: z.array(IpEntrySchema).optional(),
  deniedIps: z.array(IpEntrySchema).optional(),
  maxFileSize: z
    .number()
    .int()
    .min(1024)
    .max(500 * 1024 * 1024)
    .optional(),
  inactivityTimeout: z.number().int().min(60).max(7200).optional(),
  commandBlocklist: CommandBlocklistSchema.optional(),
});

export const UpdateShellConfigSchema = z.object({
  enabled: z.boolean().optional(),
  defaultPolicy: PolicyIdSchema.optional(),
});

export const EnableShellSchema = z.object({
  durationMinutes: z.number().int().min(5).max(480).default(30),
  policyId: z.string().optional(),
});

export const AgentLabelParamSchema = z.object({
  label: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Label must contain only lowercase letters, numbers, and hyphens'),
});

export const PolicyIdParamSchema = z.object({
  policyId: PolicyIdSchema,
});

export const FilePathQuerySchema = z.object({
  path: z
    .string()
    .min(1, 'File path is required')
    .max(4096, 'File path must not exceed 4096 characters')
    .refine((v) => !v.includes('\0'), 'File path must not contain null bytes')
    .refine(
      (v) => !path.normalize(v).split(path.sep).includes('..'),
      'File path must not contain ".." after normalization',
    ),
});

export const RecordingParamSchema = z.object({
  label: AgentLabelParamSchema.shape.label,
  sessionId: z.string().uuid('Session ID must be a valid UUID'),
});

// Inferred types
export type CreatePolicy = z.infer<typeof CreatePolicySchema>;
export type UpdatePolicy = z.infer<typeof UpdatePolicySchema>;
export type UpdateShellConfig = z.infer<typeof UpdateShellConfigSchema>;
export type EnableShell = z.infer<typeof EnableShellSchema>;
export type AgentLabelParam = z.infer<typeof AgentLabelParamSchema>;
export type PolicyIdParam = z.infer<typeof PolicyIdParamSchema>;
