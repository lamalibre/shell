export type {
  ShellAgent,
  CommandBlocklist,
  ShellPolicy,
  ShellConfig,
  ShellSessionEntry,
  AgentsResponse,
  PoliciesResponse,
  SessionsResponse,
  EnableResponse,
  HealthResponse,
  RecordingEntry,
  RecordingsResponse,
  JoinTokenResponse,
  OkResponse,
  CreatePolicyPayload,
  UpdatePolicyPayload,
  UpdateConfigPayload,
} from '@lamalibre/shell-panel';

export interface ShellDesktopConfig {
  serverUrl: string;
  apiKey: string;
  caCertPath: string | null;
  certPath: string | null;
  keyPath: string | null;
}
