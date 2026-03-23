/**
 * Panel API interaction is now handled by @lamalibre/portlama-tickets SDK.
 *
 * This module provides a lightweight console-based logger adapter that satisfies
 * the SDK's TicketLogger interface, allowing the agent (which uses picocolors
 * console output) to work with the SDK without adding pino as a dependency.
 */

import pc from 'picocolors';
import type { TicketLogger } from '@lamalibre/portlama-tickets';

/**
 * Create a console-based logger that satisfies the SDK's TicketLogger interface.
 * Maps to picocolors-styled console output matching the shell-agent's existing style.
 */
export function createConsoleTicketLogger(prefix: string): TicketLogger {
  return {
    info(objOrMsg: Record<string, unknown> | string, msg?: string) {
      const text = typeof objOrMsg === 'string' ? objOrMsg : (msg ?? '');
      if (text) console.log(pc.dim(`  [${prefix}] ${text}`));
    },
    warn(objOrMsg: Record<string, unknown> | string, msg?: string) {
      const text = typeof objOrMsg === 'string' ? objOrMsg : (msg ?? '');
      if (text) console.error(pc.yellow(`  [${prefix}] ${text}`));
    },
    error(objOrMsg: Record<string, unknown> | string, msg?: string) {
      const text = typeof objOrMsg === 'string' ? objOrMsg : (msg ?? '');
      if (text) console.error(pc.red(`  [${prefix}] ${text}`));
    },
    debug() {
      /* silent in production — shell-agent doesn't log debug */
    },
    child(bindings: Record<string, unknown>) {
      const component = typeof bindings['component'] === 'string' ? bindings['component'] : prefix;
      return createConsoleTicketLogger(component);
    },
  };
}
