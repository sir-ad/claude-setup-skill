# Blueprint: docs/project-structure.md

A map of the repo: a generated module graph plus short human notes. The graph block is refreshable. The notes are not.

## When to write
- Default when the graph script runs and finds source files. Skip with `--skip-docs` or `--minimal`.
- Skip if an equivalent exists in the detector's `docs` list (`docs/project-structure*`, `docs/repo-map*`). Then the fence goes there, listed in the plan as a planned change under the Proceed gate.
- If the script fails or prints nothing, skip the file and say why in the plan. Never write the fence by hand.

## Inputs
- Generated section: `emit.mjs --write structure-doc` fills the fence from `node "${CLAUDE_SKILL_DIR}/scripts/graph.mjs" . --markdown`. It holds the Mermaid graph, entry points, central modules and the repo map block.
- Detector: `layout`, `workspaces`, `generated[]`.
- Top-level directory listing, and the manifest, to write the notes.

## Rules
- The block between `<!-- claude-setup:begin graph -->` and `<!-- claude-setup:end graph -->` is filled by `emit.mjs` with script output only. The model never types, trims, reorders or rewords it.
- Both fence comments must appear exactly once, each on its own line. Write the prose file with the pair in place and nothing between them.
- Write the notes outside the fence. Each note is one line about one directory that is not obvious from its name. No tree dumps. At most 12 notes.
- List generated paths from `generated[]` under "Generated, do not edit", with the command that regenerates each.
- No claims about code you did not open.
- `--update` replaces only the text inside the fence through `emit.mjs`. It never touches the notes. If the fence is missing in an existing file, the plan lists it as a MERGE that adds the pair at the end.
- Cap: 80 lines outside the graph output.

## Skeleton
```markdown
# Project structure

<One line: what the repo contains and how it is laid out.>

<!-- claude-setup:begin graph -->
<output of: node "${CLAUDE_SKILL_DIR}/scripts/graph.mjs" . --markdown>
<!-- claude-setup:end graph -->

## Notes
- `<dir>/` - <what lives here and why it is separate>
- `<dir>/` - <one line>

## Generated, do not edit
- `<path>` - regenerate with `<command>`

For the components and data flow, see `docs/architecture.md`.
```
