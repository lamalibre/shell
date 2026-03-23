import { createRequire } from 'node:module';

const NODE_MAJOR = parseInt(process.versions.node.split('.')[0]!, 10);
if (NODE_MAJOR < 22) {
  console.error(`Shell CLI requires Node.js >= 22. Current: ${process.version}`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const args = process.argv.slice(2);
const command = args[0];

if (args.includes('--version') || args.includes('-v')) {
  console.log(pkg.version);
  process.exit(0);
}

async function main(): Promise<void> {
  switch (command) {
    case 'connect': {
      const label = args[1];
      if (!label) {
        console.error('\n  Usage: shell connect <agent-label>\n');
        process.exit(1);
      }
      const { requireCliConfig } = await import('./lib/config.js');
      const { runConnectCommand } = await import('./commands/connect.js');
      const config = await requireCliConfig();
      await runConnectCommand(label, config);
      break;
    }

    case 'sessions': {
      const { requireCliConfig } = await import('./lib/config.js');
      const { runSessionsCommand } = await import('./commands/sessions.js');
      const config = await requireCliConfig();
      await runSessionsCommand(config);
      break;
    }

    case 'recordings': {
      const label = args[1];
      if (!label) {
        console.error('\n  Usage: shell recordings <agent-label> [--download <session-id>]\n');
        process.exit(1);
      }
      const { requireCliConfig } = await import('./lib/config.js');
      const { runRecordingsCommand } = await import('./commands/recordings.js');
      const config = await requireCliConfig();
      await runRecordingsCommand(label, args.slice(2), config);
      break;
    }

    case 'config': {
      const { requireCliConfig } = await import('./lib/config.js');
      const { runConfigCommand } = await import('./commands/config.js');
      const config = await requireCliConfig();
      await runConfigCommand(config, args.slice(1));
      break;
    }

    case 'policies': {
      const { requireCliConfig } = await import('./lib/config.js');
      const { runPoliciesCommand } = await import('./commands/policies.js');
      const config = await requireCliConfig();
      await runPoliciesCommand(config);
      break;
    }

    case 'policy': {
      const subcommand = args[1];
      const { requireCliConfig } = await import('./lib/config.js');
      const config = await requireCliConfig();

      switch (subcommand) {
        case 'create': {
          const { runPolicyCreateCommand } = await import('./commands/policy-create.js');
          await runPolicyCreateCommand(config);
          break;
        }
        case 'update': {
          const policyId = args[2];
          if (!policyId) {
            console.error('\n  Usage: shell policy update <policy-id>\n');
            process.exit(1);
          }
          const { runPolicyUpdateCommand } = await import('./commands/policy-update.js');
          await runPolicyUpdateCommand(policyId, config);
          break;
        }
        case 'delete': {
          const policyId = args[2];
          if (!policyId) {
            console.error('\n  Usage: shell policy delete <policy-id>\n');
            process.exit(1);
          }
          const { runPolicyDeleteCommand } = await import('./commands/policy-delete.js');
          await runPolicyDeleteCommand(policyId, config);
          break;
        }
        default: {
          console.error(`
  Usage: shell policy <subcommand>

  Subcommands:
    create                Create a new policy
    update <policy-id>    Update an existing policy
    delete <policy-id>    Delete a policy

  See also: shell policies    List all policies
`);
          process.exit(1);
        }
      }
      break;
    }

    case 'agents': {
      const { requireCliConfig } = await import('./lib/config.js');
      const { runAgentsCommand } = await import('./commands/agents.js');
      const config = await requireCliConfig();
      await runAgentsCommand(config);
      break;
    }

    case 'health': {
      const { requireCliConfig } = await import('./lib/config.js');
      const { runHealthCommand } = await import('./commands/health.js');
      const config = await requireCliConfig();
      await runHealthCommand(config);
      break;
    }

    case 'tokens': {
      const subcommand = args[1];
      const { requireCliConfig } = await import('./lib/config.js');
      const config = await requireCliConfig();

      switch (subcommand) {
        case 'create': {
          const { runTokensCreateCommand } = await import('./commands/tokens.js');
          await runTokensCreateCommand(config);
          break;
        }
        default: {
          console.error(`
  Usage: shell tokens <subcommand>

  Subcommands:
    create    Create a new join token for agent enrollment
`);
          process.exit(1);
        }
      }
      break;
    }

    case 'enable': {
      const label = args[1];
      if (!label) {
        console.error('\n  Usage: shell enable <agent-label>\n');
        process.exit(1);
      }
      const { requireCliConfig } = await import('./lib/config.js');
      const { runEnableCommand } = await import('./commands/enable.js');
      const config = await requireCliConfig();
      await runEnableCommand(label, config);
      break;
    }

    case 'disable': {
      const label = args[1];
      if (!label) {
        console.error('\n  Usage: shell disable <agent-label>\n');
        process.exit(1);
      }
      const { requireCliConfig } = await import('./lib/config.js');
      const { runDisableCommand } = await import('./commands/disable.js');
      const config = await requireCliConfig();
      await runDisableCommand(label, config);
      break;
    }

    case 'uninstall': {
      const { runUninstallCommand } = await import('./commands/uninstall.js');
      await runUninstallCommand();
      break;
    }

    default: {
      console.log(`
  ${pkg.version}

  Usage: shell <command> [options]

  Commands:
    connect <label>                        Interactive shell session
    sessions                               List active and recent sessions
    recordings <label> [--download <id>]   Session recordings
    config [--enable | --disable]          Show or update server configuration
    agents                                 List enrolled agents
    health                                 Server health check
    policies                               List shell access policies
    policy create                          Create a new policy
    policy update <id>                     Update a policy
    policy delete <id>                     Delete a policy
    tokens create                          Create a join token
    enable <label>                         Enable shell access for an agent
    disable <label>                        Disable shell access for an agent
    uninstall                              Cleanup instructions

  Options:
    --version, -v                          Show version
`);
      process.exit(command ? 1 : 0);
    }
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n  Error: ${message}\n`);
  process.exit(1);
});
