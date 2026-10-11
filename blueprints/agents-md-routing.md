# Blueprint: AGENTS.md, "## Routing" and "## Delegation"

Two short sections for AGENTS.md. Routing tells any agent which role fits which signal. Delegation gives explicit permission to use the role agents. Codex needs that permission: it spawns a subagent only when the user or AGENTS.md says so.

## When to write
- Default when the roster has at least one role agent. Skip with `--skip-pipeline` or `--minimal`.
- Written even when every `.claude/` file is staged. These are AGENTS.md lines and need no file under `.claude/`. In that case they name only agents that exist in place.
- If AGENTS.md already has sections with these purposes, merge missing lines only. Never reword the user's text.
- Place both after "Working agreements". Together they take at most 25 lines of the generated AGENTS.md and count toward its line cap.

## Inputs
- The Routing table in the injected `## Agent roster` section (signals, role). Take each role's tier from the roster table. Use them as the source. Compress, do not invent rows.
- Which role agent files are written or exist, and which tools the user selected.
- Whether `/orchestrate` is in place (not staged). Name it only then.

## Rules
- Tool-neutral. Name roles and agent names, not tool features. The only Claude-specific line is the `/orchestrate` pointer, and only if the skill exists.
- Routing: one table, at most 9 rows, three columns: signal (paths or words), role, tier. Rows come from the roster. Add one last row for the default: "everything else: main agent". No prose paragraph.
- Delegation: five to seven bullets.
  - Permission, stated plainly: "You may spawn subagents for the roles above." Codex relies on this sentence.
  - Use `explorer` for read-only search, `test-runner` for checks, the reviewer after a finished diff.
  - Parallel only when scopes and writable paths do not overlap.
  - Maximum depth 1: subagents do not spawn subagents.
  - Do not delegate a single-file change or a task that needs back-and-forth.
  - Delegation message: goal, scope, writes, output format, budget.
  - Output contract: changed files, commands run, open risks.
- Point to `docs/agents.md` for the full roster, only if it is written.
- Drop any bullet that names an agent whose file is not written or does not exist.
- Do not set model names here. AGENTS.md cannot set a model.

## Skeleton
```markdown
## Routing
| Signal | Role | Tier |
|---|---|---|
| `<scope glob or keywords>` | `<role>` | <fast|standard|deep> |
| `<scope glob or keywords>` | `<role>` | <tier> |
| anything else | main agent | |

## Delegation
- You may spawn subagents for the roles above. Full roster: `docs/agents.md`.
- Use `explorer` for read-only search, `test-runner` for checks, `<lang>-reviewer` after a finished diff.
- Run subagents in parallel only when their scopes and writable paths do not overlap.
- Subagents do not spawn subagents. Do not delegate single-file changes.
- Each delegation states: goal, scope, writable paths, output format, budget.
- Each subagent reports: changed files, commands run, open risks.
```
