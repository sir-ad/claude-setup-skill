# Contributing

This repo is one Claude Code skill. Most of it is markdown, so the checks are small and fast.

## Run the checks

```sh
npm run check      # validate, then test
npm run validate   # SKILL.md, templates, knowledge notes, package coverage
npm test           # node:test files at test/*.test.mjs
```

Node 18 or newer. There are no dependencies to install.

Tests live at the top of `test/` and end in `.test.mjs`. Put fixtures in subfolders such as `test/fixtures/`. The test script does not look there, so a fixture file never runs as a test.

## Add a stack template

1. Create `templates/<name>.md`. Start it with a `# ` heading. Follow the shape of an existing template.
2. Add the template to the template list in `SKILL.md` (Phase 2) and to the stack table in `README.md`.
3. Add a detector fixture: a small project that matches the stack under `test/fixtures/`, and a `test/*.test.mjs` file that expects the new stack name.
4. Run `npm run check`.

## Add a knowledge note

1. Create a file under `knowledge/`. Start it with a `# ` heading.
2. Cite a source for each factual claim: a doc page, a changelog entry or a spec.
3. Version-gate facts. Say which tool or version a fact applies to, and when you checked it.
4. Keep each note under 150 lines.

## Writing style

- Plain, direct sentences. Keep them short.
- Avoid marketing words such as seamless, robust, leverage, comprehensive, powerful, delve, elevate, unlock and streamline.
- No emoji.
- Use few em dashes.
- No placeholders. `TODO`, `TBD`, `FIXME` and `<fill in>` fail validation.

## Generated output

The skill writes files into users' projects. Generated output must never contain secrets: no tokens, API keys, passwords, private URLs or `.env` contents. Check templates, examples and knowledge notes for this before you open a pull request.

## Pull requests

Keep one change per pull request. Run `npm run check` before you push. Describe what changed and why.
