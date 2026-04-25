# Template: Python project

Reference for `/claude-setup` when `pyproject.toml`, `setup.py`, or `requirements.txt` exists.

## Detection signals & package manager
- `pyproject.toml` with `[tool.poetry]` → Poetry
- `pyproject.toml` with `[tool.uv]` or `uv.lock` → uv
- `pyproject.toml` with `[tool.hatch]` → hatch
- `pyproject.toml` with `[tool.rye]` → rye
- `pyproject.toml` with `[build-system].requires = ["setuptools..."]` → setuptools
- Plain `requirements.txt` (no pyproject) → pip + venv

Use the detected manager in commands. Show `uv run`, `poetry run`, `python -m`, etc.

## Detect framework / project type
- `django` in deps → Django (App Router-shaped: `apps/`, `manage.py`)
- `flask`/`fastapi`/`starlette` in deps → API framework
- `pytest` config → test command uses pytest
- `mypy` / `pyright` / `ruff` config → typing/lint tooling
- `mlflow`/`wandb`/`pytorch`/`jax`/`tensorflow` → ML project (different conventions)

## CLAUDE.md should include

```md
# {{PROJECT_NAME}}

## Stack
- Python {{from .python-version / pyproject requires-python}}
- Package manager: {{detected}}
- Framework: {{Django | FastAPI | Flask | ML | library | ...}}
- Type checker: {{mypy | pyright | none}}
- Linter: {{ruff | flake8 | pylint | none}}

## Commands
- Install:    `{{pm}} install` or `pip install -r requirements.txt`
- Run:        `{{pm}} run <entry>` or `python -m {{module}}`
- Test:       `pytest` (or `{{pm}} run pytest`)
- Lint:       `ruff check .` (or whatever's configured)
- Format:     `ruff format .` or `black .`
- Typecheck:  `mypy .` or `pyright`

## Repo map
- {{list significant dirs: src/, app/, tests/, migrations/, etc.}}

## Hard rules
- {{From README/ADRs only}}
```

## settings.json permissions

```json
{
  "permissions": {
    "allow": [
      "Bash(python *)",
      "Bash(python3 *)",
      "Bash(pip *)",
      "Bash({{pm}} *)",
      "Bash(pytest *)",
      "Bash(ruff *)",
      "Bash(mypy *)",
      "Bash(black *)",
      "Bash(pyright)",
      "Bash(git status)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(git add *)",
      "Bash(git commit *)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force *)",
      "Bash(git reset --hard *)",
      "Bash(pip install -e *)"
    ]
  }
}
```

Drop `pm` allow if pip-only. Add `Bash(twine upload *)` to **deny** for libraries.

## Path-scoped rules

- Django: `apps/**/models.py` — migration discipline rule (always `makemigrations` not raw SQL); `apps/**/views.py` — auth/permission decorator rule.
- FastAPI/Flask: `app/api/**/*.py` — pydantic schema validation rule, response shape rule.
- ML: `notebooks/**/*.ipynb` — reproducibility rule (seed everything, log to wandb/mlflow).
- Tests: `tests/**/*.py` — fixture conventions, factory patterns.

Generate only the rules that have real signal in this project.

## Code-reviewer subagent (`agents/python-reviewer.md`)

Tools: `Read, Grep, Glob`.

Checklist:
1. Type hints — public functions typed, no missing return types, no implicit `Any`.
2. Async — `await` consistency, no `asyncio.run()` inside coroutines, no blocking I/O in async paths.
3. Error handling — bare `except:` flagged, custom exception classes for libraries.
4. Imports — `from x import *` flagged, circular imports flagged.
5. Tests — pytest patterns, fixtures over setup/teardown, no `assert True` filler.
6. Security — no `eval`/`exec` in prod paths, parameterized SQL, secrets via env not source.

For Django specifically: ORM N+1 detection (look for `.objects.all()` followed by attribute access in loops), `select_related`/`prefetch_related` discipline.

For ML: deterministic seeds (`torch.manual_seed`, `np.random.seed`, `random.seed`), `.to(device)` consistency.

## Skills to generate

- `/release` if `pyproject.toml` has version AND CHANGELOG.md.
- `/db-migrate` for Django (`python manage.py makemigrations && migrate`).
- `/test-fast` if pytest has slow markers (e.g. `pytest -m "not slow"`).

## .worktreeinclude

```
.env
.env.local
.python-version
{{if CLAUDE.md / .mcp.json gitignored, include}}
.claude/settings.local.json
```

## What NOT to generate

- No `output-styles/`, no `commands/`, no `agent-memory/`.
- No rules unless conventions are documented somewhere — Python projects often follow PEP-8 + community defaults; documenting them in rules is noise.
