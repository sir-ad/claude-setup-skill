# Blueprint: docs/agents.md

The tool-neutral description of the agent roster: who the role agents are, how a task is routed, what a delegation message contains and how each tool uses these files. The roster and routing tables are generated and refreshable. The rest is fixed text with repo facts filled in.

## When to write
- Default when the roster has at least one role agent. Skip with `--skip-docs` or `--minimal`.
- Skip if the detector's `docs` list already has an equivalent (`docs/agents*`). Then the fence goes there, listed in the plan as a planned change under the Proceed gate.
- If the script fails or prints nothing, skip the file and say why in the plan. Never write the tables by hand.

## Inputs
- Generated section: `emit.mjs --write agents-doc` fills the fence with the roster from `roster.mjs`, without its heading. It is the same derivation as the injected `## Agent roster` section. With `--intent`, pass the same `--intent` to emit.mjs. The section holds the roster table (role, agent file, tier, scope, why) and the routing table (signals, role).
- Which role agents, `/orchestrate` and the router hook are in the plan or exist. State only what exists.
- Which tools the user selected (Codex, Gemini, opencode, Copilot, Cursor), from the plan.
- Tier-to-model values from `reference/model-tiers.md`, and any `--model-map` the user gave.
- The skeleton must not point at `${CLAUDE_SKILL_DIR}`. The project may not have the skill installed. Refresh instructions say `/claude-setup --update`.

## Rules
- The block between `<!-- claude-setup:begin roster -->` and `<!-- claude-setup:end roster -->` is filled by `emit.mjs` with script output only. The model never types, edits, trims or reorders it. Each fence comment appears once, on its own line.
- Everything outside the fence is written by you. `--update` replaces only the fence content.
- Each "How each tool uses this" bullet appears only for a tool the user selected. Facts come from `reference/agent-adapters.md`.
- Name the router and `/orchestrate` only when they are written or exist. Drop those lines otherwise.
- Do not explain the roster beyond the tables. The evidence for each role is already in the `why` column.
- Cap: 100 lines outside the fence.

## Skeleton
`````markdown
# Agents

Role agents are scoped workers. Each one owns some paths, may edit only some of them and reports back to the main agent. They do not run on their own. The roster comes from evidence in this repo; the `why` column shows it.

<!-- claude-setup:begin roster -->
<the injected Agent roster section, verbatim>
<!-- claude-setup:end roster -->

Always present: `explorer` (read-only search), `test-runner` (runs checks, returns failures), `<lang>-reviewer` (reviews a diff).

## Model tiers
| Tier | Use for | Claude | Other tools |
|---|---|---|---|
| fast | search, test runs, docs, release prep | `haiku` | inherit the session model |
| standard | implementation in a scope | `sonnet` | inherit the session model |
| deep | review, security, hard design | `opus` | inherit the session model |

Change a tier by editing `model:` in the agent file. Other tools inherit the session model unless you map tiers to models when you run `/claude-setup --update`.

## Delegation contract
Every delegation message contains: goal, scope, writes, context, output format, budget. A subagent starts with no conversation history, so the message carries everything it needs. A role agent edits only its `writes` globs. If it needs another file it stops and names it. Two agents run in parallel only when their scopes and writes do not overlap. Role agents have no `Agent` tool, so they cannot spawn subagents.

Role agents answer in one shape: changed files, commands run with pass or fail, open risks.

## Working a task
1. Route the goal (router hint, or the routing table above).
2. Plan when the change spans more than one scope: `/plan-task`.
3. Delegate to role agents with the contract above. Use `/orchestrate <goal>` to run the whole sequence in Claude Code.
4. Run `test-runner`. At most 3 fix rounds, then stop and report.
5. Run the reviewer, and `security-reviewer` when its scope changed.

## Handoff
When a session ends with work left, write `.claude/handoff.md` (`/handoff` in Claude Code). It records goal, state, done, next steps, files touched, how to verify and open questions. A new session reads it first.

## How each tool uses this
- Claude Code: reads `.claude/agents/*.md`. The `UserPromptSubmit` hook (`.claude/hooks/route.mjs`) adds a one-line routing hint to each prompt. `/orchestrate` runs the sequence.
- Codex: reads `.codex/agents/*.toml`, mirrored from `.claude/agents/`. Codex spawns a subagent only when `AGENTS.md` says it may, so the Delegation section in `AGENTS.md` is required. Default maximum depth is 1.
- Gemini CLI: reads `.gemini/agents/*.md`. Write `@<name>` at the start of a prompt to force an agent. Subagents cannot call subagents.
- opencode: reads `.opencode/agents/*.md` (`mode: subagent`). Use `@<name>` or let the main agent pick by description.
- Copilot and Cursor: read `.claude/agents/*.md` directly. Nothing extra is written for them.

After you edit an agent file, run `/claude-setup --update` to refresh the mirrors for the other tools and the tables above.
`````
