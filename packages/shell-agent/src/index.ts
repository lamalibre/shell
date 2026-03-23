// Public API exports
export { runServe } from './serve.js';
export { runConnect } from './connect.js';
export { runLog } from './log.js';
export { runEnroll } from './enroll.js';
export { loadAgentConfig, saveAgentConfig, requireAgentConfig } from './lib/config.js';
export { createConsoleTicketLogger } from './lib/panel-api.js';
export type {
  AgentConfig,
  StandaloneAgentConfig,
  PluginAgentConfig,
  TunnelAgentConfig,
  TlsCredentials,
  ConnectionConfig,
  AgentStatus,
  CommandBlocklist,
  ShellSessionEntry,
  ShellBlocklist,
  PemFiles,
  WsInputMessage,
  WsOutputMessage,
  WsSpecialKeyMessage,
  WsResizeMessage,
  WsSessionStartedMessage,
  WsErrorMessage,
  WsAgentReadyMessage,
  WsAdminConnectedMessage,
  WsAdminDisconnectedMessage,
  WsTimeWindowExpiredMessage,
  WsConnectedMessage,
  WsAgentDisconnectedMessage,
  WsAgentMessage,
  WsServerToAgentMessage,
  WsServerToAdminMessage,
} from './types.js';

// Ticket SDK (re-export for consumers)
export { TicketClient, createTicketDispatcher } from '@lamalibre/portlama-tickets';
export type { TicketInboxEntry, TicketClientOptions, TicketLogger } from '@lamalibre/portlama-tickets';
