# Writing agent files

How to write the content of AGENTS.md, CLAUDE.md and rules. The test for every line: would removing it cause a mistake? If not, cut it.

Sources: https://code.claude.com/docs/en/best-practices , https://code.claude.com/docs/en/memory , https://developers.openai.com/codex/learn/best-practices , https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/ , https://github.com/agentsmd/agents.md (the last two via search summaries).

## What helps

- **Exact commands.** Copy-pasteable, with flags, in the order to run them: install, build, test, lint, typecheck, dev. Agents run the commands you list, so list only ones that work. Take them from the detector, not memory.
- **How to run one test.** The single most useful line in most repos. Write it only when you know the runner and the form.
- **Boundaries.** Three tiers: always do, ask first, never do. Typical: never edit generated code or applied migrations; ask before adding a dependency or changing a schema; never commit secrets.
- **Conventions that differ from the language default.** One tiny code example beats a paragraph of description.
- **Gotchas learned the hard way.** Required env vars (names only), ports, slow commands and their timeouts, tests that need a service, order dependencies ("run codegen before typecheck").
- **Where things live,** for non-obvious directories only. One line each.
- **Hard rules with their source.** Quote the rule and cite `file:line`, so a reader can check it.
- **Pointers.** "See docs/architecture.md" instead of pasting it.
- **Version notes.** Only for the exact versions the project pins, one line each, phrased as what to do or avoid.

## What hurts

- Generic advice: "write clean code", "follow best practices", "add tests".
- Long prose and tutorials. Headings and short bullets work better than paragraphs.
- Restating the README or listing every file.
- Rules a linter or formatter already enforces. Point to the config instead.
- Stale facts: hand-copied dependency lists, counts, dates, versions the project has moved past.
- Commands nobody ran: invented scripts, wrong package manager, wrong flags.
- Contradictions between files. When two files disagree, the agent may follow either one.
- Secrets, tokens, `.env` values, private URLs. Name a variable (`DATABASE_URL`), never give its value.
- Persona text ("you are a senior engineer") and shouting. Use IMPORTANT sparingly.
- Version notes for a version the project does not use.

## Skeleton

```markdown
# <project>

<One line: what it is, language, framework, package manager.>

## Commands
- Install: `pnpm install --frozen-lockfile`
- Test: `pnpm test`
- One test: `pnpm vitest run path/to/file.test.ts`
- Lint: `pnpm run lint`
- Dev: `pnpm run dev`

## Repo map
- `apps/web/`: Next.js app
- `packages/db/`: schema and migrations

## Conventions
- <Only what differs from defaults.>

## Hard rules
- "Packages must not import from apps." (README.md:5)

## Version notes
- <Library X major N: one line, what to do or avoid.>

## Boundaries
- Never: edit `packages/db/migrations/` by hand; commit `.env*`.
- Ask first: new dependencies; schema changes.
```

Drop any section with nothing real in it. Do not pad.

## Size

- Claude Code: under 200 lines per CLAUDE.md file. The recommendation counts each file, rule and import separately. Imports do not reduce context.
- AGENTS.md: aim for 150 lines or fewer. Codex stops reading at 32 KiB of combined project docs by default.
- Copilot: one instruction file should stay under about 1,000 lines. Quality drops past that.
- Windsurf: 12,000 characters per rule file (search summary; re-verify).
- When a file grows, split by area. Scoped rules in `.claude/rules/`, or a nested AGENTS.md in a package that has its own commands. The closest AGENTS.md wins.

## Where each kind of content goes

| Content | Place |
|---|---|
| Commands, repo map, conventions, hard rules, version notes | AGENTS.md |
| Claude-only habits (plan mode for a directory) | CLAUDE.md, below the import |
| Conventions for one directory or file type | `.claude/rules/` with `paths:`, mirrored by `sync-rules.mjs` |
| A multi-step procedure you repeat | a skill |
| Something that must always hold | `permissions` in settings, or a hook. Prose is advice |
| Your personal preferences | `CLAUDE.local.md` or `~/.claude/CLAUDE.md`, not the repo |

## Style

- Imperative, specific, verifiable: "Run `pnpm test` before committing", not "make sure tests pass".
- Include the reason when it is not obvious. "Migrations are append-only: production replays them in order."
- One topic per bullet. No nested bullets deeper than one level.
- No emoji, no marketing words, no humor.
- Add a rule when the same mistake happened twice, not in advance. Prune when a rule stops earning its line.
