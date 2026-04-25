# Template: Node monorepo (npm/yarn/pnpm workspaces, turbo, nx, lerna)

Reference for `/claude-setup` when `package.json` has `workspaces`, `turbo.json`, `nx.json`, or `lerna.json`.

## Detection signals
- Root `package.json` with `"workspaces": [...]` OR `"private": true` + workspace tooling config file.
- `apps/` and/or `packages/` subdirectories.
- Lockfile: `package-lock.json` (npm), `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`.

## Choose the package manager
- `pnpm-lock.yaml` → pnpm
- `yarn.lock` → yarn (check version: `packageManager` field in package.json or `node_modules/.yarn-state.yml` for berry)
- `package-lock.json` → npm
- `bun.lockb` → bun
- Multiple → flag as inconsistent and ask user.

Use the detected pm in all commands. Don't assume npm.

## CLAUDE.md should include

```md
# {{PROJECT_NAME}}

## Stack
- Node {{from .nvmrc / package.json engines}}
- Package manager: {{pm}}
- Build orchestrator: {{turbo | nx | lerna | workspaces only}}
- Workspaces: {{list with one-line role each}}
- TypeScript: {{strict mode? from tsconfig}}

## Commands
- Install:  `{{pm}} install`
- Build:    `{{pm}} run build`        (or `turbo run build` if turbo)
- Test:     `{{pm}} test`             (read scripts.test from package.json)
- Lint:     `{{pm}} run lint`
- Typecheck: `{{pm}} run typecheck`   (only if script exists)

## Repo map
- apps/<name>/   — {{role}}
- packages/<name>/ — {{role}}

## Hard rules
- {{From README/ADRs only}}
```

## settings.json permissions

```json
{
  "permissions": {
    "allow": [
      "Bash({{pm}} install)",
      "Bash({{pm}} run *)",
      "Bash({{pm}} test *)",
      "Bash({{pm}} exec *)",
      "Bash(turbo run *)",
      "Bash(nx run *)",
      "Bash(node *)",
      "Bash(npx *)",
      "Bash(git status)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(git add *)",
      "Bash(git commit *)",
      "Bash(gh run view *)",
      "Bash(gh pr view *)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force *)",
      "Bash(git reset --hard *)",
      "Bash({{pm}} publish *)"
    ]
  }
}
```

Drop `turbo run *` if no turbo. Drop `nx run *` if no nx.

## Path-scoped rules

- `apps/<name>/`: rule only if the app has distinct conventions (Next.js App Router conventions, server-only directives, etc.)
- `packages/<name>/`: rule per package only if the package has its own contract (e.g. UI primitives must be controlled+uncontrolled).
- `**/*.test.ts(x)`, `**/*.spec.ts(x)`: rule only if test conventions are non-obvious.
- `apps/web/app/api/**/*.ts`: API route shape rule only if there's a documented response shape.

Default: 0-2 rules. Don't pad.

## Code-reviewer subagent (`agents/ts-reviewer.md`)

Tools: `Read, Grep, Glob`.

Checklist (tune to project):
1. TypeScript strictness — no `any`, no `as` casts without comments, no `@ts-ignore`.
2. Async — `await` not forgotten, Promise.all where appropriate, no unhandled rejections.
3. React (if applicable) — hooks rules, server vs client components (Next.js App Router), no `useEffect` for derived state.
4. Imports — no deep `dist/` imports, no relative `../../../` chains across workspace boundaries (use workspace alias).
5. Tests — Vitest/Jest patterns, no skipped tests without reason.
6. Public API stability — `packages/*/src/index.ts` changes flagged.

## Skills to generate

- `/release` if there's a release process (changesets, semantic-release, manual). Read `.changeset/`, `release.config.js`, or `CHANGELOG.md` to detect.
- `/test` only if the test command is non-trivial (e.g. specific workspace targeting, e2e split from unit).
- `/preview-deploy` if Vercel/Netlify is detected (`vercel.json`, `netlify.toml`).

Don't generate `/lint` — it's just `pnpm run lint`, no skill needed.

## .worktreeinclude

```
.env
.env.local
.env.development.local
.env.production.local
{{include CLAUDE.md and .mcp.json if gitignored}}
.claude/settings.local.json
```

## What NOT to generate

- No `output-styles/` unless team has a documented review style.
- No `commands/`.
- No `agent-memory/`.
