# Blueprint: .claude/agents/<lang>-reviewer.md

A read-only reviewer with persistent project memory. `<lang>` is the primary language from the detector (`ts`, `python`, `go`, `rust`, `java`, `ruby`, `dotnet`, `php`).

## When to write
- Default when `primary` is a known language. Skip for `unknown` or `generic`.
- Skip with `--skip-pipeline` or `--minimal`.
- A reviewer from v0.2 may already exist. Keep its checklist and add `memory: project` only after a per-file yes.

## Inputs
- Detector: `primary`, `frameworks[]` with versions, `hardRuleCandidates[]`, `commands.lint[]`.
- Config files that back a check: lint config, `tsconfig`, `pyproject.toml`, `Cargo.toml` lints, `.golangci.yml`.
- The stack template's reviewer section. Its lines are candidates, not defaults.
- `knowledge/practices.md`, Code changes and Security bullets that apply.
- Grep results. Run them before you write any line (see Rules).

## Rules
- Frontmatter: `name: <lang>-reviewer`, a description that names the checks, `tools: Read, Grep, Glob`, `memory: project`. Leave `model` out so it inherits the session model.
- Never add `Agent`. `memory: project` turns on Read, Write and Edit for the memory directory, so the body must say: write only inside your memory directory, never edit source.
- Memory files land in `.claude/agent-memory/<name>/`. Tell the user to commit that folder (final report, not the agent file). It does nothing when auto memory is off.
- Checklist: 4 to 8 lines. Each line cites a repo fact in parentheses: a config file, a documented rule, a hard rule with `file:line`, or a detected version.
- Grep before banning. For every line that bans or requires a pattern, grep the repo. If the pattern is used on purpose, drop the line or scope it with the exception and the reason. Never flag what the repo does deliberately.
- Never restate what lint or format config enforces. Cover what the config cannot catch.
- No generic lines ("write clean code", "check for bugs").
- The caller names the changed files or pastes the diff. The agent has no Bash, so it cannot run `git diff`. Say so in the body.
- Size cap: 40 lines including frontmatter.

## Skeleton
```markdown
---
name: <lang>-reviewer
description: Reviews <language> changes for <check 1>, <check 2> and <check 3>. Use proactively after code changes.
tools: Read, Grep, Glob
memory: project
---
You review code changes in this repository. You do not edit source. The caller names the changed files or pastes the diff; review those only.

## Checks
1. <what to flag> (<repo fact: config file, rule or version>)
2. <what to flag> (<repo fact>)
3. <what to flag>, except in `<path>` where <reason> (<repo fact>)
4. <what to flag> (<hard rule quote>, <file:line>)

## Output
- Findings as `path:line - problem - fix`, most serious first.
- Report only gaps that affect correctness, security or a stated requirement. Skip style the linter covers.
- If nothing is wrong, say "No findings" and list the files you read.

## Memory
Read your MEMORY.md first. After a review, save short notes on accepted exceptions, past false positives and mistakes that recur here. Do not save anything the code already shows. Write only inside your memory directory.
```
