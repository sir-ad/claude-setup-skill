---
name: claude-setup
description: Writes AGENTS.md plus thin adapters so Claude Code, Codex, Cursor, Copilot, Gemini CLI and other coding agents share verified commands, hard rules and version notes. A script detects stack, monorepo layout and existing agent configs. Adds Claude extras (settings, rules, reviewer, skills). Use to set up a repo for coding agents or refresh it with --update.
argument-hint: "[--dry-run] [--minimal] [--skip-skills] [--update] [--agents=claude,codex,cursor,copilot,gemini,aider,cline,windsurf,all]"
allowed-tools: Bash(node *)
---

# /claude-setup

Set up the current project for coding agents. AGENTS.md is the single source of truth. CLAUDE.md imports it. Claude-specific files and thin adapters for other tools sit on top.

The rule of this skill: write only what earns its keep. No empty folders, no placeholders, no invented commands or rules, no generic advice.

Flags from the user: $ARGUMENTS

If `--update` is among them, jump to "Update mode" after Phase 1.

---

## Phase 1: Detect

Detector output (JSON, read-only, never opens .env files):

!`node "${CLAUDE_SKILL_DIR}/scripts/detect.mjs" . 2>/dev/null || echo '{"error":"node not available or detector failed"}'`

### Reading the JSON

- `primary`, `languages`, `layout` (`single` | `monorepo`), `workspaces`, `packageManager`, `languageVersion`.
- `frameworks[]`: `name`, `version` (declared), `range` (the operator, e.g. `^`), `where` (manifest), `alsoIn`. These drive version notes.
- `commands.{setup,build,test,lint,format,typecheck,dev,other}[]`: `{cmd, source, alsoIn?}`. Every command in AGENTS.md must come from here. More sources means more trust. A `source` that is only a CI file means the command is real but may need CI env.
- `ci`, `docs`, `infra`, `versionFiles`, `warnings` (read them; they flag mixed lockfiles, capped lists, unreadable files).
- `agentConfigs[]`: `{path, tool}` for every existing agent file (`claude`, `cursor`, `copilot`, `agents`, ...).
- `hardRuleCandidates[]`: `{text, source}` where source is `file:line`. These are candidates, not rules.
- `env.files` (example env files), `env.gitignored` (ignore entries already present).

### If the JSON has an `error` field

Node is missing or the detector failed. Do a manual pass with read-only commands only: `ls -la`, `ls .claude .github/workflows docs 2>/dev/null`, read `README.md` (first 120 lines) and the manifests that exist (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Gemfile`, `pom.xml`, `build.gradle*`, `composer.json`, `*.csproj`), `Makefile`, and CI workflow files. Never `cat` lockfiles or `.env*` files. Take commands only from manifest scripts, Makefile targets and CI steps. Say in the plan that detection was manual.

### Decide

1. **Template**: from `primary` and `layout`. node+monorepo: `node-monorepo`; node+single: `node-single`; python; go; rust+monorepo: `rust-workspace`; rust+single: `rust-single`; jvm; ruby; dotnet; php. Anything else (deno, swift, dart, elixir, unknown): `generic`. Mixed repos: pick the dominant ecosystem and mention the secondary one in AGENTS.md.
2. **Agents to write for**: `--agents` if given (`all` means every name in the hint). Default: `claude` plus every tool present in `agentConfigs`. Tool-by-tool behavior is in `${CLAUDE_SKILL_DIR}/reference/agent-adapters.md`.
3. **Existing files** (default action is keep):
   - AGENTS.md exists: merge missing sections, never drop or reword user content.
   - CLAUDE.md has content and there is no AGENTS.md: propose moving the tool-neutral parts into AGENTS.md and leaving CLAUDE.md as `@AGENTS.md` plus Claude-only lines. Ask first.
   - Both exist and CLAUDE.md lacks the import: propose prepending `@AGENTS.md`, nothing else.
   - Legacy files (`.cursorrules`, `.windsurfrules`, `.clinerules` as a file, `.rules`, `.github/copilot-instructions.md`, `.junie/AGENTS.md`): do not touch. Report as hazards (see adapters reference).
4. **Hard rules**: keep a candidate only if it is a real constraint on code changes ("never import apps from packages", "migrations are append-only"). Drop marketing copy, history, and setup chatter. Open the source file around the cited line if the candidate is unclear. Quote the kept rule and cite `file:line`. Invent none. No candidates left means no Hard rules section.
5. **Ask one question, only if genuinely ambiguous**: `primary` is `unknown` with source files present, `warnings` report conflicting lockfiles or package managers, or two ecosystems are equally weighted. Never ask for something the JSON answers.

---

## Phase 2: Read guidance

Read these before writing:

1. `${CLAUDE_SKILL_DIR}/templates/<name>.md` for the chosen template. The list: node-monorepo, node-single, python, go, rust-single, rust-workspace, jvm, ruby, dotnet, php, generic. A template says what to include for the stack. It is a reference, not boilerplate to paste.
2. `${CLAUDE_SKILL_DIR}/knowledge/` notes for the detected ecosystem. The files are node.md, frontend.md, python.md, rust.md, go.md, jvm.md, ruby.md, dotnet.md, php.md, mobile.md and infra.md. Read only the ones that match (a Next.js app reads node.md and frontend.md; a Terraform folder adds infra.md).
3. `${CLAUDE_SKILL_DIR}/reference/writing-agent-files.md` for how to write the content.
4. `${CLAUDE_SKILL_DIR}/reference/agent-adapters.md` when any non-Claude tool is selected.
5. `${CLAUDE_SKILL_DIR}/reference/claude-code.md` for exact file formats before writing Claude files.

Knowledge entries are version-gated. The project's declared version always wins. Write a version note only when the detected version is inside the entry's gate. If the declared version is a range, use its lower bound to evaluate the gate. If there is no version at all, skip version notes for that package. Never write a note for a version the project does not use.

---

## Phase 3: Plan and confirm

Print this before writing anything:

```
Detected: <stack> (<layout>), <pm>, <primary framework + version>
Agents:   <claude, codex, ...>   (source: --agents | existing configs | default)
Commands: setup=<cmd> build=<cmd> test=<cmd> lint=<cmd>   (each from detector)

Will write:
  AGENTS.md                              (NEW | MERGE | KEEP)
  CLAUDE.md                              (NEW: @AGENTS.md | MERGE | KEEP)
  .claude/settings.json                  (NEW | MERGE)
  .claude/rules/<n>.md                   (NEW, paths: <glob>)
  .claude/agents/<lang>-reviewer.md      (NEW)
  .claude/skills/<n>/SKILL.md            (NEW, reason: <workflow>)
  .worktreeinclude                       (NEW | SKIP)
  adapters: .gemini/settings.json, .aider.conf.yml, rule mirrors (cursor, copilot, ...)
  .gitignore                             (append: CLAUDE.local.md, .claude/settings.local.json)

Version notes (<n>): <package@version -> short title>, ...
Hard rules kept (<n>):
  - "<quote>" (README.md:5) -> AGENTS.md
Hazards: <e.g. .cursorrules shadows AGENTS.md in Zed>
Existing files: <path: keep | merge | replace>
Skipped: <what and why>

Optional: add a PostToolUse formatter hook running <formatter> on each edited file?
  It runs a command on every edit, so treat it as code. [y/N]
Optional: run the fastest detected check once (<lint | typecheck | single test>) to confirm the commands work? [y/N]
Proceed? [y/N/preview/edit-plan]
```

Flags:
- `--dry-run`: print the plan and stop. Write nothing.
- `--minimal`: plan only AGENTS.md, CLAUDE.md and `.claude/settings.json`. Adapters still follow an explicit `--agents`.
- `--skip-skills`: omit `.claude/skills/`.
- Offer the formatter hook only if the detector found a formatter (`commands.format` or a formatter in `frameworks`) and a single-file command exists in the template. Default is no.

Wait for the answer. If a file exists, never replace it without a per-file yes.

---

## Phase 4: Generate

Write in this order. Exact formats are in `${CLAUDE_SKILL_DIR}/reference/claude-code.md`.

### AGENTS.md (target 150 lines or fewer)

Sections, each only if it has real content:
1. One-line stack summary.
2. `## Commands`: setup, build, test, lint, format, typecheck, dev, as available. Exact, copy-pasteable. For monorepos, root commands first, then how to run one workspace. Add how to run a single test only when the runner is detected and the form is in the template or a knowledge note.
3. `## Repo map`: only directories that matter and are not obvious. No tree dumps.
4. `## Conventions`: only what differs from language defaults or is documented in the repo.
5. `## Hard rules`: quoted, each with its source, e.g. `- "Packages must not import from apps." (README.md:5)`.
6. `## Version notes`: at most 10 one-line bullets from knowledge/, for versions the project declares.
7. `## Boundaries`: never touch (generated code, lockfiles by hand, applied migrations, secrets) and ask first (new dependencies, schema changes).

In a monorepo, add a nested AGENTS.md in a workspace only when it has its own commands or rules. Include it in the plan.

### CLAUDE.md

First line `@AGENTS.md`. Then only Claude-specific lines, usually none. Reason: Claude Code reads AGENTS.md only when no CLAUDE.md exists. Never use a symlink by default.

### .claude/settings.json

Start from `"$schema": "https://json.schemastore.org/claude-code-settings.json"`. Merge into an existing file; keep every existing key.
- `permissions.allow`: space-glob form scoped to this stack, built from the detected commands, e.g. `Bash(pnpm run *)`, plus read-only git (`Bash(git diff *)`, `Bash(git status *)`, `Bash(git log *)`). No `Bash(*)`.
- `permissions.deny`: `Bash(rm -rf *)`, `Bash(git push --force *)`, `Bash(git reset --hard *)`, stack publish commands, and secrets: `Read(./.env)`, `Read(./.env.*)`, `Read(./**/*.pem)`, `Read(./secrets/**)`. A Read deny also blocks Edit. If `env.files` lists an example file the agent should read, deny explicit names instead of `.env.*`.
- Never set `defaultMode` to `auto` or `bypassPermissions`. Never put secrets, tokens, personal paths, or `env` values here.
- Hook: only if the user said yes in the plan. Format and script are in the reference.

### .claude/rules/<name>.md

Frontmatter `paths:` (YAML list of globs), then 3 to 10 lines. Only for directories with real, distinct conventions. Never restate AGENTS.md. Zero rules is a valid result.

### .claude/agents/<lang>-reviewer.md

Frontmatter `name`, `description`, `tools: Read, Grep, Glob`. The description names the checks ("Reviews TypeScript changes for strictness, RSC boundaries and PII in logs. Use proactively after code changes."). Body is the template's checklist, tuned to this repo and its hard rules.

### .claude/skills/<name>/SKILL.md

Only for a real, repeatable workflow with commands that exist here: `release` (version file plus changelog or changesets), `preview-deploy`, `db-migrate` when it is more than one command. Side-effecting skills get `disable-model-invocation: true` and a narrow `allowed-tools`. No stub bodies. Skip all with `--skip-skills`.

### .worktreeinclude

Gitignore syntax. List only files that are gitignored and that a fresh worktree needs: `.env`, `.env.local`, `CLAUDE.local.md`, `.claude/settings.local.json`, `.mcp.json` if ignored. Use `env.gitignored` to decide. Skip the file when nothing qualifies.

### .gitignore

Append `CLAUDE.local.md`, `.claude/settings.local.json` and `.claude/worktrees/` when missing. Append only.

### Adapters

Only for selected agents. Exact snippets and merge rules are in the adapters reference.
- gemini: `.gemini/settings.json` with `context.fileName` (merge).
- aider: `.aider.conf.yml` with `read: AGENTS.md` (merge, keep other keys).
- cursor, copilot, cline, windsurf: AGENTS.md is read natively. For path-scoped rules run `node "${CLAUDE_SKILL_DIR}/scripts/sync-rules.mjs" --targets <list>` after `.claude/rules/` is written.
- codex, zed, junie, amp, kiro, opencode: write nothing.

---

## Phase 5: Verify and report

1. List every file written with its line count (`wc -l <files>`). Flag AGENTS.md over 150 lines or CLAUDE.md over 200. AGENTS.md must stay far below Codex's 32 KiB cap.
2. Check each written `.json` parses: `node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" <file>`.
3. Confirm no secrets landed in generated files. Do not read `.env*`. Grep the written files for key-like text, e.g. `grep -nEi "(api[_-]?key|secret|token|password)[\"']?\s*[:=]\s*[\"']?[A-Za-z0-9/+_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|ghp_|AKIA[0-9A-Z]{16}" <files>`. Fix any hit.
4. If adapters with scoped rules were written, run `node "${CLAUDE_SKILL_DIR}/scripts/sync-rules.mjs" --targets <same list> --check`. It must report no pending changes. (`--check` without `--targets` is a usage error.)
5. If the user said yes in the plan, run the fastest detected check once (lint or typecheck, or the single-test form if known) to confirm the commands in AGENTS.md work. Run nothing without that yes. Never run commands with side effects (deploy, publish, migrate, dev servers). If a command fails, fix it or drop it from AGENTS.md and say so.
6. Print: the tree, the line counts, hazards found, and one concrete check per tool written:
   - Claude Code: `/memory` shows AGENTS.md imported through CLAUDE.md. `/context` lists the memory files.
   - Gemini CLI: `/memory show` includes the AGENTS.md text.
   - Codex: ask it to summarize the instructions it loaded.
   - Copilot: in a chat response, expand References and look for AGENTS.md.
   - Cursor, Cline, Windsurf, Aider: ask the agent to quote the test command from its instructions.
7. Remind the user to commit AGENTS.md, CLAUDE.md, `.claude/` (not `settings.local.json`) and `.worktreeinclude`.

---

## Update mode (`--update`)

1. Re-run detection (Phase 1). Read the existing AGENTS.md, CLAUDE.md, `.claude/settings.json`, `.claude/rules/`, adapters and rule mirrors.
2. Compare: `## Commands` against `commands.*`; `## Version notes` against `frameworks` and the current knowledge entries (new, changed, or no longer applicable); rule mirrors against `.claude/rules/` via `sync-rules.mjs --targets <list> --check`; hard-rule candidates not yet recorded; missing adapters for tools now present in `agentConfigs`.
3. Print a diff-style plan, one hunk per change, each marked `+`, `-` or `~` with its reason and source.
4. Apply only the hunks the user confirms. Touch only generated sections (Commands, Version notes, mirrors, adapters). Never rewrite user prose, reorder sections, or remove a rule the user wrote.
5. Run Phase 5 on the changed files.

---

## Anti-goals

- No empty folders. No `output-styles/`, `commands/` or `agent-memory/` by default.
- No copied docs examples. Generate a rule only if this repo has that convention.
- No clobbering. Per-file confirmation before any replace.
- No invented commands, hard rules or version notes. Every line traces to the detector, the repo, or a cited knowledge entry.
- No generic advice ("write clean code"), no restating linter rules, no long prose.
- No secrets, tokens or `.env` values in any file. Never read `.env*`.
- No `Bash(*)`, no `defaultMode: auto` or `bypassPermissions` in committed settings.
- No `.junie/AGENTS.md`, no legacy single-file rules, no Roo Code files.
- No stub skills. Working or skipped.
