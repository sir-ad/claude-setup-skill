# Blueprint: CLAUDE.md, "## Claude Code" efficiency section

A Claude-only section that sits under `@AGENTS.md` in CLAUDE.md. It holds token habits and memory notes. It is not for other tools.

## When to write
- Default with the pipeline. Skip with `--skip-pipeline` or `--minimal`.
- If CLAUDE.md has Claude-only content, merge missing lines only.
- Name explorer only when `.claude/agents/explorer.md` is written in this run or exists, and test-runner only when `.claude/agents/test-runner.md` is. The first skeleton bullet names both: keep only the part for an agent that is written, and drop the line when neither is. Name plan-task or handoff in no line unless `.claude/skills/plan-task/SKILL.md` or `.claude/skills/handoff/SKILL.md` is written or exists.
- Include a line only if its subject exists: the reviewer memory line only when the reviewer has `memory: project`.

## Inputs
- The confirmed plan: which agents and skills are being written.
- Existing CLAUDE.md, to avoid repeating what it says.

## Rules
- 12 lines or fewer including the heading. Every line is one imperative sentence.
- Each line must match the Claude Code docs. Do not add claims about token savings or cache behavior.
- Habits that are accurate:
  - Delegate wide searches to a subagent and test output to another, so the main context stays small.
  - Read files by line range when you only need part of one.
  - `/clear` between unrelated tasks. After two failed corrections on one issue, `/clear` and rewrite the prompt.
  - Run `/compact <focus>` at a natural break, not mid-task. Say what to keep.
  - `/context` shows what is loaded and where the space goes.
  - Memory: reviewer memory lives in `.claude/agent-memory/` and should be committed. Auto memory is personal and machine-local; `/memory` shows and toggles it.
- Keep a "Compact instructions" line only if you can fill it from repo facts (the plan folder, the test command). It becomes part of what survives compaction.
- No emphasis words in capitals. No persona text.

## Skeleton
```markdown
## Claude Code
- Send wide searches to the `explorer` subagent and test or lint runs to `test-runner`. Keep their output out of this conversation.
- Read files by line range when you need part of a file.
- Run `/clear` between unrelated tasks. After two failed corrections, `/clear` and rewrite the prompt.
- Run `/compact <what to keep>` at a natural break, not mid-task. Check usage with `/context`.
- When compacting, keep: the active plan in `docs/plans/`, the files changed, and the last failing command with its error.
- Reviewer memory is in `.claude/agent-memory/`. Commit it.
- Auto memory is personal and machine-local. Run `/memory` to view or toggle it.
```
