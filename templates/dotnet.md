# Template: .NET project (C#, F#)

Use when the detector reports `primary: "dotnet"`: a `.sln`, `.slnx`, `.csproj` or `.fsproj` at the root or one level down. Covers libraries, ASP.NET Core services, worker services, console apps and test projects.

## Detection signals
- `primary: "dotnet"`, `packageManager: "dotnet"`. `languages` shows `csharp` or `fsharp`.
- `layout: "monorepo"` with `workspaces` for a solution with several projects. A lone project file means `single`.
- `frameworks` is usually empty for .NET. Read project files yourself for the target framework, `Microsoft.NET.Sdk.Web` (web app), test packages (xUnit, NUnit, MSTest, TUnit) and `Microsoft.EntityFrameworkCore`.
- `commands` is empty unless a Makefile or CI supplies it. Derive commands and verify the files exist: `dotnet restore`, `dotnet build`, `dotnet test`, `dotnet format`. If the root holds both a `.sln` and a `.slnx`, or several solutions, pass the file explicitly and ask which one is canonical.
- SDK pin: `global.json`. Target framework: `<TargetFramework>` in project files or `Directory.Build.props`.
- Check by file: `Directory.Packages.props` (central package versions), `.editorconfig` (format rules), `.config/dotnet-tools.json` (local tools such as `dotnet-ef`), `Migrations/` folders (EF Core).

## AGENTS.md
- **Commands**: restore, build, test, format check, run. Use the solution file name in each. Add a single-project test form: `dotnet test <path/to/Tests.csproj>` and a filter form `dotnet test --filter "FullyQualifiedName~<Name>"`. Run command for the startup project: `dotnet run --project <path>`.
- **Repo map**: one line per project with its role (Api, Domain, Infrastructure, Tests). State the reference direction only if a doc gives it. Name the startup project and where configuration lives (`appsettings.json`, environment variants, user secrets).
- **Conventions worth writing**: nullable reference types on or off (read the project files); central package management when `Directory.Packages.props` exists (versions go there, `PackageReference` has no `Version`); async naming and cancellation token passing; DI registration location; test framework and naming; logging abstraction.
- **Version notes**: pull from `knowledge/dotnet.md` for the detected SDK, target framework and C# language version. Solution format, test runner and language feature availability depend on them.
- **Boundaries**: never read or write secrets in `appsettings*.json`; connection strings and keys belong in user secrets or environment variables. If this repo's settings files hold real secrets, tell the user and add a `Read` deny for them. Do not hand-edit `Migrations/*.cs` or `*.Designer.cs`; create migrations with the EF tool. Do not edit `bin/`, `obj/` or `*.g.cs`. Do not change the SDK pin in `global.json` or the target framework without asking.

## CLAUDE.md
`@AGENTS.md` on the first line. Claude-only lines only if the user has them.

## .claude/settings.json
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(dotnet restore *)",
      "Bash(dotnet build *)",
      "Bash(dotnet test *)",
      "Bash(dotnet format *)",
      "Bash(git add *)",
      "Bash(git commit *)"
    ],
    "ask": ["Bash(git push *)", "Bash(dotnet run *)", "Bash(dotnet ef database update*)"],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force *)",
      "Bash(git push -f *)",
      "Bash(git reset --hard *)",
      "Bash(dotnet nuget push *)",
      "Bash(dotnet nuget delete *)",
      "Bash(dotnet ef database drop*)",
      "Bash(dotnet user-secrets *)",
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./**/secrets.json)",
      "Read(./**/*.pfx)",
      "Read(./**/*.pem)"
    ]
  }
}
```
- Add `Bash(dotnet ef migrations add *)` only when `dotnet-ef` is a local or global tool for this repo.
- Libraries that publish to NuGet already have `dotnet nuget push` denied above. Keep it for apps too.
- `appsettings.Development.json` is not denied. It usually holds non-secret local settings. Add a `Read` deny for a specific settings file only when it contains real secrets.
- `Read(./.env.*)` also blocks `.env.example`. When the detector's `env.files` lists an example file, deny the real env files by name instead (for example `Read(./.env.local)`, `Read(./.env.production)`) so the example stays readable.

## Formatter hook (optional)
Only when `.editorconfig` exists and the user says yes. `dotnet format` loads the solution on every run, so it is slow per edit. Prefer the whitespace subcommand. `--include` takes relative paths, so the command strips the working directory. Needs `jq`.
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.cwd as $c | .tool_input.file_path | ltrimstr($c + \"/\") | select(endswith(\".cs\"))' | xargs -r -I{} dotnet format whitespace <solution> --include {}"
          }
        ]
      }
    ]
  }
}
```
Replace `<solution>` with the `.sln`, `.slnx` or project file. Without `jq`: `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s),f=require('path').relative(j.cwd,j.tool_input.file_path||'');if(f.endsWith('.cs'))require('child_process').spawnSync('dotnet',['format','whitespace','<solution>','--include',f])})"`

## Path-scoped rules
Only for directories with real conventions. Mirror rules with `node "${CLAUDE_SKILL_DIR}/scripts/sync-rules.mjs" --targets <tools>` if the user picked other agents.
- `**/Migrations/**` when EF Core migrations are checked in: generated, created with the tool, applied ones are not edited.
- `**/*.Tests/**` or `tests/**` when the test projects have conventions (naming, shared fixtures, integration tests that need a database or container).
- `src/<Project>/Controllers/**` or endpoint folders when the README documents an authorization or response-shape rule.
- `**/appsettings*.json` only to say where secrets go and which keys are required, never their values.

## Reviewer subagent
`.claude/agents/dotnet-reviewer.md`, frontmatter `name: dotnet-reviewer`, `description: Reviews C# changes for async misuse, disposal bugs, EF Core query mistakes and DI lifetime errors. Use after editing .cs files.`, `tools: Read, Grep, Glob`.
1. Async: no `.Result`, `.Wait()` or `GetAwaiter().GetResult()` on request paths; no `async void` outside event handlers; `CancellationToken` is accepted and passed down in public async methods.
2. `IDisposable` and `IAsyncDisposable` are disposed with `using` or `await using`. `HttpClient` comes from `IHttpClientFactory` or a typed client, not `new` per call.
3. EF Core: read-only queries use `AsNoTracking`; `ToList()` is not called before `Where`; loops that query per item; raw SQL uses the interpolated or parameterized APIs, never string concatenation.
4. DI lifetimes: a scoped service is not captured by a singleton. DbContext is scoped.
5. Nullable reference types: `!` suppressions and `#pragma warning disable` need a reason. New public APIs have correct nullability.
6. `throw ex;` loses the stack; use `throw;`. Exceptions are not used for control flow on hot paths.
7. Logging uses message templates with arguments, not string interpolation. No secrets, tokens or personal data in logs.
8. Web APIs: authorization attributes on new endpoints; input validated (`[ApiController]` or the minimal API validation the repo uses); no entity types returned directly.
9. `DateTime.Now` where `UtcNow` or `TimeProvider` is the repo's standard.
10. Tests: new behavior has a test, no skipped tests without a reason, no real network or clock dependence.

## Skills
- `release`: when a `<Version>` property exists in a project file or `Directory.Build.props` and a changelog exists. Bump, update changelog, build, test, tag. Do not include `dotnet nuget push` unless the repo already automates it.
- `db-migrate`: when EF Core `Migrations/` exist and `dotnet-ef` is available. Steps: add the migration, review the generated code and snapshot, apply to a dev database, run tests. Skip when no migrations tool is present.
- Nothing else. `dotnet test` does not need a skill.

## .worktreeinclude
List only entries in `env.gitignored` (`.env`, `.env.local`, `.claude/settings.local.json`, `CLAUDE.local.md`, `.mcp.json`), plus `appsettings.Local.json` or `appsettings.Development.json` when they are gitignored and needed to run. Do not list `bin/` or `obj/`. Skip the file when the list is empty.

## What NOT to generate
- No `Bash(dotnet *)` wildcard. It includes `nuget push` and `user-secrets`.
- No rules that restate `.editorconfig` or analyzer defaults.
- No `output-styles/`, `commands/` or `agent-memory/`.
- No `Bash(*)`, no `defaultMode` of `auto` or `bypassPermissions`.
