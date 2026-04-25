# Example: acme-saas (Node monorepo, pnpm + turbo)

This is what `/claude-setup` produced for a typical SaaS Node monorepo. Useful as a reference for how `templates/node-monorepo.md` translates into actual files.

## Inputs the skill detected

- `package.json` with `"workspaces": ["apps/*", "packages/*"]`
- `pnpm-lock.yaml` at root → pnpm
- `turbo.json` at root → turborepo
- `apps/web/package.json` depends on `next@15` → App Router
- `apps/api/package.json` depends on `hono` + `wrangler` → Cloudflare Workers
- `packages/db/` with `drizzle.config.ts` → Drizzle + Postgres
- `packages/ui/` with `components.json` → shadcn/ui
- `CHANGELOG.md` + `.changeset/` → `/release` skill is justified
- `vercel.json` at `apps/web` → `/preview-deploy` skill is justified
- README mentions: "PII never in logs", "Drizzle migrations are append-only", "App Router only"

## Files generated

```
acme-saas/
├── CLAUDE.md                          # stack + commands + hard rules
├── .worktreeinclude                   # .env, CLAUDE.md, .mcp.json
└── .claude/
    ├── settings.json                  # pnpm/turbo/git/gh allows, force-push deny
    ├── rules/
    │   ├── web-next.md                # apps/web/** — App Router, RSC vs client, server actions
    │   ├── api-hono.md                # apps/api/** — Hono handlers, env via wrangler
    │   ├── db-drizzle.md              # packages/db/** — schema + append-only migrations
    │   ├── ui-shadcn.md               # packages/ui/** — composability, no app-specific logic
    │   └── tests.md                   # **/*.test.ts — vitest, no live DB in unit tests
    ├── agents/
    │   └── ts-reviewer.md             # read-only Read/Grep/Glob; TS strict + RSC + PII checks
    └── skills/
        ├── release/SKILL.md           # changeset version → build → test → tag
        └── preview-deploy/SKILL.md    # vercel deploy + smoke check
```

## What was skipped (and why)

- `.claude/output-styles/` — no use case
- `.claude/commands/` — skills supersede per Anthropic docs
- `.claude/agent-memory/` — populated automatically when subagents run
- `/db-migrate` skill — `drizzle-kit push` is one command; a skill would just wrap it

## Hard rules extracted from README

The skill scraped these phrases and encoded each in the appropriate file:

| Source phrase | Encoded as |
|---|---|
| "PII never in logs" | `CLAUDE.md` Hard rules + `agents/ts-reviewer.md` checklist |
| "Drizzle migrations are append-only" | `rules/db-drizzle.md` |
| "App Router only — no Pages Router" | `rules/web-next.md` |
| "Server Actions for mutations, RSC for reads" | `rules/web-next.md` |
| "Hono on Cloudflare Workers — no Node-only deps" | `rules/api-hono.md` |

## What this looks like in practice

After install:

- Open `apps/web/app/(marketing)/page.tsx` → `web-next.md` enters context.
- Open `apps/api/src/routes/users.ts` → `api-hono.md` loads, `web-next.md` does not.
- Run `/release patch` → bumps versions via changeset, builds, tests, tags.
- Run `/preview-deploy` → `vercel deploy` + smoke-checks the resulting URL.
- `@ts-reviewer review the diff` → read-only review hits TS strict, RSC boundary, PII grep.

Total config: 9 files under `.claude/`, ~480 lines. One CLAUDE.md, one .worktreeinclude. No bloat.
