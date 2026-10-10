# Blueprint: docs/architecture.md

A short architecture overview for agents and new contributors. Observed facts only.

## When to write
- Default for repos with more than one module or service. Skip with `--skip-docs` or `--minimal`.
- Skip if an equivalent exists: `ARCHITECTURE.md`, `docs/architecture*`, `docs/design*`, or an entry in the detector's `docs` list that covers it. Link to it from AGENTS.md instead.
- Skip for single-file scripts and tiny repos.

## Inputs
- Graph output: `node "${CLAUDE_SKILL_DIR}/scripts/graph.mjs" . --markdown`. Use the entry points and central modules to pick components.
- Detector: `layout`, `workspaces`, `frameworks[]`, `infra`, `ci`, `docs`.
- `README.md` (first 120 lines), the manifest, `docker-compose.yml`, deploy config, routing and handler directories.
- Grep for external calls: HTTP clients, SDK imports, queue and database clients. Open the files you cite.

## Rules
- Every statement is backed by a path. Write `path` or `path:line` in the sentence. If you cannot point to code, leave the statement out.
- No invented components, no future plans, no marketing words, no history.
- Do not draw a diagram. `docs/project-structure.md` holds the graph. Link to it.
- Keep sections only when they have content. Cap: 100 lines.
- External services: include a service only when code calls it or imports its SDK, and cite that `path:line` in "Used in". Put an env var name in "Config" only when code reads it (never a value). A variable that appears only in `.env.example` or docs does not establish a service.
- Put a "Checked" line with today's date and the short commit sha, so a reader can judge staleness.
- On `--update`, rewrite only facts that no longer match the code. Keep the user's prose.

## Skeleton
```markdown
# Architecture

Checked: <yyyy-mm-dd> at <short sha>

<Two sentences: what the system does and how it is split. Source: README.md.>

## Components
| Component | Path | Responsibility |
|---|---|---|
| <name> | `<path>` | <one line, from the code> |

## Data flow
1. A request enters at `<entry file>`.
2. `<module>` <does what> (`<path>:<line>`).
3. `<module>` reads or writes `<store>` (`<path>`).

## External services
| Service | Used in | Config |
|---|---|---|
| <name> | `<path>` | `<ENV_VAR_NAME>` |

## Build and deploy
<CI file, what it runs, where it deploys. Source: `<workflow path>`.>

See `docs/project-structure.md` for the module graph and entry points.
```
