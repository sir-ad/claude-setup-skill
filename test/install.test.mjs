import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'bin', 'install.js');

const tmpDirs = [];
function makeHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-test-'));
  tmpDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// Every run uses a throwaway HOME, so the real ~/.claude is never touched.
const install = (home, ...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

const skillsDir = (home) => path.join(home, '.claude', 'skills');
const target = (home) => path.join(skillsDir(home), 'claude-setup');
const backups = (home) => path.join(home, '.claude', 'backups', 'claude-setup');
const exists = (p) => fs.existsSync(p);
const put = (file, content = 'x\n') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

// Sorted "path size" lines for everything under dir (symlinks are listed, not followed).
function snapshot(dir) {
  const lines = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      const rel = path.relative(dir, abs);
      if (e.isSymbolicLink()) lines.push(`${rel} -> ${fs.readlinkSync(abs)}`);
      else if (e.isDirectory()) {
        lines.push(`${rel}/`);
        walk(abs);
      } else lines.push(`${rel} ${fs.statSync(abs).size}`);
    }
  };
  walk(dir);
  return lines.sort();
}

test('fresh install copies the runtime items and nothing else', () => {
  const home = makeHome();
  const r = install(home);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^installed: .*claude-setup \(\d+ items\)/m);
  for (const item of ['SKILL.md', 'templates/node-single.md', 'knowledge', 'reference', 'scripts/verify.mjs', 'LICENSE']) {
    assert.ok(exists(path.join(target(home), item)), item);
  }
  for (const item of ['bin', 'package.json', 'test', 'install.sh', '.github']) {
    assert.equal(exists(path.join(target(home), item)), false, `${item} must not be installed`);
  }
  assert.equal(exists(backups(home)), false, 'no backup on a fresh install');
  assert.equal(r.err, '');
});

test('reinstall moves the old install to ~/.claude/backups/claude-setup/, outside the skills folder', () => {
  const home = makeHome();
  assert.equal(install(home).code, 0);
  put(path.join(target(home), 'MY-EDIT.txt'), 'local change\n');

  const r = install(home);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /existing skill backed up to: .*backups.*claude-setup/);
  assert.equal(exists(path.join(target(home), 'MY-EDIT.txt')), false, 'new install is clean');
  assert.ok(exists(path.join(target(home), 'SKILL.md')));

  const kept = fs.readdirSync(backups(home));
  assert.equal(kept.length, 1);
  assert.match(kept[0], /^\d+$/, 'backup is named by timestamp');
  assert.equal(fs.readFileSync(path.join(backups(home), kept[0], 'MY-EDIT.txt'), 'utf8'), 'local change\n');
  // Claude Code loads every folder under skills/, so no backup may live there.
  assert.deepEqual(fs.readdirSync(skillsDir(home)), ['claude-setup']);

  // A second reinstall never overwrites the first backup.
  assert.equal(install(home).code, 0);
  assert.equal(fs.readdirSync(backups(home)).length, 2);
  assert.ok(exists(path.join(backups(home), kept[0], 'MY-EDIT.txt')));
});

test('legacy claude-setup.bak.* folders are migrated into the backups folder', () => {
  const home = makeHome();
  put(path.join(skillsDir(home), 'claude-setup.bak.1700000000000', 'SKILL.md'), 'old one\n');
  put(path.join(skillsDir(home), 'claude-setup.bak.1700000000001', 'SKILL.md'), 'old two\n');
  put(path.join(skillsDir(home), 'claude-setup.bak.notes'), 'a file, not a backup folder\n');
  put(path.join(skillsDir(home), 'other-skill', 'SKILL.md'), 'unrelated\n');

  const r = install(home);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /moved old backup: .*claude-setup\.bak\.1700000000000 -> .*1700000000000/);
  assert.equal(fs.readFileSync(path.join(backups(home), '1700000000000', 'SKILL.md'), 'utf8'), 'old one\n');
  assert.equal(fs.readFileSync(path.join(backups(home), '1700000000001', 'SKILL.md'), 'utf8'), 'old two\n');
  assert.deepEqual(fs.readdirSync(skillsDir(home)).sort(), ['claude-setup', 'claude-setup.bak.notes', 'other-skill']);
  assert.ok(exists(path.join(target(home), 'SKILL.md')));

  // A legacy backup whose timestamp is already taken gets a numeric suffix instead of overwriting.
  put(path.join(skillsDir(home), 'claude-setup.bak.1700000000000', 'SKILL.md'), 'old three\n');
  assert.equal(install(home).code, 0);
  assert.equal(fs.readFileSync(path.join(backups(home), '1700000000000', 'SKILL.md'), 'utf8'), 'old one\n');
  assert.equal(fs.readFileSync(path.join(backups(home), '1700000000000-2', 'SKILL.md'), 'utf8'), 'old three\n');
});

test('--dry-run reports the plan and changes nothing', () => {
  const home = makeHome();
  const fresh = install(home, '--dry-run');
  assert.equal(fresh.code, 0, fresh.err);
  assert.match(fresh.out, /would install \d+ items into/);
  assert.match(fresh.out, /no changes made \(--dry-run\)/);
  assert.equal(exists(path.join(home, '.claude')), false, 'nothing was created, not even ~/.claude');

  assert.equal(install(home).code, 0);
  put(path.join(skillsDir(home), 'claude-setup.bak.1700000000000', 'SKILL.md'), 'old\n');
  put(path.join(target(home), 'MY-EDIT.txt'), 'local change\n');
  const before = snapshot(home);

  const again = install(home, '--dry-run');
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /would back up existing install:/);
  assert.match(again.out, /would move old backup:/);
  assert.deepEqual(snapshot(home), before);
});

test('--uninstall removes the skill and keeps backups', () => {
  const home = makeHome();
  const none = install(home, '--uninstall');
  assert.equal(none.code, 0, none.err);
  assert.match(none.out, /nothing to remove/);

  assert.equal(install(home).code, 0);
  assert.equal(install(home).code, 0); // creates one backup
  const dry = install(home, '--uninstall', '--dry-run');
  assert.equal(dry.code, 0);
  assert.match(dry.out, /would remove directory:/);
  assert.ok(exists(target(home)), '--uninstall --dry-run keeps the skill');

  const r = install(home, '--uninstall');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /removed directory: .*claude-setup/);
  assert.match(r.out, /left in place: 1 backup\(s\)/);
  assert.equal(exists(target(home)), false);
  assert.equal(fs.readdirSync(backups(home)).length, 1);
});

test('--uninstall on a symlinked install removes the link only', () => {
  if (process.platform === 'win32') return;
  const home = makeHome();
  const real = path.join(home, 'checkout');
  put(path.join(real, 'SKILL.md'), 'dev copy\n');
  fs.mkdirSync(skillsDir(home), { recursive: true });
  fs.symlinkSync(real, target(home));

  const r = install(home, '--uninstall');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /removed symlink:/);
  assert.deepEqual(fs.readdirSync(skillsDir(home)), []);
  assert.equal(fs.readFileSync(path.join(real, 'SKILL.md'), 'utf8'), 'dev copy\n');
});

test('an unknown flag exits 2 with usage on stderr and changes nothing', () => {
  const home = makeHome();
  const r = install(home, '--bogus');
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown option: --bogus/);
  assert.match(r.err, /Usage: claude-setup-install/);
  assert.equal(r.out, '');
  assert.equal(exists(path.join(home, '.claude')), false);

  const mixed = install(home, '--dry-run', '--nope');
  assert.equal(mixed.code, 2);
});

test('--help exits 0 and prints usage', () => {
  const home = makeHome();
  const r = install(home, '--help');
  assert.equal(r.code, 0);
  assert.match(r.out, /Usage: claude-setup-install/);
  assert.equal(exists(path.join(home, '.claude')), false);
});
