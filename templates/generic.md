# Template: Generic fallback

Use when no specific stack template fits: Deno, Swift, Dart, Elixir, Zig, Crystal, infrastructure-only repos, documentation repos, or a repo where detection is thin. Also use it as the guide for mixed or polyglot repos, then add the dominant ecosystem's template on top.

## Detection signals
- `primary` is `null`, `deno`, `swift`, `dart`, `elixir` or an ecosystem without its own template.
- `languages` is empty or has several entries of similar weight. `commands` is empty or comes only from a Makefile, justfile, Taskfile or CI.
- `warnings` mentions conflicting build tools or no manifest.
- Mixed repos: look at `languages` and pick the dominant ecosystem by file count and by where the build files sit. Use that ecosystem's template for settings, rules and the reviewer. Name the secondary ecosystem in AGENTS.md (one line, with its directory and its own commands). Do not merge two stack templates into one set of permissions.

## AGENTS.md
Write the minimum that is true.
- **Commands**: whatever `commands` contains, plus Makefile, justfile or Taskfile targets and commands the README states. Verify every target exists before writing it. If build and test commands are both missing, ask the user one question (language and how they build and test), then write what they say.
- **Repo map**: top-level directories with a one-line role each. For infrastructure repos name the environments and the tool (Terraform, Helm, Kubernetes manifests). For documentation repos name the build tool and the source folder.
- **Conventions**: only what the README, CONTRIBUTING or ADRs state. Quote the source.
- **Version notes**: omit unless a `knowledge/` file covers the detected ecosystem: `infra.md` for Terraform, Docker and Kubernetes repos, `mobile.md` for Swift, Dart and Android.
- **Boundaries**: lockfiles, generated output, applied migrations, state files (`*.tfstate`) and secrets. Include only those that exist in the repo.
- A short file is fine. Under 30 lines is normal for a generic repo.

## CLAUDE.md
`@AGENTS.md` on the first line. Nothing else.

## .claude/settings.json
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(make test)",
      "Bash(git add *)",
      "Bash(git commit *)"
    ],
    "ask": ["Bash(git push *)"],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force *)",
      "Bash(git push -f *)",
      "Bash(git reset --hard *)",
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./**/*.pem)"
    ]
  }
}
```
- Replace `make test` with the exact verified commands from the detector: one entry per command, no wildcards on tools you did not check. Examples: `Bash(deno test *)`, `Bash(mix test *)`, `Bash(swift test *)`, `Bash(zig build test *)`, `Bash(terraform validate)`, `Bash(terraform plan *)`.
- Infrastructure repos: deny `Bash(terraform apply*)`, `Bash(terraform destroy*)`, `Bash(kubectl apply*)`, `Bash(kubectl delete*)` and `Bash(helm upgrade*)` unless the user says otherwise. Also deny `Read(./**/*.tfstate)` and `Read(./**/*.tfvars)` when they exist.
- Add publish denies for any registry the manifest points to (`mix hex.publish*`, `dart pub publish*`, `deno publish*`).
- `Read(./.env.*)` also blocks `.env.example`. When the detector's `env.files` lists an example file, deny the real env files by name instead (for example `Read(./.env.local)`, `Read(./.env.production)`) so the example stays readable.

## Formatter hook (optional)
None by default. Offer one only when the repo has a single-file formatter in its README or CI (for example `deno fmt <file>`, `mix format <file>`, `terraform fmt <file>`) and the user says yes. Use the same shape as the other templates: `PostToolUse`, matcher `Edit|Write`, `jq -r '.tool_input.file_path | select(endswith(".<ext>"))' | xargs -r <formatter>`. `jq` must exist; otherwise parse stdin with a `node -e` one-liner that reads `tool_input.file_path`.

## Path-scoped rules
None. Generic means there is not enough evidence to write rules. If the repo has a clearly separate directory with its own documented rules (for example `infra/**`), one rule for that directory is fine. Mirror it with `node "${CLAUDE_SKILL_DIR}/scripts/sync-rules.mjs" --targets <tools>` if the user picked other agents.

## Reviewer subagent
These are candidate checks, not defaults. Keep a line only when a repo fact backs it (lint or type config, a documented rule, a hard rule, a detected version), and grep the repo first: if the code already uses a pattern on purpose, drop the line or scope it with the exception.

None by default. Without a known language the checklist would be generic. If the user asks for one, write it from the repo's own documented rules and keep `tools: Read, Grep, Glob`.

## Skills
None by default. Generate `release` only if a version file, a changelog and a documented release process all exist. A skill with guessed steps is worse than no skill.

## .worktreeinclude
List only entries in `env.gitignored` (`.env`, `.env.local`, `.claude/settings.local.json`, `CLAUDE.local.md`, `.mcp.json`) plus local-only files the README names. Skip the file when the list is empty.

## What NOT to generate
- No placeholder text and no sections with nothing in them. If a section has no content, leave it out.
- No commands you have not verified exist.
- No rules, reviewer agent or skills by default.
- No `output-styles/`, `commands/` or `agent-memory/`.
- No `Bash(*)`, no `defaultMode` of `auto` or `bypassPermissions`.
