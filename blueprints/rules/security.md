# Blueprint: .claude/rules/security.md

An always-on security rule. It has no `paths`, so it loads at launch with CLAUDE.md. That is why it stays short.

## When to write
- Default for any repo that handles user input, a database, authentication, secrets or network calls (a service, web app, CLI that calls APIs).
- Skip for pure libraries with no I/O, for docs-only repos, and with `--minimal`.
- Do not write it if `.claude/rules/security.md` exists. Offer a merge instead.

## Inputs
- Detector: `frameworks[]` (ORM, web framework, auth library, schema validator), `env.files`, `hardRuleCandidates[]` that mention security, `infra`.
- `docs/config.md` if written: the env var names and where they are read.
- Grep results: where input is validated, where authorization is checked, which logger is used, which DB access layer exists. Write a line only for a layer you found.
- `knowledge/practices.md`, Security. Pick the bullets that match the stack found. Typical: SQL, secrets, input validation, output encoding, authorization, logging.
- `permissions.deny` in the planned settings.json. Do not contradict it.

## Rules
- No frontmatter. Always on.
- 25 lines or fewer including the heading. Aim for 8 to 14 bullets.
- Each bullet is a checkable do or don't tied to this repo: name the library, helper or directory when you know it. Grep each name first.
- Repo hard rules about security come first, quoted with their `file:line`. Baseline bullets follow. No source links in the file.
- Never restate lint or CI checks (secret scanners, dependency audits already in CI).
- Never include secret values or real hostnames. Name env vars only.
- Leave out any baseline bullet for something the repo does not have (no CSRF line without cookie sessions, no upload line without uploads).
- Do not repeat the Boundaries section of AGENTS.md. Link nothing.

## Skeleton
```markdown
# Security
- "<hard rule quoted from the repo>" (<file:line>)
- Never commit secrets. Read them from the environment (`<ENV_VAR_NAME>`) via `<config module>`.
- Treat a secret that reached git or a log as compromised. Tell the user to rotate it.
- Build queries with `<ORM or driver>` parameters. Never concatenate user input into SQL.
- Validate request input with `<schema library>` before use. Validate on the server.
- Check authorization in `<auth layer>` on every route. Deny by default.
- Do not log tokens, passwords, session ids or personal data. Log through `<logger>`.
- Do not pass user input to a shell. Use argument arrays.
- Ask before adding a dependency. Prefer the official registry and a maintained package.
```
