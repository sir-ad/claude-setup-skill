# Template: Node single project

Use for one `package.json` with no workspaces: web apps (Next.js, Vite, Astro, Nuxt, Remix, SvelteKit), backends (Express, Fastify, Hono, NestJS), CLIs and libraries. Bun projects use this template too. Deno-only projects (`primary: "deno"`) use `generic.md`.

## Detection signals
- `primary: "node"` and `layout: "single"`.
- `packageManager` is `pnpm`, `npm`, `yarn` or `bun`. Use it in every command.
- `frameworks` names the project type: `next`, `vite`, `astro`, `nuxt`, `remix`, `react-router`, `sveltekit`, `angular`, `express`, `fastify`, `hono`, `nestjs`. No framework entry means a plain CLI or library.
- Tooling entries: `vitest`, `jest`, `playwright`, `eslint`, `biome`, `prettier`, `tailwindcss`, `prisma`, `drizzle-orm`.
- `commands` comes from `package.json` scripts. Copy it.

## AGENTS.md
- **Commands**: the detector's install, dev, build, test, lint, typecheck, format. If e2e and unit tests are separate scripts, list both with one line on when to run each.
- **Repo map**: the source root (`src/`, `app/`, `pages/`, `lib/`), the test location, config that matters. For app frameworks name the routing directory.
- **Conventions worth writing**: module system (ESM or CJS) when it is not obvious from `package.json` `type`; path alias from `tsconfig`; where env vars are read and validated; the data layer (Prisma, Drizzle) and where queries live; styling system. Only what differs from framework defaults.
- **Version notes**: pull from `knowledge/node.md` for the detected Node, backend framework and test runner versions, and from `knowledge/frontend.md` when a UI framework (`next`, `react`, `vite`, `tailwindcss` and so on) is detected. Router type (App Router vs Pages Router) is a repo fact: read it from the directory layout and write it as a convention.
- **Boundaries**: lockfile through the package manager only. No edits to build output (`dist/`, `.next/`, `.output/`, `build/`). Ask before changing migrations or generated clients. Never read or write `.env*`. If the repo is a library, say that changes to exported types and `exports` in `package.json` are public API changes.

## CLAUDE.md
`@AGENTS.md` on the first line. Nothing else unless the user has Claude-only lines.

## .claude/settings.json
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(<pm> install)",
      "Bash(<pm> run *)",
      "Bash(git add *)",
      "Bash(git commit *)"
    ],
    "ask": ["Bash(git push *)"],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force *)",
      "Bash(git push -f *)",
      "Bash(git reset --hard *)",
      "Bash(<pm> publish *)",
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./**/*.pem)"
    ]
  }
}
```
- Add `Bash(<pm> test *)` when the pm has a `test` shortcut and `scripts.test` exists.
- For library packages, also deny `Bash(npm publish *)` even when the pm is not npm.
- Deny `Bash(<pm> run deploy*)` for deploy scripts that appear in `commands.other`.
- Do not allow `npx *` or `node *`. Allow the exact tool invocations in the detector output instead.
- `Read(./.env.*)` also blocks `.env.example`. When the detector's `env.files` lists an example file, deny the real env files by name instead (for example `Read(./.env.local)`, `Read(./.env.production)`) so the example stays readable.

## Formatter hook (optional)
Only when `prettier` or `biome` is in `frameworks` and the user says yes. Needs `jq`.
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path' | xargs -r npx --no-install prettier --write --ignore-unknown"
          }
        ]
      }
    ]
  }
}
```
For biome use `biome format --write`. For bun use `bunx` in place of `npx --no-install`. Without `jq`: `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const f=JSON.parse(s).tool_input.file_path;if(f)require('child_process').spawnSync('npx',['--no-install','prettier','--write','--ignore-unknown',f])})"`

## Path-scoped rules
Default is none for a plain backend or library. Keep conventions in AGENTS.md. Mirror rules to other tools with `node "${CLAUDE_SKILL_DIR}/scripts/sync-rules.mjs" --targets <tools>`.
- App framework with a routing directory (`app/**`, `pages/**`, `src/routes/**`): one rule when the repo has a documented split such as server vs client components, or loader and action conventions.
- API route files (`app/api/**/route.ts`, `pages/api/**`, `src/routes/api/**`) when a response or error shape is documented.
- Database folder (`prisma/**`, `drizzle/**`) when migrations are checked in: say how to create one and that applied migrations are not edited.
- `**/*.test.ts(x)` only when test conventions are non-obvious.

## Reviewer subagent
These are candidate checks, not defaults. Keep a line only when a repo fact backs it (lint or type config, a documented rule, a hard rule, a detected version), and grep the repo first: if the code already uses a pattern on purpose, drop the line or scope it with the exception.

`.claude/agents/ts-reviewer.md`, frontmatter `name: ts-reviewer`, `description: Reviews TypeScript and JavaScript changes for type safety, async mistakes and framework boundary errors. Use after editing source files.`, `tools: Read, Grep, Glob`.
1. If the lint config bans `any` or `@ts-ignore`, flag new uses in changed lines.
2. If the lint config enables a floating-promise rule, flag violations it would catch.
3. If the repo validates input with a schema library (zod, valibot and the like), flag request bodies or query params that skip it.
4. Secrets and server-only values are not referenced from client-bundled code.
5. For React code: hooks called conditionally, effects used to derive state, missing keys, state set during render.
6. For app frameworks: code in the wrong side of the server/client split for the detected framework (check `knowledge/frontend.md` for the version's rules).
7. SQL or ORM calls built from string concatenation with user input.
8. Tests: no `.only`. Skipped tests need a reason.

## Skills
- `release`: when `versionFiles` has `package.json` with a version and a changelog, or `.changeset/`, or a release tool config. Use the repo's real release commands.
- `db-migrate`: when Prisma, Drizzle or Knex is present and the flow takes more than one command.
- `preview-deploy`: when `infra.vercel`, `infra.netlify` or `infra.cloudflareWorkers` is true and deploys need extra steps.
- Nothing else. A single script does not need a skill.

## .worktreeinclude
List only entries in `env.gitignored` (`.env`, `.env.local`, `.claude/settings.local.json`, `CLAUDE.local.md`, `.mcp.json`), plus `.env.development.local` when the repo uses it. Skip the file when the list is empty.

## What NOT to generate
- No rules directory for a plain Express, Fastify or CLI project.
- No `output-styles/`, `commands/` or `agent-memory/`.
- No framework-version claims in templates or in AGENTS.md unless they come from `knowledge/node.md` or `knowledge/frontend.md` for the detected version.
- No `Bash(*)`, no `defaultMode` of `auto` or `bypassPermissions`.
