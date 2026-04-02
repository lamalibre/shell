import type { ShellClient } from './client.js';
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

function enc(s: string): string {
  return encodeURIComponent(s);
}

/**
 * Create a ShellClient backed by HTTP fetch — used by the panel microfrontend.
 *
 * @param panelUrl - The base URL of the host (e.g. `http://127.0.0.1:9393`)
 * @param basePath - The plugin base path (e.g. `/api/plugins/shell`)
 */
export function createFetchShellClient(panelUrl: string, basePath: string): ShellClient {
  const pluginName = basePath.split('/').pop() ?? 'shell';
  const apiBase = `${panelUrl}/${pluginName}`;

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { ...options.headers as Record<string, string> };
    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${apiBase}${path}`, {
      ...options,
      credentials: 'include',
      headers,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = (body as Record<string, unknown>).error ?? res.statusText;
      throw new Error(`Shell API error: ${String(msg)}`);
    }
    return res.json() as Promise<T>;
  }

  async function requestText(path: string): Promise<string> {
    const res = await fetch(`${apiBase}${path}`, {
      credentials: 'include',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = (body as Record<string, unknown>).error ?? res.statusText;
      throw new Error(`Shell API error: ${String(msg)}`);
    }
    return res.text();
  }

  return {
    checkHealth: () => request<HealthResponse>('/health'),

    getServerConfig: () => request<ShellConfig>('/config'),
    updateServerConfig: (payload: UpdateConfigPayload) =>
      request<ShellConfig>('/config', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),

    getAgents: () => request<AgentsResponse>('/agents'),
    revokeAgent: (label: string) =>
      request<OkResponse>(`/agents/${enc(label)}/revoke`, { method: 'POST', body: '{}' }),

    getPolicies: () => request<PoliciesResponse>('/policies'),
    createPolicy: (payload: CreatePolicyPayload) =>
      request<ShellPolicy>('/policies', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updatePolicy: (policyId: string, payload: UpdatePolicyPayload) =>
      request<ShellPolicy>(`/policies/${enc(policyId)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    deletePolicy: async (policyId: string) => {
      await request<OkResponse>(`/policies/${enc(policyId)}`, { method: 'DELETE' });
    },

    enableAgentShell: (label: string, durationMinutes: number, policyId?: string) =>
      request<EnableResponse>(`/enable/${enc(label)}`, {
        method: 'POST',
        body: JSON.stringify({ durationMinutes, policyId }),
      }),
    disableAgentShell: async (label: string) => {
      await request<OkResponse>(`/enable/${enc(label)}`, { method: 'DELETE' });
    },

    getSessions: () => request<SessionsResponse>('/sessions'),
    terminateSession: (sessionId: string) =>
      request<OkResponse>(`/sessions/${enc(sessionId)}`, { method: 'DELETE' }),

    getRecordings: (label: string) => request<RecordingsResponse>(`/recordings/${enc(label)}`),
    downloadRecording: (label: string, sessionId: string) =>
      requestText(`/recordings/${enc(label)}/${enc(sessionId)}`),

    createJoinToken: (label: string) =>
      request<JoinTokenResponse>('/tokens', {
        method: 'POST',
        body: JSON.stringify({ label }),
      }),
  };
}
