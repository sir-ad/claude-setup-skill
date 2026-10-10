# Blueprint: AGENTS.md, "## Working agreements"

A short, tool-neutral section for AGENTS.md. Any agent can follow it: Claude Code, Codex, Cursor, Copilot, Gemini CLI.

## When to write
- Default with the pipeline. Skip with `--skip-pipeline` or `--minimal`.
- If AGENTS.md already has a section with this purpose, merge missing lines only. Never reword the user's text.
- Place it after Commands and Repo map, before Hard rules. It counts toward the 150-line AGENTS.md cap.

## Inputs
- The confirmed plan: which of `docs/architecture.md`, `docs/project-structure.md`, the plan skill and the handoff skill are being written.
- Detector: `commands.test`, `commands.lint`, `commands.typecheck`, for the verify line.

## Rules
- Tool-neutral. No slash commands, no Claude-only features. Name files and folders, not tools. The plan and handoff files are plain markdown any agent can write.
- Mention a path only if the plan writes it or it already exists. Drop the matching line otherwise. Do not point to `docs/` files that are missing.
- 6 to 9 lines.
- Steps run in order: explore, plan, implement, verify.
- The fix loop has a limit: at most 3 tries, then stop and report. Never "keep trying until it passes".
- Verify lines use the exact commands from the Commands section. Do not invent new ones.
- Plans go to `docs/plans/`. The handoff goes to `.claude/handoff.md`. Do not move them.

## Skeleton
```markdown
## Working agreements
- Explore first. Read the code and `docs/` before you change anything. Start with `docs/project-structure.md`.
- For a change that touches several files, write a plan to `docs/plans/<yyyy-mm-dd>-<slug>.md` and wait for approval before editing source.
- Implement the plan one step at a time. Tick each step off in the plan file.
- Verify with `<test command>` and `<lint command>` before you call the work done.
- If a check still fails after 3 fix attempts, stop. Report the command, the error and what you tried.
- Before you end a long session, write `.claude/handoff.md`: goal, state, done, next steps, files touched, how to verify, open questions.
- Read `.claude/handoff.md` at the start of a session if it exists.
```
