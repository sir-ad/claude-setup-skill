# Blueprint: .claude/agents/explorer.md

A read-only search subagent. It keeps file reads and grep output out of the main conversation and returns short findings with `file:line`.

## When to write
- Default for every repo with more than a handful of source files.
- Skip with `--skip-pipeline` or `--minimal`. Skip when the repo is tiny (fewer than about 20 source files) and say so in the plan.
- Do not write it if `.claude/agents/explorer.md` exists. List a MERGE in the plan instead.

## Inputs
- Detector: `layout`, `workspaces`, `generated[]`, `docs`, the source roots named in the template.
- Whether `docs/project-structure.md` is in the plan or already exists. The agent reads it first when present.
- Graph output (`node "${CLAUDE_SKILL_DIR}/scripts/graph.mjs" . --markdown`): entry points and central modules, for the "Start here" line.
- Repo files: top-level directory listing, to confirm the paths you name.

## Rules
- Frontmatter: `name: explorer`, a specific `description`, `tools: Read, Grep, Glob`, `model: haiku`, `maxTurns: 20`.
- Never add `Agent`, `Bash`, `Write` or `Edit`. Never add `memory`: it turns on Write and Edit. Without `Agent` the agent cannot spawn others.
- Do not name it `Explore`. That is a built-in agent. A different name keeps both.
- The description says what it finds and when to use it ("Use proactively before planning or editing unfamiliar code"). Keep it under 300 characters.
- Body: 15 to 30 lines. Sections: where to start, how to search, what to return.
- Name only paths that exist. List `generated[]` directories as "skip".
- Output contract: findings as `path:line - fact`, at most 30 lines, then a "Not found" list. Never paste whole files. Read by line range.
- Restate the one rule a fresh context lacks: it sees CLAUDE.md but not the conversation, so the caller must pass the question and the area.
- Size cap: 45 lines including frontmatter.

## Skeleton
```markdown
---
name: explorer
description: Read-only codebase search. Finds where code lives, how modules connect and which files a change touches. Use proactively before planning or editing unfamiliar code. Returns file:line findings.
tools: Read, Grep, Glob
model: haiku
maxTurns: 20
---
You explore this repository and report what you find. You never edit files.

## Start here
1. Read `docs/project-structure.md` if it exists. It lists entry points and central modules.
2. Source roots: <source roots, e.g. `src/`, `apps/web/`>. Tests: <test location>.
3. Skip generated paths: <generated paths from generated[]>.

## How to search
- Use Grep for symbols and strings, Glob for file names. Narrow the path before you search.
- Read a file by line range once Grep gives you the line. Do not read whole files over 200 lines.
- Follow imports one hop at a time. Stop when you can answer the question.

## What to return
- Findings as `path:line - fact`. At most 30 lines.
- End with "Not found:" and the things you searched for and did not find.
- Do not paste code blocks longer than 5 lines. Do not guess. Say "unknown" when the code does not show it.
```
