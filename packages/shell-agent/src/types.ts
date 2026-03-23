// --- Agent configuration (stored at ~/.shell-agent/agent.json) ---

export interface StandaloneAgentConfig {
  mode: 'standalone';
  serverUrl: string; // https://host:9494
  label: string;
  certPath: string; // ~/.shell-agent/cert.pem
  keyPath: string; // ~/.shell-agent/key.pem
  caPath: string; // ~/.shell-agent/ca.crt
}

export interface PluginAgentConfig {
  mode: 'plugin';
  panelUrl: string;
  authMethod: 'p12' | 'keychain';
  p12Path?: string;
  p12Password?: string;
  keychainIdentity?: string;
  label?: string;
}

export interface TunnelAgentConfig {
  mode: 'tunnel';
  serverUrl: string; // tunnel URL (e.g., https://a3f7-shell.example.com)
  panelUrl: string; // panel URL for ticket inbox
  label: string;
  portlamaP12Path: string;
  portlamaP12Password: string;
}

export type AgentConfig = StandaloneAgentConfig | PluginAgentConfig | TunnelAgentConfig;

// --- Resolved TLS credentials for WebSocket/HTTPS connections ---

export interface TlsCredentials {
  cert: Buffer;
  key: Buffer;
  ca?: Buffer;
  rejectUnauthorized: boolean;
}

// --- Common connection config (mode-agnostic, used by relay & API) ---

export interface ConnectionConfig {
  wsUrl: string;
  httpsUrl: string;
  tls: TlsCredentials;
  label: string;
  cleanup?: () => Promise<void>;
}

// --- WebSocket protocol messages (agent<->server) ---

export interface WsInputMessage {
  type: 'input';
  data: string;
}

export interface WsOutputMessage {
  type: 'output';
  data: string;
}

export interface WsSpecialKeyMessage {
  type: 'special-key';
  key: string;
}

export interface WsResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

export interface WsSessionStartedMessage {
  type: 'session-started';
  sessionId: string;
}

export interface WsErrorMessage {
  type: 'error';
  message: string;
}

export interface WsAgentReadyMessage {
  type: 'agent-ready';
  label: string;
}

export interface WsAdminConnectedMessage {
  type: 'admin-connected';
  message: string;
}

export interface WsAdminDisconnectedMessage {
  type: 'admin-disconnected';
}

export interface WsTimeWindowExpiredMessage {
  type: 'time-window-expired';
}

export interface WsConnectedMessage {
  type: 'connected';
  message: string;
}

export interface WsAgentDisconnectedMessage {
  type: 'agent-disconnected';
}

export type WsAgentMessage =
  | WsOutputMessage
  | WsSessionStartedMessage
  | WsErrorMessage
  | WsAgentReadyMessage;

export type WsServerToAgentMessage =
  | WsInputMessage
  | WsSpecialKeyMessage
  | WsResizeMessage
  | WsAdminConnectedMessage
  | WsAdminDisconnectedMessage
  | WsTimeWindowExpiredMessage
  | WsErrorMessage;

export type WsServerToAdminMessage =
  | WsOutputMessage
  | WsSessionStartedMessage
  | WsConnectedMessage
  | WsAgentDisconnectedMessage
  | WsTimeWindowExpiredMessage
  | WsErrorMessage;

// --- Agent status (from GET /api/shell/agent-status) ---

export interface CommandBlocklist {
  hardBlocked: string[];
  restricted: Record<string, boolean>;
}

export interface AgentStatus {
  label: string;
  globalEnabled: boolean;
  shellEnabled: boolean;
  shellEnabledUntil: string | null;
  policyId: string;
  commandBlocklist: CommandBlocklist | null;
}

// --- Shell session entry (from GET /api/shell/sessions) ---

export interface ShellSessionEntry {
  id: string;
  agentLabel: string;
  sourceIp: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  duration?: number;
  commandCount?: number;
}

// --- Shell blocklist format (written for shell-wrapper.sh) ---

export interface ShellBlocklist {
  hardBlocked: string[];
  blockedPatterns: string[];
  restrictedPrefixes: string[];
}

// --- PEM file extraction result ---

export interface PemFiles {
  certPath: string;
  keyPath: string;
  caPath: string | null;
  cleanup: () => Promise<void>;
}
