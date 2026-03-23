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

export interface CommandBlocklist {
  hardBlocked: string[];
  restricted: Record<string, boolean>;
}

export interface PoliciesResponse {
  policies: ShellPolicy[];
  defaultPolicy: string;
}

export interface ShellConfigResponse {
  enabled: boolean;
  policies: Pick<ShellPolicy, 'id' | 'name'>[];
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

export interface RecordingSession {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  duration: number | null;
  status: string;
}

export interface EnableResponse {
  label: string;
  shellEnabledUntil: string;
  shellPolicy: string;
}

export interface DisableResponse {
  ok: true;
  label: string;
}

export interface AgentEntry {
  label: string;
  revoked: boolean;
  shellEnabledUntil?: string;
  shellPolicy?: string;
}

export interface TokenResponse {
  token: string;
}
