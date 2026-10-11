import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');

// validate.mjs resolves its root from its own location, so each test runs a copy of the
// validate-relevant files (everything package.json ships, plus package.json itself).
const tmpDirs = [];
function copyRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-test-'));
  tmpDirs.push(dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  for (const item of ['package.json', 'scripts', ...pkg.files]) {
    const from = path.join(REPO, item);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(dir, item), { recursive: true });
  }
  return dir;
}
process.on('exit', () => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const validate = (dir) => {
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'validate.mjs')], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const edit = (dir, rel, fn) => {
  const abs = path.join(dir, rel);
  fs.writeFileSync(abs, fn(fs.readFileSync(abs, 'utf8')));
};
const failures = (out) => out.split('\n').filter((l) => l.startsWith('FAIL'));

test('validate passes on the real repo', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'validate.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /validate: ok \(0 failure\(s\)/);
});

test('validate passes on an unmodified copy', () => {
  const dir = copyRepo();
  const r = validate(dir);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(failures(r.out), []);
});

test('a placeholder TODO in a template fails, with file and line', () => {
  const dir = copyRepo();
  edit(dir, 'templates/generic.md', (t) => `${t.trimEnd()}\n\nTODO: write this section\n`);
  const r = validate(dir);
  assert.equal(r.code, 1, r.out);
  const lines = failures(r.out);
  assert.equal(lines.length, 1, r.out);
  assert.match(lines[0], /templates\/generic\.md:\d+: placeholder "TODO" found/);
  assert.match(r.out, /validate: failed \(1 failure\(s\)/);
});

test('placeholder markers are caught in the other forms, and docs that describe the rule are not', () => {
  const dir = copyRepo();
  edit(dir, 'templates/python.md', (t) => `${t.trimEnd()}\n\nTBD\n<fill in the command>\nSee FIXME later.\n`);
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.equal(failures(r.out).length, 3, r.out);

  const ok = copyRepo();
  edit(ok, 'templates/python.md', (t) => `${t.trimEnd()}\n\nNo placeholder TODOs may remain.\nWrite \`TODO\` markers nowhere.\n`);
  assert.equal(validate(ok).code, 0);
});

test('a template named in SKILL.md that does not exist fails', () => {
  const dir = copyRepo();
  fs.rmSync(path.join(dir, 'templates', 'ruby.md'));
  const r = validate(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FAIL\s+SKILL\.md template list names templates\/ruby\.md, which does not exist/);
});

test('a knowledge note named in SKILL.md that does not exist fails', () => {
  const dir = copyRepo();
  fs.rmSync(path.join(dir, 'knowledge', 'go.md'));
  const r = validate(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FAIL\s+SKILL\.md knowledge list names knowledge\/go\.md, which does not exist/);
});

test('a runtime directory missing from package.json "files" fails', () => {
  for (const item of ['templates', 'knowledge', 'scripts']) {
    const dir = copyRepo();
    edit(dir, 'package.json', (t) => {
      const pkg = JSON.parse(t);
      pkg.files = pkg.files.filter((f) => f !== item);
      return JSON.stringify(pkg, null, 2);
    });
    const r = validate(dir);
    assert.equal(r.code, 1, `${item}: ${r.out}`);
    assert.match(r.out, new RegExp(`FAIL\\s+"${item}" is missing from package\\.json "files"`), item);
  }
});

test('a runtime directory missing from the installer ITEMS fails', () => {
  const dir = copyRepo();
  edit(dir, 'bin/install.js', (t) => t.replace(/\n\s*'reference',/, ''));
  const r = validate(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FAIL\s+"reference" is missing from bin\/install\.js ITEMS/);
});

test('broken SKILL.md frontmatter and a dangling skill-dir reference fail', () => {
  const dir = copyRepo();
  edit(dir, 'SKILL.md', (t) => `${t.trimEnd()}\n\nRead \${CLAUDE_SKILL_DIR}/reference/no-such-file.md first.\n`);
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /SKILL\.md references \$\{CLAUDE_SKILL_DIR\}\/reference\/no-such-file\.md, which does not exist/);

  const noFm = copyRepo();
  edit(noFm, 'SKILL.md', (t) => t.replace(/^---[\s\S]*?\n---\n/, ''));
  const r2 = validate(noFm);
  assert.equal(r2.code, 1);
  assert.match(r2.out, /SKILL\.md has no YAML frontmatter/);
});

test('an empty template and a template without a heading fail; an over-long one only warns', () => {
  const dir = copyRepo();
  fs.writeFileSync(path.join(dir, 'templates', 'php.md'), '');
  edit(dir, 'templates/go.md', (t) => `intro without heading\n${t}`);
  let r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL\s+templates\/php\.md: file is empty/);
  assert.match(r.out, /FAIL\s+templates\/go\.md: must start with a "# " heading/);

  const long = copyRepo();
  edit(long, 'templates/generic.md', (t) => `${t.trimEnd()}\n${'filler line\n'.repeat(320)}`);
  r = validate(long);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /WARN\s+templates\/generic\.md: \d+ lines \(over 300\)/);
});

test('blueprints get the heading and placeholder checks', () => {
  const dir = copyRepo();
  fs.writeFileSync(path.join(dir, 'blueprints', 'docs', 'config.md'), '');
  edit(dir, 'blueprints/rules/testing.md', (t) => `intro without heading\n${t}`);
  edit(dir, 'blueprints/skills/handoff.md', (t) => `${t.trimEnd()}\n\nTODO: finish\n`);
  const r = validate(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FAIL\s+blueprints\/docs\/config\.md: file is empty/);
  assert.match(r.out, /FAIL\s+blueprints\/rules\/testing\.md: must start with a "# " heading/);
  assert.match(r.out, /FAIL\s+blueprints\/skills\/handoff\.md:\d+: placeholder "TODO" found/);
});

test('blueprints must ship: missing from "files" or the installer ITEMS fails', () => {
  const noFiles = copyRepo();
  edit(noFiles, 'package.json', (t) => {
    const pkg = JSON.parse(t);
    pkg.files = pkg.files.filter((f) => f !== 'blueprints');
    return JSON.stringify(pkg, null, 2);
  });
  const a = validate(noFiles);
  assert.equal(a.code, 1, a.out);
  assert.match(a.out, /FAIL\s+"blueprints" is missing from package\.json "files"/);

  const noItems = copyRepo();
  edit(noItems, 'bin/install.js', (t) => t.replace(/\n\s*'blueprints',/, ''));
  const b = validate(noItems);
  assert.equal(b.code, 1, b.out);
  assert.match(b.out, /FAIL\s+"blueprints" is missing from bin\/install\.js ITEMS/);
});

test('a blueprints path in SKILL.md that does not exist fails; placeholders are ignored', () => {
  const dir = copyRepo();
  edit(dir, 'SKILL.md', (t) => `${t.trimEnd()}\n\nSee blueprints/docs/no-such-blueprint.md and blueprints/skills/<name>.md.\n`);
  const r = validate(dir);
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(failures(r.out), ['FAIL  SKILL.md mentions blueprints/docs/no-such-blueprint.md, which does not exist']);

  const ok = copyRepo();
  edit(ok, 'SKILL.md', (t) => `${t.trimEnd()}\n\nSee blueprints/README.md and blueprints/skills/plan-task.md.\n`);
  assert.equal(validate(ok).code, 0);
});

test('a script path in a blueprint or reference that does not exist fails; real ones pass', () => {
  const dir = copyRepo();
  edit(dir, 'blueprints/hooks/router.md', (t) => `${t.trimEnd()}\n\nRun \`node "\${CLAUDE_SKILL_DIR}/scripts/no-such-script.mjs"\` first.\n`);
  edit(dir, 'reference/routing.md', (t) => `${t.trimEnd()}\n\nSee scripts/router/missing.mjs.\n`);
  const r = validate(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FAIL\s+blueprints\/hooks\/router\.md mentions scripts\/no-such-script\.mjs, which does not exist/);
  assert.match(r.out, /FAIL\s+reference\/routing\.md mentions scripts\/router\/missing\.mjs, which does not exist/);

  const ok = copyRepo();
  edit(ok, 'blueprints/hooks/router.md', (t) => `${t.trimEnd()}\n\nSee scripts/roster.mjs, scripts/sync-agents.mjs and scripts/router/route.mjs.\n`);
  assert.equal(validate(ok).code, 0);
});

test('the router script must exist, and scripts/ must ship for it', () => {
  const missing = copyRepo();
  fs.rmSync(path.join(missing, 'scripts', 'router', 'route.mjs'));
  const a = validate(missing);
  assert.equal(a.code, 1, a.out);
  assert.match(a.out, /FAIL\s+scripts\/router\/route\.mjs is missing; the router hook is copied from it/);

  const noShip = copyRepo();
  edit(noShip, 'bin/install.js', (t) => t.replace(/\n\s*'scripts',/, ''));
  const b = validate(noShip);
  assert.equal(b.code, 1, b.out);
  assert.match(b.out, /FAIL\s+"scripts" is missing from bin\/install\.js ITEMS/);
  assert.match(b.out, /FAIL\s+scripts\/router\/route\.mjs does not ship/);
});
