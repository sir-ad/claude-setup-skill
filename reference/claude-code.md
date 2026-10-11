# Claude Code file formats

The exact formats the skill writes. Checked against the Claude Code docs on 2026-10-09. Docs index: https://code.claude.com/docs/llms.txt

## CLAUDE.md and imports

Source: https://code.claude.com/docs/en/memory

- Project file is `./CLAUDE.md` or `./.claude/CLAUDE.md`. They are equivalent. Personal file is `./CLAUDE.local.md`. It is not deprecated. It loads after CLAUDE.md. You must gitignore it; Claude Code does not. In a worktree it exists only where you created it.
- Since v2.1.277 Claude Code reads AGENTS.md natively, but only when no CLAUDE.md (or `.claude/CLAUDE.md`, or `CLAUDE.local.md`) exists at or above the cwd. If any CLAUDE.md exists, only CLAUDE.md files are read. So the skill always writes a CLAUDE.md that imports AGENTS.md:

```markdown
@AGENTS.md

## Claude Code
Use plan mode for changes under `src/billing/`.
```

- `@path` resolves relative to the importing file, nests up to four hops, and is skipped in code spans and fences. Imports load at launch, so they do not save context.
- Prefer the import over a symlink. Edit and Write refuse to write through symlinks and Windows checkouts break.
- Target under 200 lines per CLAUDE.md file. CLAUDE.md is advice. Rules that must hold belong in `permissions` or a hook.

## .claude/settings.json

Sources: https://code.claude.com/docs/en/settings , https://code.claude.com/docs/en/permissions

Strict JSON: no comments, no trailing commas. If a permission mode refuses writes under `.claude/`, stage the file under `.claude-setup/staged/` and give the user `node .claude-setup/apply.mjs`. Never work around a refusal. Precedence, highest first: managed, `--settings`, `settings.local.json`, `settings.json`, `~/.claude/settings.json`. Arrays merge across files. A deny in any scope beats an allow in any scope.

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
- Write `Bash(npm run *)` (space form). `Bash(ls:*)` means the same at the end of a pattern.
- Read and Edit rules use gitignore patterns. `./x` is relative to the cwd, `//abs/path` is absolute, `~/x` is home. A bare filename matches at any depth.
- A `Read` deny also blocks Edit and Write on that path. Path rules for `Write` and `Glob` are never consulted. Use `Read(...)` and `Edit(...)`.
- `.env.*` also matches `.env.example`. Deny can't be carved back by an allow. If the agent should read the example file, deny explicit names (`.env`, `.env.local`, `.env.*.local`).
- Bash deny rules are not a security boundary (`sh -c` bypasses them). `.claudeignore` has no effect.
- Publish denies name the real publish commands: `Bash(npm publish *)`, `Bash(pnpm publish *)`, `Bash(yarn npm publish *)`, `Bash(changeset publish *)`, `Bash(cargo publish *)`, `Bash(twine upload *)`, `Bash(gem push *)`. A script is denied only when its body publishes. A script that only versions, such as `changeset version` behind `pnpm run release`, stays allowed.

Never put in committed settings: `defaultMode` of `auto` or `bypassPermissions` (Claude Code ignores them from project settings anyway), tokens, keys, `env` values, personal paths, or a blanket `Bash(*)`.

Committed `allow` rules take effect only after the user accepts the workspace-trust dialog. `deny` and `ask` apply at once. Treat committed hooks as code execution.

Add `CLAUDE.local.md`, `.claude/settings.local.json` and `.claude/worktrees/` to `.gitignore`. Claude Code adds only the settings file, and only to the user's global excludes.

## .claude/rules/*.md

Source: https://code.claude.com/docs/en/memory

Found recursively, so subfolders such as `frontend/` work. No `paths` means the rule loads at launch with the same priority as `.claude/CLAUDE.md`. With `paths` it loads when Claude reads or edits a matching file. `paths` is the only frontmatter field read; other fields are silently ignored. Invalid YAML makes the rule load unconditionally. There is no override order: everything is concatenated, and if two rules conflict Claude may follow either one. Path-scoped rules reload on demand after `/compact`; unscoped rules are re-injected from disk. If a rule must persist, drop `paths`.

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

`name` and `description` are required. Field names are camelCase and unknown fields are ignored. The opening `---` must be line 1. `tools` accepts a comma-separated string or a YAML list. Omitting it inherits every tool.

```markdown
---
name: ts-reviewer
description: Reviews TypeScript changes for strictness, server/client boundaries and PII in logs. Use proactively after code changes.
tools: Read, Grep, Glob
memory: project
model: opus
---
You review diffs. Report findings by file and line. Do not edit.
```

Frontmatter fields:

| Field | Notes |
|---|---|
| `name`, `description` | Required. `description` tells Claude when to delegate; "use proactively" encourages it. Name: max 256 chars, no `:`. |
| `tools`, `disallowedTools` | Allowlist and denylist. |
| `model` | `sonnet`, `opus`, `haiku`, a full ID, or `inherit`. Order: per-call param, frontmatter, `CLAUDE_CODE_SUBAGENT_MODEL`, main model. |
| `permissionMode` | `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan`, `manual`. |
| `maxTurns` | Partial output comes back and the agent can be resumed. |
| `skills`, `mcpServers`, `hooks` | Skill content is injected at startup. MCP servers and hooks are scoped to the agent; `Stop` becomes `SubagentStop`. |
| `memory` | `user`, `project` or `local`. See below. |
| `background`, `isolation`, `effort` | Always background; `worktree`; `low` to `max`. |
| `omitClaudeMd` | v2.1.271+. Skips CLAUDE.md for that agent. |
| `color`, `initialPrompt`, `experimental.cacheTtl` | `initialPrompt` only applies when run as the main agent with `--agent`. |

`permissionMode`, `mcpServers` and `hooks` are ignored for plugin subagents.

Nesting: subagents can spawn subagents. Default depth is 3 below the main agent (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`; `1` disables it). The spawn tool is `Agent`; `Task(...)` still works as an alias. To stop a subagent from spawning, leave `Agent` out of its `tools`. Up to 20 run at once (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`). The skill's generated subagents omit `Agent`.

A subagent starts fresh. It gets its system prompt, the task message, CLAUDE.md (unless built-in Explore or Plan, or `omitClaudeMd`), a git status snapshot and preloaded skills. It does not get conversation history or the main session's auto memory. Only its final message returns. Restate any needed rule in the task message.

Memory scopes (`memory:`):
- `project`: `.claude/agent-memory/<name>/`. Commit it. The recommended default.
- `user`: `~/.claude/agent-memory/<name>/`.
- `local`: `.claude/agent-memory-local/<name>/`. Do not commit.

When on, Read, Write and Edit are enabled for the agent and the first 200 lines or 25 KB of its `MEMORY.md` are injected. It does nothing if auto memory is disabled.
Set `model: opus` on a reviewer (the deep tier), so review does not depend on the session model. Defining your own agent named `Explore` overrides the built-in one.

## Skills: .claude/skills/<name>/SKILL.md

Source: https://code.claude.com/docs/en/skills

All frontmatter fields are optional; `description` is recommended. `name` defaults to the folder name; use lowercase letters, digits and hyphens. Keep SKILL.md under 500 lines. Fields: `name`, `description`, `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context`, `agent`, `background`, `hooks`, `paths`, `shell`, `metadata`, `license`, `compatibility`. Description plus `when_to_use` is cut at 1,536 characters.

```markdown
---
name: release
description: Cut a release with changesets. Use when the user asks to release or publish a version.
disable-model-invocation: true
allowed-tools: Bash(pnpm changeset *) Bash(pnpm run build) Bash(git tag *)
---
Run `pnpm changeset version`, then `pnpm run build` and `pnpm test`. Tag with `git tag v<version>`. Do not push.
```

`allowed-tools` pre-approves for the turn that invokes the skill. It does not restrict. `disable-model-invocation: true` makes it user-invoked only, hides its description from context and stops it being preloaded into subagents; set it on anything with side effects. `user-invocable: false` makes background knowledge for Claude only. `context: fork` with `agent: Explore|Plan|general-purpose|<custom>` runs the body as a task in an isolated subagent. A skill that is only guidelines returns nothing useful that way.

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

The hook gets JSON on stdin; `tool_input.file_path` is absolute. Exit 0 so a formatter failure never blocks the edit. For other formatters use the single-file command from the stack template, or skip the hook.

### Other hook facts

Source: https://code.claude.com/docs/en/hooks
- `SessionStart` matchers: `startup|resume|clear|compact|fork`. Stdout or JSON `additionalContext` is added to context. Only `command` and `mcp_tool` handlers work. Use matcher `compact` to put text back after compaction.
- `PreCompact` (matchers `manual|auto`) can only block, with exit 2 or `decision: "block"`. It cannot inject context; `systemMessage` and `continue` are discarded. Use it for side effects.
- `Stop` can continue the agent with `{"decision":"block","reason":"..."}`. Continuations are capped at 8 in a row (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`). Read `stop_hook_active` from stdin and exit 0 when it is true.
- `SubagentStop` has the same decision format and matches the agent type. To add context to the parent after a subagent returns, use `PostToolUse` on the `Agent` tool.

## .worktreeinclude

Source: https://code.claude.com/docs/en/worktrees

Project root, gitignore syntax. Claude Code copies a file into a new worktree only if it matches a pattern and is gitignored. Tracked files are never duplicated.

Typical contents: `.env`, `.env.local`, `.claude/settings.local.json`.

## .mcp.json

Source: https://code.claude.com/docs/en/mcp

The skill does not create it without a yes (see `code-search.md`). If one exists, leave it alone. It lives at the project root with top key `mcpServers`. An entry with `url` and no `type` is a config error. Secrets go in `${VAR}` references, never literals. Claude Code asks before using project servers. A committed approval in `.claude/settings.json` is ignored in an untrusted folder.

## Auto memory

Source: https://code.claude.com/docs/en/memory

Notes Claude writes for itself in `~/.claude/projects/<project>/memory/`. Machine-local, never committed; the first 200 lines or 25 KB of `MEMORY.md` load at start. `/memory` views it. Do not ship it. Ship `.claude/agent-memory/` instead.
