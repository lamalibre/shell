import { createRequire } from 'node:module';

const NODE_MAJOR = parseInt(process.versions.node.split('.')[0]!, 10);
if (NODE_MAJOR < 22) {
  console.error(`Shell agent requires Node.js >= 22. Current: ${process.version}`);
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
    case 'serve': {
      const { requireAgentConfig } = await import('./lib/config.js');
      const { runServe } = await import('./serve.js');
      const config = await requireAgentConfig();
      await runServe(config);
      break;
    }

    case 'connect': {
      const label = args[1];
      if (!label) {
        console.error('\n  Usage: shell-agent connect <agent-label>\n');
        process.exit(1);
      }
      const { requireAgentConfig } = await import('./lib/config.js');
      const { runConnect } = await import('./connect.js');
      const config = await requireAgentConfig();
      await runConnect(label, config);
      break;
    }

    case 'log': {
      const { requireAgentConfig } = await import('./lib/config.js');
      const { runLog } = await import('./log.js');
      const config = await requireAgentConfig();
      await runLog(args.slice(1), config);
      break;
    }

    case 'enroll': {
      const { runEnroll } = await import('./enroll.js');

      let server: string | undefined;
      let token: string | undefined;
      let label: string | undefined;

      for (let i = 1; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--server' && args[i + 1]) {
          server = args[++i];
        } else if (arg === '--token' && args[i + 1]) {
          token = args[++i];
        } else if (arg === '--label' && args[i + 1]) {
          label = args[++i];
        }
      }

      if (!server || !token) {
        console.error(
          '\n  Usage: shell-agent enroll --server <url> --token <token> [--label <name>]\n',
        );
        process.exit(1);
      }

      await runEnroll({ server, token, label });
      break;
    }

    default: {
      console.log(`
  ${pkg.version}

  Usage: shell-agent <command> [options]

  Commands:
    serve                          Start the agent daemon
    connect <label>                Interactive shell client
    log [label] [--download <id>]  Session log viewer
    enroll --server --token        Enroll with a server

  Options:
    --version, -v                  Show version
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
