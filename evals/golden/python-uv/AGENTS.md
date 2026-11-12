# svc

Python 3.12, uv. FastAPI and Pydantic.

## Commands
- Install: `uv sync`
- Test: `uv run pytest`
- One test: `uv run pytest tests/test_x.py::test_name`
- Lint: `uv run ruff check .`
- Format: `uv run ruff format .`
- Dev: `poe serve`

## Version notes
- Pydantic 2: use `model_dump()` and `model_validate()`. Do not use `.dict()` or `.parse_obj()`.
