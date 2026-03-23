# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- VM-based E2E test MCP server (`shell-e2e-mcp`) for local server/agent lifecycle testing
- Documentation redesign matching Portlama style (24 files across 6 sections)
- Zod error handler for structured API validation errors
- Server-side session recording capture during WebSocket relay with download endpoint
- Session termination endpoint (`DELETE /sessions/:sessionId`) to kill active sessions
- Agent revocation endpoint (`POST /agents/:label/revoke`) with automatic session cleanup
- File transfer via WebSocket relay (`GET/POST /file/:label`) proxied through active sessions
- CLI commands: `agents`, `health`, `config --enable/--disable`, `policy create/update/delete`, `tokens create`
- CLI recording download (`recordings <label> --download <sessionId>`)
- Desktop Recordings page with agent selector, recording table, and file download
- Desktop Settings modal for server URL, API key, and certificate path configuration
- Desktop mTLS support via client certificate and key in curl requests
- Desktop command blocklist editor and max file size field in policy forms
- Desktop search and filter on agents, sessions, and policies pages
- Desktop bulk enable/disable for multiple agents
- Desktop join token creation with copy-to-clipboard modal
- Desktop session termination button for active sessions
- Desktop agent revocation with confirmation modal
- Desktop & CLI coverage report (`docs/06-coverage/desktop-cli-coverage.md`)

### Security

- Sanitize `Content-Disposition` filenames to prevent header injection
- Validate recording labels and session IDs at the library level (defense-in-depth)
- Add `fdatasync` before atomic rename in recording stream closure
- Sanitize agent error messages in file transfer responses (no internal path leakage)
- Validate file upload bodies with Zod schema instead of unsafe casts
- Set desktop config file permissions to 0600 at creation time (not after rename)
- Validate label and session ID inputs in Tauri commands before URL interpolation
- Clean up pending file transfer requests when sessions end
- Add `terminated` flag to prevent double-cleanup race in session termination
- Use Fastify declaration merging for type-safe decorator access (replaces `as unknown` casts)

## [0.1.0] - 2025-12-01

### Added

- **S0 — Infrastructure**: pnpm workspace monorepo, TypeScript strict mode, ESLint, Prettier, CI/CD workflows (format, lint, build, npm publish, Tauri desktop builds), GitHub templates (contributing, PR, issue)
- **S1 — Shell Server** (`@lamalibre/shell-server`): Fastify 5 server with standalone and Portlama plugin modes, mTLS certificate authority (node-forge, 10-year root), WebSocket relay for terminal sessions, 5-gate auth chain (admin role, global toggle, agent cert, time window, IP ACL), agent registry with atomic JSON state, session audit log (last 500 entries), admin API key authentication
- **S2 — Shell Agent** (`@lamalibre/shell-agent`): Agent daemon with tmux session management, mTLS client certificate enrollment, session recordings via `tmux pipe-pane`, special key allowlist for tmux send-keys (prevents injection), shell wrapper with command blocklist, launchd (macOS) and systemd (Linux) service support, P12 password protection (env var, never in process args)
- **S3 — CLI and Installer**: CLI tool (`@lamalibre/shell-cli`) with `@clack/prompts` interactive interface, `create-shell` npx installer (zero runtime deps, esbuild bundled), agent enrollment and management commands
- **S4 — Desktop App** (`@lamalibre/shell-desktop`): Tauri v2 desktop application with Svelte 5 and Tailwind CSS, agents endpoint for server management

### Security

- mTLS enforcement for all agent-server communication
- Atomic file writes (temp → fsync → rename) for all state and config
- Agent directory (`~/.shell-agent/`) created with mode 0700
- PEM private keys cleaned up after CA extraction
- P12 passwords passed via environment variable, never in process arguments
- Time-window expiry checked every 30 seconds during active sessions
