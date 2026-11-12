# acme

TypeScript monorepo. pnpm workspaces + Turborepo. Next.js 15 (apps/web).

## Commands
- Install: `pnpm install --frozen-lockfile`
- Build: `pnpm run build`
- Test: `pnpm test`
- One package: `pnpm -C packages/ui run test`
- Lint: `pnpm run lint`
- Dev: `pnpm run dev`

## Hard rules
- "Packages must not import from apps. Never import `apps/*` inside `packages/*`." (README.md:7)

## Version notes
- Next.js 15: `cookies()`, `headers()`, `params` and `searchParams` are async. Await them.
- Turborepo 2: tasks go under `tasks` in `turbo.json`. The old `pipeline` key is gone.

## Boundaries
- Never: commit `.env*`.
- Ask first: new dependencies.
