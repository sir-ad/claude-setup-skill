# Template: Rust single crate

Reference for `/claude-setup` when the project is a single-crate Rust project (no `[workspace]` block).

## Detection signals
- `Cargo.toml` with `[package]` only (no `[workspace]`).
- Single `src/` directory.

## CLAUDE.md should include

```md
# {{PROJECT_NAME}}

## Stack
- Rust {{rust-version}}, edition {{edition}}.
- Type: {{lib | bin | both}}

## Commands
- Build:   `cargo build`
- Test:    `cargo test`
- Run:     `cargo run -- {{args if relevant}}`     (binaries only)
- Lint:    `cargo clippy --all-targets -- -D warnings`
- Format:  `cargo fmt`

## Hard rules
- {{Only if README has them}}
```

## settings.json permissions

Same allow/deny as `rust-workspace.md`, drop the `*--workspace` references.

## Path-scoped rules

For a single crate, path-scoped rules rarely earn their keep. Default: skip `rules/` entirely. Generate one only if:
- There's a clearly distinct `tests/` dir with non-obvious conventions.
- There are FFI bindings with safety invariants.

## Code-reviewer subagent

Same as `rust-workspace.md`, simplified — drop "workspace member" language.

## Skills to generate

- `/release` if `Cargo.toml` has `version` AND `CHANGELOG.md` exists.
- Otherwise: skip skills. Add when a real workflow shows up.

## What NOT to generate

- Probably no rules — keep it lean.
- No `output-styles/`, no `commands/`, no `agent-memory/`.
