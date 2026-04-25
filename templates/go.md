# Template: Go project

Reference for `/claude-setup` when `go.mod` exists.

## Detection signals
- `go.mod` at root.
- `go.work` at root → multi-module workspace.
- Common dirs: `cmd/`, `internal/`, `pkg/`.

## CLAUDE.md should include

```md
# {{PROJECT_NAME}}

## Stack
- Go {{from go.mod}}
- Layout: {{single module | go.work multi-module}}
- Modules: {{list}}

## Commands
- Build:    `go build ./...`
- Test:     `go test ./...`
- Vet:      `go vet ./...`
- Lint:     `golangci-lint run`     (only if config present)
- Format:   `gofmt -w .` or `goimports -w .`

## Repo map
- cmd/<name>/   — entry binary
- internal/     — private packages
- pkg/          — public packages
- {{others}}

## Hard rules
- {{From README/ADRs only}}
```

## settings.json permissions

```json
{
  "permissions": {
    "allow": [
      "Bash(go build *)",
      "Bash(go test *)",
      "Bash(go run *)",
      "Bash(go vet *)",
      "Bash(go mod *)",
      "Bash(go work *)",
      "Bash(gofmt *)",
      "Bash(goimports *)",
      "Bash(golangci-lint *)",
      "Bash(git status)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(git add *)",
      "Bash(git commit *)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force *)",
      "Bash(git reset --hard *)"
    ]
  }
}
```

## Path-scoped rules

- `internal/**` — encapsulation rule if README emphasizes it.
- `cmd/**` — main package conventions if multiple binaries.
- Most Go projects follow community defaults — usually no rules needed.

## Code-reviewer subagent (`agents/go-reviewer.md`)

Tools: `Read, Grep, Glob`.

Checklist:
1. Error handling — every error checked, wrapped with `fmt.Errorf("...%w", err)` for context.
2. Goroutines — leaked goroutines (no `context.Context` cancel path), `WaitGroup` Done called.
3. Concurrency — race conditions, `sync.Mutex` placement, `defer mu.Unlock()`.
4. Interfaces — accept interfaces, return concrete types.
5. Tests — `t.Helper()` in test helpers, table-driven tests, `t.Cleanup` over `defer`.
6. Idiomatic Go — no Java-style getters/setters, embedded types, no `interface{}` (use `any`).

## Skills to generate

- `/release` if version detection (Git tags, `internal/version/version.go`) + CHANGELOG.
- Skip otherwise.

## .worktreeinclude

```
.env
{{include if gitignored: CLAUDE.md, .mcp.json}}
.claude/settings.local.json
```
