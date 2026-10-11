# Blueprint: .claude/skills/orchestrate/SKILL.md

The `/orchestrate <goal>` skill. The main agent routes the goal, plans when needed, hands scoped work to the role agents, checks the result and reports. Subagents cannot spawn subagents here, so this skill must run in the main conversation. It must not set `context: fork`.

## When to write
- Default when the roster has at least one role agent besides `explorer`, `test-runner` and the reviewer. With no role agents, `/plan-task` plus the helpers is enough: skip it and say so in the plan.
- Skip with `--skip-skills`, `--skip-pipeline` or `--minimal`.
- Do not write it if `.claude/skills/orchestrate/` exists. List a MERGE in the plan.

## Inputs
- The roster: role names, scopes, `writes[]`, tiers. The skill reads `docs/agents.md` at run time, so do not copy the table into the skill.
- Whether `.claude/hooks/route.mjs`, `.claude/skills/plan-task/`, `.claude/skills/handoff/`, `explorer`, `test-runner`, the reviewer and `security-reviewer` are in the plan or exist. Drop each step that names a missing one.
- Detector: test and lint commands, only to name the loop's exit check.

## Rules
- Frontmatter: `name: orchestrate`, `description`, `argument-hint: "<goal>"`, `disable-model-invocation: true`, `allowed-tools: Agent Read Grep Glob Bash(node .claude/hooks/route.mjs *)`. `allowed-tools` pre-approves for the turn. It does not restrict.
- The skill has `disable-model-invocation: true`, so Claude cannot invoke `/plan-task` or `/handoff` from inside it. The body says "follow `.claude/skills/plan-task/SKILL.md`" and tells the user to run `/handoff` at the end.
- Steps, in order: route, plan if needed, dispatch, test loop, review, report.
- Route: run `node .claude/hooks/route.mjs --json "<goal>"` when the file exists. The JSON has `role`, `agent`, `tier`, `effort`, `plan`, `delegate`, `qa` and `confidence`. Otherwise read the routing table in `docs/agents.md`. The route is advice. The agent may override it and says so in the report. When `delegate` is false, the main agent decides.
- Plan: only when the route says plan, the change touches more than one scope, or it needs more than one sentence to describe. Stop for approval, as `/plan-task` does.
- Dispatch: every delegation message uses the template below. Parallel only when the scopes and `writes[]` of the agents do not overlap. Otherwise one at a time.
- Test loop: `test-runner` after the edits. On failure, send the failures to the role agent that owns the failing file. At most 3 rounds, then stop and report.
- Review: the reviewer on the changed files. Add `security-reviewer` when a changed file is in its scope. Fix only findings that affect correctness, security or a stated requirement.
- Never edit source in the skill body when a role agent owns the path. Small edits outside every role's scope are fine.
- Size cap: 70 lines.

## Skeleton
`````markdown
---
name: orchestrate
description: Route a goal to the right role agents, run them on their own scopes, test, review and report. Use for work that spans more than one area of the repo.
argument-hint: "<goal>"
disable-model-invocation: true
allowed-tools: Agent Read Grep Glob Bash(node .claude/hooks/route.mjs *)
---
Goal: $ARGUMENTS

Work as the orchestrator. Role agents do the edits in their own scopes. Follow the steps in order.

1. Route. Run `node .claude/hooks/route.mjs --json "$ARGUMENTS"`. If it is missing, use the routing table in `docs/agents.md`. Note the role, the `plan` and `delegate` flags and the confidence. If `delegate` is false, read `docs/agents.md` and choose yourself.
2. Plan. If the route says plan, or the goal touches more than one scope, follow `.claude/skills/plan-task/SKILL.md`, then stop for approval. Skip this for a change you can state in one sentence.
3. Dispatch. Send each role agent one message in the format below. Run agents in parallel only when their scopes and writable paths do not overlap. If they overlap, run them one at a time. Use `explorer` first when you do not know where the code lives.
4. Test. Send the changed files to `test-runner`. On failure, give the failures to the role agent that owns the failing file, then run `test-runner` again. Stop after 3 rounds and report what still fails.
5. Review. Send the changed file list to `<lang>-reviewer`. Add `security-reviewer` when a changed file is in its scope. Fix findings that affect correctness, security or a stated requirement. Ignore style the linter covers.
6. Report in the format below. If the work will continue in a new session, tell the user to run `/handoff`.

## Delegation message
Every agent starts with no conversation history. Send all of this:

```text
Goal: <one sentence: what this agent must produce>
Scope: <paths it may read and edit; what to leave alone>
Writes: <glob list it may edit; nothing else>
Context: <facts it needs: plan path, decisions, rules from AGENTS.md that apply>
Output: changed files with what changed; commands run with pass or fail; open risks
Budget: <max tool calls or turns; stop and report if you reach it>
```

## Final report
```markdown
## Result
<one or two sentences: done, partly done or blocked>

## Route
role <name>, plan <yes|no>, confidence <n>; overridden: <no | what and why>

## Changed
- `<path>` - <what changed> (<agent>)

## Checks
- `<command>` - <pass|fail>, <rounds used of 3>

## Review
- <finding as path:line - problem>, or "No findings"

## Open
- <risk, skipped check or question for the user>
```
`````
