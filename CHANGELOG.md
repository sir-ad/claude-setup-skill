# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `scripts/validate.mjs` checks SKILL.md frontmatter, paths and file lists, template, knowledge and reference files, and package and installer coverage. Run it with `npm run validate`.
- `npm test`, `npm run validate` and `npm run check` scripts.
- CI workflow in `.github/workflows/ci.yml`. It runs validate, tests, a pack check and an installer smoke test on Node 18, 22 and 24. A second job checks `install.sh` with `bash -n` and shellcheck.
- `reference/` ships with the skill. It is listed in the npm package `files` and the installer copy list.
- `bin/install.js` flags: `--dry-run`, `--uninstall` and `--help`. Unknown flags exit with status 2.
- `install.sh --help`. Unknown flags print usage and exit with status 2.
- `CONTRIBUTING.md`.

### Changed

- `install.sh` is now POSIX `sh` instead of bash.
- `knowledge` and `scripts` are part of the npm package `files` list and the installer copy list.

## [0.1.0] - 2026-04-25

### Added

- Initial `/claude-setup` skill in `SKILL.md`.
- Seven stack templates in `templates/`: Rust workspace, Rust single crate, Node monorepo, Node single package, Python, Go, and a generic fallback.
- `install.sh`, which symlinks the repo into `~/.claude/skills/`.
- Example output for a Node monorepo in `examples/`.
- README with logo, badges, install and usage docs, and an animated terminal demo.
- npm package `@claude-setup-skill/install` with `bin/install.js` and a publish workflow.
