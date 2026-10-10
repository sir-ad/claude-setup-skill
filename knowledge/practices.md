# Practices

Checked: 2026-10. A vetted baseline of do and don't rules. The project's own rules, config and pinned versions always win over this file.

## How the skill uses it

Copy a bullet into `.claude/rules/` only when it applies to a language, library or risk this repo actually has. Skip the rest. Never copy a bullet the repo's lint, format or CI config already enforces. Rephrase in the repo's terms and drop the link when it adds noise. Security bullets feed `security.md`, Testing bullets `testing.md`, Code changes bullets `code-style.md` and the reviewer.

Every source was read in its upstream repository (OWASP/CheatSheetSeries, OWASP/Top10, google/eng-practices, git/git, pytest, npm/cli, pypa/pip, python/cpython, golang/go) on 2026-10-10. The links point to the published pages.

## Security
- Never build SQL by string concatenation with user input. Use parameterized queries or an ORM's bound parameters. For table, column or sort names, which cannot be bound, check the value against a fixed allow-list. [OWASP SQL Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
- Never commit secrets (API keys, tokens, passwords, private keys). Read them from the environment or a secrets manager. Do not bake them into Docker `ENV` or `ARG`. [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- Treat a secret that reached git history or a log as compromised. Revoke and rotate it. [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- Validate all input on the server, even when the client validates too. Accept what is expected (allow-list); do not try to list bad strings. [OWASP Input Validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- Encode output for the place it lands. Put text in the DOM with `textContent`, not `innerHTML`. Do not pass unsanitized HTML to `dangerouslySetInnerHTML`. [OWASP XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- Do not pass user input to a shell. Call a library function instead, or pass arguments as an array with no shell. [OWASP OS Command Injection Defense](https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html)
- Deny by default. Check authorization on the server for every request, including AJAX and internal calls. [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [OWASP Top 10 A01:2025](https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/)
- Hash passwords with Argon2id (or bcrypt, scrypt, PBKDF2) and a unique salt. Never store plain text or use a fast hash. [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- Do not log passwords, access tokens, session IDs, connection strings, keys or personal data. Mask or drop them. [OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- Return a generic error to the client. Keep stack traces and internal details in server logs. [OWASP Error Handling](https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html)
- Never `pickle.loads` or `yaml.load` untrusted data. Use JSON or `yaml.safe_load`. [OWASP Deserialization](https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html)
- When the server fetches a URL a user supplied, check the destination against an allow-list of hosts. [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- Protect state-changing requests that rely on cookies with the framework's CSRF protection, or with CSRF tokens validated on the server. [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- For file uploads, generate the stored file name yourself and allow only the extensions the feature needs. [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

## Testing
- Add or update tests in the same change as the code, unless it is an emergency fix. [Google: what to look for, Tests](https://google.github.io/eng-practices/review/reviewer/looking-for.html#tests)
- Write tests that fail when the behavior breaks. Run a new test against the old code or with the fix reverted to see it fail. [Google: what to look for, Tests](https://google.github.io/eng-practices/review/reviewer/looking-for.html#tests)
- Keep assertions simple. Put unrelated checks in separate test functions. Do not add logic to tests. [Google: what to look for, Tests](https://google.github.io/eng-practices/review/reviewer/looking-for.html#tests)
- Run one pytest test by node id before the full suite: `pytest tests/test_mod.py::test_func`. [pytest: specifying tests](https://docs.pytest.org/en/stable/how-to/usage.html)
- Run one Go test with `go test ./pkg -run TestName`. Add `-shuffle=on` to find tests that depend on order. [Go: testing flags](https://pkg.go.dev/cmd/go#hdr-Testing_flags)
- Give every skipped test a reason: `pytest.mark.skip(reason=...)`, or `skip` with a message in `node:test`. [pytest: skip and xfail](https://docs.pytest.org/en/stable/how-to/skipping.html), [Node.js test runner: skipping tests](https://nodejs.org/api/test.html#skipping-tests)

## Code changes
- Keep a change small and self-contained, so a reviewer can read it in one sitting. [Google: small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html)
- Do refactoring in a separate change from a feature or bug fix. [Google: separate out refactorings](https://google.github.io/eng-practices/review/developer/small-cls.html#refactoring)
- Do not mix reformatting of existing code with other changes. [Google: what to look for, Style](https://google.github.io/eng-practices/review/reviewer/looking-for.html#style)
- Solve the problem you have now. Do not add code for a future need nobody has asked for. [Google: what to look for, Complexity](https://google.github.io/eng-practices/review/reviewer/looking-for.html#complexity)
- Write comments that say why the code exists, not what it does. [Google: what to look for, Comments](https://google.github.io/eng-practices/review/reviewer/looking-for.html#comments)
- Follow the project's style rules. Where none apply, match the surrounding code. [Google: what to look for, Consistency](https://google.github.io/eng-practices/review/reviewer/looking-for.html#consistency)
- When reviewing, accept a change that improves the code even if it is not perfect. Do not block on personal preference. [Google: the standard of code review](https://google.github.io/eng-practices/review/reviewer/standard.html)

## Dependencies
- Commit the lockfile. Change it through the package manager, never by hand. [npm: package-lock.json](https://docs.npmjs.com/cli/configuring-npm/package-lock-json)
- Install with `npm ci` in CI and release builds. It needs a lockfile and never writes to `package.json` or the lockfile. [npm ci](https://docs.npmjs.com/cli/commands/npm-ci)
- Run `npm audit` before you add or update a dependency, and scan dependencies for known vulnerabilities in CI from the start. [npm audit](https://docs.npmjs.com/cli/commands/npm-audit), [OWASP Vulnerable Dependency Management](https://cheatsheetseries.owasp.org/cheatsheets/Vulnerable_Dependency_Management_Cheat_Sheet.html)
- For Python deployments, pin versions and install with `pip install --require-hashes -r requirements.txt` so a tampered package fails. [pip: secure installs](https://pip.pypa.io/en/stable/topics/secure-installs/)
- Install Python packages into a virtual environment, not the system Python. [Python tutorial: virtual environments](https://docs.python.org/3/tutorial/venv.html)
- In Go, run `go mod verify` to check that downloaded modules match their recorded hashes. [Go: go mod verify](https://go.dev/ref/mod#go-mod-verify)
- Take new dependencies only from the official registry. Check that the package is maintained before you add it. [OWASP Top 10 A03:2025](https://owasp.org/Top10/2025/A03_2025-Software_Supply_Chain_Failures/)

## Git
- Make one commit per logical change. [Git: submitting patches](https://git-scm.com/docs/SubmittingPatches)
- Write the subject as a short imperative line (about 50 characters). Use the body to say why the change is needed. [Git: submitting patches](https://git-scm.com/docs/SubmittingPatches), [Google: CL descriptions](https://google.github.io/eng-practices/review/developer/cl-descriptions.html)
- Do not rebase or rewrite a branch that others have based work on. [Git: rebase, recovering from upstream rebase](https://git-scm.com/docs/git-rebase#_recovering_from_upstream_rebase)
- If you must replace your own published branch, use `git push --force-with-lease`, never bare `--force`. [Git: git-push](https://git-scm.com/docs/git-push)
- Run secret detection before you commit, in a pre-commit hook or the IDE. [OWASP Secrets Management, detection](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
