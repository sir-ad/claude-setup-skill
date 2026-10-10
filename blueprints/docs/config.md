# Blueprint: docs/config.md

The names of environment variables, config files and CLI flags. Names only, never values.

## When to write
- Default when `env.files` lists an example file, or grep finds environment reads in source, or the repo has a config file the app loads. Skip with `--skip-docs` or `--minimal`.
- Skip if an equivalent exists (`docs/config*`, `docs/configuration*`, `docs/environment*`). Link to it instead.
- Skip when the repo reads no env vars and has no config file.

## Inputs
- Detector: `env.files`, `env.gitignored`, `frameworks[]`, `infra`.
- Only the example env files named in `env.files` (`.env.example`, `.env.sample`, `.env.template`). Never open `.env`, `.env.local`, `.env.production` or any other real env file.
- Grep source for reads: `process.env.`, `import.meta.env.`, `os.environ`, `os.getenv`, `env::var`, `os.Getenv`, `ENV[`. Record `path:line` for each name.
- Config files the app loads (`config/*.yml`, `settings.py`, `next.config.*`), CLI parsers (`argparse`, `commander`, `clap`, `cobra`) for flags.
- `docker-compose.yml` and CI workflow for variables they set.

## Rules
- Env var names only. Never a value, not even an example value or placeholder copied from the example file.
- One row per name. Columns: name, required or optional, read in (`path:line`), what it controls. Take "what it controls" from a comment in the example file or from the code. Leave it blank if unknown. Do not guess.
- For each name, grep the code, excluding `.env*` files, docs and lockfiles. If code reads it, write `path:line` in "Read in". If only an example file lists it, write `listed in <file>; no code reads it` in "Read in".
- Never infer an integration from a variable name. A name such as `TWITTER_API_KEY` alone does not mean the repo calls Twitter.
- Mark "required" only when the code fails without it (a startup check or no default). A name that no code reads is never "required". Otherwise "optional".
- Never record names that look like they hold a secret together with any hint of the value.
- Config files: path, format, and which code loads it. CLI flags: only those defined in the repo.
- Cap: 80 lines. If there are more than 40 variables, group by area.
- On `--update`, add new names, mark removed ones, keep descriptions the user edited.

## Skeleton
```markdown
# Configuration

Names only. Values live in the environment or a secrets manager, not in the repo.

## Environment variables
| Name | Required | Read in | Controls |
|---|---|---|---|
| `<ENV_VAR_NAME>` | yes | `<path>:<line>` | <what it controls> |
| `<ENV_VAR_NAME>` | optional | `<path>:<line>` | <what it controls> |

Copy `<example env file>` to `<local env file>` and fill in values. `<local env file>` is gitignored.

## Config files
- `<path>` - <format>, loaded by `<path>:<line>`

## CLI flags
- `<flag>` - <what it does> (`<path>:<line>`)
```
