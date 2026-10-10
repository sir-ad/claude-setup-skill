# Blueprint: .claude/skills/plan-task/SKILL.md

The `/plan-task <task>` skill. It explores, writes a plan file, and stops so the user can approve before any source file changes.

## When to write
- Default with the pipeline. Skip with `--skip-skills`, `--skip-pipeline` or `--minimal`.
- Do not write it if `.claude/skills/plan-task/` exists. Offer a merge instead.
- Named plan-task because Claude Code has a built-in /plan command.
- The plan file path is `docs/plans/<yyyy-mm-dd>-<slug>.md`. Create `docs/plans/` only when the skill first writes a plan. Do not create the folder during setup.

## Inputs
- Whether `.claude/agents/explorer.md` is in the plan. If not, the skill body searches directly.
- Whether `docs/architecture.md` and `docs/project-structure.md` are in the plan or exist. Name only those.
- Detector: `commands.test`, `commands.lint`, `commands.typecheck`, for the Verification step.
- `AGENTS.md` Hard rules and Boundaries, which the plan must respect.

## Rules
- Frontmatter: `name: plan-task`, `description`, `argument-hint: "<task>"`, `disable-model-invocation: true`, `allowed-tools: Read Grep Glob Edit(docs/plans/**)`.
- `allowed-tools` pre-approves for the turn. It does not restrict. The body must also say "Do not edit any file outside `docs/plans/`".
- The body states the stop: after writing the file, print the path and a 5-line summary, ask for approval, and end the turn. Do not start implementing.
- Delegate search to `explorer` with a full delegation prompt: the objective, the output format (`path:line - fact`), the area, and the boundary (read-only, 30 lines). The subagent does not see this conversation.
- Skip planning when the change fits one sentence. Say so and offer to proceed directly.
- Every Context line cites `path:line`. No invented paths. Unknowns go under Open questions.
- Steps are a checklist, small enough to verify one at a time. Verification lists exact commands from `AGENTS.md`.
- Slug: lowercase words from the task joined by hyphens, at most 6 words. If the file exists, add `-2`.
- Size cap: 60 lines.

## Skeleton
`````markdown
---
name: plan-task
description: Explore the code and write an implementation plan to docs/plans/, then stop for approval. Use when starting a task that touches more than one file.
argument-hint: "<task>"
disable-model-invocation: true
allowed-tools: Read Grep Glob Edit(docs/plans/**)
---
Plan this task: $ARGUMENTS

1. If the whole change fits in one sentence, say so and offer to implement it directly. Stop.
2. Read `docs/project-structure.md` and `docs/architecture.md` when they exist, and the Hard rules in `AGENTS.md`.
3. Delegate the search to the `explorer` subagent. Give it the objective, the area to search, and the format `path:line - fact`. Ask for at most 30 lines. Search directly if the subagent is missing.
4. Write `docs/plans/<yyyy-mm-dd>-<slug>.md` in the format below. Use today's date.
5. Print the file path and a summary of at most 5 lines. Ask: "Approve this plan?" Then stop. Do not edit any file outside `docs/plans/`. Do not start the work.

After approval, work through the Steps in order, tick each box as it is done, and run the Verification commands before you report done.

## Plan format
```markdown
# Plan: <title>

Date: <yyyy-mm-dd>
Status: draft

## Goal
<One or two sentences. What changes and why.>

## Context
- `<path>:<line>` - <fact the plan relies on>

## Steps
- [ ] 1. <small, verifiable step> (`<path>`)
- [ ] 2. <next step>

## Verification
- `<test command>` - <expected result>
- `<lint command>` - no new errors

## Risks and open questions
- <risk, or a question the user must answer before step 1>
```
`````
