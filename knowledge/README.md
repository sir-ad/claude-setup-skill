# Knowledge notes

These files hold short, dated, cited notes about current practice in each ecosystem: which version is current, what changed, and which old habits to drop. They exist because a model's training data lags behind releases.

## How the skill uses them

1. Detect the stack and the exact versions the project pins (lockfiles, manifests, toolchain files).
2. Open the matching ecosystem file. Read the `Version notes` bullets.
3. Keep only bullets whose version gate matches what the project uses. Never apply a note for a version the project does not use. A note for `Django >= 6.1` does not apply to a Django 5.2 project.
4. Copy at most about 10 relevant bullets into the project's `AGENTS.md` under "Version notes". Rephrase each for the project, keep the version gate, and drop the source link if it adds noise.
5. Treat the `Default toolchain` section as a fallback. Commands found in the project always win.

The project's pinned versions always win over these files.

## Files

- `node.md`: Node.js, package managers, TypeScript, test runners
- `frontend.md`: frameworks, bundlers, CSS tooling
- `python.md`: Python, uv, Ruff, pytest, Pydantic, FastAPI, Django, SQLAlchemy
- `rust.md`: Rust editions, Cargo, common crates
- `go.md`: Go releases, modules, golangci-lint
- `jvm.md`: Java, Kotlin, Spring Boot, Gradle, Maven
- `ruby.md`: Ruby and Rails
- `dotnet.md`: .NET, C#, ASP.NET Core
- `php.md`: PHP, Laravel, Symfony, test and analysis tools
- `mobile.md`: Swift, Android Gradle Plugin, Flutter and Dart
- `infra.md`: Terraform, OpenTofu, Docker Compose

## Updating them

- Re-check every bullet against its source link. Prefer the project's own docs, changelog or release notes.
- Bump the `Checked:` date in each file you re-verified.
- Keep a source link on every bullet. Remove a bullet instead of keeping one you cannot verify.
- Do not add trivia or release highlights. A note belongs here only if it changes how code is written, how a tool is configured, or which command runs.
- Keep each file under 150 lines and keep the same three sections (Current versions, Version notes, Default toolchain) in every file.
