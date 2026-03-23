// Plugin mode
export { default as shellPlugin } from './plugin.js';
export type { ShellPluginOpts } from './plugin.js';

// Local / Portlama plugin factory
export { buildPlugin } from './build-plugin.js';

// Standalone mode
export { startStandaloneServer } from './standalone.js';
export type { StandaloneServerOpts } from './standalone.js';

// Tunnel auth
export { TicketStore, SessionStore, PanelTicketMap, loadTunnelConfig } from './lib/tunnel-auth.js';
export type { TunnelConfig } from './lib/tunnel-auth.js';

// Ticket SDK (re-export for consumers)
export { TicketInstanceManager } from '@lamalibre/portlama-tickets';
export type {
  TicketInstanceManagerOptions,
  TicketCertConfig,
  TransportConfig,
  RegisterInstanceResult,
  RequestTicketResult,
} from '@lamalibre/portlama-tickets';

// Types
export type {
  ShellConfig,
  ShellPolicy,
  CommandBlocklist,
  ShellSessionEntry,
  ShellAgent,
  AuthInfo,
  AgentRegistry,
  ShellContext,
  ShellAccessResult,
} from './types.js';
export { ShellError } from './types.js';
