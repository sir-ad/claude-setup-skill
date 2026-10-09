# Template: Go project

Use when `go.mod` or `go.work` exists and Go is the primary language. Covers services, CLIs, libraries and multi-module workspaces.

## Detection signals
- `primary: "go"`. `languageVersion.go` holds the `go` directive and toolchain.
- `layout: "monorepo"` with `workspaces` set means `go.work` or several modules. Otherwise one module.
- `packageManager: "go"`.
- `frameworks` may list `gin`, `echo`, `chi`, `fiber`. No entry usually means the standard library `net/http` or a CLI.
- `commands` holds build, test and vet. Lint and format are not implied by the detector. Add `golangci-lint run` only when a `.golangci.yml`, `.golangci.yaml` or `.golangci.toml` exists. Add `gofmt` or `goimports` as the format command when CI or a Makefile uses it, otherwise `gofmt -w .`.
- `commands` may also come from a Makefile, Taskfile or justfile. Prefer those targets when they exist; they often set build tags and flags.

## AGENTS.md
- **Commands**: build, test, vet, lint, format from the detector and config files. Include test flags the repo needs (`-race`, `-tags integration`) only if CI or the Makefile uses them.
- **Repo map**: `cmd/<name>/` for each binary with a one-line role, `internal/` packages that matter, `pkg/` if present, `api/` or `proto/` for schemas, `migrations/`. For `go.work`, list each module and its path.
- **Conventions worth writing**: how errors are wrapped and which sentinel or typed errors exist; logging library; config loading; dependency injection style (constructors, wire); test style when it differs from table-driven tests; build tags in use.
- **Version notes**: pull from `knowledge/go.md` for the detected `go` directive, toolchain and golangci-lint version. Config format and language features depend on those versions.
- **Boundaries**: do not edit generated files (`*.pb.go`, `*_gen.go`, sqlc output, mocks). Change the source schema and regenerate with the repo's command. Do not edit `go.sum` by hand. Applied migrations are never edited. Do not add dependencies without saying why. Never read or write `.env*`.

## CLAUDE.md
`@AGENTS.md` on the first line. Claude-only lines only if the user has them.

## .claude/settings.json
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(go build *)",
      "Bash(go test *)",
      "Bash(go vet *)",
      "Bash(go mod tidy)",
      "Bash(gofmt *)",
      "Bash(git add *)",
      "Bash(git commit *)"
    ],
    "ask": ["Bash(git push *)", "Bash(go generate *)"],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force *)",
      "Bash(git push -f *)",
      "Bash(git reset --hard *)",
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./**/*.pem)",
      "Read(./**/*.key)"
    ]
  }
}
```
- Add `Bash(golangci-lint run *)` only if a golangci config exists. Add `Bash(goimports *)` only if CI uses it.
- Add `Bash(go run ./cmd/<name> *)` for the entry in `commands.dev`, not `go run *`.
- Add `Bash(make test)` style entries for Makefile targets that the detector listed.
- `go generate` runs arbitrary commands from source comments, so it stays in `ask`.
- `Read(./.env.*)` also blocks `.env.example`. When the detector's `env.files` lists an example file, deny the real env files by name instead (for example `Read(./.env.local)`, `Read(./.env.production)`) so the example stays readable.
- Go libraries ship by tag. Deny `Bash(git push --tags *)` and `Bash(git tag *)` only if the user wants releases to stay manual.

## Formatter hook (optional)
Only when the user says yes. `gofmt` ships with Go, so this is the one case where no formatter detection is needed. Needs `jq`.
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path | select(endswith(\".go\"))' | xargs -r gofmt -w"
          }
        ]
      }
    ]
  }
}
```
Use `goimports -w` if CI runs goimports. Without `jq`: `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const f=JSON.parse(s).tool_input.file_path||'';if(f.endsWith('.go'))require('child_process').spawnSync('gofmt',['-w',f])})"`

## Path-scoped rules
Most Go repos follow community defaults and need none. Mirror rules with `node "${CLAUDE_SKILL_DIR}/scripts/sync-rules.mjs" --targets <tools>` if the user picked other agents.
- `internal/<domain>/**` when the README or an ADR sets layering (for example handlers do not import storage packages directly).
- `cmd/**` when there are several binaries with a shared bootstrap convention.
- `migrations/**` or `db/migrations/**` when SQL migrations are checked in: naming scheme, never edit an applied file.
- `**/*_test.go` only when the repo has non-obvious test rules (golden files, integration build tags, a required test helper).

## Reviewer subagent
These are candidate checks, not defaults. Keep a line only when a repo fact backs it (lint or type config, a documented rule, a hard rule, a detected version), and grep the repo first: if the code already uses a pattern on purpose, drop the line or scope it with the exception.

`.claude/agents/go-reviewer.md`, frontmatter `name: go-reviewer`, `description: Reviews Go changes for ignored errors, goroutine leaks, data races and context misuse. Use after editing .go files.`, `tools: Read, Grep, Glob`.
1. Every returned error is checked. Wrap with `fmt.Errorf("...: %w", err)` when adding context. Compare with `errors.Is` and `errors.As`, not `==` or string matching.
2. Each goroutine has a stop condition (context cancel, closed channel, `WaitGroup`). No goroutine started in a loop without a bound.
3. Shared state is guarded: lock released with `defer`, no copy of a struct containing a mutex, no map written from several goroutines.
4. `context.Context` is the first parameter, is passed down, and is not stored in a struct. No `context.Background()` inside request paths.
5. `defer` inside loops, `rows.Close()` and `resp.Body.Close()` missing, HTTP clients without timeouts.
6. Exported names have doc comments when the repo is a library. New exported API is flagged.
7. SQL built by string concatenation. Secrets or tokens in log lines.
8. Tests: table-driven where the repo does it, `t.Helper()` in helpers, `t.Cleanup` for teardown, no `time.Sleep` for synchronization.

## Skills
- `release`: when the repo has a changelog and a documented tag or GoReleaser flow (`.goreleaser.yaml`). Use the repo's real commands. Go has no version file, so the version is the tag; do not invent one.
- `db-migrate`: when a migration tool is configured (golang-migrate, goose, atlas, sqlc with migrations) and creating one takes more than a single command.
- Skip everything else. `go test ./...` does not need a skill.

## .worktreeinclude
List only entries in `env.gitignored` (`.env`, `.env.local`, `.claude/settings.local.json`, `CLAUDE.local.md`, `.mcp.json`). Skip the file when the list is empty.

## What NOT to generate
- No rules that restate `gofmt`, `go vet` or Effective Go.
- No `output-styles/`, `commands/` or `agent-memory/`.
- No lint command unless a lint config exists.
- No `Bash(*)`, no `go run *` wildcard, no `defaultMode` of `auto` or `bypassPermissions`.
