export interface ShellAgent {
  label: string;
  revoked: boolean;
  shellEnabledUntil?: string;
  shellPolicy?: string;
}

export interface CommandBlocklist {
  hardBlocked: string[];
  restricted: Record<string, boolean>;
}

export interface ShellPolicy {
  id: string;
  name: string;
  description: string;
  allowedIps: string[];
  deniedIps: string[];
  maxFileSize: number;
  inactivityTimeout: number;
  commandBlocklist: CommandBlocklist;
}

export interface ShellConfig {
  enabled: boolean;
  policies: ShellPolicy[];
  defaultPolicy: string;
}

export interface ShellSessionEntry {
  id: string;
  agentLabel: string;
  sourceIp: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  duration?: number;
}

export interface AgentsResponse {
  agents: ShellAgent[];
}

export interface PoliciesResponse {
  policies: ShellPolicy[];
  defaultPolicy: string;
}

export interface SessionsResponse {
  sessions: ShellSessionEntry[];
}

export interface EnableResponse {
  label: string;
  shellEnabledUntil: string;
  shellPolicy: string;
}

export interface HealthResponse {
  status: string;
}

export interface RecordingEntry {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  duration?: number;
  status: string;
  hasRecording?: boolean;
}

export interface RecordingsResponse {
  recordings: RecordingEntry[];
}

export interface JoinTokenResponse {
  token: string;
}

export interface OkResponse {
  ok: boolean;
}

export interface CreatePolicyPayload {
  id?: string;
  name: string;
  description?: string;
  allowedIps?: string[];
  deniedIps?: string[];
  maxFileSize?: number;
  inactivityTimeout?: number;
  commandBlocklist?: { hardBlocked?: string[]; restricted?: Record<string, boolean> };
}

export interface UpdatePolicyPayload {
  name?: string;
  description?: string;
  allowedIps?: string[];
  deniedIps?: string[];
  maxFileSize?: number;
  inactivityTimeout?: number;
  commandBlocklist?: { hardBlocked?: string[]; restricted?: Record<string, boolean> };
}

export interface UpdateConfigPayload {
  enabled?: boolean;
  defaultPolicy?: string;
}
