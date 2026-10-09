# Python

Checked: 2026-10. The project's pinned versions always win over this file.

## Current versions
| Tool | Latest stable | Support notes |
|---|---|---|
| Python | 3.14.8 | 3.14 EOL 2030-10-31. 3.13 EOL 2029-10-31, 3.12 EOL 2028-10-31, 3.11 EOL 2027-10-31. 3.10 reached EOL 2026-10-01 and 3.9 on 2025-10-31. |
| uv | 0.12.24 | Still 0.x, no 1.0. |
| Ruff | 0.16.10 | Linter and formatter. |
| mypy | 2.4.0 | 2.x uses a native parser by default. |
| ty (Astral) | 0.0.85 | Beta. Versions are 0.0.x and diagnostics can change between any two releases. |
| pytest | 9.1.1 | |
| Pydantic | 2.14.0 | |
| FastAPI | 0.143.0 | Still 0.x. |
| Django | 6.1.2 | 6.0 current. 5.2 LTS gets security fixes to 2028-04-30. 4.2 LTS is EOL (2026-04-07). |
| SQLAlchemy | 2.1.4 | |

## Version notes
- **Python >= 3.14**: annotations are evaluated lazily. Write forward references unquoted and do not add `from __future__ import annotations`. To inspect annotations at runtime use `annotationlib`. [source](https://raw.githubusercontent.com/python/cpython/main/Doc/whatsnew/3.14.rst)
- **Python >= 3.14**: a t-string (`t"..."`, PEP 750) returns a `Template` object, not a `str`. Do not use it where a plain f-string is expected. [source](https://raw.githubusercontent.com/python/cpython/main/Doc/whatsnew/3.14.rst)
- **Python >= 3.14**: the free-threaded build is officially supported but still a separate, optional build. Do not assume the GIL is gone; the default build keeps it. [source](https://raw.githubusercontent.com/python/cpython/main/Doc/whatsnew/3.14.rst)
- **Python <= 3.10**: 3.10 reached EOL on 2026-10-01 and 3.9 on 2025-10-31. Do not target either for new code, and do not set `requires-python` below 3.11 in a new project. [source](https://endoflife.date/python)
- **uv >= 0.12.0**: `uv init` now creates a packaged project (`[build-system]` with `uv_build`, `src/<name>/` layout, a `[project.scripts]` entry). For the old flat layout use `uv init --no-package`; for a bare `pyproject.toml` use `uv init --bare`; for a library use `uv init --lib`. [source](https://raw.githubusercontent.com/astral-sh/uv/main/CHANGELOG.md)
- **uv (any)**: add dependencies with `uv add <pkg>` and dev dependencies with `uv add --dev <pkg>`. Do not edit `uv.lock` by hand and do not use `pip install` in a uv project. In CI, `uv lock --check` or `uv run --locked` fails on a stale lockfile. [source](https://raw.githubusercontent.com/astral-sh/uv/main/docs/concepts/projects/sync.md)
- **Dev dependencies (PEP 735)**: put them in `[dependency-groups]`, not `[project.optional-dependencies]` or `[tool.uv] dev-dependencies`. The `dev` group is synced by default; `uv sync --no-dev` skips it. [source](https://raw.githubusercontent.com/astral-sh/uv/main/docs/concepts/projects/dependencies.md)
- **pyproject license (PEP 639)**: write `license = "MIT"` (an SPDX expression) and `license-files = [...]`. Do not use `license = {text = ...}`, `license = {file = ...}` or `License ::` classifiers. A build error about license being a table means the build backend is too old (hatchling >= 1.27.0, setuptools >= 77.0.3, uv-build >= 0.7.19). [source](https://raw.githubusercontent.com/pypa/packaging.python.org/main/source/guides/writing-pyproject-toml.rst)
- **Ruff**: for new projects use `ruff check --fix` and `ruff format` instead of Flake8, Black and isort. If the project already configures those tools, keep them. [source](https://raw.githubusercontent.com/astral-sh/ruff/main/README.md)
- **Ruff >= 0.16.0**: the default rule set grew from 59 to 413 rules, so an unconfigured `ruff check` reports much more than before. `ruff format` now also formats Python code blocks in Markdown. Suppress with `# ruff: ignore[CODE]` or `# noqa`. [source](https://raw.githubusercontent.com/astral-sh/ruff/main/CHANGELOG.md)
- **mypy >= 2.0**: the native parser is the default. `--no-native-parser` restores the old one but it is planned for removal in early 2027. [source](https://raw.githubusercontent.com/python/mypy/master/CHANGELOG.md)
- **pytest >= 9.0**: config can live in a native `[tool.pytest]` table in `pyproject.toml` (or `pytest.toml`). It cannot sit next to `[tool.pytest.ini_options]` in the same file. The `subtests` fixture is built in; do not add `pytest-subtests`. [source](https://raw.githubusercontent.com/pytest-dev/pytest/main/doc/en/changelog.rst)
- **pytest >= 9.1**: passing a generator as `parametrize` argvalues is deprecated (removed in pytest 10). Pass a list or tuple. [source](https://raw.githubusercontent.com/pytest-dev/pytest/main/doc/en/changelog.rst)
- **Pydantic >= 2**: use `model_dump()`, `model_validate()`, `model_validate_json()`, `model_copy()`, `ConfigDict`/`model_config`, `@field_validator`, `@model_validator`, `RootModel`, `TypeAdapter`. Do not use `.dict()`, `.parse_obj()`, `.from_orm()`, `class Config`, `orm_mode`, `@validator`, `@root_validator` or `__root__`. [source](https://raw.githubusercontent.com/pydantic/pydantic/main/docs/migration.md)
- **FastAPI >= 0.128.0**: Pydantic v1 (including `pydantic.v1`) is not supported. Install `fastapi` or `fastapi[standard]`, not the discontinued `fastapi-slim`. `ORJSONResponse` and `UJSONResponse` are deprecated since 0.131.0. [source](https://raw.githubusercontent.com/fastapi/fastapi/master/docs/en/docs/release-notes.md)
- **Django >= 6.0**: built-in CSP (`ContentSecurityPolicyMiddleware`, `SECURE_CSP`), template partials (`{% partialdef %}`, `{% partial %}`) and a tasks framework (`django.tasks.task`, `.enqueue()`; workers run outside Django). Do not add a third-party CSP package for basic policies. [source](https://raw.githubusercontent.com/django/django/main/docs/releases/6.0.txt)
- **Django >= 6.1**: use the `MAILERS` setting for email. `EMAIL_BACKEND` and the other `EMAIL_*` settings are deprecated and go away in Django 7.0. `on_delete=DB_CASCADE` is available but fires no signals. [source](https://raw.githubusercontent.com/django/django/main/docs/releases/6.1.txt)
- **SQLAlchemy >= 2.0**: use `DeclarativeBase`, `Mapped[...]`, `mapped_column()` and `select()` with `session.execute()` / `session.scalars()`. Do not write 1.x style `declarative_base()` or `session.query()` in new code. [source](https://raw.githubusercontent.com/sqlalchemy/sqlalchemy/main/doc/build/changelog/whatsnew_20.rst)
- **SQLAlchemy >= 2.1**: requires Python 3.11 or newer. `greenlet` is no longer installed by default, so async code needs `sqlalchemy[asyncio]`. The default PostgreSQL driver is psycopg (v3). [source](https://raw.githubusercontent.com/sqlalchemy/sqlalchemy/main/doc/build/changelog/migration_21.rst)

## Default toolchain
- Setup: `uv sync`.
- Test: `uv run pytest`.
- Lint and format: `uv run ruff check --fix` and `uv run ruff format`.
- Lockfile check: `uv lock --check`.
- Type check: use whichever checker the project configures (mypy, pyright or ty). Do not add one.
- Projects without uv follow their own lockfile (`poetry.lock`, `requirements.txt`).
