# Template: Node single project (one package.json)

Reference for `/claude-setup` when `package.json` has no `workspaces` field.

## Detection signals
- Single `package.json`.
- Often: `next.config.js`, `vite.config.ts`, `astro.config.mjs`, `nuxt.config.ts`, `remix.config.js`, or plain Express/Fastify/Hono.

## Detect framework

- `next` in deps → Next.js (note App Router vs Pages Router by checking `app/` vs `pages/`)
- `vite` → Vite (often React/Vue/Svelte — check `@vitejs/plugin-*`)
- `astro` → Astro
- `nuxt` → Nuxt
- `@remix-run/*` → Remix
- `express`/`fastify`/`hono`/`koa` → backend framework
- None of the above → plain Node CLI/lib

The framework determines half the rules. Note it.

## CLAUDE.md should include

Same shape as `node-monorepo.md`, single project. Add framework one-liner:
```md
- Framework: Next.js 15 (App Router) | Vite + React | Astro | ...
```

## settings.json permissions

Same as monorepo template, drop turbo/nx allows.

For Next.js, add:
```
"Bash(next dev *)",
"Bash(next build)",
"Bash(next start)"
```

## Path-scoped rules

- Next.js App Router: `app/**/*.tsx`, `app/**/*.ts` — server vs client component rule, async server components rule.
- API routes: `app/api/**/route.ts` (Next.js) or `pages/api/**` — request/response shape rule if documented.
- Tests: `**/*.test.ts(x)` — only if conventions are non-obvious.

Default for plain Express/Fastify: probably no rules. Keep CLAUDE.md tight instead.

## Code-reviewer subagent

Same as `node-monorepo.md`. Mention framework-specific items (server actions, RSC boundaries) if applicable.

## Skills to generate

- `/release` if version + CHANGELOG.
- `/preview-deploy` if Vercel/Netlify detected.
- `/db-migrate` if Prisma/Drizzle/Knex detected.

Skip if none apply.

## .worktreeinclude

Same as monorepo template.
