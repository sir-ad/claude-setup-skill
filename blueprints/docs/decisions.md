# Blueprint: docs/decisions/

An architecture decision record (ADR) folder with a template and an index. Two files: `0000-template.md` and `README.md`.

## When to write
- Only when the repo has no ADR folder. Check for `docs/decisions`, `docs/adr`, `doc/adr`, `adr/`, `docs/architecture/decisions`, `decisions/`. If one exists, write nothing and use its format.
- Skip with `--skip-docs` or `--minimal`.
- Offer it only when the repo has signs of design choices worth recording: more than one service or package, or an existing `docs/` folder. Otherwise skip.

## Inputs
- Detector: `docs` list, `layout`, `workspaces`.
- Directory listing for the ADR folder names above.

## Rules
- Do not back-fill decisions. Do not invent ADRs from guesses about history. The index starts with only the template.
- The template has these sections: Status, Context, Decision, Consequences. Status values: proposed, accepted, superseded by NNNN, deprecated.
- File names are `NNNN-short-title.md` with a four-digit number. Numbers never change.
- Cap: template 25 lines, index 20 lines.
- AGENTS.md may link the folder in one line. It must not copy the contents.

## Skeleton
File one, `docs/decisions/0000-template.md`:
````markdown
# NNNN. <Short title of the decision>

Date: <yyyy-mm-dd>
Status: proposed

## Context
<The problem and the forces behind it. Facts, not opinions.>

## Decision
<What we decided, in one or two sentences, in the active voice.>

## Consequences
- <What gets easier.>
- <What gets harder, or what we now have to maintain.>
````

File two, `docs/decisions/README.md`:
````markdown
# Decisions

Each file records one decision. Copy `0000-template.md`, give it the next number, and add a row below. Do not edit an accepted record; supersede it with a new one.

| Number | Title | Status |
|---|---|---|
| [0000](0000-template.md) | Template | n/a |
````
