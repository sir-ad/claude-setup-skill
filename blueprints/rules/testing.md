# Blueprint: .claude/rules/testing.md

Path-scoped test conventions. It loads when Claude reads or edits a test file.

## When to write
- Only when a test runner is detected and the repo has test files with conventions worth stating (fixtures, helpers, naming, mocking policy).
- Skip when tests are few and plain, with `--minimal`, or when no runner was found.
- Do not write it if `.claude/rules/testing.md` exists. List a MERGE in the plan instead.

## Inputs
- Detector: `commands.test[]`, `frameworks[]` in the `test` group (vitest, jest, pytest, playwright), `ci`.
- Test config: `vitest.config.*`, `jest.config.*`, `[tool.pytest]`, `conftest.py`, `pytest.ini`, `playwright.config.*`.
- 3 to 5 existing test files. Note: file naming, where fixtures live, how external services are faked, how async is handled, snapshot use.
- The test location from the stack template.
- `knowledge/practices.md`, Testing. Copy only bullets that apply to this runner.

## Rules
- Frontmatter has `paths` only: quoted globs for test files (`"**/*.test.{ts,tsx}"`, `"tests/**"`, `"**/*_test.go"`). Use the repo's real layout.
- Body: 4 to 12 bullet lines, hard cap 40 lines.
- Say which runner it is and where tests live. Do not repeat the command list: the commands are in AGENTS.md. Refer to it ("run one test with the form in AGENTS.md").
- State what you saw: the fixture folder, the factory helper, the mocking policy, the marker or tag for slow tests. Grep each name first.
- Add a rule like "no network in unit tests" only when the repo already follows it (check with grep) or a test config enforces it.
- Skipped tests need a reason. No `.only` or `fit`/`fdescribe` left behind. Include these only if a baseline bullet applies.
- Never state coverage targets the repo does not have.

## Skeleton
```markdown
---
paths:
  - "<test glob, e.g. tests/**/*.py>"
  - "<second glob if needed>"
---
# Testing
- Runner: <runner and version>. Tests live in `<test directory>`; name files `<pattern>`.
- Shared fixtures are in `<fixture path>`. Reuse them before adding a new one.
- <How external services are faked, e.g. "HTTP is mocked with `<helper>`. Do not call the network.">
- Mark slow tests with `<marker or tag>`. They run in `<where>`.
- Give every skipped test a reason.
- A new test must fail without the change it covers.
```
