# Blueprint: .claude/rules/code-style.md

Path-scoped conventions for source files. It loads only when Claude reads or edits a matching file.

## When to write
- Only when you found at least 3 conventions in the repo that differ from the language default and that no lint or format config enforces.
- Skip for tiny repos, for repos with no source files, and with `--minimal`. Zero rules is a valid result.
- Do not write it if `.claude/rules/code-style.md` exists. List a MERGE in the plan instead.

## Inputs
- Lint and format config: ESLint or Biome config, Prettier, `ruff.toml` or `[tool.ruff]`, `.editorconfig`, `rustfmt.toml`, `.golangci.yml`, `.rubocop.yml`. Read them to learn what is already enforced.
- 3 to 5 representative source files, read by range. Look for patterns the config cannot see: module layout, naming of files, error handling style, logging helper, import alias.
- Detector: `frameworks[]`, `hardRuleCandidates[]`, source roots from the template.
- `CONTRIBUTING.md`, `docs/`, and the existing `AGENTS.md` Conventions section.
- `knowledge/practices.md`, Code changes. Copy only bullets that apply.

## Rules
- Frontmatter has `paths` only, a YAML list of quoted globs for the source directories (`"src/**/*.{ts,tsx}"`). Never `**/*`. Other fields are ignored by Claude Code.
- Body: 4 to 12 bullet lines, hard cap 40 lines. Short imperative sentences.
- Repo-derived rules first. Then at most 3 baseline bullets from `knowledge/practices.md`.
- Never restate what lint or format config already enforces (quotes, semicolons, import order, line length). Point to the config in one line if useful.
- Never restate AGENTS.md. Do not repeat commands.
- Every identifier in backticks must exist. Grep for it before writing. Every rule that bans or requires a pattern needs a grep check: if the repo breaks it on purpose, scope the rule or drop it.
- No generic advice ("write clean code").
- In a monorepo, scope each rule file to one workspace's paths, or name a subfolder (`.claude/rules/web/code-style.md`).

## Skeleton
```markdown
---
paths:
  - "<source glob, e.g. src/**/*.{ts,tsx}>"
---
# Code style
- <Convention the config does not enforce>. Example: `<path>`.
- Put <kind of code> in `<directory>`, not in `<other directory>`.
- Log through `<logger helper>`. Do not call `<banned call>` here.
- Name <kind of file> as `<pattern>`.
- Do not mix reformatting with other changes.
```
