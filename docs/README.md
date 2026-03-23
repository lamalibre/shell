# Shell Documentation

Secure remote terminal access via tmux — standalone and Portlama plugin.

## Documentation Structure

### [Introduction](00-introduction/)
- [What is Shell?](00-introduction/what-is-shell.md) — overview, use cases, quick reference
- [How It Works](00-introduction/how-it-works.md) — architecture walkthrough, data flows, design decisions
- [Quick Start](00-introduction/quickstart.md) — from zero to first session in 10 minutes

### [Concepts](01-concepts/)
- [Deployment Modes](01-concepts/deployment-modes.md) — standalone vs plugin mode
- [Security Model](01-concepts/security-model.md) — 5-gate auth chain, time windows, recording
- [tmux Sessions & Recording](01-concepts/tmux-sessions.md) — session lifecycle, output model, special keys
- [WebSocket Relay](01-concepts/websocket-relay.md) — connection pairing, message types, close codes

### [Guides](02-guides/)
- [Standalone Setup](02-guides/standalone-setup.md) — server installation and service management
- [Agent Enrollment](02-guides/agent-enrollment.md) — enrolling agents in standalone and plugin modes
- [Desktop App](02-guides/desktop-app.md) — Tauri v2 graphical management interface
- [CLI Usage](02-guides/cli-usage.md) — command-line tool reference
- [Managing Policies](02-guides/managing-policies.md) — IP allowlists, command blocklists, policy CRUD

### [Architecture](03-architecture/)
- [System Overview](03-architecture/overview.md) — component roles, monorepo structure, data flows
- [Shell Server](03-architecture/shell-server.md) — Fastify server, routes, libraries, certificates
- [Shell Agent](03-architecture/shell-agent.md) — daemon lifecycle, tmux management, TLS
- [State Management](03-architecture/state-management.md) — file formats, atomic writes, concurrency

### [API Reference](04-api-reference/)
- [API Overview](04-api-reference/overview.md) — authentication, error format, endpoint summary
- [Config & Policies API](04-api-reference/config-policies.md) — configuration and policy endpoints
- [Agents & Sessions API](04-api-reference/agents-sessions.md) — agent management, enable/disable, audit log
- [WebSocket Protocol](04-api-reference/websocket-protocol.md) — message format, sequence diagrams, close codes

### [Reference](05-reference/)
- [Config Files](05-reference/config-files.md) — file locations, permissions, write patterns
- [Glossary](05-reference/glossary.md) — term definitions
