## Type

- [ ] New feature
- [ ] Bug fix
- [ ] Shell protocol change
- [ ] Security hardening
- [ ] Documentation

## Testing

- [ ] tmux session lifecycle (connect, input/output, resize, disconnect)
- [ ] Command blocklist enforcement
- [ ] WebSocket relay cleanup (both sides close correctly)
- [ ] 5-gate auth chain (each gate tested)
- [ ] E2E tests pass: `bash tests/e2e/run-all.sh`

## Security

- [ ] No credentials in diff (P12 passwords, PEM keys, API keys)
- [ ] execa uses array arguments (no shell interpolation)
- [ ] Zod validation on all new/modified endpoints
- [ ] Special key allowlist enforced for tmux send-keys
