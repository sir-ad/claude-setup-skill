# Template: Python project

Use when `pyproject.toml`, `setup.py`, `setup.cfg`, `Pipfile` or `requirements.txt` exists and Python is the primary language. Covers apps, libraries, Django, FastAPI, Flask and scripts. Workspaces (uv, poetry path deps) are handled as one project with a longer repo map.

## Detection signals
- `primary: "python"`. `languageVersion.python` holds the `requires-python` range.
- `packageManager`: `uv`, `poetry`, `pdm` or `pip`. The detector already prefixes commands (`uv run pytest`, `poetry run ruff check .`). Use them as given.
- `frameworks`: `django`, `fastapi`, `flask`, `pydantic`, `sqlalchemy` set the project type. `pytest`, `ruff`, `mypy` set the tool commands.
- `commands.dev` often holds a `poe` task or a `project.scripts` entry. Prefer those over inventing a run command.
- `versionFiles` contains `pyproject.toml` when the project has a version (a library or a released app).

## AGENTS.md
- **Commands**: setup (`uv sync`, `poetry install`, `pip install -r requirements.txt`), test, lint, format, typecheck, dev, from the detector. If tests need services (database, Redis), say how to start them only if a compose file or README says so.
- **Repo map**: package directory (`src/<name>/` or `<name>/`), `tests/`, `migrations/` or `alembic/`, `scripts/`, `notebooks/` if present. For Django list the apps. For FastAPI name the router and settings modules.
- **Conventions worth writing**: layout (src layout or flat); how settings are loaded (env, pydantic settings, Django settings module); test layout and fixtures in `conftest.py`; async or sync style when the code base is consistent; type checking strictness only if configured (`strict = true`).
- **Version notes**: pull from `knowledge/python.md` for the detected Python, framework, ruff and package manager versions. Do not state them from memory.
- **Boundaries**: lockfile (`uv.lock`, `poetry.lock`, `pdm.lock`) changes through the tool only. Applied migrations are never edited; add a new one. Do not edit generated files (protobuf output, OpenAPI clients). Never read or write `.env*`, and never print settings that hold secrets.

## CLAUDE.md
`@AGENTS.md` on the first line. Claude-only lines only if the user has them.

## .claude/settings.json
Allow the exact tools in the detector output, run through the project's environment manager. Shown for uv. For poetry replace `uv run` with `poetry run` and `uv sync` with `poetry install`. For plain pip drop the prefix and use `python -m pytest *` if that is how tests run.
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(uv sync *)",
      "Bash(uv run pytest *)",
      "Bash(uv run ruff *)",
      "Bash(uv run mypy *)",
      "Bash(git add *)",
      "Bash(git commit *)"
    ],
    "ask": ["Bash(git push *)"],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force *)",
      "Bash(git push -f *)",
      "Bash(git reset --hard *)",
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./**/*.pem)"
    ]
  }
}
```
- Add only the tools that appear in `frameworks` (no `mypy` entry unless mypy is detected). Add `Bash(uv run python manage.py test *)` for Django.
- For libraries add `Bash(twine upload *)`, `Bash(uv publish *)` and `Bash(poetry publish *)` to deny.
- Do not allow `python *` or `uv run *`. They run arbitrary code.
- `Read(./.env.*)` also blocks `.env.example`. When the detector's `env.files` lists an example file, deny the real env files by name instead (for example `Read(./.env.local)`, `Read(./.env.production)`) so the example stays readable.

## Formatter hook (optional)
Only when `ruff` is detected and the user says yes. Needs `jq`.
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path | select(endswith(\".py\"))' | xargs -r uv run ruff format"
          }
        ]
      }
    ]
  }
}
```
Use `poetry run ruff format` or plain `ruff format` to match the package manager. If Black is the configured formatter, use `black`. Without `jq`: `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const f=JSON.parse(s).tool_input.file_path||'';if(f.endsWith('.py'))require('child_process').spawnSync('uv',['run','ruff','format',f])})"`

## Path-scoped rules
Only where the project has conventions it documents. Python repos usually follow community defaults, so write none rather than noise. Mirror rules with `node "${CLAUDE_SKILL_DIR}/scripts/sync-rules.mjs" --targets <tools>` if the user picked other agents.
- Django, `**/migrations/**`: never edit applied migrations, create with `makemigrations`, name them. Add when more than a handful of migrations exist.
- Django, `**/models.py` or `**/views.py`: only when README or docs state a rule (permission checks, soft delete, query helpers).
- FastAPI, router and schema directories: request and response models live in one place, handlers do not return ORM objects. Only if the code base already does this.
- SQLAlchemy with Alembic, `alembic/versions/**`: same migration discipline as Django.
- `tests/**/*.py`: fixture and factory conventions, markers that gate slow tests.

## Reviewer subagent
These are candidate checks, not defaults. Keep a line only when a repo fact backs it (lint or type config, a documented rule, a hard rule, a detected version), and grep the repo first: if the code already uses a pattern on purpose, drop the line or scope it with the exception.

`.claude/agents/python-reviewer.md`, frontmatter `name: python-reviewer`, `description: Reviews Python changes for typing gaps, async mistakes, error handling and unsafe data access. Use after editing .py files.`, `tools: Read, Grep, Glob`.
1. Public functions have parameter and return annotations when the project is typed. No new `Any` without a reason.
2. Bare `except:` and silent `except Exception: pass` are flagged only when the lint config enables a rule for them (ruff `E722` or `BLE001`).
3. Async code: no blocking calls (`requests`, `time.sleep`, sync DB drivers) inside `async def`. No `asyncio.run()` inside a running loop.
4. Mutable default arguments, when ruff's `B006` is enabled. Module-level state that makes tests order dependent.
5. SQL built with f-strings or `%` formatting. Raw queries must be parameterized.
6. `eval`, `exec`, `pickle.loads` or `yaml.load` (without a safe loader) on external input.
7. Django: queryset loops that touch relations without `select_related` or `prefetch_related`; migrations edited after being applied; `DEBUG` or secret key read from source.
8. FastAPI and Pydantic: handlers return validated models, not raw dicts from the DB; settings read from env, not constants.
9. Tests: no `assert True` filler.

## Skills
- `release`: when `versionFiles` has `pyproject.toml` with a version and a changelog. Bump version, update changelog, build, tag. Use `uv build` or `poetry build` to match the tool. Never include a publish step unless the repo already automates it.
- `db-migrate`: when Django or Alembic is present. Steps: create migration, review the generated file, apply to a dev database, run tests. Skip when migrating is one command with nothing to review.
- `test-fast`: only when pytest markers such as `slow` or `integration` are defined in `pyproject.toml`.

## .worktreeinclude
List only entries in `env.gitignored` (`.env`, `.env.local`, `.claude/settings.local.json`, `CLAUDE.local.md`, `.mcp.json`). Do not add `.venv`; each worktree creates its own through the package manager. Skip the file when the list is empty.

## What NOT to generate
- No rules that restate PEP 8 or ruff defaults.
- No `output-styles/`, `commands/` or `agent-memory/`.
- No notebook or ML rules unless `notebooks/` exists and the README states reproducibility requirements.
- No `Bash(*)`, no `defaultMode` of `auto` or `bypassPermissions`.
