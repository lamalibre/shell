# tmux Sessions & Recording

> Shell uses tmux on the agent machine to provide terminal sessions with resize support, scrollback, and automatic recording of every session.

## In Plain English

When you connect to a remote machine through Shell, you are not talking directly to a shell process. Instead, your keystrokes go to tmux — a terminal multiplexer that manages a virtual terminal session.

Think of tmux as a picture frame around a TV screen. The TV (your shell process) produces output. tmux captures that output into a virtual screen buffer. Every 100 milliseconds, the agent reads the current state of that buffer and sends it to you. When you type, tmux forwards your keystrokes to the shell process inside.

This indirection gives you three things for free:

1. **Clean screen captures** — `tmux capture-pane` gives a consistent snapshot of the terminal, not a stream of raw escape codes
2. **Resize support** — `tmux resize-window` adjusts the virtual terminal; no need to manage PTY dimensions directly
3. **Session recording** — `tmux pipe-pane` tees all I/O to a log file, capturing everything that appears in the terminal

## For Users

### Session Lifecycle

```
Admin connects
  │
  ├── Agent spawns tmux session
  │   └── tmux new-session -d -s shell-agent -x 120 -y 40 shell-wrapper.sh
  │
  ├── Agent enables recording
  │   └── tmux pipe-pane -t shell-agent "cat >> ~/.shell-agent/recordings/<uuid>.log"
  │
  ├── Agent starts output polling (every 100ms)
  │   └── tmux capture-pane -p -S - (captures full scrollback)
  │   └── Compares with previous capture
  │   └── If changed → sends { type: "output", data: <pane-content> }
  │
  ├── Interactive session
  │   ├── Input: tmux send-keys -l "<keystroke>"
  │   ├── Special keys: tmux send-keys Enter / C-c / Tab / etc.
  │   └── Resize: tmux resize-window -t shell-agent -x <cols> -y <rows>
  │
  └── Session ends (disconnect / timeout / time-window expiry)
      ├── tmux kill-session -t shell-agent
      ├── Recording saved at ~/.shell-agent/recordings/<uuid>.log
      └── Command history in ~/.shell-agent/shell-history.log
```

### Output Model

Shell uses a **full-screen refresh** model, not a streaming diff model:

- Every 100ms, the agent captures the entire pane content via `tmux capture-pane`
- If the content has changed since the last capture, it sends the complete pane as a single `output` message
- The admin client clears the screen (`\x1b[2J\x1b[H`) and writes the full pane content

This approach is simple and robust. It handles full-screen apps (vim, htop, less) correctly because the client always receives the complete terminal state, not incremental updates that could get out of sync.

### Special Key Allowlist

For security, only these named keys can be sent via the `special-key` message type:

```
Enter    Escape    C-c    C-d    C-z    Tab
Up       Down      Left   Right
BSpace   DC        Home   End    PPage  NPage
```

Any key not in this list is rejected. This prevents injection of arbitrary tmux commands through the special-key channel. Regular text input goes through the `input` message type as literal characters.

### Terminal Resize

When you resize your terminal window, the client sends a `resize` message with the new dimensions:

- **Columns:** 1–500 (validated)
- **Rows:** 1–500 (validated)
- The agent calls `tmux resize-window` to adjust the virtual terminal

The initial session size is 120 columns by 40 rows.

### Shell Wrapper

When the tmux session starts, it runs `~/.shell-agent/shell-wrapper.sh` instead of a plain shell. This wrapper provides:

- **Command blocklist checking** — reads `~/.shell-agent/shell-blocklist.json` and checks each command before execution
- **Command logging** — appends every command to `~/.shell-agent/shell-history.log` with a timestamp and EXEC/BLOCKED status
- **Custom prompt** — shows `shell:<pwd>$` in yellow

If the shell wrapper is not available, the session falls back to `/bin/bash`.

### Session Recording

Every session is recorded via `tmux pipe-pane`:

| Item | Location |
| --- | --- |
| **Raw terminal I/O** | `~/.shell-agent/recordings/<session-uuid>.log` |
| **Command history** | `~/.shell-agent/shell-history.log` |
| **Server audit log** | `~/.shell/shell-sessions.json` (last 500 entries) |

Recordings are stored on the agent machine, not the server. This ensures the recording captures everything tmux produces, even if the WebSocket connection drops temporarily.

## For Developers

### tmux Commands Used

| Operation | Command | Notes |
| --- | --- | --- |
| Spawn session | `tmux new-session -d -s shell-agent -x 120 -y 40 <wrapper>` | Detached, named, sized |
| Enable recording | `tmux pipe-pane -t shell-agent "cat >> <path>"` | Append mode |
| Capture output | `tmux capture-pane -p -S -` | Full scrollback, print to stdout |
| Send text input | `tmux send-keys -l "<data>"` | `-l` = literal (no key lookup) |
| Send special key | `tmux send-keys <key>` | Without `-l`, key names resolved |
| Resize | `tmux resize-window -t shell-agent -x <cols> -y <rows>` | Validated 1-500 |
| Kill session | `tmux kill-session -t shell-agent` | On disconnect/timeout |

All tmux commands are executed via `execa` with array arguments — never string interpolation.

### Polling Implementation

The output poller runs as a `setInterval` at 100ms:

```
let lastOutput = '';

setInterval(async () => {
  const current = await captureTmuxOutput();
  if (current !== lastOutput) {
    lastOutput = current;
    ws.send(JSON.stringify({ type: 'output', data: current }));
  }
}, 100);
```

This means:
- Maximum latency from tmux update to admin screen: ~100ms
- If output has not changed, no message is sent (bandwidth efficient)
- Full pane content is sent each time (no diff encoding)

### Session Naming

The tmux session is always named `shell-agent`. This means only one session per agent at a time — the server enforces this with close code `4409` if a session is already active.

### Source Files

| File | Purpose |
| --- | --- |
| `packages/shell-agent/src/tmux.ts` | tmux spawn, capture, send-keys, resize, kill |
| `packages/shell-agent/src/relay.ts` | WebSocket connection, output polling, message dispatch |
| `packages/shell-agent/src/lib/shell-wrapper.sh` | Command blocklist enforcement, history logging |

### Related Documentation

- [WebSocket Relay](websocket-relay.md) — message types and connection lifecycle
- [Security Model](security-model.md) — special key allowlist and command blocklist
- [Shell Agent](../03-architecture/shell-agent.md) — agent daemon architecture
