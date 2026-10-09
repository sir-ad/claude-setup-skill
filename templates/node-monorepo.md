# Template: Node monorepo

Use when the repo has npm, yarn, pnpm or bun workspaces, or turbo, nx or lerna config. Read this to decide what to generate, then phrase everything in terms of the actual repo.

## Detection signals
- `primary: "node"` and `layout: "monorepo"`. `workspaces` lists member paths.
- `packageManager` is `pnpm`, `npm`, `yarn` or `bun`. Use it in every command. If `warnings` reports conflicting lockfiles, ask one question before writing anything.
- `frameworks` entries `turbo`, `nx`, `next`, `vite`, `vitest`, `jest`, `prettier`, `biome`, `eslint`, `prisma`, `drizzle-orm` decide the sections below.
- `commands` comes from root and member `package.json` scripts. Copy it, do not rewrite it.

## AGENTS.md
- **Commands**: the detector's commands for install, build, test, lint, typecheck, dev. Add the per-workspace form so agents do not run the whole repo for a one-package change: `pnpm --filter <pkg> run test`, `turbo run test --filter=<pkg>`, `npm run test -w <pkg>`, `yarn workspace <pkg> run test`. Check the form against the detected package manager.
- **Repo map**: group `workspaces` by parent directory (`apps/`, `packages/`, `services/`). One line of role per member, taken from its `description` or README. Add the dependency direction only if a doc states it (for example apps may import packages, never the reverse).
- **Conventions worth writing**: how internal packages are referenced (`workspace:*` or a path alias, read it from an existing `package.json`); where a new dependency is added (the member, not the root, unless it is tooling); which test runner each member uses when they differ; TypeScript project references or path aliases if `tsconfig` uses them.
- **Version notes**: pull from `knowledge/node.md` for the detected Node, orchestrator and package manager versions, and from `knowledge/frontend.md` when a UI framework (`next`, `react`, `vite`, `tailwindcss` and so on) is detected. Do not write version claims from memory.
- **Boundaries**: never hand-edit the lockfile; change it through the package manager. Do not edit build output (`dist/`, `.next/`, `.turbo/`, `.nx/`). Ask before touching migration folders or generated clients (Prisma, Drizzle, GraphQL codegen) when detected. Never read or write `.env*`.

## CLAUDE.md
`@AGENTS.md` on the first line. Add Claude-only lines only if the user has them. Usually nothing else.

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
- Add `Bash(turbo run *)` only if `turbo` is detected, `Bash(nx run *)` only for nx. Use `Bash(<pm> test *)` if the pm has a test shortcut.
- Deny `Bash(<pm> run deploy*)`, `release*` and `publish*` for any such script that appears in `commands.other`.
- Do not allow `npx *` or `node *`. They run arbitrary code. Allow the exact tools from the detector instead.
- `Read(./.env.*)` also blocks `.env.example`. When the detector's `env.files` lists an example file, deny the real env files by name instead (for example `Read(./.env.local)`, `Read(./.env.production)`) so the example stays readable.

## Formatter hook (optional)
Only when `prettier` or `biome` is in `frameworks` and the user says yes in the plan step. Needs `jq`.
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
For biome use `biome format --write` instead. Without `jq`, use: `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const f=JSON.parse(s).tool_input.file_path;if(f)require('child_process').spawnSync('npx',['--no-install','prettier','--write','--ignore-unknown',f])})"`

## Path-scoped rules
Default is zero to two. Add one only when the condition holds. Mirror them to other tools with `node "${CLAUDE_SKILL_DIR}/scripts/sync-rules.mjs" --targets <tools>` when the user picked other agents.
- `apps/<name>/**` when that app has its own framework conventions that differ from the rest (routing layout, server-only code, data fetching rules).
- `packages/<name>/src/**` when the package is a published or shared contract with a documented API shape.
- `**/*.test.ts`, `**/*.spec.ts` only when test conventions are non-obvious (shared fixtures, a custom render helper, no mocks of a given module).
- Database package (`prisma/**`, `drizzle/**`) when migrations are checked in.

## Reviewer subagent
`.claude/agents/ts-reviewer.md`, frontmatter `name: ts-reviewer`, `description: Reviews TypeScript and JavaScript changes in this monorepo for type safety, workspace boundary violations and async mistakes. Use after editing source files.`, `tools: Read, Grep, Glob`.
1. Imports reach across workspaces only through the package name, never `../../other-pkg/src` or `dist/` paths.
2. A new dependency used by one member is declared in that member's `package.json`, not only the root.
3. No `any`, `@ts-ignore` or unexplained `as` casts in changed lines. `@ts-expect-error` needs a reason.
4. Promises are awaited or returned. `Promise.all` where calls are independent. No floating promises in handlers.
5. Changes to a package's `index.ts` exports are flagged as public API changes.
6. Framework boundary checks from the detected stack (server vs client code, env access in client bundles).
7. Tests: no `.only`, no skipped tests without a reason.

## Skills
- `release`: when `versionFiles` has a changelog or `.changeset/` and a version is bumped by a repeatable process (changesets, release-please, semantic-release). Encode the real commands from that tool's config.
- `db-migrate`: when Prisma or Drizzle is detected and the flow has more than one step (generate, apply, regenerate client).
- `preview-deploy`: when `infra.vercel` or `infra.netlify` is true and the deploy needs more than a push.
- No `lint` or `test` skills. A package script is enough.

## .worktreeinclude
List only the files in `env.gitignored` (typically `.env`, `.env.local`, `.claude/settings.local.json`, `CLAUDE.local.md`, `.mcp.json`), plus `.env.development.local` and `.env.production.local` when the repo uses them. Gitignore syntax. Skip the file if the list is empty.

## What NOT to generate
- No rules for directories without distinct conventions.
- No `output-styles/`, `commands/` or `agent-memory/`.
- No `lint` skill, no `Bash(*)`, no `defaultMode` of `auto` or `bypassPermissions`.
- No framework or version claims that are not in `knowledge/node.md`, `knowledge/frontend.md` or the repo itself.
