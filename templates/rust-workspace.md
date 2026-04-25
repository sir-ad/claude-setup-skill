# Template: Rust workspace (Cargo `[workspace]`)

Reference for `/claude-setup` when the project has a Cargo workspace with multiple members. Use this to decide what to generate; phrase output in terms of the actual project.

## Detection signals
- `Cargo.toml` has `[workspace]` block with `members = [...]`.
- Multiple crates under `crates/` or as listed in `members`.
- Often: `[workspace.package]`, `[workspace.dependencies]`.

## CLAUDE.md should include

```md
# {{PROJECT_NAME}}

## Stack
- Rust {{rust-version from Cargo.toml or rust-toolchain.toml}}, edition {{edition}}.
- Workspace members: {{list each crate with one-line role}}
- Async runtime: {{detect tokio/async-std presence per crate, or "sync only"}}

## Commands
- Build:   `cargo build --workspace`
- Test:    `cargo test --workspace`
- Lint:    `cargo clippy --workspace --all-targets -- -D warnings`
- Format:  `cargo fmt --all`
- {{include cargo audit / cargo deny ONLY if those configs exist}}

## Repo map
- {{list each member crate with one-line role}}
- {{any RFC/PRD/ADR files at root, mark as LOCKED if README says so}}

## Hard rules
- {{ONLY if README/RFCs say so. e.g. "Crate X stays sync per RFC §N", "Banned dep: openssl"}}
- {{Don't invent. If README has none, omit the section.}}
```

## settings.json permissions

```json
{
  "permissions": {
    "allow": [
      "Bash(cargo build *)",
      "Bash(cargo test *)",
      "Bash(cargo clippy *)",
      "Bash(cargo fmt *)",
      "Bash(cargo check *)",
      "Bash(cargo run *)",
      "Bash(cargo tree *)",
      "Bash(git status)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(git add *)",
      "Bash(git commit *)",
      "Bash(gh run view *)",
      "Bash(gh pr view *)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force *)",
      "Bash(git push -f *)",
      "Bash(git reset --hard *)",
      "Bash(git clean -fd*)"
    ]
  }
}
```

Add `cargo audit *` and `cargo deny *` only if `Cargo.toml` or `deny.toml` exists at root.

Add `cargo publish *` to **deny** for proprietary projects (check LICENSE).

## Path-scoped rules to consider

Generate one rule per workspace member ONLY if that member has distinct conventions:

- **Core/library crate** (`crates/<name>-core/`): if README or RFC mentions sync-only, locked types, banned deps → `rules/core-invariants.md` scoped to `crates/<name>-core/src/**/*.rs`.
- **CLI crate** (`crates/<name>-cli/`): if it uses tokio while the core stays sync → `rules/cli-async.md` scoped to `crates/<name>-cli/**`.
- **Bench crate** (`bench/` or `crates/bench/`): if there's a fixture-deterministic requirement → `rules/bench.md` scoped to `bench/**`.
- **Tests**: only if there are non-obvious test conventions (e.g. snapshot review with insta, deterministic seeds) → `rules/tests.md` scoped to `**/*test*.rs`.

Don't generate a rule if the convention is already obvious from CLAUDE.md.

## Code-reviewer subagent (`agents/rust-reviewer.md`)

Tools: `Read, Grep, Glob`.

Body checklist (encode the project's actual policies; this is a starting point):

1. Workspace dependency hygiene — pinned versions stay pinned, no new transitive deps that violate the project's TLS/crypto/runtime policies.
2. Async/sync boundary — if some crates are sync-only, flag any `async fn` or tokio import sneaking in.
3. Error handling — `thiserror` in libraries, `anyhow` in binaries (or whatever the project does — read existing code).
4. Determinism — flag `SystemTime::now()`, unseeded RNGs in compute paths.
5. Tests — flag `#[ignore]` without justification, missing snapshot review.
6. Clippy — mentally run `-D warnings`, flag obvious lints.

Encode RFC/ADR sections by quoted reference if the project has them.

## Skills to generate

- **`/release`** — if `Cargo.toml` has `[workspace.package].version` AND a `CHANGELOG.md` exists. Bumps version, runs audit/deny/clippy/test, tags. Reflects what the project actually does (read `scripts/release.sh` if present).
- **`/bench-compare`** — if there's a `bench/` crate with a measurable output. Runs bench, diffs vs baseline ref.
- Skip `/strategy-add` and similar project-specific scaffolds — those are too project-shaped to template.

## .worktreeinclude

```
.env
.env.local
{{if CLAUDE.md or .mcp.json gitignored, include them}}
{{if .claude/settings.local.json gitignored, include it}}
```

## What NOT to generate

- No `output-styles/` (no use case).
- No `commands/` (skills supersede per Anthropic docs).
- No `agent-memory/` (auto-populated when subagents with `memory:` frontmatter run).
- No empty folders.
