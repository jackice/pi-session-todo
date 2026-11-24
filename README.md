# @jackice/pi-session-todo

A session-scoped TODO tool and persistent HUD for Pi. It does not replace, migrate, or synchronize the project-level `todo` tool (`.pi/todos`, `/todos`).

- Verified with Pi `1.6.0`, `@jackice/pi-ui` `0.4.2`, and `@earendil-works/pi-tui` `1.6.0`.
- Tested the store, tool, and HUD in the Pi TUI.
- Does not modify Pi itself, take over project-level tasks, launch subagents, or schedule workflows.

## Installation

Install the preview with Pi:

```bash
pi install npm:@jackice/pi-session-todo@0.1.0
```

The extension entry point is `./index.ts`. `@jackice/pi-ui` and `@earendil-works/pi-tui` are peer dependencies.

## Tool

Each `session_todo` call performs one operation. Failed operations leave task state unchanged.

| Operation | Parameters | Behavior |
|---|---|---|
| `init` | `phases`, `mode`, `replace?` | Creates the task tree. Replacing an existing tree requires `replace=true`. |
| `view` | — | Returns the current tree and stable IDs without changing state. |
| `start` | `taskId` | Marks a task `in_progress`. Serial mode allows only one active task. |
| `done` | `taskId` | Marks a task complete. Serial mode promotes the next `pending` task. |
| `drop` | `taskId` | Marks a task `abandoned`. Serial mode promotes the next task if the dropped task was active. |
| `rm` | `taskId` | Removes a task. Serial mode promotes the next task if the removed task was active. |
| `append` | `content`, `phaseId?` | Appends a `pending` task. Defaults to the active phase or, if none is active, the last phase. |

- Pass `expectedRevision` to apply a change only if the revision still matches.
- `done` records explicit completion, not reviewer approval.
- In parallel mode, start tasks explicitly. Completing a task does not start another one.

## Persistence

For each state change, the extension appends a version 1 snapshot with `pi.appendEntry("session-todo", snapshot)`:

- It persists the snapshot before making the new state visible. If `appendEntry` throws, the tool reports an error and retains the previous state.
- No-op calls, such as repeating `done` or `start`, do not append a snapshot or increment the revision.
- In `--no-session` mode, state stays in memory. Otherwise, Pi does not write a session file before the first message.
- Reloading, creating, forking, or switching sessions restores the latest valid snapshot on the current branch.
- After `session_tree`, a small `session-todo-branch` entry records the selected point so switching or reloading does not restore the previous leaf.
- If the latest snapshot is corrupt, the extension shows the last readable snapshot and rejects writes.
- Subagents marked with `PI_SUBAGENT_CHILD=1` can call `view` but cannot write. The parent session records results.
- Limits: 50 phases, 200 tasks, 500 characters per task, and 64 KiB per snapshot.

## HUD

- `setWidget("jackice:session-todo", factory, { placement: "aboveEditor" })`
- Height budget: `total = clamp(rows - 19, 3, 8)`. The panel border uses two rows, leaving `total - 2` for content.
- The HUD hides 60 seconds after all tasks are complete by default. A new task immediately restores it.
- These commands change only the display, not task state:

```text
/session-todo expand
/session-todo collapse
/session-todo show
/session-todo hide
/session-todo status
```

Configuration:

```bash
# Milliseconds: -1 disables auto-hide; 0 hides immediately.
PI_SESSION_TODO_HIDE_MS=60000
# Or use the extension flag:
--session-todo-hide-ms 60000
```

Use the environment variable to disable auto-hide; the CLI may interpret a negative flag value as another option.

## Verification

Pi `1.6.0` TUI in a tmux PTY:

| Check | Result |
|---|---|
| Empty state | `Session TODO · empty` appears above the editor. |
| `init` → `start` → `done` | The HUD moves from `0/3` to `1/3`; serial mode promotes the next task. |
| All tasks complete | With a four-second timeout, the `3/3` HUD hides after four seconds. |
| Reload | The HUD restores `3/3` from the custom entry. |
| Auto-hide disabled | With `-1`, the HUD remains visible after 12 seconds. |
| Write failure | An `appendEntry` error leaves in-memory state unchanged. |
| Corrupt snapshot | Read-only recovery rejects writes. |
| Parallel mode | Two tasks can be `in_progress` at once. There is no auto-promotion, and the HUD updates after `append` and `rm`. |
| Project-level TODO | The `todo` list and claim operations work alongside the session HUD. |
| Branch navigation | The HUD follows `navigateTree` and stays on the selected branch after a switch or reload. |
| New session and switching | A new session starts empty. Switching back restores the previous HUD, with only one HUD visible. |
| Canceled switch | Canceling in `session_before_switch` leaves the session and HUD unchanged. |
| Subagent access | `PI_SUBAGENT_CHILD=1` permits `view` and rejects writes. |

Unit and integration tests:

```bash
pnpm install
pnpm typecheck
pnpm test
```

## Limitations

- Subagents are identified by `PI_SUBAGENT_CHILD=1`. Custom runners that omit this variable are not subject to the read-only check.
- Cancellation in the `/tree` UI and writes queued during session switching or cleanup have not been tested.
- Project-level `todo` list, claim, and status updates were verified alongside this extension. No task data is migrated or synchronized.
- The extension does not support persistent authorization, workflow scheduling, or automatic subagent launches.
