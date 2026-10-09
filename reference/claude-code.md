# Claude Code file formats

The exact formats the skill writes. Checked against the Claude Code docs on 2026-10-09. Docs index: https://code.claude.com/docs/llms.txt

## CLAUDE.md and imports

Source: https://code.claude.com/docs/en/memory

- Project file is `./CLAUDE.md` or `./.claude/CLAUDE.md`. Personal file is `./CLAUDE.local.md`. You must gitignore it; Claude Code does not.
- Since v2.1.277 Claude Code reads AGENTS.md natively, but only when no CLAUDE.md exists in the cwd or above. If both exist, only CLAUDE.md is read. So the skill always writes a CLAUDE.md that imports AGENTS.md:

```markdown
@AGENTS.md

## Claude Code
Use plan mode for changes under `src/billing/`.
```

- `@path` resolves relative to the importing file. Imports nest up to four hops. They are skipped inside code spans and fenced blocks. They load at launch, so they do not save context.
- Prefer the import over `ln -s AGENTS.md CLAUDE.md`. Edit and Write refuse to write through symlinks and Windows checkouts break.
- Target under 200 lines per CLAUDE.md file. Block-level HTML comments are stripped before injection.
- CLAUDE.md is advice. Rules that must hold belong in `permissions` or a hook.

## .claude/settings.json

Sources: https://code.claude.com/docs/en/settings , https://code.claude.com/docs/en/permissions

Strict JSON: no comments, no trailing commas. Some permission modes refuse writes under `.claude/`; if so, print the file content for the user instead of working around it. Precedence, highest first: managed, `--settings`, `settings.local.json`, `settings.json`, `~/.claude/settings.json`. Arrays merge across files. A deny in any scope beats an allow in any scope.

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": ["Bash(pnpm run *)", "Bash(pnpm test *)", "Bash(git diff *)", "Bash(git status *)"],
    "deny": [
      "Bash(rm -rf *)", "Bash(git push --force *)", "Bash(git reset --hard *)",
      "Read(./.env)", "Read(./.env.*)", "Read(./**/*.pem)", "Read(./secrets/**)"
    ]
  }
}
```

Rule syntax:
- Order is deny, then ask, then allow. First match wins.
- `Bash(npm run *)` is the space form. `Bash(ls:*)` means the same, but only at the end of a pattern. Write the space form.
- `Bash(ls *)` matches `ls` and `ls -la`, not `lsof`. A rule without `*` matches that exact command only.
- Read and Edit rules use gitignore patterns. `./x` is relative to the cwd, `//abs/path` is absolute, `~/x` is home. A bare filename matches at any depth.
- A `Read` deny also blocks Edit and Write on that path. Path rules for `Write` and `Glob` are never consulted. Use `Read(...)` and `Edit(...)`.
- `.env.*` also matches `.env.example`. Deny can't be carved back by an allow. If the agent should read the example file, deny explicit names (`.env`, `.env.local`, `.env.*.local`).
- Bash deny rules are not a security boundary (`sh -c` bypasses them). `.claudeignore` has no effect.

Never put in committed settings: `defaultMode` of `auto` or `bypassPermissions` (Claude Code ignores them from project settings anyway), tokens, keys, `env` values, personal paths, or a blanket `Bash(*)`.

Committed `allow` rules take effect only after the user accepts the workspace-trust dialog. `deny` and `ask` apply at once. Treat committed hooks as code execution.

Add `CLAUDE.local.md`, `.claude/settings.local.json` and `.claude/worktrees/` to `.gitignore`. Claude Code adds only the settings file, and only to the user's global excludes.

## .claude/rules/*.md

Source: https://code.claude.com/docs/en/memory

Found recursively. No `paths` means the rule loads at launch. With `paths` it loads when Claude reads or edits a matching file. `paths` is the only frontmatter field read. Invalid YAML makes the rule load unconditionally.

```markdown
---
paths:
  - "apps/web/**/*.{ts,tsx}"
  - "packages/ui/**"
---
# Web app
- Server Actions for mutations. Server Components for reads.
```

Globs are gitignore style with brace expansion. Quote globs that start with `*` or `{`.

## Subagents: .claude/agents/<name>.md

Source: https://code.claude.com/docs/en/sub-agents

`name` and `description` are required. Field names are camelCase. The opening `---` must be line 1. `tools` accepts a comma-separated string or a YAML list. Omitting it inherits every tool.

```markdown
---
name: ts-reviewer
description: Reviews TypeScript changes for strictness, server/client boundaries and PII in logs. Use proactively after code changes.
tools: Read, Grep, Glob
---
You review diffs. Report findings by file and line. Do not edit.
```

Leave `model` out so the reviewer inherits the session model.

## Skills: .claude/skills/<name>/SKILL.md

Source: https://code.claude.com/docs/en/skills

All frontmatter fields are optional. `name` defaults to the folder name; use lowercase letters, digits and hyphens. Keep it under 500 lines.

```markdown
---
name: release
description: Cut a release with changesets. Use when the user asks to release or publish a version.
disable-model-invocation: true
allowed-tools: Bash(pnpm changeset *) Bash(pnpm run build) Bash(git tag *)
---
1. Run `pnpm changeset version`.
2. Run `pnpm run build` and `pnpm test`.
3. Tag with `git tag v<version>`. Do not push.
```

`allowed-tools` pre-approves for the turn that invokes the skill. It does not restrict. `disable-model-invocation: true` makes it user-invoked only; set it on anything with side effects.

## Hooks: formatter on edit

Source: https://code.claude.com/docs/en/hooks-guide

Only with a yes from the user. Merge into `.claude/settings.json`. Needs `jq`; skip the hook if `which jq` finds nothing.

```json
{ "hooks": { "PostToolUse": [ { "matcher": "Edit|Write", "hooks": [
  { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/format.sh", "args": [], "timeout": 30 }
] } ] } }
```

```bash
#!/bin/bash
# .claude/hooks/format.sh (chmod +x)
FILE=$(jq -r '.tool_input.file_path // empty')
[ -z "$FILE" ] && exit 0
npx --no-install prettier --write --ignore-unknown "$FILE" >/dev/null 2>&1
exit 0
```

The hook gets JSON on stdin; `tool_input.file_path` is absolute. Exit 0 so a formatter failure never blocks the edit. The docs' own one-liner is `jq -r '.tool_input.file_path' | xargs npx prettier --write`; the script above is a hardened variant. For other formatters use the single-file command from the stack template, or skip the hook.

## .worktreeinclude

Source: https://code.claude.com/docs/en/worktrees

Project root, gitignore syntax. Claude Code copies a file into a new worktree only if it matches a pattern and is gitignored. Tracked files are never duplicated.

```text
.env
.env.local
CLAUDE.local.md
.claude/settings.local.json
```

## .mcp.json

Source: https://code.claude.com/docs/en/mcp

The skill does not create it. If one exists, leave it alone. It lives at the project root with top key `mcpServers`. An entry with `url` and no `type` is a config error. Secrets go in `${VAR}` references, never literals.
