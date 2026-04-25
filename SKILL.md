---
description: Scaffolds a context-aware .claude/ directory for any project. Detects language, framework, monorepo layout, and existing conventions, then generates CLAUDE.md, settings.json, path-scoped rules, a code-reviewer subagent, and stack-relevant skills. Asks before clobbering existing files.
argument-hint: [--minimal | --skip-skills | --dry-run]
---

# /claude-setup

Scaffold a working `.claude/` directory for the current project. Read the codebase, detect context, write only what earns its keep on this stack.

The hard rule of this skill: **don't generate cargo-cult.** No empty folders. No generic placeholders. If a rule, skill, or agent doesn't have a real reason to exist for THIS project, skip it.

---

## Phase 1: Detect

Run these in parallel and study the output:

!`pwd && echo "---" && ls -la`
!`cat README.md 2>/dev/null | head -120`
!`cat package.json Cargo.toml pyproject.toml go.mod Gemfile pom.xml build.gradle build.gradle.kts deno.json bun.lockb 2>/dev/null | head -300`
!`ls .claude/ 2>/dev/null && echo "---existing claude config above---"`
!`cat .gitignore 2>/dev/null | head -60`
!`ls docs/ docs/rfcs/ docs/adr/ docs/architecture/ 2>/dev/null`

From that output, decide:

- **Stack**: Rust (Cargo.toml), Node/TS (package.json), Python (pyproject.toml/requirements.txt), Go (go.mod), Ruby (Gemfile), Java/Kotlin (pom.xml/build.gradle), Deno (deno.json), Bun, or mixed. If multiple, pick the dominant one and note the secondary.
- **Layout**: monorepo (`workspaces`/`turbo`/`nx`/`lerna`/cargo `[workspace]`/Go workspace) vs. single project.
- **Existing `.claude/`**: if present, this is a merge — never overwrite without per-file confirmation.
- **Hard rules** scraped from README/RFCs/ADRs: words like "locked", "banned", "no <X>", "must <X>", "RFC", "ADR-NNN", "invariant" are signals. Encode the real ones — invent none.
- **Test framework, linter, formatter, package manager** — extract from configs and scripts so commands in `CLAUDE.md` are real.

If detection is genuinely ambiguous (multiple lockfiles, no clear primary language, no README), STOP and ask the user **one** focused question to resolve. Don't ask for things you can detect.

---

## Phase 2: Read the matching template

Templates bundled with this skill describe what to generate per stack. Read whichever applies (use `${CLAUDE_SKILL_DIR}/templates/<name>.md`):

- `rust-workspace.md` — Cargo `[workspace]`
- `rust-single.md` — single Cargo.toml
- `node-monorepo.md` — npm/yarn/pnpm workspaces, turbo, nx, lerna
- `node-single.md` — single package.json (Next.js, Vite, Express, etc.)
- `python.md` — Poetry, pip+venv, uv, hatch
- `go.md` — `go.mod` projects
- `generic.md` — fallback for anything else

Each template lists what `CLAUDE.md` should include, which permissions matter, which path-scoped rules earn their keep, how to tune the code-reviewer subagent, and which skills are typically useful for that stack.

The templates are **references**, not boilerplate to paste. Use them to decide what to generate; phrase the output in terms of THIS project.

---

## Phase 3: Plan and confirm

Print a plan to the user before writing anything:

```
Detected: <stack> (<layout>)
Project name: <name>
Primary commands: build=<cmd>, test=<cmd>, lint=<cmd>

Will create:
  CLAUDE.md                                  (NEW | MERGE | SKIP)
  .worktreeinclude                           (NEW | SKIP)
  .claude/settings.json                      (NEW)
  .claude/rules/<n>.md                       (NEW, path: <glob>)
  .claude/agents/<lang>-reviewer.md          (NEW)
  .claude/skills/<n>/SKILL.md                (NEW)

Will skip (no clear use case): output-styles/, commands/, agent-memory/

Existing files: <list with action: keep/replace/merge>

Hard rules detected from README/RFCs:
  - <quote 1> → encoded in rules/<file>.md
  - <quote 2> → encoded in CLAUDE.md

Proceed? [y/N/preview/edit-plan]
```

If `--dry-run`: stop here.

If a file already exists, default action is **keep**. Ask before replace.

If `--minimal`: plan only `CLAUDE.md` + `.claude/settings.json`.

If `--skip-skills`: omit `skills/` from the plan.

---

## Phase 4: Generate

Write files according to the plan. Per-file rules:

### `CLAUDE.md`
- Top: stack one-liner.
- `## Commands` block: real commands extracted from package.json scripts / Makefile / Cargo aliases / pyproject scripts. Don't list commands that don't exist.
- `## Repo map` block: only the directories that matter. Skip `node_modules`, `target`, `dist`, `.next`, `__pycache__`.
- `## Hard rules`: only what came from README/RFCs/ADRs. If nothing's there, omit the section — don't pad.
- `## Behavioral principles`: keep the user's existing principles if `CLAUDE.md` already has them; otherwise omit (their global `~/.claude/CLAUDE.md` likely covers it).

### `.claude/settings.json`
- `permissions.allow`: stack-tuned. For Rust: `cargo *`, `git diff *`, `gh *`. For Node: `npm test *`, `npm run *`, `pnpm *`. Don't allow blanket `Bash(*)`.
- `permissions.deny`: minimum `rm -rf *`, `git push --force *`, `git reset --hard *`. Add stack-specific destructive ones (e.g. `npm publish *` for libraries).
- No hooks unless the project has a clear pre/post-tool need.

### `.claude/rules/<name>.md`
Path-scoped rules ONLY for directories with real conventions. Heuristic:
- Monorepos: one rule per workspace member that has distinct rules.
- Test conventions: one rule scoped to `**/*test*` patterns IF the project has non-obvious test conventions.
- Infra/IaC: one rule scoped to `infra/**` IF the project has IaC.
- API design: one rule scoped to API routes IF there's a clear shape contract.

Don't generate a rule just because the docs example had one. If the conventions are obvious from `CLAUDE.md`, no rule needed.

### `.claude/agents/<lang>-reviewer.md`
- Tools: `Read, Grep, Glob` only (read-only).
- Body: language-tuned checklist (see template).
- Description must be specific enough that Claude auto-invokes for review tasks: "Reviews <lang> changes for ..." — list the specific checks.

### `.claude/skills/<n>/SKILL.md`
Generate ONLY skills that have a clear, repeatable workflow:
- `/release` — if the project has a version file (Cargo.toml, package.json, pyproject.toml) AND a CHANGELOG.md.
- `/test` — if there's a non-trivial test command (e.g. matrix, multiple suites). Single `cargo test` doesn't need a skill.
- `/lint` — same logic.
- Stack-specific (e.g. `/db-migrate` for Django/Rails, `/deploy-preview` for Next.js).

Don't generate placeholder skills with TODO bodies. Working or skipped, no in-between.

### `.worktreeinclude`
- List gitignored files that worktrees need: `.env`, `.env.local`.
- If `CLAUDE.md` or `.mcp.json` are gitignored (check `.gitignore`), include them so worktrees aren't blind.
- If `.claude/settings.local.json` is gitignored, include it.

---

## Phase 5: Verify and report

After writing:

```sh
echo "=== generated tree ==="
find .claude -type f | sort
echo "=== line counts ==="
find .claude -type f -exec wc -l {} \;
```

Print:
1. Final tree.
2. Line counts (target: each file ≤ 100 lines; flag if any exceed 150).
3. One concrete verification step (e.g. "open a session, run `/permissions`, confirm `cargo *` shows as committed").
4. Reminder: add `.claude/settings.local.json` to `.gitignore` if not already.

---

## Anti-goals (re-stated for clarity)

1. **No empty folders.** No `output-styles/` unless there's a real style. No `commands/` (skills supersede per Anthropic docs).
2. **No copy-paste from the docs example.** `testing.md` and `api-design.md` from the canonical tree are *examples* — only generate something analogous if THIS project actually has those conventions.
3. **No clobbering.** Always per-file confirm before replacing.
4. **No hard rules from thin air.** Pull from README/RFCs/ADRs. If they don't exist, the project doesn't have hard rules — say so, move on.
5. **No skills with TODOs.** Working or skipped.
6. **No global wildcards in permissions.** `Bash(cargo *)` not `Bash(*)`.

---

## Flags reference

- `--minimal`: `CLAUDE.md` + `.claude/settings.json` only.
- `--skip-skills`: omit skills/.
- `--dry-run`: print plan, write nothing.

(All flags optional. Default is full canonical layout, stack-aware, with confirmation.)
