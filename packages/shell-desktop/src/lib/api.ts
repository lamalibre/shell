import { invoke } from '@tauri-apps/api/core';
import type {
  ShellDesktopConfig,
  AgentsResponse,
  ShellConfig,
  PoliciesResponse,
  SessionsResponse,
  EnableResponse,
  HealthResponse,
  CreatePolicyPayload,
  UpdatePolicyPayload,
  UpdateConfigPayload,
  ShellPolicy,
  RecordingsResponse,
  JoinTokenResponse,
  OkResponse,
} from './types.js';

export async function getShellConfig(): Promise<ShellDesktopConfig> {
  return invoke<ShellDesktopConfig>('get_shell_config');
}

export async function updateShellConfig(config: Partial<ShellDesktopConfig>): Promise<void> {
  return invoke('update_shell_config', { config });
}

export async function getAgents(): Promise<AgentsResponse> {
  return invoke<AgentsResponse>('get_agents');
}

export async function getServerConfig(): Promise<ShellConfig> {
  return invoke<ShellConfig>('get_server_config');
}

export async function updateServerConfig(payload: UpdateConfigPayload): Promise<ShellConfig> {
  return invoke<ShellConfig>('update_server_config', { payload });
}

export async function getPolicies(): Promise<PoliciesResponse> {
  return invoke<PoliciesResponse>('get_shell_policies');
}

export async function createPolicy(payload: CreatePolicyPayload): Promise<ShellPolicy> {
  return invoke<ShellPolicy>('create_shell_policy', { payload });
}

export async function updatePolicy(
  policyId: string,
  payload: UpdatePolicyPayload,
): Promise<ShellPolicy> {
  return invoke<ShellPolicy>('update_shell_policy', { policyId, payload });
}

export async function deletePolicy(policyId: string): Promise<void> {
  return invoke('delete_shell_policy', { policyId });
}

export async function enableAgentShell(
  label: string,
  durationMinutes: number,
  policyId?: string,
): Promise<EnableResponse> {
  return invoke<EnableResponse>('enable_agent_shell', { label, durationMinutes, policyId });
}

export async function disableAgentShell(label: string): Promise<void> {
  return invoke('disable_agent_shell', { label });
}

export async function getSessions(): Promise<SessionsResponse> {
  return invoke<SessionsResponse>('get_shell_sessions');
}

export async function checkHealth(): Promise<HealthResponse> {
  return invoke<HealthResponse>('check_health');
}

export async function getRecordings(label: string): Promise<RecordingsResponse> {
  return invoke<RecordingsResponse>('get_recordings', { label });
}

export async function downloadRecording(
  label: string,
  sessionId: string,
): Promise<string> {
  return invoke<string>('download_recording', { label, sessionId });
}

export async function createJoinToken(label: string): Promise<JoinTokenResponse> {
  return invoke<JoinTokenResponse>('create_join_token', { label });
}

export async function terminateSession(sessionId: string): Promise<OkResponse> {
  return invoke<OkResponse>('terminate_session', { sessionId });
}

export async function revokeAgent(label: string): Promise<OkResponse> {
  return invoke<OkResponse>('revoke_agent', { label });
}
