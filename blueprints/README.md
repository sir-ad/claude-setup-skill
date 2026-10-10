# Blueprints

A blueprint tells Claude how to write one kind of generated file for a specific repo. Claude reads the blueprint at runtime, reads the inputs it names, and writes the file. A blueprint is not a template to paste. The skeleton shows the shape. The Rules decide what goes in.

Each blueprint has four sections: When to write, Inputs, Rules, Skeleton. Angle-bracket slots in a skeleton are filled from the detector, the graph or the repo. A slot with no repo fact behind it means the line is dropped.

Every file is listed in the plan (Phase 3) and written only after the user confirms. Flags that skip a group: `--skip-docs`, `--skip-pipeline`, `--skip-skills`, `--minimal`.

## Index

| Blueprint | Writes | Plan step | Skipped by |
|---|---|---|---|
| `agents/explorer.md` | `.claude/agents/explorer.md` | Agents | `--skip-pipeline`, `--minimal` |
| `agents/test-runner.md` | `.claude/agents/test-runner.md` | Agents | `--skip-pipeline`, `--minimal` |
| `agents/reviewer.md` | `.claude/agents/<lang>-reviewer.md` | Agents | `--skip-pipeline`, `--minimal` |
| `skills/plan-task.md` | `.claude/skills/plan-task/SKILL.md` | Skills | `--skip-skills`, `--skip-pipeline`, `--minimal` |
| `skills/handoff.md` | `.claude/skills/handoff/SKILL.md` | Skills | `--skip-skills`, `--skip-pipeline`, `--minimal` |
| `rules/code-style.md` | `.claude/rules/code-style.md` | Rules | `--minimal` |
| `rules/testing.md` | `.claude/rules/testing.md` | Rules | `--minimal` |
| `rules/security.md` | `.claude/rules/security.md` | Rules | `--minimal` |
| `docs/architecture.md` | `docs/architecture.md` | Docs | `--skip-docs`, `--minimal` |
| `docs/project-structure.md` | `docs/project-structure.md` | Docs | `--skip-docs`, `--minimal` |
| `docs/config.md` | `docs/config.md` | Docs | `--skip-docs`, `--minimal` |
| `docs/decisions.md` | `docs/decisions/0000-template.md`, `docs/decisions/README.md` | Docs | `--skip-docs`, `--minimal` |
| `hooks/session-start-handoff.md` | `hooks.SessionStart` in `.claude/settings.json` | Hook (opt-in, default no) | `--skip-pipeline`, `--minimal` |
| `agents-md-working-agreements.md` | `## Working agreements` in `AGENTS.md` | AGENTS.md | `--skip-pipeline`, `--minimal` |
| `claude-md-efficiency.md` | `## Claude Code` in `CLAUDE.md` | CLAUDE.md | `--skip-pipeline`, `--minimal` |

## Sources of facts

- `scripts/detect.mjs` and `scripts/context.mjs`: stack, commands, docs, env example files, generated paths, hard-rule candidates.
- `scripts/graph.mjs`: entry points, central modules and the module graph, used by `docs/project-structure.md`.
- `knowledge/practices.md`: the cited baseline for rules files. Copy only bullets that apply.
- `reference/claude-code.md`: the exact file formats.

## Shared rules for every blueprint

- Write only what the repo or a cited source supports. Grep before you name a path, flag or function.
- Respect the size cap in the blueprint. Short sentences, imperative voice.
- Never read `.env` files. Never write secret values.
- If a file already exists, keep it and offer a merge. Replace only after a per-file yes.
- Subagents do not get the `Agent` tool. Only the reviewer gets `memory: project`. Only explorer and test-runner use `model: haiku`.
