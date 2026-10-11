# Blueprint: UserPromptSubmit router hook

A local script that reads each prompt, matches it against the roster's routes and adds one line of advice to the context: which role agent fits, which tier, whether to plan. It never blocks a prompt and never changes the model. Claude Code only. Other tools get the `## Routing` table in `AGENTS.md` (see `agents-md-routing.md`).

The router is written by `emit.mjs --write router`, never by hand. The model writes nothing in this blueprint except the rest of `.claude/settings.json`.

## When to write
- Default yes when the roster has at least one role agent. Show it in the plan as a default-yes item with this one-line explanation: "runs a local script on each prompt, no network, adds a one-line routing hint".
- Skip with `--no-router`, `--skip-pipeline` or `--minimal`. Skip if the user answers no in the plan.
- It runs a command, so print the exact settings JSON in the plan, as with every hook.
- If `.claude/hooks/route.mjs` exists and differs from the skill's copy, the plan shows the difference before Proceed.

## Inputs
- The skill's script, copied by emit.mjs: `${CLAUDE_SKILL_DIR}/scripts/router/route.mjs`.
- Router config: built by emit.mjs from `roster.mjs` (the same roster as the Agent roster section). With `--intent`, pass the same `--intent` to emit.mjs. It holds roles (paths and keywords), tiers, the confidence threshold (0.55) and `log`.
- The planned `.claude/settings.json` (the model writes it without the router hook) and `.gitignore`.
- Whether `hooks.UserPromptSubmit` already exists. If so, emit.mjs appends an entry. It never replaces one.

## Rules
- emit.mjs writes the router as one unit, all or nothing:
  - `.claude/hooks/route.mjs`: a byte copy of `scripts/router/route.mjs`. Never edit it, reformat it or add comments. The project must run without the skill installed.
  - `.claude/router.json`: the router config. Commit it with the hook.
  - `hooks.UserPromptSubmit` in `.claude/settings.json`: merged, with every existing key and hook kept.
  - `.claude/route-log.jsonl` in `.gitignore`.
  If any part fails, none is written and the report says so.
- Never write `route.mjs`, `router.json` or the hook entry by hand, and never with a `node -e`, `cp` or shell redirect. A refused write follows Phase 4 staging: emit.mjs runs with `--stage`, and the report lists the staged files and `node .claude-setup/apply.mjs`.
- Event `UserPromptSubmit` has no matcher. Handler type `command`. Use the command and timeout below. A `UserPromptSubmit` hook defaults to 30 seconds. The script answers in well under a second, so 5 seconds is a safe ceiling. On timeout the hint is dropped and the prompt still goes through. ([hooks](https://code.claude.com/docs/en/hooks#userpromptsubmit))
- The hook can only add context. It cannot rewrite the prompt or change the model or effort. State this in the plan if asked. ([hooks](https://code.claude.com/docs/en/hooks#decision-control))
- `.claude/route-log.jsonl` is in `.gitignore`. The script logs only when the config has `"log": true` and a config file was found. A line holds a timestamp, a 12-character hash of the prompt, its length and the decision fields (role, agent, tier, model, effort, plan, delegate, qa, confidence, backend). It never holds prompt text or reasons.
- Optional backends are off by default. Mention them in the final report, not in the settings:
  - `CLAUDE_SETUP_ROUTER=ollama`: asks a local Ollama model when rule confidence is under the threshold. `CLAUDE_SETUP_ROUTER_MODEL` picks the model. `CLAUDE_SETUP_ROUTER_URL` overrides the endpoint.
  - `CLAUDE_SETUP_ROUTER=decider`: asks a running Strands Decider server at `CLAUDE_SETUP_DECIDER_URL`.
  - `CLAUDE_SETUP_ROUTER_TIMEOUT_MS` can lower the 1500 ms timeout. It cannot raise it.
  - `CLAUDE_SETUP_ROUTER=off` disables the router.
  - Set them in the shell or in the `env` key of settings. Any backend failure falls back to the rules. See `reference/routing.md`.
- How to turn it off, for the final report: write "no routing" or "/noroute" in a prompt to skip it once, set `CLAUDE_SETUP_ROUTER=off`, or remove the `UserPromptSubmit` entry from `.claude/settings.json`.
- Check after writing (not after a staged write, when the hook is not yet in place): `node .claude/hooks/route.mjs --explain "<a prompt from the repo's domain>"` prints the decision and the rules that matched. Run it once and include one line of its output in the report.
- No other hooks. No network calls from the hook by default.

## Skeleton
This is the merged entry emit.mjs adds under the top-level `hooks` key of `.claude/settings.json`. Show it verbatim in the plan:
```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/route.mjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

The `.gitignore` line that emit.mjs appends:
```text
.claude/route-log.jsonl
```

Example of what the model sees on a prompt (the wording comes from the script):
```text
Route: frontend agent (tier standard/sonnet), effort medium, plan no, then test-runner. Confidence 0.88. Override by saying 'no routing'.
```
When confidence is under the threshold the hint says so: `Route: handle in main session ... Closest role: backend, not confident enough to delegate.`
