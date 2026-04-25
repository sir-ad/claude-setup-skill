# Example: tetris.codes (Rust workspace, closed-source, RFC-locked)

This is what `/claude-setup` produced for a real Rust workspace project. Useful as a reference for how `templates/rust-workspace.md` translates into actual files.

## Inputs the skill detected

- `Cargo.toml` with `[workspace]` and members `["crates/tetris-core", "crates/tetris-cli", "bench"]`
- `rfc-001-core-contract.md` at root → indicates locked invariants
- README mentions: "openssl banned", "Compressor trait stays sync", "proprietary"
- `CHANGELOG.md` exists → `/release` skill is justified
- `bench/` crate exists → `/bench-compare` skill is justified
- `infra/cloudflare/` and `infra/supabase/` → `rules/infra.md` is justified

## Files generated

```
tetris.codes/
├── CLAUDE.md                          # stack + commands + RFC-001 hard rules
├── .worktreeinclude                   # .env, CLAUDE.md, .mcp.json, settings.local.json
└── .claude/
    ├── settings.json                  # cargo/git/gh allows, force-push deny
    ├── rules/
    │   ├── core-invariants.md         # crates/tetris-core/** — RFC + openssl ban
    │   ├── cli-tokio.md               # crates/tetris-cli/** — async/sync boundary
    │   ├── tests.md                   # **/*test*.rs — determinism, all_registered
    │   └── infra.md                   # infra/** — Cloudflare + Supabase rules
    ├── agents/
    │   └── rust-reviewer.md           # read-only Read/Grep/Glob; RFC + dep hygiene
    └── skills/
        ├── release/SKILL.md           # bump → audit → deny → clippy → test → tag
        ├── bench-compare/SKILL.md     # diff vs baseline; abort on Pass@1 −2%
        └── strategy-add/SKILL.md      # scaffold compressor + wire REGISTRY
```

## What was skipped (and why)

- `.claude/output-styles/` — no use case
- `.claude/commands/` — skills supersede per Anthropic docs
- `.claude/agent-memory/` — populated automatically when subagents run

## Hard rules extracted from README/RFC

The skill scraped these phrases and encoded each in the appropriate file:

| Source phrase | Encoded as |
|---|---|
| "openssl is banned per RFC-001" | `CLAUDE.md` Hard rules + `rules/core-invariants.md` |
| "Compressor trait stays sync per RFC §2.4" | `rules/core-invariants.md` + `rules/cli-tokio.md` |
| "Proprietary / closed-source" | `CLAUDE.md` Hard rules + `agents/rust-reviewer.md` checklist |
| "RFC-001 is locked at v0.0.1" | `rules/core-invariants.md` (with required-reading note) |
| Strategy `all_registered` test guard | `rules/tests.md` + `skills/strategy-add/SKILL.md` |

## What this looks like in practice

After install:

- Open `crates/tetris-core/src/graph.rs` → `core-invariants.md` enters context.
- Open `crates/tetris-cli/src/main.rs` → `cli-tokio.md` enters context, `core-invariants.md` does not.
- Run `/release 0.0.30` → bumps Cargo.toml, runs the audit gauntlet, tags.
- Run `/bench-compare main` → measures regression.
- `@rust-reviewer review the diff` → read-only review hits the encoded checklist.

Total config: 10 files under `.claude/`, ~520 lines. One CLAUDE.md, one .worktreeinclude. No bloat.
