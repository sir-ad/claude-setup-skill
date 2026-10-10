# Blueprint: SessionStart hook in .claude/settings.json

A hook that prints `.claude/handoff.md` into context when a session starts, resumes or is compacted. It runs a command, so it is opt-in.

## When to write
- Only when the handoff skill is in the plan AND the user says yes to the hook. Default is no.
- Ask in the plan, next to the formatter-hook question: "Print .claude/handoff.md at session start? It runs a shell command on every start, resume and compact. [y/N]"
- Skip with `--skip-pipeline` or `--minimal`.

## Inputs
- The planned or existing `.claude/settings.json`. Merge into it; keep every existing key and every existing hook.
- Whether `hooks.SessionStart` already exists. If so, append a new entry to its array. Never replace it.

## Rules
- Event `SessionStart`, matcher `"startup|resume|compact"`, handler type `command`. `SessionStart` supports `command` and `mcp_tool` handlers only.
- Stdout from the command is added to the session context. Do not print anything else. Exit 0 whether or not the file exists, so a missing file never errors.
- The `compact` matcher is how the handoff returns after compaction. Context a hook added earlier is summarised away, so the hook runs again.
- Use `${CLAUDE_PROJECT_DIR:-.}` so the path holds when the working directory changes.
- Show the exact JSON in the plan, verbatim, as with all settings changes. Treat it as code execution.
- The file can go stale. In the final report, tell the user to delete or overwrite `.claude/handoff.md` when the work it describes is done.
- No other hooks. No `curl`, no network, no writes.

## Skeleton
Add this under the top-level `hooks` key of `.claude/settings.json`:
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|compact",
        "hooks": [
          {
            "type": "command",
            "command": "cat \"${CLAUDE_PROJECT_DIR:-.}/.claude/handoff.md\" 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```
