# Template: Rust workspace

Use when the root `Cargo.toml` has a `[workspace]` table with members, or the detector reports `primary: "rust"` with `layout: "monorepo"`. A repo with a single `[package]` and no workspace uses `rust-single.md`.

## Detection signals
- `primary: "rust"`, `layout: "monorepo"`, `packageManager: "cargo"`. `workspaces` lists member crate paths.
- `languageVersion.rust` holds `edition`, `rustVersion` (MSRV) and `toolchain` from `rust-toolchain.toml`.
- `frameworks` may list `tokio`, `axum`, `actix-web`, `serde`. Per-member use is in `where` and `alsoIn`; use it to say which crates are async.
- `commands` already carries `--workspace` forms: build, test, clippy, fmt, check. Copy them. If CI runs clippy with `-D warnings` or extra feature flags, use the CI form and say so.
- `versionFiles` lists member `Cargo.toml` files with versions, plus a changelog if present.
- Look for `deny.toml`, `.config/nextest.toml`, `rustfmt.toml`, `clippy.toml`, `benches/` and `fuzz/` yourself. The detector does not report them.

## AGENTS.md
- **Commands**: the detector's workspace commands, plus a single-crate form (`cargo test -p <crate>`) because workspace-wide runs are slow. Add `cargo nextest run` only if nextest config or CI uses it. Add `cargo deny check` or `cargo audit` only if their config exists.
- **Repo map**: one line per member crate with its role, taken from its `description` or README. Mark which crates are libraries and which are binaries. State the dependency direction if a doc gives one. Name RFC or ADR files and quote any that are marked locked.
- **Conventions worth writing**: which crates are sync-only and which use the async runtime (from `frameworks[].where`); error handling style per crate kind (`thiserror` in libraries, `anyhow` in binaries, but only when the code does this); dependencies declared once in `[workspace.dependencies]` and inherited with `workspace = true`; feature flag policy; where `unsafe` is allowed.
- **Version notes**: pull from `knowledge/rust.md` for the detected edition, `rust-version` and key crates (tokio, axum, serde and others in `frameworks`). Do not state edition rules or crate APIs from memory.
- **Boundaries**: `Cargo.lock` changes through cargo only. Do not edit `target/`. Do not raise `rust-version` or change the edition without asking. Snapshot files (`*.snap`) are reviewed, not hand-edited. Ask before adding a dependency to a crate that is meant to stay small. Never read or write `.env*`.

## CLAUDE.md
`@AGENTS.md` on the first line. Claude-only lines only if the user has them.

## .claude/settings.json
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(cargo build *)",
      "Bash(cargo test *)",
      "Bash(cargo check *)",
      "Bash(cargo clippy *)",
      "Bash(cargo fmt *)",
      "Bash(cargo doc *)",
      "Bash(cargo tree *)",
      "Bash(git add *)",
      "Bash(git commit *)"
    ],
    "ask": ["Bash(git push *)", "Bash(cargo add *)", "Bash(cargo install *)"],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force *)",
      "Bash(git push -f *)",
      "Bash(git reset --hard *)",
      "Bash(cargo publish *)",
      "Bash(cargo yank *)",
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./**/*.pem)"
    ]
  }
}
```
- Add `Bash(cargo run *)` when `commands.dev` or the README runs a binary through cargo.
- Add `Bash(cargo nextest *)`, `Bash(cargo deny *)` or `Bash(cargo audit)` only when their config or CI use exists.
- `Read(./.env.*)` also blocks `.env.example`. When the detector's `env.files` lists an example file, deny the real env files by name instead (for example `Read(./.env.local)`, `Read(./.env.production)`) so the example stays readable.

## Formatter hook (optional)
Only when the user says yes. `rustfmt` ships with the toolchain. `rustfmt` run on a file defaults to an old edition, so pass the detected edition. Needs `jq`.
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path | select(endswith(\".rs\"))' | xargs -r rustfmt --edition <edition>"
          }
        ]
      }
    ]
  }
}
```
Fill `<edition>` from `languageVersion.rust.edition`. Without `jq`, use the command `cargo fmt --all`. It reads no stdin, formats the whole workspace on each edit and takes the edition from `Cargo.toml`.

## Path-scoped rules
Generate one only when the member has conventions that the AGENTS.md summary would not carry. Mirror rules with `node "${CLAUDE_SKILL_DIR}/scripts/sync-rules.mjs" --targets <tools>` if the user picked other agents.
- Core library crate, `crates/<name>/src/**/*.rs`: when a README, RFC or ADR sets invariants (sync only, banned dependencies, locked types). Quote the source in the rule.
- Binary or service crate that uses the async runtime while core crates do not.
- `**/tests/**/*.rs` and snapshot directories: only when there is a snapshot workflow or deterministic-seed requirement.
- `benches/**`: when benchmarks must stay deterministic or compare against a baseline.
- Any crate containing `unsafe` or FFI: safety comment and test requirements.

## Reviewer subagent
These are candidate checks, not defaults. Keep a line only when a repo fact backs it (lint or type config, a documented rule, a hard rule, a detected version), and grep the repo first: if the code already uses a pattern on purpose, drop the line or scope it with the exception.

`.claude/agents/rust-reviewer.md`, frontmatter `name: rust-reviewer`, `description: Reviews Rust changes for panics in library code, unsafe without justification, async mistakes and API breaks. Use after editing .rs files.`, `tools: Read, Grep, Glob`.
1. No `unwrap()` or `expect()` in library code paths or request handlers. Tests and clearly infallible cases are fine with a message.
2. Every `unsafe` block has a `// SAFETY:` comment that states the invariant. New `unsafe` in a crate that had none is a finding.
3. Async: no blocking calls (`std::fs`, `std::thread::sleep`, heavy CPU work) on the runtime. No `std::sync::Mutex` guard held across `.await`.
4. Sync-only crates do not gain `async fn` or a runtime dependency.
5. Dependencies are added to `[workspace.dependencies]` and inherited. A new dependency in a core crate is flagged.
6. Errors: library crates return typed errors. Errors keep their source (`#[from]`, `#[source]`). No `String` errors in public APIs.
7. Public items in library crates: new or changed signatures are flagged as semver-relevant. Feature flags stay additive.
8. Lossy `as` casts, and `SystemTime::now()` or unseeded randomness in code that must be deterministic.
9. Tests: no `#[ignore]` without a reason, new behavior has a test, snapshots were reviewed.

## Skills
- `release`: when a member or `[workspace.package]` has a version and a changelog exists. Steps: bump version(s), update changelog, run build, test, clippy and deny or audit if configured, tag. Read `scripts/release.*` or CI release workflow first and match it. Do not add a `cargo publish` step unless the repo already automates it.
- `bench-compare`: when a `benches/` directory or a bench crate exists and the README describes a baseline comparison.
- Skip project-shaped scaffolds (adding a strategy, a plugin). They are too specific to template.

## .worktreeinclude
List only entries in `env.gitignored` (`.env`, `.env.local`, `.claude/settings.local.json`, `CLAUDE.local.md`, `.mcp.json`). Do not list `target/`; it is large and rebuilds. Skip the file when the list is empty.

## What NOT to generate
- No rules that restate rustfmt or clippy defaults.
- No `output-styles/`, `commands/` or `agent-memory/`.
- No `cargo audit` or `cargo deny` commands without their config.
- No `Bash(*)`, no `defaultMode` of `auto` or `bypassPermissions`.
