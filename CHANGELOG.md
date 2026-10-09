# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
