import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadCases, scoreGolden, scoreProject, snapshot, surfaceErrors, formatResults, ALLOWED_SURFACE } from '../scripts/eval.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'eval.mjs');
const cases = loadCases();
const byId = (id) => cases.find((c) => c.id === id);

const tmpDirs = [];
process.on('exit', () => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-test-')); tmpDirs.push(d); return d; };

function withGolden(id, edit = (t) => t) {
  const c = byId(id);
  const dir = tmp();
  fs.cpSync(path.join(ROOT, c.fixture), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), edit(fs.readFileSync(path.join(ROOT, 'evals', 'golden', id, 'AGENTS.md'), 'utf8')));
  return { dir, c };
}

test('cases: every fixture exists and every golden case has a golden AGENTS.md', () => {
  assert.ok(cases.length >= 4);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, 'ids are unique');
  for (const c of cases) {
    assert.ok(fs.existsSync(path.join(ROOT, c.fixture)), `${c.id}: fixture ${c.fixture}`);
    if (c.golden) assert.ok(fs.existsSync(path.join(ROOT, 'evals', 'golden', c.id, 'AGENTS.md')), `${c.id}: golden output`);
  }
});

test('golden outputs pass their own case', () => {
  for (const c of cases.filter((x) => x.golden)) {
    const r = scoreGolden(c);
    assert.deepEqual(r.failures, [], c.id);
    assert.equal(r.ok, true);
  }
});

test('scoring catches an invented command, a missing required command and a forbidden version note', () => {
  const { dir, c } = withGolden('node-pnpm-monorepo', (t) => t
    .replace('- Test: `pnpm test`\n', '- Typecheck: `pnpm run typecheck`\n')
    .replace('## Boundaries', '- Tailwind 4: configuration lives in CSS.\n\n## Boundaries'));
  const r = scoreProject(dir, c);
  assert.equal(r.ok, false);
  const text = r.failures.join('\n');
  assert.match(text, /audit AGENTS\.md:\d+: command `pnpm run typecheck` does not trace/);
  assert.match(text, /missing command `pnpm test`/);
  assert.match(text, /Tailwind 4 must not appear/);
  assert.match(text, /declares Tailwind 3, not 4/);
});

test('scoring catches a dropped hard rule and a secret-like value', () => {
  const fakeKey = ['sk', 'live', 'x'.repeat(24)].join('_'); // built at runtime so no secret-shaped literal sits in the repo
  const { dir, c } = withGolden('node-pnpm-monorepo', (t) => `${t.replace(/## Hard rules[\s\S]*?\n\n/, '')}\napi_key = "${fakeKey}"\n`);
  const text = scoreProject(dir, c).failures.join('\n');
  assert.match(text, /missing hard rule containing "Packages must not import from apps"/);
  assert.match(text, /verify AGENTS\.md: .*secret/i);
});

test('scoring needs an AGENTS.md', () => {
  const dir = tmp();
  fs.copyFileSync(path.join(ROOT, 'test', 'fixtures', 'go-mod', 'go.mod'), path.join(dir, 'go.mod'));
  assert.match(scoreProject(dir, {}).failures[0], /AGENTS\.md was not written/);
});

test('surface: only the files the skill may write can appear', () => {
  for (const ok of ['AGENTS.md', 'CLAUDE.md', '.claude/agents/frontend.md', 'docs/agents.md', '.gitignore', '.gemini/settings.json', '.cursor/rules/x.mdc', '.claude-setup/apply.mjs']) {
    assert.ok(ALLOWED_SURFACE.some((re) => re.test(ok)), ok);
  }
  for (const bad of ['src/index.ts', 'package.json', '.env', 'tests/test_x.py', 'README.md', '.github/workflows/ci.yml']) {
    assert.ok(!ALLOWED_SURFACE.some((re) => re.test(bad)), bad);
  }
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export {}\n');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  const before = snapshot(dir);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# x\n');
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 1\n'); // edited a source file
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'stray\n');
  fs.rmSync(path.join(dir, 'package.json'));
  assert.deepEqual(surfaceErrors(before, snapshot(dir)), [
    'changed src/a.ts, which /claude-setup does not write',
    'created notes.txt, which /claude-setup does not write',
    'deleted package.json',
  ]);
});

test('formatResults lists failures and the pass count', () => {
  const out = formatResults([{ id: 'a', ok: true, failures: [], claims: { commands: 1, hardRules: 0, versionNotes: 2 } }, { id: 'b', ok: false, failures: ['missing command `x`'], claims: {} }]);
  assert.match(out, /^pass {2}a {2}\(1 commands, 0 hard rules, 2 version notes\)/);
  assert.match(out, /FAIL {2}b\n {6}- missing command `x`/);
  assert.match(out, /eval: 1\/2 case\(s\) passed$/);
});

test('cli: --list and --golden exit 0; usage errors exit 2', () => {
  const run = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  assert.match(run(['--list']).stdout, /node-pnpm-monorepo/);
  const g = run(['--golden']);
  assert.equal(g.status, 0, g.stdout);
  assert.match(g.stdout, /eval: 4\/4 case\(s\) passed/);
  assert.equal(run(['--golden', '--case', 'go-mod']).status, 0);
  for (const args of [[], ['--bogus'], ['--case'], ['--golden', '--case', 'nope'], ['--run', '--timeout', '0']]) assert.equal(run(args).status, 2, args.join(' '));
});

test('cli: --run stops before any model call when the skill is not installed', () => {
  const home = tmp();
  const r = spawnSync(process.execPath, [SCRIPT, '--run', '--case', 'go-mod'], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.dirname(process.execPath) } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /the skill is not installed at .*claude-setup/);
  assert.match(r.stdout, /npx -y @claude-setup-skill\/install/);
});
