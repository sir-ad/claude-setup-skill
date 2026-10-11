# Routing

How the router decides which role agent fits a prompt, what it can and cannot do, and why the default has no model in it. Claude reads this before it writes the router hook. Facts checked 2026-10-11. [SEARCH] marks a claim taken from a search summary, not from a page or file that was opened. Figures marked "estimate" are not measured.

## What the router is

A script in `.claude/hooks/route.mjs`, run by a `UserPromptSubmit` hook. It reads the prompt from stdin, scores it against `.claude/router.json` and prints one line of context, for example `Route: frontend agent (tier standard/sonnet), effort medium, plan no, then test-runner. Confidence 0.88. Override by saying 'no routing'.`

- It is advice. The main agent can ignore it, and the user can override it ("use opus", "no routing").
- It adds context only. A `UserPromptSubmit` hook cannot rewrite the prompt and has no field for the model or effort. ([hooks](https://code.claude.com/docs/en/hooks#decision-control)) The model comes from the agent file the main agent then calls.
- It never blocks. On any error it exits 0 and prints nothing.
- It makes no network call by default and needs nothing beyond Node.

## Order of decision

1. Rules, always. They score four kinds of evidence per role:
   - file paths in the prompt that match the role's scope globs: 3 points each, split 3/n when n roles share the glob;
   - keywords from `.claude/router.json`: 1 point each, 2 when the keyword is the role's own name;
   - a built-in term list per kind of role (ui, endpoint, migration, deploy, flaky and so on): 0.5 each;
   - a stack frame in pasted output: the first project frame counts, later ones count less.

   A negated mention ("don't touch the ui") does not count. The script then computes `confidence = strength x margin factor`. Strength is `1 - exp(-(evidence + 0.4 if the prompt has a change verb) / 1.6)`. The margin factor is `0.4 + 0.6 x margin`, where margin is the lead of the best role over the runner-up.
2. A decision to delegate needs confidence of at least 0.55, an effort above low, and a prompt that is not a question or a short follow-up. The threshold came from a sweep over the test prompts: the lowest value with no wrong delegations. It is stored as `thresholds.confidence` in `.claude/router.json`.
3. When the prompt touches more than one layer, the primary role is the lowest layer (data, then backend, then frontend). `delegate` is false and `plan` is true, so the main agent orchestrates. The `qa` flag is true on any change verb. QA is the primary role only when the request is mainly about tests.
4. Local model, only if enabled and rule confidence is under the threshold. One short call with a timeout of at most 1500 ms. The rules keep a veto over roles the prompt negated, and the model can raise effort but never lower it. Any failure falls back to the rules silently.
5. A cheap model call is not built into the script. When the goal is large and confidence is still low, the main agent can send a `haiku` explorer to look first. That costs a subagent context and a few seconds, so it is not worth it for routine edits.

Questions and short follow-ups ("yes", "do it") get no delegation. Words such as auth, payment, migration or security raise effort to high, which sets `plan` to yes. A delegated risky task moves to the `deep` tier. Pasted logs, stack traces and long fenced blocks are separated from the prose and down-weighted, so their words do not swamp the keyword counts. The script reads at most about 24,000 characters (the first 14,000 and the last 8,000) and at most 40 file paths. A non-English prompt gets low confidence and goes to the main session.

To skip the router for one prompt, write "no routing" or "/noroute". `CLAUDE_SETUP_ROUTER=off` turns it off.

## Why not a model by default

Anthropic's own guidance lists routing as a pattern for distinct categories that can be classified reliably. ([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)) Rules do that with no install. The learned options below were read in the research for this skill. None of them is trained on coding-agent roles, and each costs a download or a daemon.

| Option | Size and install | Latency | Why not the default |
|---|---|---|---|
| Laya ([repo](https://github.com/NandhaKishorM/laya)) | ModernBERT-large, 421M parameters. All three checkpoints about 2.3 GB. Needs Python 3.10+, torch, transformers and a Hugging Face download | 192-453 ms warm for 4 questions on a 28-thread CPU. 7-10 s to load a checkpoint | About 3 weeks old at the time (0.1.0 on 2026-09-18, 38 releases to 2026-10-10, classified Beta). Base checkpoints scored near chance zero-shot on its own typed-decision set. Its router preset is a generic small-model versus large-model question, not roles. The JS packages named in its README were not on npm |
| Strands Decider 2B ([repo](https://github.com/strands-labs/strands-decider)) | 1.9B parameters. About 4.5 GB base model downloaded on first use. torch 2.7+. Peak about 8.3 GB of memory on CPU | 115-153 ms on a GPU or Apple GPU. 3.3-5.4 s on an M3 Pro CPU. A third-party Claude Code hook measured 4 s to load per process | PyPI 0.1.0, released 2026-10-01 and described as "An experimental typed classifier". A third-party test found the server crashed on prompts over 4096 tokens and under concurrent requests. Good as a resident server, not as a one-shot hook |
| Jev (TypeSafe AI) | Hosted | 70-500 ms over the network [SEARCH] | Needs network and an API key |
| Arch-Router-1.5B | About 1.1-1.6 GB as a community GGUF [SEARCH] | CPU latency not documented | License terms were not read. Not bundled |
| RouteLLM | Python, torch, an OpenAI key for embeddings | | Strong versus weak model only. Last release 2024-07 |

Sources: the Laya README and PyPI JSON, the Strands Decider README, `docs/inference.md` and `evaluation/results.md`, and a [third-party Claude Code hook test](https://github.com/tusharck/strands-decider-code-checker). A hook that waits on a multi-second load makes every prompt slower. In a cloud or sandboxed session a Hugging Face download may be blocked altogether.

## Accuracy and failure modes

No benchmark exists for routing coding-agent prompts. These are estimates from the research, to set expectations:

- Role: about 75-85% agreement with a person on clear prompts, 50-60% on terse follow-ups ("fix it", "do that").
- Tier and effort are subjective. Expect about 60-70% exact agreement and about 90% within one step.
- Plan or not: about 75-80% when risk and size rules exist.

Known misses:
- Negation: "don't refactor, just rename".
- Two intents in one prompt.
- Follow-up turns that depend on the conversation.
- Non-English prompts, and quoted code that matches a keyword.
- A repo whose scopes overlap, such as a full-stack framework where `app/` holds both UI and server code. The router then reports low confidence.

Errors are not symmetric. Sending a hard task to a cheap tier costs retries. The rules lean to the higher tier on doubt, and low confidence means "main agent decides". The router names the rules that matched, so a wrong route is easy to see: `node .claude/hooks/route.mjs --explain "<prompt>"`.

## Privacy

- The hook runs on the user's machine. With the default backend nothing leaves it.
- The log `.claude/route-log.jsonl` is written only when `.claude/router.json` exists and has `"log": true`. A line holds a timestamp, a 12-character hash of the prompt, its length and the decision fields (role, agent, tier, model, effort, plan, delegate, qa, confidence, backend). It never holds prompt text or the reasons. The file is gitignored.
- A backend receives the first 1500 characters of the prompt. With Ollama or a local Decider server that stays on the machine. If you point `CLAUDE_SETUP_ROUTER_URL` or `CLAUDE_SETUP_DECIDER_URL` at a remote host, the prompt goes there.

## Enabling a backend

Both are off by default and fall back to the rules on any error. Set the variables in the shell or in the `env` key of settings.

Ollama (a 1.5B model; about 1 GB per a third-party size table):
```sh
ollama pull qwen2.5:1.5b
export CLAUDE_SETUP_ROUTER=ollama
export CLAUDE_SETUP_ROUTER_MODEL=qwen2.5:1.5b
```
The script calls `http://127.0.0.1:11434/api/chat` with a JSON schema for the answer and temperature 0. `CLAUDE_SETUP_ROUTER_URL` overrides the endpoint. It never pulls a model. Ollama must already be running. The call has a timeout of 1500 ms, and `CLAUDE_SETUP_ROUTER_TIMEOUT_MS` can lower it but not raise it. Warm latency for a model this size on a laptop CPU is an estimate of 0.3-1.5 s. A 1.5B model is about as good as the rules on role and weaker on tier and effort, so it only helps on terse prompts.

Strands Decider (needs a machine with a GPU or Apple GPU and about 5 GB free):
```sh
pip install strands-decider
strands-decider serve StrandsAgents/strands-decider-2B-hobson-v19 --port 8000
export CLAUDE_SETUP_ROUTER=decider
export CLAUDE_SETUP_DECIDER_URL=http://localhost:8000/v1/systemone
```
The script posts to the URL exactly as given, so include the endpoint path. It uses the answer only when the rules were under the threshold. Treat it as an experiment until the project leaves 0.1.

## Tuning with --update

`/claude-setup --update` re-derives the roster from the repo, so scopes follow new directories and frameworks. It also reads `.claude/route-log.jsonl` for counts only: how often each role matched, how often confidence was under the threshold, and which backend answered. From that it proposes changes to `.claude/router.json`: drop a route that never fires, add a keyword for a role that is often a near miss, move a threshold. It shows the diff and waits for a yes.

It cannot learn from the wording of prompts, because the text is not stored. To fix a repeated miss, add the keyword to the role in `.claude/router.json` by hand, or tell the skill which role the prompt should have gone to.
