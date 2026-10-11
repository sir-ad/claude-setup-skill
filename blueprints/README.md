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
| `agents/role.md` | `.claude/agents/<role>.md`, one per roster role | Agents | `--skip-pipeline`, `--minimal` |
| `skills/plan-task.md` | `.claude/skills/plan-task/SKILL.md` | Skills | `--skip-skills`, `--skip-pipeline`, `--minimal` |
| `skills/handoff.md` | `.claude/skills/handoff/SKILL.md` | Skills | `--skip-skills`, `--skip-pipeline`, `--minimal` |
| `skills/orchestrate.md` | `.claude/skills/orchestrate/SKILL.md` | Skills | `--skip-skills`, `--skip-pipeline`, `--minimal` |
| `rules/code-style.md` | `.claude/rules/code-style.md` | Rules | `--minimal` |
| `rules/testing.md` | `.claude/rules/testing.md` | Rules | `--minimal` |
| `rules/security.md` | `.claude/rules/security.md` | Rules | `--minimal` |
| `docs/architecture.md` | `docs/architecture.md` | Docs | `--skip-docs`, `--minimal` |
| `docs/project-structure.md` | `docs/project-structure.md` | Docs | `--skip-docs`, `--minimal` |
| `docs/config.md` | `docs/config.md` | Docs | `--skip-docs`, `--minimal` |
| `docs/decisions.md` | `docs/decisions/0000-template.md`, `docs/decisions/README.md` | Docs | `--skip-docs`, `--minimal` |
| `docs/agents.md` | `docs/agents.md` | Docs | `--skip-docs`, `--minimal` |
| `hooks/router.md` | `.claude/hooks/route.mjs`, `.claude/router.json`, `hooks.UserPromptSubmit` in `.claude/settings.json` | Hook (default yes) | `--no-router`, `--skip-pipeline`, `--minimal` |
| `hooks/session-start-handoff.md` | `hooks.SessionStart` in `.claude/settings.json` | Hook (opt-in, default no) | `--skip-pipeline`, `--minimal` |
| `agents-md-working-agreements.md` | `## Working agreements` in `AGENTS.md` | AGENTS.md | `--skip-pipeline`, `--minimal` |
| `agents-md-routing.md` | `## Routing` and `## Delegation` in `AGENTS.md` | AGENTS.md | `--skip-pipeline`, `--minimal` |
| `claude-md-efficiency.md` | `## Claude Code` in `CLAUDE.md` | CLAUDE.md | `--skip-pipeline`, `--minimal` |

## Sources of facts

- `scripts/detect.mjs` and `scripts/context.mjs`: stack, commands, docs, env example files, generated paths, hard-rule candidates.
- `scripts/graph.mjs`: entry points, central modules and the module graph, used by `docs/project-structure.md`.
- `scripts/roster.mjs`: the evidence-based role roster, its routing table and the router config, used by `agents/role.md`, `docs/agents.md`, `hooks/router.md` and `agents-md-routing.md`.
- `knowledge/practices.md`: the cited baseline for rules files. Copy only bullets that apply.
- `reference/claude-code.md`: the exact file formats.
- `reference/model-tiers.md`, `reference/routing.md` and `reference/agent-adapters.md`: tiers and model values, router design, agent files per tool.

## Shared rules for every blueprint

- Write only what the repo or a cited source supports. Grep before you name a path, flag or function.
- Respect the size cap in the blueprint. Short sentences, imperative voice.
- Never read `.env` files. Never write secret values.
- If a file already exists, keep it and offer a merge. Replace only after a per-file yes.
- Subagents do not get the `Agent` tool. Only the reviewer gets `memory: project`. Model comes from the tier: `fast` agents (explorer, test-runner, docs, release) use `haiku`, `standard` use `sonnet`, `deep` use `opus` or inherit. Role agents are written only for roles the roster lists.
