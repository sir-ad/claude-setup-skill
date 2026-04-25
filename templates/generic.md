# Template: Generic / unknown stack

Fallback when no specific stack template applies (Ruby, Java/Kotlin, Elixir, Crystal, Zig, mixed/polyglot, infrastructure-only repos, doc repos, etc.).

## Strategy

Generate the **minimum viable** `.claude/`:

1. **CLAUDE.md** — extract whatever commands and conventions ARE documented in README. If README says "run `make build`", encode it. If README is silent, leave commands empty and ask the user.

2. **`.claude/settings.json`** — conservative permissions:
   ```json
   {
     "permissions": {
       "allow": [
         "Bash(make *)",
         "Bash(git status)",
         "Bash(git diff *)",
         "Bash(git log *)",
         "Bash(git add *)",
         "Bash(git commit *)"
       ],
       "deny": [
         "Bash(rm -rf *)",
         "Bash(git push --force *)",
         "Bash(git reset --hard *)"
       ]
     }
   }
   ```
   Add specifics ONLY for tools you can verify exist (`bundle`, `mvn`, `gradle`, `mix`, `zig`, etc. — check for the manifest file).

3. **No rules, no skills, no agents.** Generic = we don't know enough to opinionate. The user can run `/claude-setup` again later when the project has a clearer shape, or add rules manually.

4. **`.worktreeinclude`** — `.env`, `.env.local`, plus anything the README mentions as local-only.

## When to ASK instead of generating

If you can't detect:
- The build command
- The test command
- The primary language

ask the user **one question** with their tool/lang as options before falling back to generic. Better to ask than to write a CLAUDE.md with empty Commands.

## What NOT to do

- Don't generate boilerplate that says `<TODO: fill in>` — that's worse than nothing.
- Don't list commands you haven't verified exist (no `make test` if there's no Makefile target).
- Don't pretend to know the stack. Generic is honest.
