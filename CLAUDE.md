# Shell

Secure remote terminal via tmux — standalone and Portlama plugin.

## Repository Structure

```
shell/
├── packages/
│   ├── shell-server/       # Fastify server (standalone + Portlama plugin mode)
│   ├── shell-agent/        # Agent daemon (tmux session manager)
│   ├── shell-cli/          # CLI tool
│   ├── shell-desktop/      # Tauri v2 desktop app
│   └── create-shell/       # npx installer (zero deps, esbuild bundled)
├── tests/
│   └── e2e/               # Single-node E2E tests
├── docs/                  # Architecture, API, Protocol, Security, State
└── .claude/               # Agent specs, skill definitions, settings
```

## Tech Stack

| Layer        | Technology                                |
| ------------ | ----------------------------------------- |
| Server       | Fastify 5, Zod validation, WebSocket (ws) |
| Agent        | Node.js ESM, tmux CLI, execa              |
| Desktop      | Tauri v2, Svelte, Tailwind                |
| CLI          | @clack/prompts, picocolors                |
| Certificates | node-forge (CA generation, mTLS)          |
| Installer    | esbuild bundled, zero runtime deps        |
| State        | JSON files (atomic temp → fsync → rename) |
| Monorepo     | pnpm workspaces                           |
| Target OS    | macOS (launchd), Linux (systemd)          |

## Development

```bash
pnpm install          # install all workspace dependencies
pnpm build            # build all packages
pnpm dev:server       # shell server in standalone mode
pnpm lint             # lint all packages
```

Build before considering a task complete. Avoid commands that hang.

## Coding Conventions

**JavaScript / Node.js:**

- ES Modules everywhere (`import`, not `require`)
- TypeScript strict mode (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- `execa` for shell commands with array arguments — never `child_process` or string interpolation
- Zod schemas for all API input validation at route level
- Routes handle HTTP only — business logic in `lib/`
- Fastify logger, never `console.log` in library code
- Conventional Commits (`feat:`, `fix:`, `docs:`, `security:`)

**Rust / Tauri (Desktop):**

- Shared HTTP helpers via `curl_panel` pattern
- `tokio::task::spawn_blocking` for subprocess calls — never block the Tauri event loop
- Atomic file writes (temp → rename) for config and state

## Security Rules

1. **5-gate auth chain:** admin role → global toggle → agent cert valid → time window active → IP ACL
2. **Special key allowlist** for tmux send-keys: Enter, Escape, C-c, C-d, C-z, Tab, arrows, BSpace, DC, Home, End, PPage, NPage — anything else rejected (prevents injection)
3. **P12 password protection:** curl uses temp config file (`-K`, O_EXCL + 0600, cleaned up in try/finally); openssl uses `SHELL_AGENT_P12_PASS` env var — password never in process listings
4. **Session recordings** via `tmux pipe-pane` stored on agent at `~/.shell-agent/recordings/`
5. **Command blocklist** is advisory only — real security is auth chain + recording + time windows
6. **All file writes atomic** (temp → fsync → rename)
7. **Agent directory** `~/.shell-agent/` created with mode 0700
8. **PEM private keys** cleaned up after CA extraction

## Certificate Scoping

| Mode       | CA                                | Agent certs                    | Scoping                                       |
| ---------- | --------------------------------- | ------------------------------ | --------------------------------------------- |
| Standalone | Own CA (node-forge, 10-year root) | `CN=agent:<label>`             | API key for admin, mTLS for agents            |
| Plugin     | Portlama's CA                     | Portlama agent certs           | Time-windowed `shellEnabledUntil` on registry |
| Tunnel     | Own CA (like standalone)          | Ticket-based (P12 for panel)   | `@lamalibre/portlama-tickets` SDK, 60s heartbeats |

## Critical Constraints

- WebSocket relay is transparent — panel never interprets terminal data
- Time-window expiry checked every 30 seconds during active sessions
- Sessions are one-per-agent — second connection gets code 4409
- Admin WebSocket timeout: 30 seconds waiting for agent
- tmux output polling: 100ms interval (capture-pane diff)
- Session audit log: last 500 entries, pruned on write

## Environment Variables

| Variable               | Purpose                                          |
| ---------------------- | ------------------------------------------------ |
| `SHELL_AGENT_P12_PASS` | P12 password for openssl (never in process args) |
| `NODE_ENV`             | `development` skips mTLS check                   |

## License

PolyForm Noncommercial 1.0.0. Copyright (c) 2025 Code Lama Software.
