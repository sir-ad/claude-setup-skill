# Example: acme-saas (Node monorepo, pnpm + turbo)

This is what `/claude-setup` produced for a typical SaaS Node monorepo. The project is fictional. Use it to see how `templates/node-monorepo.md` and the `knowledge/` notes turn into actual files.

## What the detector found

From `node scripts/detect.mjs .`:

- `primary: node`, `layout: monorepo`, `packageManager: pnpm`
- `workspaces`: `apps/web`, `apps/api`, `packages/db`, `packages/ui`
- `frameworks`: `next 15`, `react 19`, `tailwindcss 4`, `turbo 2`, `hono`, `drizzle-orm`, `vitest`, `prettier`
- `commands`: install, build, test, lint, typecheck and dev, each with its source (`package.json#scripts.*` or `.github/workflows/ci.yml`)
- `agentConfigs`: `.cursor/rules/` exists, so Cursor is selected next to Claude
- `versionFiles`: `package.json`, with `CHANGELOG.md` and `.changeset/` present, so a `/release` skill is justified
- `infra`: `vercel: true`, so a `/preview-deploy` skill is justified
- `hardRuleCandidates` from `README.md`: "PII never in logs", "Drizzle migrations are append-only", "App Router only", and two more that the skill dropped as marketing text

## Files written

```
acme-saas/
├── AGENTS.md                          # source of truth, read by every agent
├── CLAUDE.md                          # @AGENTS.md + one Claude-only line
├── .worktreeinclude                   # .env, .env.local, CLAUDE.local.md
├── .cursor/rules/                     # mirrors of .claude/rules, via sync-rules.mjs
│   ├── web-next.mdc
│   ├── api-hono.mdc
│   └── db-drizzle.mdc
└── .claude/
    ├── settings.json                  # pnpm/turbo/git allows; force-push and .env denies
    ├── rules/
    │   ├── web-next.md                # apps/web/**: App Router, RSC vs client, server actions
    │   ├── api-hono.md                # apps/api/**: Hono handlers, env via wrangler
    │   └── db-drizzle.md              # packages/db/**: schema + append-only migrations
    ├── agents/
    │   └── ts-reviewer.md             # Read/Grep/Glob; TS strict, RSC, PII checks
    └── skills/
        ├── release/SKILL.md           # changeset version, build, test, tag
        └── preview-deploy/SKILL.md    # vercel deploy + smoke check
```

`.gitignore` got `CLAUDE.local.md`, `.claude/settings.local.json` and `.claude/worktrees/` appended. No formatter hook: the user answered no in the plan step.

## AGENTS.md (excerpt)

```markdown
# acme-saas

TypeScript monorepo. pnpm workspaces + Turborepo. Next.js 15 (apps/web), Hono (apps/api), Drizzle + Postgres (packages/db).

## Commands
- Install: `pnpm install --frozen-lockfile`
- Build: `pnpm run build`
- Test: `pnpm test`
- One package: `pnpm -C packages/ui run test`
- Lint: `pnpm run lint`
- Typecheck: `pnpm run typecheck`
- Dev: `pnpm run dev`

## Hard rules
- "PII never in logs." (README.md:41)
- "Drizzle migrations are append-only." (README.md:57)
- "App Router only. No Pages Router." (README.md:63)

## Version notes
- Next.js 15: `cookies()`, `headers()`, `params` and `searchParams` are async. Await them.
- Next.js 15: `fetch` responses are not cached by default. Opt in where you want caching.
- Tailwind 4: configuration lives in CSS (`@import "tailwindcss"`, `@theme`). Don't add a `tailwind.config.js` unless the repo already has one.
- Turborepo 2: tasks go under `tasks` in `turbo.json`. The old `pipeline` key is gone.

## Boundaries
- Never: edit applied files in `packages/db/migrations/`; commit `.env*`.
- Ask first: new dependencies; changes to the database schema.
```

Every command above has a source in the detector output. The version notes appear because the project declares those majors. A repo on Tailwind 3 would get no Tailwind note.

## CLAUDE.md

```markdown
@AGENTS.md

## Claude Code
Use plan mode for changes under `packages/db/`.
```

Claude Code reads AGENTS.md on its own only when no CLAUDE.md exists. The import makes sure it still gets read.

## Hard rules and where they went

| Source phrase | Encoded as |
|---|---|
| "PII never in logs" | AGENTS.md Hard rules + `agents/ts-reviewer.md` checklist |
| "Drizzle migrations are append-only" | AGENTS.md Hard rules + `rules/db-drizzle.md` |
| "App Router only. No Pages Router." | AGENTS.md Hard rules + `rules/web-next.md` |
| "Server Actions for mutations, RSC for reads" | `rules/web-next.md` |
| "Hono on Cloudflare Workers, no Node-only deps" | `rules/api-hono.md` |

## What was skipped, and why

- `.claude/output-styles/`: no use case
- `.claude/commands/`: skills cover it
- `.claude/agent-memory/`: filled in automatically when subagents run
- `/db-migrate` skill: `drizzle-kit push` is one command; a skill would only wrap it
- `ui-shadcn.md` and `tests.md` rules: the conventions are standard, so AGENTS.md needs no extra file
- `.github/copilot-instructions.md`: Copilot reads AGENTS.md on its own

## What this looks like in practice

- Open `apps/web/app/(marketing)/page.tsx` in Claude Code: `web-next.md` enters context.
- Open `apps/api/src/routes/users.ts`: `api-hono.md` loads, `web-next.md` does not.
- Run `/release patch`: bumps versions through changesets, builds, tests, tags.
- Run `/preview-deploy`: `vercel deploy`, then a smoke check on the URL.
- Ask Codex or Copilot the same question: they read the same AGENTS.md.

Verify: `/memory` in Claude Code shows AGENTS.md imported through CLAUDE.md.
