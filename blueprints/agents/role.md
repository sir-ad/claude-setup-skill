# Blueprint: .claude/agents/<role>.md

One blueprint for every role agent in the roster: `frontend`, `backend`, `data`, `infra`, `mobile`, `docs`, `test-writer`, `security-reviewer`, `release`. A role agent is a scoped worker. It owns a set of paths, may edit only some of them, and reports back to the main agent. It is not a free-running agent.

## When to write
- Once per role in the injected `## Agent roster` section (or in the `--intent` re-run of `node "${CLAUDE_SKILL_DIR}/scripts/roster.mjs" . --intent "<text>" --markdown`). No roster entry, no file. Never write a role the roster did not list.
- The roster caps role agents at 8, not counting `explorer`, `test-runner` and the reviewer. Do not exceed it.
- `explorer`, `test-runner` and `<lang>-reviewer` keep their own blueprints.
- Skip with `--skip-pipeline` or `--minimal`.
- Do not overwrite `.claude/agents/<role>.md` if it exists. Offer a merge and keep the user's checks.

## Inputs
- The roster row for the role: `Why` (evidence), `Scope` (globs) and `Tier`. Tools and writable paths are not in the table. Use `Read, Grep, Glob, Edit, Write, Bash` for a role that edits and `writes` = its scope globs. Use `Read, Grep, Glob` and no writes for `security-reviewer` and the reviewer. `node "${CLAUDE_SKILL_DIR}/scripts/roster.mjs" . --json` prints the exact `tools` and `writes` per role if you need them.
- Detector: `frameworks[]` with versions, `commands.*`, `generated[]`, `hardRuleCandidates[]`.
- Graph: central modules and entry points that fall inside `scope[]` (`node "${CLAUDE_SKILL_DIR}/scripts/graph.mjs" . --markdown`). Name at most 3.
- Repo rules: `.claude/rules/*.md` and `AGENTS.md` Hard rules that touch this scope.
- Config files that back a check: framework config, lint config, `tsconfig`, migration tool config, Dockerfile, CI workflow.

## Rules
- Frontmatter: `name` (the role), `description`, `tools` from the roster entry, `model` from the tier, `maxTurns: 30`.
- Model from tier: `fast` -> `haiku`, `standard` -> `sonnet`, `deep` -> `opus`. If the user chose "inherit" for deep, leave `model` out. Other tools get their own files from `sync-agents.mjs`.
- Never add `Agent`. Never add `memory`: only the reviewer has it.
- The description is a routing contract. Say what the scope is, in repo terms, and when to use the agent: "Edits <scope> (<framework>). Use for <kinds of task>. Not for <neighbouring role>." Under 300 characters. Make it differ from the neighbours so Claude picks one.
- Read-only roles (`security-reviewer`) get `Read, Grep, Glob` and no `Edit`, `Write` or `Bash`. Their description starts with "Reviews", their body drops the "May edit" part and says "You never edit files", and they report findings as `path:line - problem - fix`.
- Body, at most 50 lines including frontmatter:
  1. Scope: the `scope[]` paths, then the 2 or 3 central modules.
  2. May edit: the `writes[]` globs. Must not edit: everything else in the repo, `generated[]`, lockfiles, `.env*`. If a task needs a file outside `writes[]`, stop and say which file and why.
  3. Checks: 3 to 6 lines. Each cites a repo fact in parentheses (a config file, a rule, a hard rule with `file:line`, a detected version). Grep before you ban or require a pattern. Drop a line the repo breaks on purpose.
  4. Commands: only the detector's commands for this scope, run the narrowest form. Never install, deploy, publish, migrate against a real database, or start a dev server.
  5. Output contract.
- Output contract, the same for every role: changed files (one per line, with what changed), commands run with pass or fail, open risks and anything not checked. No pasted diffs or logs.
- The agent starts with a fresh context. It sees CLAUDE.md, not the conversation. The body says: "The caller gives you the goal, the paths and the output format. If one is missing, ask for it in your reply."
- Role hints. Candidates for the checks, not defaults:

| Role | Look for |
|---|---|
| frontend | component and routing conventions of the framework, state and data-fetch pattern, styling system, a11y lint config, design tokens file |
| backend | route and handler layout, input validation library, error and auth middleware, API schema or OpenAPI file |
| data | migration tool and its naming, rule that migrations are append-only, schema file, seed scripts |
| infra | Dockerfile base images, CI workflow names, IaC state rules, secret handling files (names only) |
| mobile | platform targets, navigation pattern, native module folders, build config |
| docs | docs generator and its config, link-check or spell-check script, generated pages to skip |
| test-writer | test framework, test file naming, fixtures folder, mocking rule, coverage threshold in config |
| security-reviewer | auth and session code, payment or crypto libraries, secret-scan config, rules in `.claude/rules/security.md` |
| release | version file, changelog format, changeset config, tag format. Prepares the change; never tags, pushes or publishes |

## Skeleton
```markdown
---
name: <role>
description: Edits <scope in repo terms> (<framework>). Use for <task kinds>. Not for <neighbouring role>.
tools: <roster tools, comma separated>
model: <haiku|sonnet|opus>
maxTurns: 30
---
You are the <role> worker for this repository. The caller gives you the goal, the paths and the output format. If one is missing, ask for it in your reply.

## Scope
- Paths: <scope globs>
- Start with: <central module paths from the graph>

## Edit rules
- You may edit: <writes globs>
- You must not edit anything else, including <generated paths>, lockfiles and `.env*`. If the task needs another file, stop and name it.

## Checks
1. <what to flag or follow> (<repo fact>)
2. <what to flag or follow> (<repo fact>)
3. <what to flag or follow>, except in `<path>` where <reason> (<repo fact>)

## Commands
- <narrowest test, lint or typecheck command for this scope>
Do not install, deploy, publish, migrate a real database or start a dev server.

## Report back
- Changed files: `<path>` - <what changed>
- Commands run: `<command>` - pass or fail
- Open risks and anything you did not check
Do not paste diffs or logs.
```
