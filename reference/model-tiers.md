# Model tiers

Each role agent has a tier, not a model name. The tier says how much capability the job needs. The skill turns the tier into a model value for each tool. Claude reads this before it writes `model:` into an agent file. Facts checked 2026-10-11. Tags: [SRC] read from the tool's docs or source; [SEARCH] from a search summary only.

## The three tiers

| Tier | Jobs | Claude value |
|---|---|---|
| `fast` | Search, running tests, reading logs, docs edits, release prep | `haiku` |
| `standard` | Implementation inside one scope, test writing | `sonnet` |
| `deep` | Review, security review, architecture, hard debugging | `opus`, or `inherit` |

The tier of each role comes from `scripts/roster.mjs`. A user can change one by editing `model:` in the agent file. `--update` keeps that edit.

## Why tiers

- Anthropic's cost guidance: pick the model per job, use `model: haiku` or `CLAUDE_CODE_SUBAGENT_MODEL` to make subagents cheaper, Sonnet for most work, Opus for architecture. ([costs](https://code.claude.com/docs/en/costs#choose-the-right-model))
- Search and test runs read a lot and conclude little. A smaller model does that job at lower cost and faster. Review and security work is the opposite: little to read, a wrong answer is expensive. Spend there.
- Subagents add tokens. Anthropic measured about 4x the tokens of a chat for an agent and about 15x for a multi-agent system. ([multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)) A cheaper tier on the workers is how the roster keeps that in check.
- Switching the main model mid-session invalidates the prompt cache. ([prompt caching](https://code.claude.com/docs/en/prompt-caching)) A per-agent `model:` leaves the main session alone.
- No price table here. Prices change, and nothing in this skill depends on a number. The rule is only that the lower tier costs less per token.

## Claude Code [SRC]

Source: https://code.claude.com/docs/en/sub-agents#choose-a-model and https://code.claude.com/docs/en/model-config

- `model:` takes an alias (`haiku`, `sonnet`, `opus`, `fable`), a full model ID, or `inherit`. Leaving it out means the subagent uses the main model, unless `CLAUDE_CODE_SUBAGENT_MODEL` is set.
- Resolution order (v2.1.251 and later), first match wins:
  1. the `model` parameter of the call that starts the subagent;
  2. `model:` in the agent file (`inherit` means the main model);
  3. the `CLAUDE_CODE_SUBAGENT_MODEL` environment variable;
  4. the main conversation's model.
- `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` (v2.1.257 and later) makes the variable win over the file and the call.
- Aliases resolve per provider. On the Anthropic API, `opus`, `sonnet` and `haiku` are the 5.5 models. On Bedrock and Vertex, `opus` is 5.5 while `sonnet` and `haiku` are 4.5. On Foundry, `opus` is 4.6. A full ID pins one model on every provider that offers it.
- An alias of the same family as the main model resolves to the main model's exact ID, including a `[1m]` context suffix.
- An organization `availableModels` list is applied. A blocked alias falls back to the newest allowed model of that family, then to the inherited model.
- Do not write full IDs. Aliases stay valid when models roll over.
- `effort:` in the agent file (`low` up to `max`) is the second control. It overrides the session effort, but not `CLAUDE_CODE_EFFORT_LEVEL`. Some models lack the top levels and fall back to a lower one. The skill sets no `effort` by default. Add it for a `deep` agent only when the user asks.
- Skills can also set `model:` and `effort:`. The override lasts for the current turn only.
- A `UserPromptSubmit` hook cannot change the model or effort. It can only add context. That is why the router suggests an agent and the agent's own `model:` does the work. ([hooks](https://code.claude.com/docs/en/hooks#decision-control))

## Other tools

The same tier cannot be written as one value for every tool. Names differ, change often, and depend on the account.

| Tool | Field | Values | Default the skill writes |
|---|---|---|---|
| Codex [SRC] | `model`, `model_reasoning_effort` in `.codex/agents/<name>.toml` | Free-form model slug the account has. Effort is one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`, `persistent` | omitted |
| Gemini CLI [SRC] | `model` in `.gemini/agents/<name>.md` | Any Gemini model string, or `inherit` | `inherit` |
| opencode [SRC] | `model` in `.opencode/agents/<name>.md` | `provider/model-id` | omitted |
| Copilot [SRC] | `model` in `.agent.md` | A string or a list. VS Code uses display names such as `Claude Opus 4.5`. The CLI shows dotted IDs such as `claude-sonnet-4.6` | omitted |
| Cursor [SEARCH] | `model` in `.cursor/agents/<name>.md` | `fast`, `inherit` or a model ID | omitted |

Notes:
- Codex: roles that set a model tell the parent session it cannot change it. The spawn tool says to omit `model` unless the user asks. Defaults for all subagents go in `config.toml` as `default_subagent_model` and `default_subagent_reasoning_effort`.
- Gemini CLI: `/model` and `--model` do not override a subagent's model. A subagent with `model: inherit` follows the session.
- opencode: a subagent with no `model` uses the model of the primary agent that called it.
- Copilot: a list means the first available model is used. The VS Code subagent order is the call's model, then the agent's `model`, then Auto if set, then the main model.

## Recommendation

- For Claude, write the alias from the tier.
- For every other tool, omit the model, or write `inherit` where the tool has it. The agent then runs on the model the user chose. Names differ by tool, account and surface, and they change.
- If the user wants tiers on other tools, they pass a map and the skill writes it into the mirrors:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/sync-agents.mjs" --targets codex,gemini,opencode --model-map fast=<model>,standard=<model>,deep=<model>
```

- Use only model names the user typed. Never fill in a name from memory.
