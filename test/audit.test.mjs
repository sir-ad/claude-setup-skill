import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { audit, auditHardRules, sections, formatReport } from '../scripts/audit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'audit.mjs');
const fixture = (name) => path.join(HERE, 'fixtures', name);

const tmpDirs = [];
process.on('exit', () => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

// A copy of a fixture with an AGENTS.md written over it.
function project(fixtureName, agents, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
  tmpDirs.push(dir);
  if (fixtureName) fs.cpSync(fixture(fixtureName), dir, { recursive: true });
  for (const [rel, text] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  if (agents !== null) fs.writeFileSync(path.join(dir, 'AGENTS.md'), agents);
  return dir;
}
const errors = (dir) => audit(dir).errors;
const only = (dir, re) => errors(dir).filter((e) => re.test(e));

test('sections: headings inside code fences do not split', () => {
  const s = sections('# t\n\n## Commands\n- `a`\n```\n## not a heading\n```\n## Hard rules\n- x\n');
  assert.deepEqual([...s.keys()], ['commands', 'hard rules']);
});

test('commands: detector, script, Makefile and single-test forms trace; an invented one does not', () => {
  const good = project('node-pnpm-monorepo', '## Commands\n- Test: `pnpm test`\n- Build: `pnpm run build`\n- One package: `pnpm -C packages/ui run test`\n- Dev: `pnpm dev`\n- Format: `pnpm run format`\n');
  assert.deepEqual(errors(good), []);
  const bad = project('node-pnpm-monorepo', '## Commands\n- Test: `pnpm test`\n- Types: `pnpm run typecheck`\n- Deploy: `pnpm run deploy`\n');
  const e = errors(bad);
  assert.equal(e.length, 2);
  assert.match(e[0], /AGENTS\.md:3: command `pnpm run typecheck` does not trace/);
  assert.match(e[1], /`pnpm run deploy`/);
});

test('commands: Makefile targets, and a single-test form only when the runner is in the repo', () => {
  const go = project('go-mod', '## Commands\n- Test: `make test`\n- One: `go test ./pkg -run TestName`\n- Ship: `make deploy`\n');
  assert.deepEqual(errors(go).map((e) => e.match(/`([^`]+)`/)[1]), ['make deploy']);
  const py = project('python-uv', '## Commands\n- One: `uv run pytest tests/test_x.py::test_name`\n- Wrong: `cargo test foo`\n- Wrong: `npx jest src`\n');
  assert.deepEqual(errors(py).map((e) => e.match(/`([^`]+)`/)[1]), ['cargo test foo', 'npx jest src']);
});

test('commands: a command that only appears in repo text (CI, README) is traced', () => {
  const dir = project(null, '## Commands\n- Check: `./tools/check.sh --fast`\n- Other: `./tools/nope.sh`\n', { 'README.md': '# x\n\nRun `./tools/check.sh --fast` before you push.\n', 'package.json': '{"name":"x"}' });
  assert.deepEqual(errors(dir).map((e) => e.match(/`([^`]+)`/)[1]), ['./tools/nope.sh']);
});

test('commands: only command-shaped spans are audited; compound commands and env prefixes are split', () => {
  const dir = project('node-single-npm', [
    '## Commands',
    '- Test: `npm test` (reads `DATABASE_URL`, config in `.env.example` and `src/config.ts`)',
    '- Both: `npm ci && npm run build`',
    '- CI: `CI=1 npm test`',
    '- Dir: `cd app && npm run dev`',
    '- Node: `node --test test/a.test.mjs`',
    '- Bad: `npm ci && npm run deploy`',
    '- Bad: `FOO=1 make ship`',
    '',
  ].join('\n'));
  assert.deepEqual(errors(dir).map((e) => e.match(/`([^`]+)`/)[1]), ['npm run deploy', 'make ship']);
});

test('hard rules: an exact quote with file:line passes; the cited line may be a few lines off', () => {
  const dir = project('node-pnpm-monorepo', '## Hard rules\n- "Packages must not import from apps. Never import `apps/*` inside `packages/*`." (README.md:7)\n- "Run `pnpm test` before pushing." (README.md:6)\n');
  assert.deepEqual(errors(dir), []);
});

test('hard rules: invented quote, wrong line, missing file and bad format are errors', () => {
  const dir = project('node-pnpm-monorepo', [
    '## Hard rules',
    '- "Never use default exports." (README.md:7)',
    '- "Packages must not import from apps." (README.md:400)',
    '- "Packages must not import from apps." (docs/none.md:1)',
    '- Packages must not import from apps.',
    '- "Packages must not import from apps." (../outside.md:1)',
    '',
  ].join('\n'));
  const e = errors(dir);
  assert.equal(e.length, 5);
  assert.match(e[0], /quote not found/);
  assert.match(e[1], /has \d+ lines, not 400/);
  assert.match(e[2], /cannot be read/);
  assert.match(e[3], /not in the form/);
  assert.match(e[4], /cannot be read/, 'a path that leaves the repo is never opened');
});

test('hard rules: a trimmed qualifier is caught, with or without an ellipsis', () => {
  const readme = '# x\n\nRules\n\n- Never edit `gen/` by hand unless you regenerate it with `make gen`.\n- Keep handlers small.\n';
  const full = project(null, '## Hard rules\n- "Never edit `gen/` by hand unless you regenerate it with `make gen`." (README.md:5)\n', { 'README.md': readme });
  assert.deepEqual(errors(full), []);
  const trimmed = project(null, '## Hard rules\n- "Never edit `gen/` by hand." (README.md:5)\n', { 'README.md': readme });
  assert.match(errors(trimmed)[0], /says "unless", the quote does not/);
  const cut = project(null, '## Hard rules\n- "Never edit `gen/` … `make gen`." (README.md:5)\n', { 'README.md': readme });
  assert.match(errors(cut)[0], /says "unless"/, 'an ellipsis must not hide the qualifier');
  const fine = project(null, '## Hard rules\n- "Keep handlers small." (README.md:6)\n', { 'README.md': readme });
  assert.deepEqual(errors(fine), [], 'the qualifier belongs to the previous sentence');
});

test('hard rules: .env files are never opened, even when cited', () => {
  const dir = project(null, '## Hard rules\n- "SECRET=abc123" (.env:1)\n', { '.env': 'SECRET=abc123\n' });
  const r = audit(dir);
  assert.match(r.errors[0], /cannot be read/);
  assert.ok(!JSON.stringify(r).includes('abc123\n'), 'file content is not copied into the report');
  assert.deepEqual(auditHardRules(dir, null), []);
});

test('version notes: undeclared package, wrong major and over the limit are errors', () => {
  const dir = project('node-pnpm-monorepo', [
    '## Version notes',
    '- Next.js 15: `params` is async. Await it.',
    '- Turborepo 2: tasks go under `tasks`.',
    '- Next.js 14: use the Pages Router.',
    '- Tailwind 4: configuration lives in CSS.',
    '- Django 5: use async views.',
    '- Node 20: native fetch.',
    '- Some free text with no version',
    '',
  ].join('\n'));
  const e = errors(dir);
  assert.equal(e.length, 4);
  assert.match(e[0], /declares Next\.js 15, not 14/);
  assert.match(e[1], /declares Tailwind 3, not 4/, 'a dev dependency on Tailwind 3 must not get a Tailwind 4 note');
  assert.match(e[2], /does not declare Django/);
  assert.match(e[3], /not in the form/);
  const many = project('node-pnpm-monorepo', `## Version notes\n${Array.from({ length: 11 }, () => '- Next.js 15: a note.').join('\n')}\n`);
  assert.match(errors(many).at(-1), /11 version notes, the limit is 10/);
});

test('version notes: aliases and language versions resolve', () => {
  const dir = project('node-pnpm-monorepo', '## Version notes\n- Next 15: a.\n- NextJS 15: b.\n- Turbo 2: c.\n- pnpm 9: d.\n- Node 20: e.\n');
  assert.deepEqual(errors(dir), []);
});

test('a missing AGENTS.md or missing sections never throw', () => {
  assert.deepEqual(errors(project('go-mod', null)), ['AGENTS.md: cannot be read']);
  const r = audit(project('go-mod', '# only a title\n'));
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings[0], /no "## Commands"/);
});

test('every reference output in evals/golden passes with the claims counted', () => {
  const dir = project('node-pnpm-monorepo', fs.readFileSync(path.join(HERE, '..', 'evals', 'golden', 'node-pnpm-monorepo', 'AGENTS.md'), 'utf8'));
  const r = audit(dir);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.checked, { commands: 6, hardRules: 1, versionNotes: 2 });
  assert.match(formatReport(r), /^audit: ok \(9 claim\(s\)/);
});

test('cli: exit 0, 1 and 2; --json has the report shape', () => {
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  const ok = run(project('go-mod', '## Commands\n- Test: `make test`\n'));
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /audit: ok/);
  const bad = run(project('go-mod', '## Commands\n- Test: `make nope`\n'), '--json');
  assert.equal(bad.status, 1);
  const json = JSON.parse(bad.stdout);
  assert.deepEqual(Object.keys(json), ['root', 'checked', 'commands', 'hardRules', 'versionNotes', 'errors', 'warnings']);
  assert.equal(run('--bogus').status, 2);
  assert.equal(run('a', 'b').status, 2);
});
