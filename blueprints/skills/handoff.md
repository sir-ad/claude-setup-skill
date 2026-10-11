# Blueprint: .claude/skills/handoff/SKILL.md

The `/handoff` skill. It writes `.claude/handoff.md` so the next session, or another tool, can continue without the chat history.

## When to write
- Default with the pipeline. Skip with `--skip-skills`, `--skip-pipeline` or `--minimal`.
- Do not write it if `.claude/skills/handoff/` exists. List a MERGE in the plan instead.
- The handoff file is working state, not documentation. In the plan, offer to append `.claude/handoff.md` to `.gitignore` (default yes). If the user wants to share handoffs across machines, skip the ignore entry.

## Inputs
- Detector: `commands.test`, `commands.lint`, for the "How to verify" section.
- Whether `docs/plans/` is used. If so, the handoff links the active plan.
- Whether the SessionStart hook blueprint is in the plan. If so, mention in the final report that the file is printed at session start.

## Rules
- Frontmatter: `name: handoff`, `description`, `disable-model-invocation: true`, `allowed-tools: Bash(git status *) Bash(git diff *) Bash(git log *) Edit(.claude/handoff.md)`.
- `allowed-tools` only pre-approves. The body must say "Write only `.claude/handoff.md`".
- Use dynamic context so git facts are real: `` !`git status --short` `` and `` !`git log --oneline -5` ``. They run before Claude sees the skill.
- Overwrite the file each time. One handoff, not a history.
- The content is tool-neutral plain markdown. Another agent with no Claude features must be able to read it.
- Never write secrets, tokens, `.env` values or personal paths. Name env vars only.
- Every claim in "Done" must be checkable: a file path, a commit, or a command result. Do not write "should work".
- Keep the file under 80 lines. Next steps are an ordered list the next session can start on.
- Size cap for the skill: 45 lines.

## Skeleton
`````markdown
---
name: handoff
description: Write .claude/handoff.md with the goal, current state and next steps so a new session can continue. Use before ending a session or before a long compaction.
disable-model-invocation: true
allowed-tools: Bash(git status *) Bash(git diff *) Bash(git log *) Edit(.claude/handoff.md)
---
Write `.claude/handoff.md` for the work in this session. Overwrite the file. Write nothing else.

Working tree:
!`git status --short`

Recent commits:
!`git log --oneline -5`

Use the facts above and the conversation. Follow the format below. Be specific: file paths, commands, exact error text. Leave out secrets and `.env` values.

## Handoff format
```markdown
# Handoff

Written: <yyyy-mm-dd hh:mm>
Branch: <branch> at <short sha>
Plan: <docs/plans/... path, or "none">

## Goal
<One or two sentences.>

## State
<Where the work stands now. What works, what is broken.>

## Done
- <change, with file path or commit>

## Next steps
1. <first thing the next session should do>
2. <then this>

## Files touched
- `<path>` - <what changed>

## How to verify
- `<test command>` - <expected result>

## Open questions
- <question for the user, or "none">
```
`````
