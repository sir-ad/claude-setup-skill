# Agentic pipeline

How the generated agents, skills and plans fit together, and why the default is small. Claude reads this before writing a project's `.claude/agents/` and `.claude/skills/`. Humans can read it to see what the files are for.

Sources: [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), [multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system), [long-running harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents), [Claude Code sub-agents](https://code.claude.com/docs/en/sub-agents), [Google ADK docs](https://github.com/google/adk-docs/blob/main/docs/agents/index.md). Details of each Claude Code field are in `claude-code.md`.

## Default shape

One main agent does the work. It has three helpers and two skills.

| File | Job | Tools | Model |
|---|---|---|---|
| `.claude/agents/explorer.md` | Read-only search. Reads `docs/project-structure.md` first. Returns `file:line` findings. | Read, Grep, Glob | haiku |
| `.claude/agents/test-runner.md` | Runs the detected test and lint commands. Returns only failures. | Bash (scoped), Read, Grep | haiku |
| `.claude/agents/<lang>-reviewer.md` | Reviews a diff against the repo's own rules. Keeps `memory: project`. | Read, Grep, Glob | inherit |
| `.claude/skills/plan-task/SKILL.md` | `/plan-task <task>`: explore, write a plan file, stop for approval. | | |
| `.claude/skills/handoff/SKILL.md` | `/handoff`: write `.claude/handoff.md`. | | |

None of the generated subagents has the `Agent` tool, so they cannot spawn more subagents. Both skills set `disable-model-invocation: true` because they write files.

### Why not more

- Anthropic says to start with the simplest solution and add complexity only when it measurably helps. ([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents))
- A multi-agent system used about 15x the tokens of a chat, and agents about 4x. Anthropic notes that most coding tasks have fewer parallelizable parts than research, so multi-agent suits them less. ([multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system))
- ADK gives the same reasons to split an agent: long instructions degrade, context is limited, and each part should do one job. ([ADK agents](https://github.com/google/adk-docs/blob/main/docs/agents/index.md)) The three helpers earn their place by isolating noisy output (searches, test logs) and by giving review a fresh context.
- Add an agent only after a repeated failure that a narrower agent would fix. Do not add one per language, layer or ticket.

## Pattern mapping

Left: the named pattern. Right: what a generated project uses.

| Pattern | Source | Claude Code mechanism |
|---|---|---|
| Prompt chaining | [Anthropic](https://www.anthropic.com/engineering/building-effective-agents) | Numbered steps in a skill. `/plan-task` runs explore, write plan, stop. The gate between steps is a file or a human approval. |
| Routing | Anthropic | Subagent `description` fields. Claude picks a subagent from the request and the descriptions, so write them as routing contracts: specific, and different from their peers. "use proactively" encourages delegation. ([sub-agents](https://code.claude.com/docs/en/sub-agents#understand-automatic-delegation)) |
| Parallelization | Anthropic | Several read-only subagents in one turn, each with its own question, sharing no state. The main agent merges the answers. Sectioning only. No voting by default. |
| Orchestrator-workers | Anthropic | The main agent, with explorer and test-runner as workers. Anthropic lists it as the fit for multi-file coding changes. |
| Evaluator-optimizer | Anthropic | Test, fix, test again, capped at 3 rounds, then stop and report. The reviewer is the evaluator for a finished diff. |
| `LlmAgent` with transfer | [ADK](https://github.com/google/adk-docs/blob/main/docs/agents/custom-agents.md) | Same as routing. ADK says transfer needs clear instructions and distinct `description`s. |
| `SequentialAgent` | [ADK](https://github.com/google/adk-docs/blob/main/docs/agents/workflow-agents/sequential-agents.md) | Skill steps, in order. |
| `ParallelAgent` | [ADK](https://github.com/google/adk-docs/blob/main/docs/agents/workflow-agents/parallel-agents.md) | Parallel read-only subagents. ADK branches share no history or state and write to distinct keys. Here each writes its own result and the main agent gathers them. |
| `LoopAgent` | [ADK](https://github.com/google/adk-docs/blob/main/docs/agents/workflow-agents/loop-agents.md) | The 3-round test-fix loop. ADK says a loop does not decide when to stop. It needs `max_iterations` or an `escalate` signal. Here the cap is 3 and "tests pass" is the exit. |
| `output_key` session state | [ADK](https://github.com/google/adk-docs/blob/main/docs/sessions/state.md) | A named file: `docs/plans/<date>-<slug>.md` for plans, `.claude/handoff.md` for session state. |
| `AgentTool` | [ADK](https://github.com/google/adk-docs/blob/main/docs/agents/custom-agents.md) | The `Agent` tool. A subagent runs, and its final message comes back as the tool result. |

ADK 2.0 notes that template workflow agents have been superseded by graph and dynamic workflows ([ADK workflows](https://github.com/google/adk-docs/blob/main/docs/workflows/index.md)). The mapping above still holds, because the ideas are the same. Claude Code's closest match is a [dynamic workflow](https://code.claude.com/docs/en/workflows): a script in `.claude/workflows/` that holds the loop. The skill does not generate one.

## Delegation rules

Spawn a subagent when the work is:
- noisy (many search hits, long test logs) and only the conclusion matters;
- self-contained, with a clear result;
- read-only and independent of other open questions.

Keep the work in the main conversation when it needs tight back-and-forth, shares context with the next step, or edits the same files. ([choose between subagents and main](https://code.claude.com/docs/en/sub-agents#choose-between-subagents-and-main-conversation))

A subagent starts with a fresh context. It does not see the conversation, skills already invoked or files already read. ([what loads at startup](https://code.claude.com/docs/en/sub-agents#what-loads-at-startup)) So the task message must carry everything:

1. **Goal.** One sentence: what question to answer.
2. **Scope.** Paths or modules to look at, and what to leave alone.
3. **Output format.** For example: "up to 10 findings as `path:line - one-line reason`".
4. **Budget.** A tool-call or turn limit. Set `maxTurns` in the agent file as a backstop.
5. **Rules that matter.** Restate any rule the subagent must follow. It may not have seen it.

Anthropic found that vague delegation caused duplicated work, and that each subagent needs an objective, an output format, tool guidance and explicit boundaries. ([multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system))

### Output contract

Every generated subagent says this in its body:
- Findings are `path:line - reason`. No whole-file pastes. Quote at most a few lines.
- Failures only, for test-runner: command, `path:line`, one-line cause.
- If a result is large, write it to a file and return the path. Anthropic reports this avoids loss when results are passed along in chat.
- End with what was not checked.

### Nesting

Subagents can spawn subagents. The default depth is 3 below the main agent, set by `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (`1` turns nesting off). Leaving `Agent` out of `tools` stops a subagent from spawning. Generated subagents leave it out on purpose: nesting multiplies token cost and hides work. Add `Agent` to one only when a person asks for an orchestrator, and say why in its file. ([sub-agents](https://code.claude.com/docs/en/sub-agents))

## Handoff protocol

`.claude/handoff.md` is plain Markdown so any tool or agent can read it. Format:

```markdown
# Handoff
Goal: <one sentence>
State: <where things stand now: branch, what runs, what is broken>
Done:
- <finished step, with commit hash if any>
Next steps:
1. <the very next action>
Files touched:
- path/to/file - what changed
Verify: <exact commands that show the work is correct>
Open questions:
- <decision the next session needs from a person>
```

Write it:
- before `/clear`;
- at the end of a session;
- before handing the work to another tool or agent.

Overwrite it each time. It is current state, not a log. Keep it out of commits unless the team wants it shared. The optional reload hook (asked about in the plan, default no):

```json
{"hooks":{"SessionStart":[{"matcher":"startup|resume|compact","hooks":[{"type":"command","command":"cat .claude/handoff.md 2>/dev/null || true"}]}]}}
```

The matcher includes `compact` because `PreCompact` cannot add context. It can only block or run side effects. A `SessionStart` hook with matcher `compact` is how text gets back in after compaction. ([hooks](https://code.claude.com/docs/en/hooks))

## Long-running tasks

Anthropic's harness for long tasks used a feature list, a progress file and a commit per change. Agents did one feature at a time, left the tree in a clean state, and started each session by reading the git log and the progress file. ([long-running harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)) The generated version:

1. `/plan-task` writes `docs/plans/<yyyy-mm-dd>-<slug>.md`: goal, context with `file:line`, steps as a checklist, verification, risks.
2. A person approves the plan.
3. The main agent takes one unchecked step, implements it, runs the verify command, ticks the box and commits.
4. If a step fails verification, fix and rerun at most 3 times. Then stop and report what failed. Do not start the next step.
5. At session end, run `/handoff`.
6. A new session reads the plan and the handoff, runs the verify commands, then continues with the next unchecked step.

Anthropic also says to give the agent ground truth from the environment at each step, stopping conditions such as a maximum number of iterations, and human checkpoints. The plan approval and the 3-round cap are those.
