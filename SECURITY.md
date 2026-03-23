# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.x     | Yes       |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

If you discover a security vulnerability in Shell, please report it
responsibly through one of these channels:

1. **GitHub Security Advisory** (preferred):
   [Open a private advisory](https://github.com/lamalibre/shell/security/advisories/new)

2. **Email**: security@codelama.dev

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Affected component (shell-server, shell-agent, shell-cli, create-shell, shell-desktop)
- Potential impact

### What to Expect

- **Acknowledgment** within 48 hours on a best-effort basis — this is a solo-maintained project, so response times may vary
- **Status update** within 7 days on a best-effort basis, with an assessment and remediation timeline
- **Credit** in the release notes (unless you prefer to remain anonymous)

### What Qualifies

- mTLS bypass or certificate validation issues
- Tmux session escape or cross-session access
- Agent enrollment token leakage
- Shell command injection
- Credential leakage (agent keys, join tokens, P12 passwords)
- Authentication or authorization bypass (5-gate auth chain)
- Privilege escalation (agent role accessing admin endpoints)
- Path traversal or file access outside intended directories
- WebSocket relay manipulation or session hijacking
- Insecure default configurations

### Out of Scope

- Denial of service (resource exhaustion)
- Issues requiring physical access to the host
- Social engineering attacks
- Vulnerabilities in upstream dependencies (report those to the upstream project)

## Disclosure Policy

We follow coordinated disclosure. We ask that you give us reasonable time to
address the issue before any public disclosure. We aim to release fixes within
30 days of a confirmed vulnerability, but this is on a best-effort basis.
