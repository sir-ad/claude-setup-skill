# Rust

Checked: 2026-10. The project's pinned versions always win over this file.

## Current versions
| Tool | Latest stable | Support notes |
|---|---|---|
| Rust | 1.99.0 (2026-10-01) | Six-week cadence. Only the latest stable is supported. Edition 2024 has been stable since 1.85.0 (2025-02-20). |
| tokio | 1.53.2 | |
| axum | 0.8.9 | Still 0.x. |
| reqwest | 0.13.x | |
| rand | 0.10.3 | |
| sqlx | 0.9.0 | MSRV 1.94. |
| thiserror | 2.0.21 | |
| clap | 4.6.7 | |
| cargo-nextest | 0.9.148 | |
| cargo-deny | 0.20.2 | |
| cargo-audit | 0.22.2 | |

## Version notes
- **edition = "2024"**: it implies `resolver = "3"`, which picks dependency versions compatible with your `rust-version`. In a virtual workspace set `resolver = "3"` explicitly in `[workspace]`. Set `rust-version` in `Cargo.toml`. [source](https://raw.githubusercontent.com/rust-lang/edition-guide/master/src/rust-2024/cargo-resolver.md)
- **edition = "2024"**: `extern` blocks must be written `unsafe extern "C" { ... }`. Write `#[unsafe(no_mangle)]`, `#[unsafe(export_name = "...")]` and `#[unsafe(link_section = "...")]`. The bare forms are errors. [source](https://raw.githubusercontent.com/rust-lang/edition-guide/master/src/rust-2024/unsafe-extern.md)
- **edition = "2024"**: `std::env::set_var` and `remove_var` are `unsafe`. References to `static mut` are denied, and `unsafe_op_in_unsafe_fn` warns by default, so wrap unsafe operations in an inner `unsafe {}` block even inside `unsafe fn`. [source](https://raw.githubusercontent.com/rust-lang/edition-guide/master/src/rust-2024/newly-unsafe-functions.md)
- **edition = "2024"**: `gen` is a reserved keyword; rename any identifier called `gen`. `Future` and `IntoFuture` are in the prelude, so drop explicit imports. [source](https://raw.githubusercontent.com/rust-lang/edition-guide/master/src/rust-2024/prelude.md)
- **edition = "2024" and rustc >= 1.88**: `let` chains work in `if` and `while` (`if let Some(x) = a && x > 0 { }`). Use them instead of nested `if let`. They do not compile in edition 2021. [source](https://raw.githubusercontent.com/rust-lang/edition-guide/master/src/rust-2024/let-chains.md)
- **edition = "2024"**: `Cargo.toml` keys must use dashes: `[dev-dependencies]`, `[build-dependencies]`, `default-features`, `crate-type`, `proc-macro`, and `[package]` (not `[project]`). Underscore spellings are errors. Migrate an older crate with `cargo fix --edition`. [source](https://raw.githubusercontent.com/rust-lang/edition-guide/master/src/rust-2024/cargo-table-key-names.md)
- **edition = "2024"**: `impl Trait` in return position captures all in-scope lifetimes. Narrow it with `+ use<..>` when you do not want that. [source](https://raw.githubusercontent.com/rust-lang/edition-guide/master/src/SUMMARY.md)
- **rustc >= 1.74**: configure lints in a `[lints]` table in `Cargo.toml` instead of repeating `#![deny(...)]` attributes in each crate. [source](https://raw.githubusercontent.com/rust-lang/rust/master/RELEASES.md)
- **rustc >= 1.99**: the legacy integer modules are deprecated. Write `i32::MAX`, not `std::i32::MAX`. [source](https://raw.githubusercontent.com/rust-lang/rust/master/RELEASES.md)
- **axum >= 0.8**: path parameters are `/{id}` and `/{*rest}`. The old `/:id` and `/*rest` forms panic at startup. Handlers and services must be `Sync`. [source](https://raw.githubusercontent.com/tokio-rs/axum/main/axum/CHANGELOG.md)
- **reqwest >= 0.13**: rustls is the default TLS backend and the crypto provider defaults to aws-lc. The `rustls-tls` feature is now named `rustls`. [source](https://raw.githubusercontent.com/seanmonstar/reqwest/master/CHANGELOG.md)
- **rand >= 0.10**: the `Rng` trait is now `RngExt`, `OsRng` is `SysRng`, `SeedableRng::from_os_rng` is removed and `choose_multiple*` is renamed `sample*`. Snippets written for earlier rand versions may not compile. MSRV is 1.85. [source](https://raw.githubusercontent.com/rust-random/rand/master/CHANGELOG.md)
- **sqlx >= 0.9**: MSRV is 1.94 and it supports a per-crate `sqlx.toml`. `Cargo.lock` is no longer tracked in the sqlx repo, so `cargo install --locked sqlx-cli` no longer works; drop `--locked` there. [source](https://raw.githubusercontent.com/launchbadge/sqlx/main/CHANGELOG.md)

## Default toolchain
- Format: `cargo fmt --check` (CI) or `cargo fmt`.
- Lint: `cargo clippy --all-targets -- -D warnings`.
- Test: `cargo test`, or `cargo nextest run` if the project uses cargo-nextest.
- Dependency checks, if configured: `cargo deny check`, `cargo audit`.
- Workspaces: add `--workspace` to the commands above.
