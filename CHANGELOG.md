# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-10

### Added

- `scripts/graph.mjs` builds a module-level import graph for JS/TS, Python, Go and Rust. It ranks modules, finds entry points, and prints a Mermaid graph and a budgeted repo map with `--markdown`. It has no dependencies and never opens `.env` files.
- `docs/project-structure.md` holds the graph between `<!-- claude-setup:begin graph -->` and `<!-- claude-setup:end graph -->`. `--update` refreshes only the text inside those markers. The skill also writes `docs/architecture.md`, `docs/config.md` (env var names, never values) and, when no ADR folder exists, `docs/decisions/`.
- `blueprints/` tells the skill how to write each generated file: when to write it, which inputs to read, the rules and a skeleton. Every blueprint is injected into the context.
- Agentic pipeline: read-only `explorer` and `test-runner` subagents, a reviewer that keeps project memory, and the `plan-task` and `handoff` skills. Subagents never get the `Agent` tool. The skill is named `plan-task` because Claude Code has a built-in `/plan` command.
- Topic rules: `.claude/rules/code-style.md`, `testing.md` and `security.md`, built from the repo first and a short baseline second.
- AGENTS.md gains a tool-neutral "Working agreements" section. CLAUDE.md gains a short section of token and memory habits.
- `knowledge/practices.md`, a cited do and don't baseline for security, testing, code changes, dependencies and git.
- `reference/agentic-pipeline.md`, `reference/token-efficiency.md` and `reference/code-search.md`.
- Opt-in extras, each a separate yes in the plan: a SessionStart hook that prints `.claude/handoff.md`, a code-search MCP entry in `.mcp.json`, and `.codex/config.toml`.
- Flags `--skip-docs` and `--skip-pipeline`.
- `test/consistency.test.mjs` checks that README, SKILL.md, the templates and the adapters reference agree.
- `verify.mjs` checks that links in AGENTS.md and CLAUDE.md point to files that exist. `--expect <paths>` turns any planned file that was not written into an error. Phase 5 passes the plan's file list.

### Changed

- The default output now includes docs, topic rules and the pipeline files. `--minimal` still writes only AGENTS.md, CLAUDE.md and `.claude/settings.json`.
- Phase 3 prints the exact formatter hook, the handoff hook and every `.gitignore` entry the skill will append. The plan lists `.gitignore` entries exactly as Phase 4 writes them.
- One formatter-hook recipe, the script in `reference/claude-code.md`.
- All templates allow only read-only git (`diff`, `status`, `log`, `show`) and use the space-glob form for install and test rules, so `pnpm install --frozen-lockfile` matches.
- README says commands are traced to your scripts and CI, not verified by running them. It separates what scripts enforce from what the skill instructs. Version notes in `knowledge/` cite sources; the one-line notes in AGENTS.md do not.
- The skill writes `.claude/` first and AGENTS.md and CLAUDE.md last. They mention only files that were written or already exist. Refused files are listed under "Files to create by hand" with their content.
- `docs/config.md` cites where code reads each variable, or says that no code reads it. `docs/architecture.md` lists an external service only when code calls it, with a `path:line` citation.
- The explorer page shows the new files and flags.

### Fixed

- `detect.mjs` finds workspace members when the file walk runs out of budget, keeps members named `build`, `dist`, `vendor` or `target`, and no longer lets one huge folder starve the walk.
- `detect.mjs` gives JVM, .NET, Ruby, PHP, sbt and CMake projects implied commands and language versions. CI commands keep their working directory. `catalog:`, `workspace:*` and `latest` are no longer reported as versions. Yarn Berry gets the right workspace command. Go `/vN` module names, more agent config directories and odd script names are handled.
- Hard-rule candidates are whole paragraphs and no longer cite sections the skill wrote itself.
- `verify.mjs` detects Anthropic, OpenAI, Stripe, Google, GitHub, GitLab, Slack, npm and AWS keys, JWTs and credentials in URLs. Invalid JSON reports only a line and column. It errors on unrestricted `Bash` allows and a missing `@AGENTS.md` import.
- `sync-rules.mjs` reports a legacy `.clinerules` file as a conflict instead of crashing. `--check` ignores CRLF differences.
- The `.gitignore` plan listed two entries while Phase 4 appended three.
- A hard-rule sentence that runs into a short code block is kept whole.

## [0.2.0] - 2026-10-10

### Added

- AGENTS.md is the shared source of truth for every agent. CLAUDE.md imports it with `@AGENTS.md` and keeps only Claude-only lines. Claude Code reads AGENTS.md only when no CLAUDE.md exists, so the import is required.
- `--agents=<list>` writes adapters for the tools you name: `claude`, `codex`, `cursor`, `copilot`, `gemini`, `aider`, `cline`, `windsurf`, or `all`. Gemini CLI gets `.gemini/settings.json` and Aider gets `.aider.conf.yml`. Cursor, Copilot, Cline and Windsurf read AGENTS.md and get rule mirrors instead.
- `--update` re-runs detection, compares it with your current files, and applies only the changes you confirm. Your own prose is never rewritten.
- `scripts/sync-rules.mjs` copies path-scoped rules from `.claude/rules/` into the formats Cursor, Copilot, Cline and Windsurf read. Generated files carry a marker comment. Files without the marker are never overwritten or removed. `--check` exits 1 when mirrors are stale, so CI can run it.
- `scripts/detect.mjs` reads a project and reports its languages, package manager, frameworks with declared versions, commands, CI workflows and existing agent files. It never reads `.env` files or lockfile contents.
- `scripts/context.mjs` picks the stack template and knowledge notes for the project. The skill loads its output at start, so headless runs no longer need read access to the skill directory.
- `scripts/verify.mjs` checks every written file in one pass: line counts, JSON syntax, secret patterns, AGENTS.md and CLAUDE.md size and import, and unsafe settings. It never prints a matched secret.
- Knowledge notes in `knowledge/` cover 11 ecosystems: Node/TypeScript, frontend, Python, Rust, Go, JVM, Ruby, .NET, PHP, mobile and infra. Versions were checked in October 2026. Each note names old habits to drop and links to its upstream source.
- Reference docs in `reference/` cover the exact file formats, the adapter table with known hazards, and how to write agent files. They ship with the skill and the npm package.
- New templates for JVM, Ruby, .NET and PHP.
- README covers headless use.
- `scripts/validate.mjs` checks SKILL.md frontmatter, referenced paths, template, knowledge and reference files, and package and installer coverage. Run it with `npm run validate`. `npm test` runs the tests and `npm run check` runs both.
- CI workflow in `.github/workflows/ci.yml`. It runs validate, tests, a pack check and an installer smoke test on Node 18, 22 and 24. A second job checks `install.sh` with `bash -n` and shellcheck. `CONTRIBUTING.md` explains how to run these checks.
- `bin/install.js` gains `--dry-run`, `--uninstall` and `--help`. `install.sh --help` prints usage. Both installers exit with status 2 on unknown flags.

### Changed

- The existing templates are reworked for AGENTS.md output. Version-specific advice moved to `knowledge/` so templates stay correct as tool versions change.
- Generated `.claude/settings.json` uses the current permission syntax and denies reads of secret files. Committed settings never set a bypass mode.
- Hard-rule candidates come only from contributing docs, ADRs, existing agent files and rule-like README sections. Tutorial prose and option descriptions are dropped. Sentences are kept whole.
- Reviewer checklists and rules must tie each line to a fact in the repo.
- The skill loads its context in one step. If that is missing, it reads the skill files instead, and stops with a clear message if neither works.
- Files are written exactly as the confirmed plan lists. Any drift is reported after the write.
- Writes refused under `.claude/` are reported with the full intended content instead of being skipped.
- Detected frameworks show their dependency group (runtime, dev, test, optional or peer), and the package manager version is recorded.
- Single-test commands use the form each test runner expects.
- When a repo defines no setup command, the skill adds an implied one.
- `install.sh` is now POSIX `sh` instead of bash.
- The README demo shows AGENTS.md output and the Cursor mirror.
- Reinstall backups go to `~/.claude/backups/claude-setup/` so Claude Code no longer lists the old copy as a second skill. Old backups in the skills folder are moved there on install.

## [0.1.0] - 2026-04-25

### Added

- Initial `/claude-setup` skill in `SKILL.md`.
- Seven stack templates in `templates/`: Rust workspace, Rust single crate, Node monorepo, Node single package, Python, Go, and a generic fallback.
- `install.sh`, which symlinks the repo into `~/.claude/skills/`.
- Example output for a Node monorepo in `examples/`.
- README with logo, badges, install and usage docs, and an animated terminal demo.
- npm package `@claude-setup-skill/install` with `bin/install.js` and a publish workflow.
