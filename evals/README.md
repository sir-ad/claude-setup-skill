# Evals

The unit tests check the scripts. These evals check the output: whether the `AGENTS.md` that `/claude-setup` writes is true of the repo it was written for.

## What a case scores

A case is a fixture repo plus expectations, listed in `cases.json`. A project passes when all four checks pass:

| Check | Script | Catches |
|---|---|---|
| Files are well formed and safe | `scripts/verify.mjs` | secrets, bad JSON, unsafe settings, broken links, bad fences |
| Claims are true of the repo | `scripts/audit.mjs` | an invented command, a hard-rule quote that is not in its source or lost an "unless", a version note for a dependency or major the project does not declare |
| Case expectations | `cases.json` | a required command or hard rule is missing, a forbidden version note appears (for example a Tailwind 4 note when the repo declares Tailwind 3) |
| Surface | `scripts/eval.mjs` | with `--run` only: a file outside the skill's output was created, changed or deleted |

None of these judge whether a hard rule really constrains code changes, or whether a listed command is the best one. They check that the claim is supported by the repo.

## Offline: no model, no cost

```sh
npm run eval                                  # score the reference outputs in evals/golden/
node scripts/eval.mjs --golden --case go-mod  # one case
node scripts/eval.mjs --score path/to/project # score any project that /claude-setup already wrote
node scripts/audit.mjs path/to/project        # only the claims audit
```

`golden/<case>/AGENTS.md` is a hand-written reference output for the fixture. It proves the scorer accepts a good file. `test/audit.test.mjs` and `test/eval.test.mjs` change those files on purpose (an invented command, a trimmed qualifier, a wrong major version, a stray file) and prove the scorer rejects each change. `npm test` runs both.

The golden files were written by hand from the detector output. They are not recordings of a model run.

## Live: a model writes the files

```sh
npx -y @claude-setup-skill/install     # the skill must be installed
npm run eval:live                      # every case
node scripts/eval.mjs --run --case node-pnpm-monorepo --model <model> --keep
```

For each case, `--run` copies the fixture to a temp directory, runs `claude -p "/claude-setup"` with `--permission-mode acceptEdits`, answers the plan gate with `claude -p ... --continue`, runs `.claude-setup/apply.mjs` if files were staged, and scores the result. It spends model usage, so CI does not run it.

This path has not been run end to end. It stops before any model call when the skill is not installed, and that part is tested. Whether a second `--continue` turn is the right way to answer the Proceed gate in headless mode, and whether `acceptEdits` stages the files as the README describes, still needs a first real run. Use `--keep` to inspect the output when it fails.

## Add a case

1. Pick or add a small fixture under `test/fixtures/`.
2. Add an entry to `cases.json`: `id`, `fixture`, and any of `requireCommands`, `requireHardRules`, `forbidVersionNotes`. Set `golden` to true when you also add a reference output.
3. For a golden case, write `golden/<id>/AGENTS.md` from `node scripts/detect.mjs test/fixtures/<fixture>`. Use only commands, rules and versions that output supports.
4. Run `npm run check`.

## Not covered yet

- Whether agents do better work with the generated files than without them. That needs a task set and a model budget: the same tasks run with and without the files, scored by the repo's own tests.
- Whether the roster and the router help on real prompts. `test/router.test.mjs` has an accuracy table of labelled prompts, but it is small and written by the author of the rules. A log of real decisions (`.claude/route-log.jsonl`) is the better source once users have one.
