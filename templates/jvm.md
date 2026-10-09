# Template: JVM project (Java, Kotlin, Spring Boot)

Use when the detector reports `primary: "jvm"`: a `pom.xml`, `build.gradle(.kts)` or `settings.gradle(.kts)` at the root. Covers Maven and Gradle, Java and Kotlin, plain libraries and Spring Boot services. Android apps use this template for the build tool parts only; add nothing Android-specific without evidence in the repo.

## Detection signals
- `primary: "jvm"`. `languages` shows `java` and/or `kotlin`.
- `packageManager`: `maven` or `gradle`. The detector picks Gradle when both exist and adds a warning; ask which one the team uses.
- `layout: "monorepo"` with `workspaces` for multi-module builds (Maven `<modules>`, Gradle `include`).
- `frameworks` lists `spring-boot` with its version when present.
- `commands` is mostly empty for JVM. Derive commands yourself and verify the files exist. Wrapper first: `./mvnw` if `mvnw` exists, else `mvn`; `./gradlew` if `gradlew` exists, else `gradle`. CI workflow commands in `commands` win over derived ones.
- Java or Kotlin version is not in `languageVersion`. Read it from the build file (`maven.compiler.release`, `java.version`, `jvmToolchain`, `sourceCompatibility`) or `.java-version`, `.sdkmanrc`, `.tool-versions`.

## AGENTS.md
- **Commands**: Maven: `./mvnw verify` (build and test), `./mvnw test`, `./mvnw test -Dtest=<Class>` for one test. Gradle: `./gradlew build`, `./gradlew test`, `./gradlew test --tests <Class>`. Add `spotlessApply` or `spotless:apply`, `checkstyleMain`, `detekt` or `ktlintCheck` only when that plugin appears in the build files. Note integration test profiles or source sets if they exist.
- **Repo map**: modules with a one-line role each. Within a module, name the base package only if the layout is not the usual `src/main/java` and `src/test/java` (or `kotlin`). For Spring, name the main application class and where configuration lives.
- **Conventions worth writing**: injection style used by the code (constructor injection); transaction boundaries (service layer or elsewhere); DTO vs entity separation; null-handling policy (annotations, Kotlin nullability); test split (unit, slice tests, full context, Testcontainers); logging facade.
- **Version notes**: pull from `knowledge/jvm.md` for the detected Java, Kotlin, Spring Boot and build tool versions. Starter names, test annotations and serialization defaults change between major versions, so do not write them from memory.
- **Boundaries**: do not edit applied Flyway or Liquibase migrations; add a new one. Do not edit generated sources (`target/`, `build/`, `generated/`, OpenAPI or protobuf output). Dependency versions come from the BOM, version catalog (`gradle/libs.versions.toml`) or parent POM; change them there. Never read or write `.env*` or files holding credentials.

## CLAUDE.md
`@AGENTS.md` on the first line. Claude-only lines only if the user has them.

## .claude/settings.json
Shown for Maven with a wrapper. For Gradle use `./gradlew test *`, `./gradlew build *`, `./gradlew check *`, and deny `./gradlew publish*`. Without a wrapper, use `mvn` or `gradle`.
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(./mvnw test *)",
      "Bash(./mvnw verify *)",
      "Bash(./mvnw compile *)",
      "Bash(./mvnw package *)",
      "Bash(git add *)",
      "Bash(git commit *)"
    ],
    "ask": ["Bash(git push *)"],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force *)",
      "Bash(git push -f *)",
      "Bash(git reset --hard *)",
      "Bash(./mvnw deploy*)",
      "Bash(./mvnw release*)",
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./**/*.pem)",
      "Read(./**/*.jks)",
      "Read(./**/*.p12)",
      "Read(~/.m2/settings.xml)",
      "Read(~/.gradle/gradle.properties)"
    ]
  }
}
```
- Add `Bash(./mvnw spotless:apply *)` or `Bash(./gradlew spotlessApply *)` when spotless is configured.
- Do not allow `./mvnw *` or `./gradlew *`. They include `deploy`, `publish` and arbitrary tasks.
- Spring Boot dev command (`spring-boot:run`, `bootRun`) starts a long-running server. Leave it to `ask`.
- `Read(./.env.*)` also blocks `.env.example`. When the detector's `env.files` lists an example file, deny the real env files by name instead (for example `Read(./.env.local)`, `Read(./.env.production)`) so the example stays readable.

## Formatter hook (optional)
JVM formatters (spotless, google-java-format via the build) start a build tool and work per project, which is too slow after every edit. Do not generate a hook for them. Offer one only for Kotlin when a `ktlint` binary is on `PATH` and the user says yes. Needs `jq`.
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path | select(endswith(\".kt\") or endswith(\".kts\"))' | xargs -r ktlint -F"
          }
        ]
      }
    ]
  }
}
```
Without `jq`: `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const f=JSON.parse(s).tool_input.file_path||'';if(/\.kts?$/.test(f))require('child_process').spawnSync('ktlint',['-F',f])})"`

## Path-scoped rules
Only for directories with real conventions. Mirror rules with `node "${CLAUDE_SKILL_DIR}/scripts/sync-rules.mjs" --targets <tools>` if the user picked other agents.
- `**/db/migration/**` or `**/db/changelog/**` when Flyway or Liquibase is in the build file: naming scheme, never edit an applied file.
- `src/test/**` when the repo separates unit and integration tests by naming (`*IT`, `*IntegrationTest`) or source set, or requires Testcontainers.
- A module directory that has its own architecture rule in the README or an ADR (for example the domain module has no Spring imports).
- `src/main/resources/**` only when profiles or config properties have documented rules.

## Reviewer subagent
These are candidate checks, not defaults. Keep a line only when a repo fact backs it (lint or type config, a documented rule, a hard rule, a detected version), and grep the repo first: if the code already uses a pattern on purpose, drop the line or scope it with the exception.

`.claude/agents/jvm-reviewer.md`, frontmatter `name: jvm-reviewer`, `description: Reviews Java and Kotlin changes for null handling, transaction and persistence mistakes, resource leaks and Spring wiring errors. Use after editing .java or .kt files.`, `tools: Read, Grep, Glob`.
1. Resources (streams, connections, executors) are closed with try-with-resources or `use {}`.
2. `Optional.get()` without a check, `!!` in Kotlin, `lateinit` read before assignment.
3. Spring wiring: constructor injection, no field `@Autowired` in new code. Singleton beans hold no mutable shared state.
4. `@Transactional` on private methods or called from within the same class does nothing. Transaction boundaries sit on the service layer, not the controller.
5. JPA: entities returned from controllers, lazy collections touched outside a transaction, loops that trigger one query per item, `equals` and `hashCode` built on generated ids.
6. Query strings built by concatenation. Request bodies bound without validation (`@Valid`, constraint annotations).
7. `catch (Exception)` or `catch (Throwable)` that swallows the error. Missing cause when rethrowing.
8. Blocking calls inside reactive chains or coroutines; `GlobalScope` use.
9. Secrets or personal data in log statements or in `application*.yml` committed to the repo.
10. Tests: new behavior has a test at the right level, no `@Disabled` without a reason, no `Thread.sleep` for synchronization.

## Skills
- `release`: when the build file has a version and a changelog exists. Read the release plugin config (`maven-release-plugin`, Gradle release plugin, CI workflow) and encode the real steps. Never include `deploy` or `publish` unless the repo already automates it.
- `db-migrate`: when Flyway or Liquibase is configured and adding a migration takes more than one step (create file with the next version, run it against a dev database, run tests). Skip for a bare folder of SQL files with no tool.
- Nothing else. `./mvnw verify` does not need a skill.

## .worktreeinclude
List only entries in `env.gitignored` (`.env`, `.env.local`, `.claude/settings.local.json`, `CLAUDE.local.md`, `.mcp.json`), plus local config files that are gitignored and needed to run: `application-local.yml` or `.properties`, `local.properties`. Do not list `target/`, `build/` or `.gradle/`. Skip the file when the list is empty.

## What NOT to generate
- No `Bash(./mvnw *)` or `Bash(./gradlew *)` wildcards.
- No rules that restate language or Spring defaults.
- No `output-styles/`, `commands/` or `agent-memory/`.
- No Android, Kotlin Multiplatform or Compose guidance without evidence in the repo.
- No `Bash(*)`, no `defaultMode` of `auto` or `bypassPermissions`.
