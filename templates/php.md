# Template: PHP project (Composer, Laravel, Symfony)

Use when the detector reports `primary: "php"`: a `composer.json` at the root. Covers Laravel and Symfony apps, other frameworks, and Composer libraries.

## Detection signals
- `primary: "php"`, `packageManager: "composer"`.
- `frameworks` lists `laravel` or `symfony` with the constraint from `composer.json`. No entry means a plain library or a different framework.
- `commands` holds `composer run <script>` entries for every script in `composer.json` (test, lint, analyse, dev and so on). Copy them. They often wrap the real tools and flags.
- Tools are not listed by the detector. Read `require-dev` and check `vendor/bin` names: `pest` or `phpunit` (tests), `phpstan` or Larastan (static analysis), `pint` or `php-cs-fixer` (format), `rector`.
- PHP version: `require.php` in `composer.json` or `config.platform.php`.
- Check by file: `artisan` (Laravel), `bin/console` (Symfony), `phpunit.xml(.dist)`, `phpstan.neon(.dist)`, `pint.json`, `.php-cs-fixer.php`, `auth.json`.
- `type: "library"` in `composer.json` means a package. Packages ship by git tag on Packagist; there is no publish command.

## AGENTS.md
- **Commands**: install (`composer install`), test (Pest, PHPUnit, or `php artisan test`), a single file or filter (`vendor/bin/pest --filter <name>`, `vendor/bin/phpunit --filter <name>`), static analysis (`vendor/bin/phpstan analyse`), format check (`vendor/bin/pint --test`), dev server (`composer run dev` or `php artisan serve` or `symfony server:start` if the repo uses it). Prefer the detector's `composer run` scripts when they exist.
- **Repo map**: for Laravel, only the unusual parts (`app/Actions`, `app/Services`, `modules/`, packages in `packages/`). For Symfony, `src/` layers and `config/packages` entries that matter. For a library: `src/`, `tests/`, and the public namespace.
- **Conventions worth writing**: where logic lives (controllers, actions, services); validation via form requests; authorization via policies; Pest function style vs PHPUnit classes; `declare(strict_types=1)` policy; static analysis level from `phpstan.neon`; code style preset from `pint.json`.
- **Version notes**: pull from `knowledge/php.md` for the detected PHP, framework and test tool versions. Required PHP versions, skeleton layout and tool majors change over time, so do not write them from memory.
- **Boundaries**: `composer.lock` changes through Composer only. Do not edit `vendor/`. Applied migrations are not edited; add a new one. Never read or write `.env*`, `auth.json` or framework key files. Do not run `migrate:fresh`, `db:wipe` or any command that drops data. Call `env()` only in config files (Laravel).

## CLAUDE.md
`@AGENTS.md` on the first line. Claude-only lines only if the user has them.

## .claude/settings.json
Shown for Laravel with Pest and PHPStan. Keep only the lines whose tools exist. For Symfony replace the artisan lines with `Bash(bin/console make*)` and `Bash(bin/phpunit *)`.
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(composer install)",
      "Bash(composer run test*)",
      "Bash(vendor/bin/pest *)",
      "Bash(vendor/bin/phpstan *)",
      "Bash(vendor/bin/pint *)",
      "Bash(php artisan test *)",
      "Bash(php artisan make*)",
      "Bash(git add *)",
      "Bash(git commit *)"
    ],
    "ask": [
      "Bash(git push *)",
      "Bash(php artisan migrate)",
      "Bash(php artisan migrate:rollback*)",
      "Bash(php artisan tinker*)",
      "Bash(composer require *)",
      "Bash(composer update *)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force *)",
      "Bash(git push -f *)",
      "Bash(git reset --hard *)",
      "Bash(php artisan migrate:fresh*)",
      "Bash(php artisan migrate:reset*)",
      "Bash(php artisan db:wipe*)",
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./auth.json)",
      "Read(./storage/*.key)",
      "Read(./config/secrets/*/*.decrypt.private.php)",
      "Read(./**/*.pem)",
      "Read(~/.config/composer/auth.json)",
      "Read(~/.composer/auth.json)"
    ]
  }
}
```
- Drop the lines for tools that are not installed. Add `Bash(vendor/bin/phpunit *)` for PHPUnit, `Bash(vendor/bin/php-cs-fixer *)` for php-cs-fixer, `Bash(vendor/bin/rector *)` for Rector.
- Never allow `composer run *` or `php artisan *`. Scripts and artisan commands can deploy, wipe or send mail.
- The Symfony secrets key line is harmless in a Laravel repo; drop it there. The `storage/*.key` line targets Laravel Passport keys; drop it if Passport is absent.
- `Read(./.env.*)` also blocks `.env.example`. When the detector's `env.files` lists an example file, deny the real env files by name instead (for example `Read(./.env.local)`, `Read(./.env.production)`) so the example stays readable.

## Formatter hook (optional)
Only when `laravel/pint` or `friendsofphp/php-cs-fixer` is in `require-dev` and the user says yes. Needs `jq`.
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path | select(endswith(\".php\"))' | xargs -r vendor/bin/pint"
          }
        ]
      }
    ]
  }
}
```
For php-cs-fixer use `vendor/bin/php-cs-fixer fix`. Without `jq`: `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const f=JSON.parse(s).tool_input.file_path||'';if(f.endsWith('.php'))require('child_process').spawnSync('vendor/bin/pint',[f])})"`

## Path-scoped rules
Only for directories with real conventions. Mirror rules with `node "${CLAUDE_SKILL_DIR}/scripts/sync-rules.mjs" --targets <tools>` if the user picked other agents.
- `database/migrations/**` (Laravel) or `migrations/**` (Doctrine): new migration for every schema change, never edit a merged one, write `down()` when the repo does.
- `tests/**`: Pest vs PHPUnit style, shared test case or trait, database refresh strategy. Add when the repo mixes styles or has a custom base test case.
- `app/Http/**` or `src/Controller/**`: only when the README documents a validation and authorization pattern (form requests, policies, voters).
- `app/Models/**` or `src/Entity/**`: only when there is a documented rule such as mass assignment policy or soft deletes.
- `routes/**`: only when routes are split by file with naming or middleware rules.

## Reviewer subagent
`.claude/agents/php-reviewer.md`, frontmatter `name: php-reviewer`, `description: Reviews PHP changes for injection risks, mass assignment, N+1 queries, missing authorization and loose typing. Use after editing .php files.`, `tools: Read, Grep, Glob`.
1. SQL built by concatenation or interpolation, including `DB::raw`, `whereRaw`, `orderByRaw` and Doctrine DQL strings. Use bindings.
2. Mass assignment: `$guarded = []`, `Model::unguard()`, or `create($request->all())`. Use validated data.
3. N+1: relations accessed in loops without `with()` or a join. Doctrine `flush()` inside loops.
4. Validation: new endpoints validate input through a form request or constraints, not ad hoc `$request->input` use.
5. Authorization: new routes and actions have a policy, gate, voter or middleware check.
6. Blade `{!! !!}` or raw output of user input. `unserialize` on external data. Shell calls built from input.
7. `env()` called outside config files (Laravel); config cache then returns null.
8. Typing: `declare(strict_types=1)` where the repo uses it, parameter and return types on new methods, `===` over `==`, no `@` error suppression.
9. Queued jobs hold ids or serializable data, are idempotent, and set tries or backoff when the repo does.
10. Left-over `dd()`, `dump()`, `var_dump()`, `ray()`. Tests: new behavior has a test, no skipped tests without a reason.

## Skills
- `release`: for a library, when a changelog exists. Steps: update the changelog, run tests and static analysis, tag. If `composer.json` has a `version` field, bump it; otherwise the tag is the version. Never include a push of tags unless the user confirms.
- `db-migrate`: Laravel or Symfony with Doctrine, when the flow takes more than one step (generate, review the file, run on a dev database, run tests). Skip when migrations are not in the repo.
- Nothing else. `composer run test` does not need a skill.

## .worktreeinclude
List only entries in `env.gitignored` (`.env`, `.env.local`, `.claude/settings.local.json`, `CLAUDE.local.md`, `.mcp.json`). Add `database/database.sqlite` when the app uses SQLite for local development and the file is gitignored. List `auth.json` only if the user agrees in the plan step, because it holds credentials. Do not list `vendor/` or `node_modules/`. Skip the file when the list is empty.

## What NOT to generate
- No `Bash(composer run *)` or `Bash(php artisan *)` wildcards.
- No rules that restate PSR-12 or Pint presets.
- No `output-styles/`, `commands/` or `agent-memory/`.
- No `Bash(*)`, no `defaultMode` of `auto` or `bypassPermissions`.
