import type { ShellClient } from '@lamalibre/shell-panel';
import * as api from './api.js';

export function createDesktopShellClient(): ShellClient {
  return {
    checkHealth: () => api.checkHealth(),
    getServerConfig: () => api.getServerConfig(),
    updateServerConfig: (payload) => api.updateServerConfig(payload),
    getAgents: () => api.getAgents(),
    revokeAgent: (label) => api.revokeAgent(label),
    getPolicies: () => api.getPolicies(),
    createPolicy: (payload) => api.createPolicy(payload),
    updatePolicy: (id, payload) => api.updatePolicy(id, payload),
    deletePolicy: (id) => api.deletePolicy(id),
    enableAgentShell: (label, duration, policyId) => api.enableAgentShell(label, duration, policyId),
    disableAgentShell: (label) => api.disableAgentShell(label),
    getSessions: () => api.getSessions(),
    terminateSession: (id) => api.terminateSession(id),
    getRecordings: (label) => api.getRecordings(label),
    downloadRecording: (label, sessionId) => api.downloadRecording(label, sessionId),
    createJoinToken: (label) => api.createJoinToken(label),
  };
}
