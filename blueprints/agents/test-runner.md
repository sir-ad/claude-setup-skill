# Blueprint: .claude/agents/test-runner.md

A subagent that runs the repo's checks and returns only the failures. Test output stays out of the main conversation.

## When to write
- Default when the detector found at least one of `commands.test`, `commands.lint` or `commands.typecheck`.
- Skip when none exist, with `--skip-pipeline`, or with `--minimal`.
- Do not write it if `.claude/agents/test-runner.md` exists. Offer a merge instead.

## Inputs
- Detector: `commands.test[]`, `commands.lint[]`, `commands.typecheck[]` with `source` and `alsoIn`. Prefer commands that appear in more than one source.
- The single-test form from the stack template or knowledge note (`pytest path::name`, `go test ./pkg -run Name`).
- The scripts those commands call (`scripts/*.sh`, Makefile target, CI step) for required env vars or services.
- `permissions.allow` in the planned `.claude/settings.json`. Every command in the body must be allowed there.

## Rules
- Frontmatter: `name: test-runner`, a specific `description`, `tools: Bash, Read, Grep`, `model: haiku`, `maxTurns: 10`.
- Never add `Agent`, `Write` or `Edit`. This agent reports. It does not fix.
- Scope Bash through the body and through `permissions.allow` in settings.json. Do not invent `Bash(...)` patterns inside `tools`.
- Only commands from the detector. No invented flags. Mark a command "needs <service or env var>" when the source file shows it.
- Never run: install, deploy, publish, migrate, dev servers, or anything that writes outside the repo. If a check needs one of these first, report that and stop.
- Output contract: one block per failing check: `path:line - test or rule - one-line cause`. At most 20 failures. When everything passes, print the command and the pass count only.
- Size cap: 40 lines including frontmatter.

## Skeleton
```markdown
---
name: test-runner
description: Runs the project's tests, lint and typecheck and returns only the failures with file:line and a one-line cause. Use after code changes, before reporting work as done.
tools: Bash, Read, Grep
model: haiku
maxTurns: 10
---
You run checks and report failures. You never edit files.

## Commands you may run
- Tests: `<test command>`
- One test: `<single-test command>`
- Lint: `<lint command>`
- Typecheck: `<typecheck command>`
Run the narrowest command that covers the files the caller names. Run the full suite only when asked.

## Do not run
Install, deploy, publish, migrate or dev-server commands. If a check needs one of them first, say so and stop.

## What to return
- For each failing check: `path:line - test or rule - one-line cause`. At most 20.
- If a command cannot run (missing service, env var, tool), say which one and stop. Do not guess.
- If everything passes, return the command and the pass count. Nothing else.
- Quote the first error line only. Do not paste logs or stack traces.
```
