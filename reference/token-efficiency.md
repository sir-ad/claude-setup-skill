# Token efficiency

Habits and settings that keep Claude Code's context small and its bills low. Every item has a source. Claude uses this when it writes the Claude-only section of CLAUDE.md. Humans can use it as a checklist.

Core constraint: the context window fills fast and performance degrades as it fills. ([best practices](https://code.claude.com/docs/en/best-practices)) Anthropic frames context as a finite attention budget and aims for the smallest set of high-signal tokens. ([context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents))

## Instruction files

- **Keep CLAUDE.md under about 200 lines.** Move task-specific procedures into skills, which load only when used. ([memory](https://code.claude.com/docs/en/memory#write-effective-instructions), [costs](https://code.claude.com/docs/en/costs#move-instructions-from-claude-md-to-skills))
- **Codex caps AGENTS.md at 32 KiB** in total (`project_doc_max_bytes`, default 32768) and truncates beyond it. ([codex source](https://github.com/openai/codex/blob/main/codex-rs/core/src/agents_md.rs)) The skill keeps AGENTS.md under 150 lines, well inside both limits.
- **Use path-scoped rules.** A rule with `paths:` loads only when Claude reads or edits a matching file. A rule without `paths` loads every session. ([memory](https://code.claude.com/docs/en/memory#path-specific-rules))
- **`@imports` do not save context.** Imported files load at launch with the file that imports them. Use them to avoid duplication, not to shrink. ([memory](https://code.claude.com/docs/en/memory#write-effective-instructions))
- **Link, do not paste.** "See docs/architecture.md" costs a line. Claude reads the file only when needed. This is the just-in-time pattern Anthropic describes: CLAUDE.md up front, glob and grep for the rest. ([context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents))

## Isolate noise in subagents

- A subagent keeps verbose output out of the main context. Only its final summary comes back. Use one for searches and for test runs. ([sub-agents](https://code.claude.com/docs/en/sub-agents))
- **Pick the model per subagent.** `model: haiku` is cheaper for search and test running. Leave review on `inherit` or a stronger model. `CLAUDE_CODE_SUBAGENT_MODEL` sets one for all. ([costs](https://code.claude.com/docs/en/costs#choose-the-right-model))
- Anthropic describes sub-agents returning condensed summaries of about 1,000 to 2,000 tokens. ([context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)) The generated agents ask for `file:line` findings and no whole-file pastes for that reason.
- **Agent teams cost more.** They are experimental, off by default (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), and used about 7x the tokens in plan mode. Use them for parallel research or independent modules, not sequential work. ([agent teams](https://code.claude.com/docs/en/agent-teams), [costs](https://code.claude.com/docs/en/costs#manage-agent-team-costs))
- Plain multi-agent systems are costly too: about 15x a chat in Anthropic's research system. ([source](https://www.anthropic.com/engineering/multi-agent-research-system))

## Session habits

- **Read by range.** Ask for the lines you need (`Read` with offset and limit, `sed -n 40,80p`) instead of whole files. Use the generated `docs/project-structure.md` to find the right file first.
- **`/clear` between unrelated tasks.** After two failed corrections on the same issue, `/clear` and rewrite the prompt. ([costs](https://code.claude.com/docs/en/costs#manage-context-proactively))
- **`/compact <focus>`** to summarize with a stated focus, for example `/compact keep the failing test list and the migration plan`. A "Compact instructions" section in CLAUDE.md also works. Run it at a natural break, not mid-task, because rebuilding the cache costs tokens. ([prompt caching](https://code.claude.com/docs/en/prompt-caching#compacting-the-conversation))
- **Auto-compaction** runs near the limit. `/autocompact <tokens>` sets the window. ([model config](https://code.claude.com/docs/en/model-config#set-the-auto-compact-window))
- **What survives compaction:** root CLAUDE.md, unscoped rules, auto memory, the plan, skills (5k tokens each, 25k total) and up to 5 re-read files. Path-scoped rules reload when a matching file is touched again. Text a hook added is summarized away. ([context window](https://code.claude.com/docs/en/context-window#what-survives-compaction))
- **Save state to a file before clearing.** That is what `/handoff` does.
- **Inspect.** `/context` shows usage, loaded memory files and hints. `/usage` shows cost, plan limits and cache statistics. `/cost` is an alias of `/usage`. ([commands](https://code.claude.com/docs/en/commands))

## Settings

- **Effort.** `/effort` or the `effort` frontmatter field takes `low`, `medium`, `high`, `xhigh` or `max`. Lower effort uses fewer thinking tokens. Only the `ultrathink` keyword is recognized for a one-off deeper pass. "think hard" is plain text. ([model config](https://code.claude.com/docs/en/model-config), [costs](https://code.claude.com/docs/en/costs#adjust-extended-thinking))
- **Model.** Sonnet for most work, Opus for architecture, Haiku for subagents. ([costs](https://code.claude.com/docs/en/costs#choose-the-right-model))
- **MCP.** Tool definitions are deferred by default. Prefer CLI tools such as `gh` over an MCP server. Disable unused servers with `/mcp`. ([costs](https://code.claude.com/docs/en/costs#reduce-mcp-server-overhead))
- **Hooks can filter output.** A `PreToolUse` hook can rewrite a test command to print only failures. ([costs](https://code.claude.com/docs/en/costs#offload-processing-to-hooks-and-skills))

## Prompt caching

The cache prefix is system prompt, then CLAUDE.md, memory and unscoped rules, then the conversation. These invalidate it mid-session: switching models, changing effort, adding or removing MCP servers, enabling plugins, denying a tool. Editing CLAUDE.md mid-session does not invalidate it, and does not apply until `/clear`, `/compact` or a restart. So set model and effort at the start. ([prompt caching](https://code.claude.com/docs/en/prompt-caching))

## What the skill writes for this

| Habit | Generated file |
|---|---|
| Short instruction files | `AGENTS.md` (table of contents, 150 lines or fewer) and `CLAUDE.md` (`@AGENTS.md` plus a Claude section of 12 lines or fewer) |
| Path-scoped rules | `.claude/rules/code-style.md`, `testing.md` with `paths:`. `security.md` stays unscoped and short. |
| Link instead of paste | `docs/architecture.md`, `docs/project-structure.md`, `docs/config.md` |
| Find files without reading many | `docs/project-structure.md` repo map from `scripts/graph.mjs` |
| Isolate search | `.claude/agents/explorer.md` (haiku, read-only) |
| Isolate test output | `.claude/agents/test-runner.md` (haiku, failures only) |
| Cheap review memory | `<lang>-reviewer.md` with `memory: project`, stored in `.claude/agent-memory/` |
| Read by range, `/clear`, `/compact <focus>`, `/context` | The Claude section of `CLAUDE.md` |
| State outside the context | `/plan` writes `docs/plans/`, `/handoff` writes `.claude/handoff.md` |
| Reload after compaction | Optional `SessionStart` hook, only with a yes |
| No agent teams | Not generated. The skill mentions the cost if asked. |
