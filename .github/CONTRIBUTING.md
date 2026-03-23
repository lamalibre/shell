# Contributing to Shell

## Prerequisites

- Node.js 22+ (check `.nvmrc`)
- pnpm 9+
- tmux (`brew install tmux` on macOS, `sudo apt install tmux` on Linux)

## Setup

```bash
git clone https://github.com/lamalibre/shell.git
cd shell
pnpm install
pnpm build
```

## Development

```bash
pnpm dev:server    # Start shell server in standalone mode (port 9494)
```

`NODE_ENV=development` skips mTLS checks for local development.

## Code Standards

- **ES Modules** — `import`, not `require`
- **TypeScript strict** — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- **execa** — array arguments for all subprocess calls, never string interpolation
- **Zod** — validation schemas at route level for all API inputs
- **Fastify logger** — never `console.log` in library code
- **Atomic writes** — temp file → fsync → rename for all JSON state files

## Pull Request Process

1. Fork and create a feature branch
2. Make changes following code standards
3. Build: `pnpm build`
4. Lint: `pnpm lint`
5. Run tests: `bash tests/e2e/run-all.sh`
6. Submit PR with the template filled out
