# Go

Checked: 2026-10. The project's pinned versions always win over this file.

## Current versions
| Tool | Latest stable | Support notes |
|---|---|---|
| Go | 1.27.2 | Go supports the two newest major versions: 1.27 and 1.26 (1.26.9). 1.25 went EOL 2026-08-19 and 1.24 on 2026-02-10. |
| golangci-lint | 2.14.0 | v2 config format. Import path ends in `/v2`. |
| gin | 1.12.0 | |
| echo | 4.16.0 | Still `/v4`. |
| chi | 5.3.2 | |
| pgx | 5.11.0 | |
| testify | 1.12.1 | |
| cobra | 1.10.2 | |
| grpc-go | 1.84.0 | |
| sqlc | 1.31.1 | |

## Version notes
- **go.mod `go` line >= 1.21**: the `go` line is a strict minimum, and the go command may switch toolchains to meet it. The go command itself writes three-part release versions (`go 1.27.0`); the two-part form `go 1.27` is still a valid language version, so do not rewrite an existing line. [source](https://raw.githubusercontent.com/golang/website/master/_content/doc/go1.21.md)
- **Go >= 1.25**: the go command no longer adds a `toolchain` line when it updates the `go` line. Do not add one by hand unless the project pins a toolchain on purpose. [source](https://raw.githubusercontent.com/golang/website/master/_content/doc/go1.25.md)
- **Go >= 1.21**: use `log/slog` for structured logging in new code. [source](https://raw.githubusercontent.com/golang/website/master/_content/doc/go1.21.md)
- **go.mod `go` line >= 1.22**: each loop iteration has its own variable, so do not write `v := v` before closures or goroutines. `for i := range 10` ranges over an integer. Use `math/rand/v2` for new code. [source](https://raw.githubusercontent.com/golang/website/master/_content/doc/go1.22.md)
- **go.mod `go` line >= 1.22**: `net/http.ServeMux` patterns take a method and wildcards: `mux.HandleFunc("GET /items/{id}", h)` with `r.PathValue("id")`. Do not add a router dependency only for method or path-parameter matching. [source](https://raw.githubusercontent.com/golang/website/master/_content/doc/go1.22.md)
- **Go >= 1.23**: functions can be ranged over (`for x := range seq`). The `iter` package defines the iterator types. [source](https://raw.githubusercontent.com/golang/website/master/_content/doc/go1.23.md)
- **Go >= 1.24**: track tool dependencies with the `tool` directive: `go get -tool example.com/cmd@latest`, run with `go tool <name>`. Do not use a `tools.go` file with blank imports. [source](https://raw.githubusercontent.com/golang/website/master/_content/doc/go1.24.md)
- **Go >= 1.24**: benchmarks use `for b.Loop() { ... }`, not `for i := 0; i < b.N; i++`. [source](https://raw.githubusercontent.com/golang/website/master/_content/doc/go1.24.md)
- **Go >= 1.25**: use `wg.Go(func() { ... })` on `sync.WaitGroup` instead of `wg.Add(1)` plus `go func() { defer wg.Done() ... }()`. `testing/synctest` (`synctest.Test`) tests time-dependent code without real sleeps. [source](https://raw.githubusercontent.com/golang/website/master/_content/doc/go1.25.md)
- **Go >= 1.26**: the built-in `new` accepts an expression, so `new(yearsSince(born))` returns a `*int` and replaces a temporary variable plus `&v`. `go fix ./...` now applies modernizers that rewrite old idioms. [source](https://raw.githubusercontent.com/golang/website/master/_content/doc/go1.26.md)
- **Go >= 1.26**: `go tool doc` is removed. Use `go doc`. [source](https://raw.githubusercontent.com/golang/website/master/_content/doc/go1.26.md)
- **Go >= 1.27**: methods may declare their own type parameters (not interface methods). `encoding/json/v2` and `encoding/json/jsontext` are available, and `encoding/json` is backed by v2, so marshalling output can differ from older releases. Opt out with `GOEXPERIMENT=nojsonv2`. [source](https://raw.githubusercontent.com/golang/website/master/_content/doc/go1.27.md)
- **Go >= 1.27**: `go test` runs the `stdversion` vet check by default, so calling a standard library API newer than the module's `go` line fails the test run. [source](https://raw.githubusercontent.com/golang/website/master/_content/doc/go1.27.md)
- **golangci-lint v2**: the config file starts with `version: "2"`. Set `linters.default` (`standard`, `all`, `none` or `fast`), then `linters.enable` and `linters.settings`. Formatters (`gofmt`, `gofumpt`, `goimports`, `gci`, `golines`) go in a separate top-level `formatters:` section. v1 keys such as `linters-settings` and `issues.exclude-rules` do not apply. [source](https://raw.githubusercontent.com/golangci/golangci-lint/main/.golangci.reference.yml)

## Default toolchain
- Build: `go build ./...`.
- Test: `go test ./...` (add `-race` in CI if the project does).
- Vet: `go vet ./...`.
- Lint: `golangci-lint run` when a `.golangci.yml` exists.
- Format: `gofmt -w .`, or the formatters listed in the project's golangci-lint config.
- Dependencies: `go mod tidy` after changing imports.
