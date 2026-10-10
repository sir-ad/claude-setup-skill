---
name: claude-setup
description: Sets up a repo for coding agents. Writes AGENTS.md (commands traced to your scripts and CI, hard rules with sources, version notes), CLAUDE.md, a repo graph and docs, topic rules, a read-only explorer, test-runner and reviewer, plan-task and handoff skills, and adapters for Codex, Cursor, Copilot, Gemini and others. Use on a new repo, or with --update.
argument-hint: "[--dry-run] [--minimal] [--skip-docs] [--skip-pipeline] [--skip-skills] [--update] [--agents=claude,codex,cursor,copilot,gemini,aider,cline,windsurf,all]"
allowed-tools: Bash(node *)
---

# /claude-setup

Set up the current project for coding agents. AGENTS.md is the single source of truth. CLAUDE.md imports it. Docs, rules, subagents, skills and thin adapters sit on top.

The rule of this skill: write only what the repo or a cited source supports. No empty folders, no placeholders, no invented commands or rules, no generic advice. Scripts produce facts. You write prose only from those facts.

Flags from the user: $ARGUMENTS

If `--update` is among them, jump to "Update mode" after Phase 2.

---

## Phase 1: Detect and load context

Everything the skill needs is injected here: the detector JSON, the repo graph, the chosen template, the matching knowledge notes, the blueprints and the reference files. The scripts are read-only and never open .env files.

!`node "${CLAUDE_SKILL_DIR}/scripts/context.mjs" . 2>/dev/null || echo 'CONTEXT_ERROR: node not available or context.mjs failed'`

If the output above contains `CONTEXT_ERROR` or has no `## Detection` section, follow "If the context is missing" in Phase 2 first.

The header lists `Template:`, `Knowledge:`, `Sections:` and `Size:`. Sections follow in this order: `## Detection`, `## Template`, `## Knowledge` notes for the stack, `## Repo graph`, `## Knowledge: knowledge/practices.md`, `## Blueprint: blueprints/<path>` for each blueprint, and `## Reference:` files. `Size:` is the size of this injected context, not of the repo.

### Reading the detection JSON

- `primary`, `languages`, `layout` (`single` | `monorepo`), `workspaces`, `packageManager`, `packageManagerVersion`, `languageVersion`.
- `frameworks[]`: `name`, `version` (declared), `range`, `group` (`runtime` | `dev` | `test` | `optional` | `peer`), `where`, `alsoIn`. These drive version notes.
- `commands.{setup,build,test,lint,format,typecheck,dev,other}[]`: `{cmd, source, alsoIn?}`. Every command in AGENTS.md must trace to an entry here or to a script, Makefile target or CI step you opened. A `source` that is only a CI file means the command is real but may need CI env. An `implied:` entry is inferred from a manifest, so check it against the repo's own scripts.
- `ci`, `docs` (existing docs, ADR folders), `infra`, `versionFiles`, `warnings`.
- `agentConfigs[]`: `{path, tool}` for every existing agent file.
- `hardRuleCandidates[]`: `{text, source}` where source is `file:line`. Candidates, not rules.
- `env.files` (example env files), `env.gitignored`.
- `generated[]`: `{path, evidence}` for files with "DO NOT EDIT" or "@generated" headers, or written by a script.

### Decide

1. **Template**: the script picked one and says why (`Template: <name> (reason)`). Override only with a stated reason, such as a mixed repo. Mention a secondary ecosystem in AGENTS.md.
2. **Agents to write for**: `--agents` if given (`all` means every name in the hint). Default: `claude` plus every tool in `agentConfigs`. Behavior per tool is in the adapters reference.
3. **Existing files** (default action is keep):
   - AGENTS.md exists: merge missing sections, never drop or reword user content.
   - CLAUDE.md has content and no AGENTS.md exists: propose moving the tool-neutral parts into AGENTS.md and leaving CLAUDE.md as `@AGENTS.md` plus Claude-only lines. Ask first.
   - Both exist and CLAUDE.md lacks the import: propose prepending `@AGENTS.md`, nothing else.
   - Legacy files (`.cursorrules`, `.windsurfrules`, `.clinerules` as a file, `.rules`, `.github/copilot-instructions.md`, `.junie/AGENTS.md`): do not touch. Report as hazards.
   - Equivalents: skip any docs file, agent, skill or rule whose equivalent already exists (check `docs`, the filesystem and `.claude/`). Say "skipped: exists" in the plan. Offer a merge only for the pipeline files.
4. **Hard rules**: keep a candidate only if it constrains code changes. Product-scope statements, marketing copy, history and setup chatter are not hard rules. Open the source around the cited line if unclear. Quote the whole sentence, or mark a cut with "…". Never trim a qualifier that weakens the rule ("unless", "except"). Cite `file:line`. Invent none. None left means no Hard rules section.
5. **Ask one question, only if genuinely ambiguous**: `primary` is `unknown` with source files present, `warnings` report conflicting lockfiles or package managers, or two ecosystems are equally weighted. Never ask what the JSON answers.

### Investigate before writing

The detector's commands are candidates. Before writing Commands, open the scripts they point at (`scripts/*.sh`, Makefile targets, the main CI workflow). Prefer the repo's own invocations over `implied:` entries (for example `scripts/lint.sh` runs `mypy fastapi`, not `mypy .`; CI installs with extra flags). Before writing Boundaries, use `generated[]` and look for generated docs or code (a README built from a docs page, codegen output). Each generated file goes under "never edit by hand" with the command that regenerates it.

---

## Phase 2: Use the guidance

The template, knowledge notes, blueprints and references are already in the injected context. Use them. Do not re-read them. A template says what to include for the stack. A blueprint says how to write one kind of file: When to write, Inputs, Rules, Skeleton. Follow the blueprint. Its skeleton is a shape, not text to paste. A slot with no repo fact behind it means the line is dropped.

Knowledge entries are version-gated. The project's declared version always wins. Write a version note only when the declared version is inside the entry's gate. If the declared version is a range, use its lower bound. With no version, skip notes for that package. Gate package-manager notes on `packageManagerVersion`. Notes for `dev`, `test`, `optional` or `peer` dependencies rank below `runtime` ones. A `test`-group package is never described as the project's framework. `knowledge/practices.md` feeds the rules files: copy only bullets that apply to a language, library or risk the repo has, and skip any the repo's lint or CI already enforces.

### If the context is missing

The injection failed, or Node is missing.
1. `Read` the files from `${CLAUDE_SKILL_DIR}`. Templates are in `${CLAUDE_SKILL_DIR}/templates/<name>.md`. The list: node-monorepo, node-single, python, go, rust-single, rust-workspace, jvm, ruby, dotnet, php, generic. Knowledge notes are in `${CLAUDE_SKILL_DIR}/knowledge/`. The files are node.md, frontend.md, python.md, rust.md, go.md, jvm.md, ruby.md, dotnet.md, php.md, mobile.md and infra.md. Read only the notes that match, plus `practices.md`. Blueprints are indexed in `${CLAUDE_SKILL_DIR}/blueprints/README.md`. Also read the files in `${CLAUDE_SKILL_DIR}/reference/`.
2. Get detection from `node "${CLAUDE_SKILL_DIR}/scripts/detect.mjs" .` and the graph from `node "${CLAUDE_SKILL_DIR}/scripts/graph.mjs" . --markdown`. If Node is missing, do a manual pass with read-only commands: `ls -la`, `ls .claude .github/workflows docs 2>/dev/null`, `README.md` (first 120 lines), the manifests that exist, `Makefile`, CI workflows. Never `cat` lockfiles or `.env*`. Take commands only from manifest scripts, Makefile targets and CI steps. Skip `docs/project-structure.md`, because the graph cannot be written by hand. Say in the plan that detection was manual.
3. If the skill files cannot be read either, STOP. Tell the user the skill directory is out of reach and suggest `--add-dir ~/.claude/skills/claude-setup` for headless runs. Do not continue with a degraded plan.

---

## Phase 3: Plan and confirm

Print this before writing anything:

```
Detected: <stack> (<layout>), <pm>, <primary framework + version>
Agents:   <claude, codex, ...>   (source: --agents | existing configs | default)
Commands: setup=<cmd> build=<cmd> test=<cmd> lint=<cmd>   (repo script or CI step first, detector second)

Will write:
  AGENTS.md                              (NEW | MERGE | KEEP; adds ## Working agreements)
  CLAUDE.md                              (NEW: @AGENTS.md + efficiency section | MERGE | KEEP)
  .claude/settings.json                  (NEW | MERGE)
  docs/architecture.md                   (NEW | skipped: exists)
  docs/project-structure.md              (NEW; graph fence from the injected Repo graph)
  docs/config.md                         (NEW | skipped: no env example)
  docs/decisions/                        (NEW only if no ADR folder)
  .claude/rules/code-style.md            (NEW, paths: <globs>)
  .claude/rules/testing.md               (NEW, paths: <globs>)
  .claude/rules/security.md              (NEW, always on)
  .claude/rules/<dir>.md                 (NEW, paths: <glob>)
  .claude/agents/explorer.md             (NEW)
  .claude/agents/test-runner.md          (NEW)
  .claude/agents/<lang>-reviewer.md      (NEW)
  .claude/skills/plan-task/SKILL.md      (NEW)
  .claude/skills/handoff/SKILL.md        (NEW)
  .claude/skills/<n>/SKILL.md            (NEW, reason: <workflow>)
  .worktreeinclude                       (NEW | SKIP)
  adapters: .gemini/settings.json, .aider.conf.yml, rule mirrors (cursor, copilot, ...)
  .gitignore                             (append: CLAUDE.local.md, .claude/settings.local.json, .claude/worktrees/, .claude/handoff.md)

Version notes (<n>, exactly these will be written): <package@version -> short title>, ...
Hard rules kept (<n>):
  - "<quote>" (README.md:5) -> AGENTS.md
Hazards: <e.g. .cursorrules shadows AGENTS.md in Zed>
Existing files: <path: keep | merge | replace>
Skipped: <what and why>

Then the full .claude/settings.json (the merged result if the file exists), verbatim, in a json block.

Optional, each [y/N]. Show the exact content under each question you ask:
  Formatter hook (PostToolUse, runs <formatter> on each edited file; adds .claude/hooks/format.sh)
  Handoff hook (SessionStart prints .claude/handoff.md)
  Code-search MCP (.mcp.json entry, local server; embeddings need an API key)
  Codex config (.codex/config.toml; only if codex is selected and you ask)
  Run the fastest detected check once (<lint | typecheck | single test>)
Proceed? [y/N/preview/edit-plan]
```

Rules for the plan:
- `--dry-run`: print the plan and stop. Write nothing.
- `--minimal`: only AGENTS.md, CLAUDE.md and `.claude/settings.json`. No `.gitignore` change; mention the entries in the report. Adapters still follow an explicit `--agents`.
- `--skip-docs`: no `docs/` files. `--skip-pipeline`: no explorer, test-runner, reviewer, plan-task, handoff, handoff hook, Working agreements or CLAUDE.md efficiency section. `--skip-skills`: no `.claude/skills/` at all.
- Drop the `.claude/handoff.md` ignore entry when the handoff skill is not written.
- Formatter hook: ask only if the detector found a formatter and a single-file command exists in the template. Show the hook JSON and the `format.sh` script from the Claude Code reference, nothing else. Handoff hook: ask only if the handoff skill is planned; show the JSON from `blueprints/hooks/session-start-handoff.md`. Both default to no.
- Code-search MCP: ask only for a large codebase (the Repo graph `Source files:` line shows more than about 1,000, or `workspaces` lists 10 or more members), or when the user asked. Follow `reference/code-search.md`. Embeddings are never the default. Write `.mcp.json` only on yes.
- The plan is a contract: Phase 4 writes exactly what it lists, with settings JSON verbatim. If anything changes after confirmation, show the new content and get a new yes. If a file exists, never replace it without a per-file yes.

---

## Phase 4: Generate

**Write order.** Write `.claude/` files first, then `docs/`, then adapters (with `.gitignore` and `.worktreeinclude`), and AGENTS.md and CLAUDE.md last. AGENTS.md goes last so an interrupted run does not leave links to files that were never written. AGENTS.md and CLAUDE.md may mention a file (agent, skill, doc) only if it was written successfully in this run or already exists. If a write was refused or failed, leave its mention out of AGENTS.md and CLAUDE.md, and list the file under `Files to create by hand` in the final report with its full content.

Write exactly what the confirmed plan lists: no extra files, no extra permission entries, no extra version notes, none dropped. Use the plan's file names exactly, including the reviewer name. Never drop or rename a planned file silently; if one is skipped, name it and say why in the report. If a write is refused (Claude Code can protect `.claude/` paths in some permission modes), do not work around it. For settings.json, the `Files to create by hand` entry is the same JSON as in the plan.

Follow the blueprint for each file. Each one lists its inputs, rules and size cap.

| Output | Blueprint |
|---|---|
| `docs/architecture.md` | `blueprints/docs/architecture.md` |
| `docs/project-structure.md` | `blueprints/docs/project-structure.md` |
| `docs/config.md` | `blueprints/docs/config.md` |
| `docs/decisions/` | `blueprints/docs/decisions.md` |
| `.claude/rules/code-style.md` | `blueprints/rules/code-style.md` |
| `.claude/rules/testing.md` | `blueprints/rules/testing.md` |
| `.claude/rules/security.md` | `blueprints/rules/security.md` |
| `.claude/agents/explorer.md` | `blueprints/agents/explorer.md` |
| `.claude/agents/test-runner.md` | `blueprints/agents/test-runner.md` |
| `.claude/agents/<lang>-reviewer.md` | `blueprints/agents/reviewer.md` |
| `.claude/skills/plan-task/SKILL.md` | `blueprints/skills/plan-task.md` |
| `.claude/skills/handoff/SKILL.md` | `blueprints/skills/handoff.md` |
| `hooks.SessionStart` in settings | `blueprints/hooks/session-start-handoff.md` |
| `## Working agreements` in AGENTS.md | `blueprints/agents-md-working-agreements.md` |
| `## Claude Code` in CLAUDE.md | `blueprints/claude-md-efficiency.md` |

### AGENTS.md (target 150 lines or fewer)

Sections, each only if it has real content:
1. One-line stack summary.
2. `## Commands`: setup, build, test, lint, format, typecheck, dev, as available. Exact, copy-pasteable. In a monorepo, root commands first, then how to run one workspace. Add a single-test command only when the runner is known and the form is in the template or a knowledge note. Use the runner's node-id form: `uv run pytest path/to/test_x.py::test_name`, `pnpm vitest run path -t "name"`, `cargo test name`, `go test ./pkg -run TestName`.
3. `## Repo map`: only directories that matter and are not obvious. Link `docs/project-structure.md` when written. No tree dumps.
4. `## Working agreements` (blueprint). Link the docs that exist, in one line each.
5. `## Conventions`: only what differs from language defaults or is documented in the repo.
6. `## Hard rules`: quoted in full, each with its source, e.g. `- "Packages must not import from apps." (README.md:5)`.
7. `## Version notes`: at most 10 one-line bullets, runtime frameworks first, exactly the notes listed in the confirmed plan.
8. `## Boundaries`: never touch (generated files with their regenerate command, lockfiles by hand, applied migrations, secrets) and ask first (new dependencies, schema changes). Boundaries must agree with settings.json: anything in `deny` is "never", not "ask first".

In a monorepo, add a nested AGENTS.md in a workspace only when it has its own commands or rules. List it in the plan.

### docs/project-structure.md

Paste the injected `## Repo graph` section verbatim between `<!-- claude-setup:begin graph -->` and `<!-- claude-setup:end graph -->`, each marker on its own line, once. Write notes outside the fence only. If the section is empty or missing, skip the file and say why.

### CLAUDE.md

First line `@AGENTS.md`. Then the `## Claude Code` efficiency section (blueprint) and any other Claude-only lines. Claude Code reads AGENTS.md only when no CLAUDE.md exists, so the import is required. Never use a symlink by default.

### .claude/settings.json

Start from `"$schema": "https://json.schemastore.org/claude-code-settings.json"`. Merge into an existing file; keep every existing key.
- `permissions.allow`: space-glob form, as narrow as the commands you list in AGENTS.md (`Bash(pnpm turbo run *)`, not `Bash(pnpm turbo *)`). Git is read-only: `Bash(git diff *)`, `Bash(git status *)`, `Bash(git log *)`, `Bash(git show *)`. Add `git add` or `git commit` only if the user asks. No `Bash(*)`.
- `permissions.deny`: `Bash(rm -rf *)`, `Bash(git push --force *)`, `Bash(git reset --hard *)`, stack publish commands, and secrets: `Read(./.env)`, `Read(./.env.*)`, `Read(./**/*.pem)`, `Read(./secrets/**)`. A Read deny also blocks Edit. If `env.files` lists an example file the agent should read, deny explicit names instead of `.env.*`.
- Never set `defaultMode` to `auto` or `bypassPermissions`. No secrets, tokens, personal paths or `env` values.
- Hooks only for the yes answers in the plan, with the exact content shown there.

### Directory rules, reviewer, other skills

- `.claude/rules/<dir>.md`: frontmatter `paths:` (list of globs), 3 to 10 lines, only for a directory with real, distinct conventions. Never restate AGENTS.md. Every identifier in backticks must exist in the repo: grep first.
- Reviewer: follow `blueprints/agents/reviewer.md`. Template checklists are candidates, not defaults. Keep a line only with a citation to a repo fact (config file, documented rule, hard rule, detected version). Before writing a line that bans or requires a pattern, grep the repo for it. If the repo uses the pattern, drop the line or scope it with the exception and reason. Prefer 4 to 8 strong lines. Never flag what the repo does on purpose.
- Extra skills (`release`, `preview-deploy`, `db-migrate`) only for a real workflow with commands that exist here. Side-effecting skills get `disable-model-invocation: true` and a narrow `allowed-tools`. No stub bodies.

### .worktreeinclude, .gitignore, .mcp.json, adapters

- `.worktreeinclude`: gitignore syntax. Only files that are gitignored and that a fresh worktree needs (`.env`, `.env.local`, `CLAUDE.local.md`, `.claude/settings.local.json`, `.mcp.json` if ignored). Use `env.gitignored`. Skip when nothing qualifies.
- `.gitignore`: append `CLAUDE.local.md`, `.claude/settings.local.json`, `.claude/worktrees/` and, when the handoff skill is written, `.claude/handoff.md`. Append only, and only entries that are missing.
- `.mcp.json`: only on yes, from `reference/code-search.md`. Merge into an existing file.
- gemini: `.gemini/settings.json` with `context.fileName` (merge). aider: `.aider.conf.yml` with `read: AGENTS.md` (merge). cursor, copilot, cline, windsurf: read AGENTS.md natively; for path-scoped rules run `node "${CLAUDE_SKILL_DIR}/scripts/sync-rules.mjs" --targets <list>` after `.claude/rules/` is written. codex, zed, junie, amp, kiro, opencode: nothing. `.codex/config.toml` only on yes; never set profiles or providers, because project config is ignored unless the project is trusted.

---

## Phase 5: Verify and report

1. Run one call over every planned file that was written in this run or already exists: `node "${CLAUDE_SKILL_DIR}/scripts/verify.mjs" --dir . <files...>`. Include docs, agents, skills, rules and settings. It checks line counts, JSON validity, secret-like text, AGENTS.md and CLAUDE.md size, the `@AGENTS.md` import and settings.json safety. A planned file that is missing is reported as an error. It never opens .env files. Fix every error and re-run until it exits 0. Quote its final `verify:` summary line verbatim in the report.
2. Check each written agent and skill against its blueprint: every field in the blueprint's `Frontmatter:` rule is present with the stated value. Check that the graph fence markers appear once each and that the text between them equals the injected Repo graph section.
3. Compare the written files with the confirmed plan. Report any difference: a file, permission entry, hook or version note planned but not written, or written but not planned.
4. If adapters with scoped rules were written, run `node "${CLAUDE_SKILL_DIR}/scripts/sync-rules.mjs" --targets <same list> --check`. It must report no pending changes. (`--check` without `--targets` is a usage error.)
5. If the user said yes to the check, run the fastest detected check once (lint or typecheck, or the single-test form). Never run commands with side effects (deploy, publish, migrate, dev servers). If a command fails, fix it or drop it from AGENTS.md and say so.
6. Print: the tree, line counts, hazards, a `Files to create by hand` section (each file with its full content), and one check per tool written:
   - Claude Code: `/memory` shows AGENTS.md imported through CLAUDE.md. `/agents` lists explorer and test-runner. `/plan-task <task>` and `/handoff` appear in the `/` menu.
   - Gemini CLI: `/memory show` includes the AGENTS.md text.
   - Codex: ask it to summarize the instructions it loaded.
   - Copilot: in a chat response, expand References and look for AGENTS.md.
   - Cursor, Cline, Windsurf, Aider: ask the agent to quote the test command from its instructions.
7. Remind the user to commit AGENTS.md, CLAUDE.md, `docs/`, `.claude/` (not `settings.local.json`, not `handoff.md`) and `.worktreeinclude`. If the handoff hook was written, say to delete `.claude/handoff.md` when the work it describes is done.

---

## Update mode (`--update`)

1. Detection, graph and guidance are already in the injected context. Read the existing AGENTS.md, CLAUDE.md, `.claude/`, `docs/`, adapters and rule mirrors.
2. Compare: `## Commands` against the repo's scripts and `commands.*`; `## Version notes` against `frameworks` and the knowledge entries; rule mirrors via `sync-rules.mjs --targets <list> --check`; hard-rule candidates not yet recorded; missing adapters; the graph fence in `docs/project-structure.md` against the injected Repo graph; pipeline files (explorer, test-runner, plan-task, handoff, topic rules) not yet present.
3. Print a diff-style plan, one hunk per change, each marked `+`, `-` or `~` with its reason and source.
4. Apply only confirmed hunks. Replace the graph fence only between its markers. Touch only generated sections (Commands, Version notes, graph fence, mirrors, adapters). New pipeline files follow Phase 4 and need a per-file yes. Never rewrite user prose, reorder sections, or remove a rule the user wrote.
5. Run Phase 5 on the changed files.

---

## Anti-goals

- No empty folders. No `output-styles/`, `commands/` or `agent-memory/` by default.
- No copied docs examples. Generate a rule only if this repo has that convention.
- No clobbering. Per-file confirmation before any replace.
- No invented commands, hard rules or version notes. Every line traces to the detector, the repo, or a cited knowledge entry.
- No plan drift: write what the confirmed plan lists, nothing else.
- No hand-written graph. The fence holds script output only.
- No `Agent` tool for subagents. No embeddings or MCP without a yes.
- No generic advice ("write clean code"), no restating linter rules, no long prose.
- No secrets, tokens or `.env` values in any file. Never read `.env*`.
- No `Bash(*)`, no `defaultMode: auto` or `bypassPermissions` in committed settings.
- No `.junie/AGENTS.md`, no legacy single-file rules, no Roo Code files.
- No stub skills. Working or skipped.
