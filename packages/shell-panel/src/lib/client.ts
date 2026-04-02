import type {
  AgentsResponse,
  CreatePolicyPayload,
  EnableResponse,
  HealthResponse,
  JoinTokenResponse,
  OkResponse,
  PoliciesResponse,
  RecordingsResponse,
  SessionsResponse,
  ShellConfig,
  ShellPolicy,
  UpdateConfigPayload,
  UpdatePolicyPayload,
} from './types.js';

/**
 * Abstract client interface for Shell API operations.
 *
 * Two implementations:
 * - `createFetchShellClient` — HTTP fetch for the panel microfrontend
 * - `createDesktopShellClient` — Tauri invoke wrapper in shell-desktop
 */
export interface ShellClient {
  checkHealth(): Promise<HealthResponse>;

  getServerConfig(): Promise<ShellConfig>;
  updateServerConfig(payload: UpdateConfigPayload): Promise<ShellConfig>;

  getAgents(): Promise<AgentsResponse>;
  revokeAgent(label: string): Promise<OkResponse>;

  getPolicies(): Promise<PoliciesResponse>;
  createPolicy(payload: CreatePolicyPayload): Promise<ShellPolicy>;
  updatePolicy(policyId: string, payload: UpdatePolicyPayload): Promise<ShellPolicy>;
  deletePolicy(policyId: string): Promise<void>;

  enableAgentShell(label: string, durationMinutes: number, policyId?: string): Promise<EnableResponse>;
  disableAgentShell(label: string): Promise<void>;

  getSessions(): Promise<SessionsResponse>;
  terminateSession(sessionId: string): Promise<OkResponse>;

  getRecordings(label: string): Promise<RecordingsResponse>;
  downloadRecording(label: string, sessionId: string): Promise<string>;

  createJoinToken(label: string): Promise<JoinTokenResponse>;
}
