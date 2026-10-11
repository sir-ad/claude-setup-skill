---
name: claude-setup
description: Sets up a repo for coding agents. Writes AGENTS.md (commands traced to your scripts and CI, hard rules with sources, version notes), CLAUDE.md, a repo graph and docs, topic rules, an evidence-based agent roster with model tiers, a local prompt router, plan-task, orchestrate and handoff skills, and agent files for Codex, Gemini, opencode and Copilot. Use on a new repo, or with --update.
argument-hint: "[--dry-run] [--minimal] [--skip-docs] [--skip-pipeline] [--skip-skills] [--no-router] [--update] [--intent \"<text>\"] [--model-map fast=X,standard=Y,deep=Z] [--agents=claude,codex,cursor,copilot,gemini,aider,cline,windsurf,all]"
allowed-tools: Bash(node *)
---

# /claude-setup

Set up the current project for coding agents. AGENTS.md is the single source of truth. CLAUDE.md imports it. Docs, rules, a role roster, subagents, skills, a router hook and thin adapters sit on top.

The rule of this skill: write only what the repo or a cited source supports. No empty folders, no placeholders, no invented commands or rules, no generic advice. Scripts produce facts and the generated parts. You write prose only from those facts.

Flags from the user: $ARGUMENTS

If `--update` is among them, jump to "Update mode" after Phase 2.

---

## Phase 1: Detect and load context

The core is injected here: the detector JSON, the repo graph, the agent roster, the chosen template, the matching knowledge notes (bullets already filtered to the detected versions), the writing guide and an index of everything else. Blueprints and other references are fetched on demand in Phase 2. The scripts are read-only and never open .env files.

!`node "${CLAUDE_SKILL_DIR}/scripts/context.mjs" . 2>/dev/null || echo 'CONTEXT_ERROR: node not available or context.mjs failed'`

If the output above contains `CONTEXT_ERROR` or has no `## Detection` section, follow "If the context is missing" in Phase 2 first.

The header lists `Template:`, `Knowledge:`, `Sections:` and `Size:`. Sections follow in this order: `## Detection`, `## Template`, `## Knowledge` notes for the stack, `## Repo graph`, `## Agent roster`, `## Reference: reference/writing-agent-files.md` and `## Guidance index`. On a large repo the core is compacted: lists are capped harder and the writing reference moves to the index. If `## Reference: reference/writing-agent-files.md` is absent, fetch it with `--show` before writing any file. The index has one line for each blueprint (the README first), reference and knowledge file that is not injected. `Size:` is the size of this injected context, not of the repo. Headings inside the roster are demoted to `###`.

**Permission mode.** Writes under `.claude/` need a permission mode that allows them. Interactive mode asks for each file. Headless `acceptEdits` refuses them. The skill still works: Phase 4 stages a refused file under `.claude-setup/` and gives one apply command. Never change the permission mode or the settings to get a write through.

If `--intent "<text>"` was given, re-run `node "${CLAUDE_SKILL_DIR}/scripts/roster.mjs" . --intent "<text>" --markdown` and use its output instead of the injected roster, with its `## ` headings changed to `### `. Keep an `intent:` role only if the text names a capability. Pass the same `--intent` to `emit.mjs` in Phase 4.

### Reading the detection JSON

- `primary`, `languages`, `layout` (`single` | `monorepo`), `workspaces`, `packageManager`, `packageManagerVersion`, `languageVersion`.
- `frameworks[]`: `name`, `version` (declared), `range`, `group` (`runtime` | `dev` | `test` | `optional` | `peer`), `where`, `alsoIn`. These drive version notes.
- `commands.{setup,build,test,lint,format,typecheck,dev,other}[]`: `{cmd, source, alsoIn?}`. Every command in AGENTS.md must trace to an entry here or to a script, Makefile target or CI step you opened. A `source` that is only a CI file means the command is real but may need CI env. An `implied:` entry is inferred from a manifest, so check it against the repo's own scripts.
- `ci`, `docs` (existing docs, ADR folders), `infra`, `versionFiles`, `warnings`.
- `agentConfigs[]`: `{path, tool}` for every existing agent file.
- `hardRuleCandidates[]`: `{text, source}` where source is `file:line`. Candidates, not rules.
- `env.files` (example env files), `env.gitignored`.
- `generated[]`: `{path, evidence}` for files with "DO NOT EDIT" or "@generated" headers, or written by a script.

The roster lists a role only where the repo shows evidence (its Why column), at most 8 besides `explorer`. It is the source for role agents, `docs/agents.md`, the Routing section and the router. Never add a role it did not list.

### Decide

1. **Template**: the script picked one and says why (`Template: <name> (reason)`). Override only with a stated reason, such as a mixed repo. Mention a secondary ecosystem in AGENTS.md.
2. **Agents to write for**: `--agents` if given (`all` means every name in the hint). Default: `claude` plus every tool in `agentConfigs`. Behavior per tool is in the adapters reference.
3. **Existing files** (default action is keep):
   - AGENTS.md exists: merge missing sections, never drop or reword user content.
   - CLAUDE.md has content and no AGENTS.md exists: propose moving the tool-neutral parts into AGENTS.md and leaving CLAUDE.md as `@AGENTS.md` plus Claude-only lines. Ask first.
   - Both exist and CLAUDE.md lacks the import: propose prepending `@AGENTS.md`, nothing else.
   - Legacy files (`.cursorrules`, `.windsurfrules`, `.clinerules` as a file, `.rules`, `.github/copilot-instructions.md`, `.junie/AGENTS.md`): do not touch. Report as hazards.
   - Equivalents: skip any docs file, agent, skill or rule whose equivalent already exists (check `docs`, the filesystem and `.claude/`). Say "skipped: exists" in the plan. A merge of a pipeline file is a MERGE line in the plan.
4. **Hard rules**: keep a candidate only if it constrains code changes. Product-scope statements, marketing copy, history and setup chatter are not hard rules. Open the source around the cited line if unclear. Quote the whole sentence, or mark a cut with "…". Never trim a qualifier that weakens the rule ("unless", "except"). Cite `file:line`. Invent none. None left means no Hard rules section.
5. **Ask one question, only if genuinely ambiguous**: `primary` is `unknown` with source files present, `warnings` report conflicting lockfiles or package managers, or two ecosystems are equally weighted. Never ask what the JSON answers.

### Investigate before writing

The detector's commands are candidates. Before writing Commands, open the scripts they point at (`scripts/*.sh`, Makefile targets, the main CI workflow). Prefer the repo's own invocations over `implied:` entries (for example `scripts/lint.sh` runs `mypy fastapi`, not `mypy .`; CI installs with extra flags). Before writing Boundaries, use `generated[]` and look for generated docs or code (a README built from a docs page, codegen output). Each generated file goes under "never edit by hand" with the command that regenerates it.

---

## Phase 2: Use the guidance

The template, stack knowledge notes and writing guide are already in the injected context. Use them. A template says what to include for the stack. A blueprint says how to write one kind of file: When to write, Inputs, Rules, Skeleton. Follow the blueprint. Its skeleton is a shape, not text to paste. A slot with no repo fact behind it means the line is dropped.

Blueprints are not injected. After the plan is confirmed and before Phase 4, fetch only the blueprints for files in the plan, in one or two batched calls:

`node "${CLAUDE_SKILL_DIR}/scripts/context.mjs" --show blueprints/agents/role.md blueprints/docs/agents.md blueprints/hooks/router.md`

Run it as one plain command: no `cd`, `&&`, pipe or redirect. A compound command needs its own approval and can stall a headless run.

The paths come from the Guidance index and the Phase 4 table. The same call fetches `knowledge/practices.md` (for the rules files) and any reference. While planning, fetch `reference/model-tiers.md`, `reference/routing.md` or `reference/code-search.md` only if a question needs them. Do not fetch what the plan does not use.

The injected knowledge bullets already match the detected versions. Write a version note only from them. The project's declared version always wins. Notes for `dev`, `test`, `optional` or `peer` dependencies rank below `runtime` ones, and a `test`-group package is never described as the project's framework. `knowledge/practices.md` feeds the rules files: copy only bullets that apply to a language, library or risk the repo has, and skip any the repo's lint or CI already enforces.

### If the context is missing

The injection failed, or Node is missing.
1. `Read` the files from `${CLAUDE_SKILL_DIR}`. Templates are in `${CLAUDE_SKILL_DIR}/templates/<name>.md`. The list: node-monorepo, node-single, python, go, rust-single, rust-workspace, jvm, ruby, dotnet, php, generic. Knowledge notes are in `${CLAUDE_SKILL_DIR}/knowledge/`. The files are node.md, frontend.md, python.md, rust.md, go.md, jvm.md, ruby.md, dotnet.md, php.md, mobile.md and infra.md. Read only the notes that match, plus `practices.md`. Blueprints are indexed in `${CLAUDE_SKILL_DIR}/blueprints/README.md`. Also read the files in `${CLAUDE_SKILL_DIR}/reference/`. Read blueprints one by one with `Read` instead of `--show`.
2. Get detection from `node "${CLAUDE_SKILL_DIR}/scripts/detect.mjs" .` and the graph from `node "${CLAUDE_SKILL_DIR}/scripts/graph.mjs" . --markdown`. If Node is missing, do a manual pass with read-only commands: `ls -la`, `ls .claude .github/workflows docs 2>/dev/null`, `README.md` (first 120 lines), the manifests that exist, `Makefile`, CI workflows. Never `cat` lockfiles or `.env*`. Take commands only from manifest scripts, Makefile targets and CI steps. Without scripts there are no fences and no router, so skip `docs/project-structure.md`, `docs/agents.md` and the router, and say so in the plan.
3. If the skill files cannot be read either, STOP. Tell the user the skill directory is out of reach and suggest `--add-dir ~/.claude/skills/claude-setup` for headless runs. Do not continue with a degraded plan.

---

## Phase 3: Plan and confirm

Print this before writing anything. Replace each bracketed slot with real names. The skeleton shows the shape only.

```
Detected: <stack> (<layout>), <pm>, <primary framework + version>
Agents:   <claude, codex, ...>   (source: --agents | existing configs | default)
Commands: setup=<cmd> build=<cmd> test=<cmd> lint=<cmd>   (repo script or CI step first, detector second)

Will write (one line per file, real paths, no globs, braces or placeholders):
  AGENTS.md                                 (NEW | MERGE | KEEP; ## Working agreements, ## Routing, ## Delegation)
  CLAUDE.md                                 (NEW: @AGENTS.md + efficiency section | MERGE | KEEP)
  .claude/settings.json                     (NEW | MERGE)
  docs/agents.md                            (NEW, roster fence from emit.mjs | skipped: <why>)
  docs/architecture.md                      (NEW | skipped: exists)
  docs/project-structure.md                 (NEW, graph fence from emit.mjs)
  docs/config.md                            (NEW | skipped: no env example)
  docs/decisions/0000-template.md           (NEW only if no ADR folder)
  docs/decisions/README.md                  (NEW only if no ADR folder)
  .claude/rules/code-style.md               (NEW, paths: <globs>)
  .claude/rules/testing.md                  (NEW, paths: <globs>)
  .claude/rules/security.md                 (NEW, always on)
  .claude/rules/<dir>.md                    (NEW, one line per directory rule)
  .claude/agents/explorer.md                (NEW)
  .claude/agents/test-runner.md             (NEW)
  .claude/agents/<lang>-reviewer.md         (NEW, model: opus)
  .claude/agents/<role>.md                  (NEW, one line per roster role, model from tier)
  .claude/hooks/route.mjs                   (NEW, router unit from emit.mjs)
  .claude/router.json                       (NEW, router unit from emit.mjs)
  .claude/skills/plan-task/SKILL.md         (NEW)
  .claude/skills/orchestrate/SKILL.md       (NEW, only with role agents)
  .claude/skills/handoff/SKILL.md           (NEW)
  .claude/skills/<name>/SKILL.md            (NEW, reason: <workflow>; one line per extra skill)
  .worktreeinclude                          (NEW | SKIP)
  .gemini/settings.json                     (NEW | MERGE, only when gemini is selected)
  .aider.conf.yml                           (NEW | MERGE, only when aider is selected)
  <one line per mirror path from the dry run>
  .gitignore                                (append: CLAUDE.local.md, .claude/settings.local.json, .claude/worktrees/, .claude/handoff.md, .claude/route-log.jsonl)

Roster (<n> roles): <role: tier, evidence in a few words>, ...
Version notes (<n>, exactly these will be written): <package@version -> short title>, ...
Hard rules kept (<n>):
  - "<quote>" (README.md:5) -> AGENTS.md
Hazards: <e.g. .cursorrules shadows AGENTS.md in Zed>
Existing files: <path: keep | merge | replace>
Skipped: <what and why>
```

Then the full `.claude/settings.json` (the merged result if the file exists, including the router hook), verbatim, in a json block.

Answer each yes/no line in the same reply as Proceed. The default is in brackets:
```
  Router hook [yes]: UserPromptSubmit runs a local script on each prompt, no network, adds a one-line routing hint.
  Formatter hook [no]: PostToolUse runs <formatter> on each edited file. Adds .claude/hooks/format.sh.
  Handoff hook [no]: SessionStart prints .claude/handoff.md.
  Code-search MCP [no]: .mcp.json entry, local server. Asked only for a large codebase or when the user asked.
  Codex config [no]: .codex/config.toml. Only if codex is selected.
  Fastest check [no]: run <lint | typecheck | single test> once.
Proceed? [y/N/edit-plan]
```
Under each line that adds a file or a hook, show its exact content.

Get the router and fence paths from the script, not from memory: `node "${CLAUDE_SKILL_DIR}/scripts/emit.mjs" . --write router,agents-doc,structure-doc --dry-run` (with the same `--intent` as Phase 4) and copy each `write` path it prints. Do not pass `--stage` in this dry run. Mirror files are skipped until `.claude/agents/` exists, so list them by the paths in `reference/agent-adapters.md`, one line per role file per selected tool.

Rules for the plan:
- `--dry-run`: print the plan and stop. Write nothing.
- `--minimal`: only AGENTS.md, CLAUDE.md and `.claude/settings.json`. No roster, router, docs or pipeline files. No `.gitignore` change; mention the entries in the report. Adapters still follow an explicit `--agents`.
- `--skip-docs`: no `docs/` files. `--skip-pipeline`: no explorer, test-runner, reviewer, role agents, plan-task, orchestrate, handoff, router, handoff hook, Working agreements, Routing, Delegation or CLAUDE.md efficiency section. `--skip-skills`: no `.claude/skills/` at all. `--no-router`: no router hook, `route.mjs`, `router.json` or log ignore entry; the roster stays.
- `--intent` and `--model-map` change inputs, not the file list.
- Drop the `.claude/handoff.md` ignore entry when the handoff skill is not written, and `.claude/route-log.jsonl` when the router is not written.
- Formatter and handoff hooks: ask only if the detector found a formatter with a single-file command, or the handoff skill is planned. Show the hook JSON and the script from the Claude Code reference or `blueprints/hooks/session-start-handoff.md`, nothing else.
- Router: default yes. It adds one line of context. It cannot change the model or block a prompt. Its hook JSON from `blueprints/hooks/router.md` is part of the settings block. Say that "no routing" in a prompt, `/noroute` or `CLAUDE_SETUP_ROUTER=off` skips it. If the user says no, drop the hook, both router files and the log entry, and show the updated plan.
- Code-search MCP: ask only for a large codebase (the Repo graph `Source files:` line shows more than about 1,000, or `workspaces` lists 10 or more members), or when the user asked. Follow `reference/code-search.md`. Embeddings are never the default.
- The plan is a contract. Phase 4 writes exactly what it lists, with settings JSON verbatim. Replacing an existing file is a REPLACE line in the plan with its diff shown, covered by the same Proceed. If anything changes after Proceed, show the change and ask again.

---

## Phase 4: Generate

**Write order.** The Write tool writes every file, except the parts `emit.mjs` owns: the router unit, the two fences in `docs/` and the agent mirrors. Those are never typed by hand.

1. **Model-authored `.claude/` files.** Write each with the Write tool, from its blueprint: the role, reviewer, explorer and test-runner agents, the rules, the skills, and the settings JSON without the router hook (emit.mjs merges that).
2. **Docs and other files.** Write the `docs/` prose with each fence comment on its own line and nothing between the pair. Then `.worktreeinclude`, the other `.gitignore` entries, and `.gemini/settings.json` or `.aider.conf.yml` only when that tool is selected.
3. **Generated parts.** Run `node "${CLAUDE_SKILL_DIR}/scripts/emit.mjs" . --write router,agents-doc,structure-doc,mirrors [--targets <list>] [--intent "<text>"] [--model-map fast=X,standard=Y,deep=Z]`. Leave out `router` with `--no-router`, `agents-doc` or `structure-doc` when those files are skipped. Pass `mirrors` only when another tool is selected, with `--targets` for those tools. It runs only once `.claude/agents/` is in place. It writes the router as one unit (`.claude/hooks/route.mjs` as a byte copy of `scripts/router/route.mjs`, `.claude/router.json`, the `UserPromptSubmit` entry in settings, the `.claude/route-log.jsonl` line in `.gitignore`; all or nothing). It fills the roster fence in `docs/agents.md` and the graph fence in `docs/project-structure.md` with script output only, and writes other-tool agent mirrors. Add `--stage` only after a refusal (below).
4. **AGENTS.md, then CLAUDE.md**, last, so they link only to files that exist.

**Refusals.** If a step 1 write is refused, do not retry it another way. Write every remaining model-authored `.claude/` file to `.claude-setup/staged/.claude/<same path>` with the Write tool, then run step 3 with `--stage`. With `--stage`, emit.mjs sends its `.claude/` files to staging and writes the rest in place. Never copy `route.mjs`, `router.json` or fence content by hand, never use `node -e`, `cp`, `sed` or a shell redirect to reach `.claude/`, and never change the permission mode or settings to get a write through. A staged file is not in place, so AGENTS.md and CLAUDE.md do not mention it, and mirrors (built from `.claude/agents/`) wait for `apply.mjs`; the report says so. The report lists every staged path and the command `node .claude-setup/apply.mjs`.

Write exactly what the confirmed plan lists: no extra files, no extra permission entries, no extra version notes, none dropped. Use the plan's file names exactly, including the reviewer name. A planned file that is skipped is named in the report with its reason.

Follow the blueprint for each file, fetched with `--show` as described in Phase 2. Each one lists its inputs, rules and size cap.

| Output | Blueprint | Written by |
|---|---|---|
| `docs/architecture.md` | `blueprints/docs/architecture.md` | Write |
| `docs/project-structure.md` | `blueprints/docs/project-structure.md` | Write (prose), emit.mjs (graph fence) |
| `docs/config.md` | `blueprints/docs/config.md` | Write |
| `docs/decisions/` | `blueprints/docs/decisions.md` | Write |
| `docs/agents.md` | `blueprints/docs/agents.md` | Write (prose), emit.mjs (roster fence) |
| `.claude/rules/code-style.md`, `testing.md`, `security.md` | `blueprints/rules/code-style.md`, `blueprints/rules/testing.md`, `blueprints/rules/security.md` | Write |
| `.claude/agents/explorer.md`, `test-runner.md` | `blueprints/agents/explorer.md`, `blueprints/agents/test-runner.md` | Write |
| `.claude/agents/<lang>-reviewer.md` | `blueprints/agents/reviewer.md` | Write |
| `.claude/agents/<role>.md` (each roster role) | `blueprints/agents/role.md` | Write |
| `.claude/skills/plan-task/SKILL.md` | `blueprints/skills/plan-task.md` | Write |
| `.claude/skills/orchestrate/SKILL.md` | `blueprints/skills/orchestrate.md` | Write |
| `.claude/skills/handoff/SKILL.md` | `blueprints/skills/handoff.md` | Write |
| `hooks.SessionStart` in settings | `blueprints/hooks/session-start-handoff.md` | Write (settings) |
| router hook, `route.mjs`, `router.json`, `hooks.UserPromptSubmit` | `blueprints/hooks/router.md` | emit.mjs |
| other-tool agent mirrors | `scripts/sync-agents.mjs` via emit.mjs | emit.mjs |
| `## Working agreements`, `## Routing`, `## Delegation` in AGENTS.md | `blueprints/agents-md-working-agreements.md`, `blueprints/agents-md-routing.md` | Write |
| `## Claude Code` in CLAUDE.md | `blueprints/claude-md-efficiency.md` | Write |

### AGENTS.md (target 150 lines or fewer)

Sections, each only if it has real content:
1. One-line stack summary.
2. `## Commands`: setup, build, test, lint, format, typecheck, dev, as available. Exact, copy-pasteable. In a monorepo, root commands first, then how to run one workspace. Add a single-test command only when the runner is known and the form is in the template or a knowledge note. Use the runner's node-id form: `uv run pytest path/to/test_x.py::test_name`, `pnpm vitest run path -t "name"`, `cargo test name`, `go test ./pkg -run TestName`.
3. `## Repo map`: only directories that matter and are not obvious. Link `docs/project-structure.md` when written. No tree dumps.
4. `## Working agreements`, `## Routing` and `## Delegation` (blueprints). These are AGENTS.md text and are written even when every `.claude/` file is staged. They name only agents that exist in place. Delegation is required for Codex, which spawns subagents only when told. Name `/orchestrate` only when its skill is in place. Link the docs that exist, in one line each.
5. `## Conventions`: only what differs from language defaults or is documented in the repo.
6. `## Hard rules`: quoted in full, each with its source, e.g. `- "Packages must not import from apps." (README.md:5)`.
7. `## Version notes`: at most 10 one-line bullets, runtime frameworks first, exactly the notes listed in the confirmed plan.
8. `## Boundaries`: never touch (generated files with their regenerate command, lockfiles by hand, applied migrations, secrets) and ask first (new dependencies, schema changes). Boundaries must agree with settings.json: anything in `deny` is "never", not "ask first".

In a monorepo, add a nested AGENTS.md in a workspace only when it has its own commands or rules. List it in the plan.

### docs/agents.md and docs/project-structure.md

Write the prose, with `<!-- claude-setup:begin roster -->` and `<!-- claude-setup:end roster -->` in `docs/agents.md`, and `<!-- claude-setup:begin graph -->` and `<!-- claude-setup:end graph -->` in `docs/project-structure.md`. Each marker is on its own line, once. emit.mjs fills the pair from `roster.mjs` and `graph.mjs`. Never type fence content. Notes and tables outside the fences come from the blueprints. If a script prints nothing, skip that file and say why.

### Role agents and the router

- One `.claude/agents/<role>.md` per roster role, from `blueprints/agents/role.md`. The tier sets `model`: fast `haiku`, standard `sonnet`, deep `opus`. `<lang>-reviewer` and `security-reviewer` are deep, so `model: opus`. No role agent has the `Agent` tool.
- Router: emit.mjs writes it in Phase 4 step 3. Never write `route.mjs` or `router.json` by hand. After a real (not staged) write, run `node .claude/hooks/route.mjs --explain "<a prompt from this repo's domain>"` once and put one line of its output in the report.

### CLAUDE.md

First line `@AGENTS.md`. Then the `## Claude Code` efficiency section (blueprint) and any other Claude-only lines. Claude Code reads AGENTS.md only when no CLAUDE.md exists, so the import is required. Never use a symlink by default.

### .claude/settings.json

Start from `"$schema": "https://json.schemastore.org/claude-code-settings.json"`. Merge into an existing file; keep every existing key.
- `permissions.allow`: space-glob form, as narrow as the commands you list in AGENTS.md (`Bash(pnpm turbo run *)`, not `Bash(pnpm turbo *)`). Git is read-only: `Bash(git diff *)`, `Bash(git status *)`, `Bash(git log *)`, `Bash(git show *)`. Add `git add` or `git commit` only if the user asks. No `Bash(*)`.
- `permissions.deny`: `Bash(rm -rf *)`, `Bash(git push --force *)`, `Bash(git reset --hard *)`, the secret reads `Read(./.env)`, `Read(./.env.*)`, `Read(./**/*.pem)`, `Read(./secrets/**)` (a Read deny also blocks Edit; if `env.files` lists an example file the agent should read, deny explicit names instead of `.env.*`), and the publish commands of the detected stack: `Bash(npm publish *)`, `Bash(pnpm publish *)`, `Bash(yarn npm publish *)`, `Bash(changeset publish *)`, `Bash(cargo publish *)`, `Bash(twine upload *)`, `Bash(gem push *)`, only those the repo can use.
- Deny a script (`Bash(pnpm run <name> *)`) only when its body in `package.json` or the Makefile publishes. Never deny a script that only versions or prepares a release, such as `changeset version`, or a release script that stops before publishing.
- Never set `defaultMode` to `auto` or `bypassPermissions`. No secrets, tokens, personal paths or `env` values.
- Hooks only for the yes answers in the plan, with the exact content shown there.

### Directory rules, reviewer, other skills

- `.claude/rules/<dir>.md`: frontmatter `paths:` (list of globs), 3 to 10 lines, only for a directory with real, distinct conventions. Never restate AGENTS.md. Every identifier in backticks must exist in the repo: grep first.
- Reviewer: follow `blueprints/agents/reviewer.md`, with `model: opus`. Template checklists are candidates, not defaults. Keep a line only with a citation to a repo fact (config file, documented rule, hard rule, detected version). Before writing a line that bans or requires a pattern, grep the repo for it. If the repo uses the pattern, drop the line or scope it with the exception and reason. Prefer 4 to 8 strong lines.
- Extra skills (`release`, `preview-deploy`, `db-migrate`) only for a real workflow with commands that exist here. Side-effecting skills get `disable-model-invocation: true` and a narrow `allowed-tools`. No stub bodies.

### .worktreeinclude, .gitignore, .mcp.json, adapters

- `.worktreeinclude`: gitignore syntax. Only files that are gitignored and that a fresh worktree needs (`.env`, `.env.local`, `CLAUDE.local.md`, `.claude/settings.local.json`, `.mcp.json` if ignored). Use `env.gitignored`. Skip when nothing qualifies.
- `.gitignore`: append `CLAUDE.local.md`, `.claude/settings.local.json`, `.claude/worktrees/` and, when the handoff skill is written, `.claude/handoff.md`. `.claude/route-log.jsonl` comes from emit.mjs with the router. Append only entries that are missing.
- `.mcp.json`: only on yes, from `reference/code-search.md`. Merge into an existing file.
- Other tools' agent files: emit.mjs runs `sync-agents.mjs` for the selected tools among codex, gemini, opencode and copilot. Include `copilot` only for the Copilot cloud agent, because Copilot CLI and VS Code read `.claude/agents/` directly. Add `--model-map` only with values the user typed. Without a map the mirrors carry no model. Formats are in the adapters reference.
- gemini: `.gemini/settings.json` with `context.fileName` (merge). aider: `.aider.conf.yml` with `read: AGENTS.md` (merge). cursor, copilot, cline, windsurf: read AGENTS.md natively. For path-scoped rules, run `node "${CLAUDE_SKILL_DIR}/scripts/sync-rules.mjs" --targets <list>` after `.claude/rules/` is written in place (not staged). codex, zed, junie, amp, kiro, opencode: nothing. `.codex/config.toml` only on yes; never set profiles or providers, because project config is ignored unless the project is trusted.

---

## Phase 5: Verify and report

1. Run one call: `node "${CLAUDE_SKILL_DIR}/scripts/verify.mjs" --dir . --expect <planned paths written in place, comma-separated> <every file written in place>`. If emit.mjs got `--intent`, pass the same `--intent` here. Include `docs/agents.md`, every agent file, `.claude/hooks/route.mjs`, `.claude/router.json`, skills, rules and settings when they landed in place. Staged files are not expected at their planned paths, so leave them out of `--expect` and list them in the report. `--expect` turns any planned path that was not written into an error, so leave out files the user declined. verify.mjs checks line counts, JSON, secret-like text, AGENTS.md and CLAUDE.md size and import, links to missing files, settings safety, and the fences (markers paired and in order, no empty or placeholder text, text equal to script output). It never opens .env files. Fix every error and re-run until it exits 0. Quote its final `verify:` line verbatim in the report.
2. Check each written agent and skill against its blueprint's Frontmatter rule (reviewers carry `model: opus`). Check that each fence marker appears once.
3. Compare the written files with the confirmed plan. Report any difference: a file, permission entry, hook or version note planned but not written, or written but not planned.
4. If rule mirrors were written, run `node "${CLAUDE_SKILL_DIR}/scripts/sync-rules.mjs" --targets <same list> --check`. If agent mirrors were written, run `node "${CLAUDE_SKILL_DIR}/scripts/sync-agents.mjs" --targets <same list> --check` (add the same `--model-map`). Both must report no pending changes. (`--check` without `--targets` is a usage error.)
5. If the user said yes to the check, run the fastest detected check once. Never run commands with side effects (deploy, publish, migrate, dev servers). If a command fails, fix it or drop it from AGENTS.md and say so.
6. Print the tree, line counts, hazards and one check per tool written:
   - Claude Code: `/memory` shows AGENTS.md imported through CLAUDE.md. `/agents` lists explorer, test-runner and the role agents. `/plan-task`, `/orchestrate` and `/handoff` appear in the `/` menu. A prompt gets a `Route:` line, and `node .claude/hooks/route.mjs --explain "<prompt>"` shows why.
   - Gemini CLI: `/memory show` includes the AGENTS.md text. Also `@<role>` at the start of a prompt runs a role agent.
   - Codex: ask it to summarize the instructions it loaded and to list the agents in `.codex/agents/`.
   - opencode: `@<role>` runs a role agent.
   - Copilot: in a chat response, expand References and look for AGENTS.md.
   - Cursor, Cline, Windsurf, Aider: ask the agent to quote the test command from its instructions.
   - If staging was used: a "Staged" section listing every file under `.claude-setup/` (the staged files, `apply.mjs` and `README.md`) and the command `node .claude-setup/apply.mjs`. Paste no file content.
7. Remind the user to commit AGENTS.md, CLAUDE.md, `docs/`, `.claude/` (not `settings.local.json`, not `handoff.md`), `.claude/agent-memory/` (reviewer memory) and `.worktreeinclude`. Do not commit `.claude-setup/`. If the handoff hook was written, say to delete `.claude/handoff.md` when the work it describes is done. If the router was written, say how to skip it, and that the optional Ollama and Decider backends are off until `CLAUDE_SETUP_ROUTER` is set (`reference/routing.md`).

---

## Update mode (`--update`)

1. Detection, graph, roster and router config are the same sources as before: the injected context, `scripts/roster.mjs --router-config` for the router config, and `scripts/graph.mjs --markdown` for the graph. Fetch blueprints with `--show` for any new file. Read the existing AGENTS.md, CLAUDE.md, `.claude/`, `docs/`, adapters and rule mirrors.
2. Compare: `## Commands` against the repo's scripts and `commands.*`; `## Version notes` against `frameworks` and the knowledge entries; rule mirrors via `sync-rules.mjs --targets <list> --check`; hard-rule candidates not yet recorded; missing adapters; the graph fence in `docs/project-structure.md` and the roster fence in `docs/agents.md` against script output; `.claude/router.json` against `roster.mjs --router-config` (show the diff; if `.claude/route-log.jsonl` exists, read counts only to propose keyword or threshold changes); agent mirrors via `sync-agents.mjs --targets <list> --check`; new roles in the roster and pipeline files not yet present.
3. Print a diff-style plan, one hunk per change, each marked `+`, `-` or `~` with its reason and source.
4. Apply only confirmed hunks. Refresh fences and the router unit with `emit.mjs` only, as in Phase 4 step 3. Touch only generated sections (Commands, Version notes, fences, mirrors, adapters). New pipeline files follow Phase 4 and are listed in the diff plan under the same Proceed. Never rewrite user prose, reorder sections, or remove a rule the user wrote.
5. Run Phase 5 on the changed files.

---

## Anti-goals

- No empty folders. No `output-styles/`, `commands/` or `agent-memory/` by default.
- No copied docs examples. Generate a rule only if this repo has that convention.
- No clobbering. Replacing a file is a REPLACE line in the plan.
- No invented commands, hard rules or version notes. Every line traces to the detector, the repo, or a cited knowledge entry.
- No plan drift: write what the confirmed plan lists, nothing else.
- No hand-typed fences, `route.mjs` or `router.json`, and no `node -e` copies. `emit.mjs` writes them.
- No role without evidence in the roster. No edits to the copied `route.mjs`.
- No `Agent` tool for subagents. No embeddings or MCP without a yes.
- No deny rule that blocks a versioning script. No publish command left allowed.
- No generic advice ("write clean code"), no restating linter rules, no long prose.
- No secrets, tokens or `.env` values in any file. Never read `.env*`.
- No `Bash(*)`, no `defaultMode: auto` or `bypassPermissions` in committed settings.
- No `.junie/AGENTS.md`, no legacy single-file rules, no Roo Code files.
- No stub skills. Working or skipped.
