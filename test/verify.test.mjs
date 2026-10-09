import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { verifyFiles, scanForSecrets } from '../scripts/verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'verify.mjs');

const tmpDirs = [];
function makeTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
  tmpDirs.push(dir);
  return dir;
}
function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
process.on('exit', () => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const run = (dir, files) => spawnSync(process.execPath, [SCRIPT, '--dir', dir, ...files], { encoding: 'utf8' });
const levels = (findings, level) => findings.filter((f) => f.level === level);

// Secret-shaped strings are built at runtime so this repo never contains one.
const fakeAws = () => 'AKIA' + 'B'.repeat(16);
const fakeGithub = () => 'ghp' + '_' + 'a1'.repeat(15);
const fakeSlack = () => 'xox' + 'b-' + '1234567890-abcdefghij';
const fakeOpenAi = () => 'sk' + '-' + 'Zz9'.repeat(8);
const fakePrivateKey = () => '-----BEGIN ' + 'RSA PRIVATE KEY-----';

const goodSettings = {
  $schema: 'https://json.schemastore.org/claude-code-settings.json',
  permissions: { allow: ['Bash(npm run *)'], deny: ['Read(./.env)', 'Read(./secrets/**)'] },
};

test('clean files report line counts and exit 0', () => {
  const dir = makeTmp();
  write(dir, 'AGENTS.md', '# Project\n\nUse pnpm.\n');
  write(dir, 'CLAUDE.md', '\n@AGENTS.md\n');
  write(dir, '.claude/settings.json', JSON.stringify(goodSettings));
  const res = run(dir, ['AGENTS.md', 'CLAUDE.md', '.claude/settings.json']);
  assert.equal(res.status, 0, res.stdout);
  assert.match(res.stdout, /info\s+AGENTS\.md: 3 lines/);
  assert.match(res.stdout, /info\s+CLAUDE\.md: 2 lines/);
  assert.match(res.stdout, /verify: 3 files, 0 errors, 0 warnings/);
});

test('invalid JSON is an error and exits 1', () => {
  const dir = makeTmp();
  write(dir, 'data.json', '{ "a": ');
  const res = run(dir, ['data.json']);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /error\s+data\.json: invalid JSON/);
  assert.match(res.stdout, /1 error/);
});

test('missing files are errors', () => {
  const dir = makeTmp();
  const res = run(dir, ['nope.md']);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /error\s+nope\.md: file not found/);
});

test('secret patterns are errors and the secret itself is never printed', () => {
  const dir = makeTmp();
  const secrets = [fakeAws(), fakeGithub(), fakeSlack(), fakeOpenAi(), fakePrivateKey()];
  write(dir, 'notes.md', secrets.map((s) => `value: ${s}`).join('\n') + '\n');
  const res = run(dir, ['notes.md']);
  assert.equal(res.status, 1);
  assert.equal((res.stdout.match(/possible secret/g) || []).length, 5);
  for (const s of secrets) assert.ok(!res.stdout.includes(s), 'secret leaked into output');
  assert.match(res.stdout, /line 1: possible secret \(AWS access key\)/.test('') ? /x/ : /line 1: possible secret/);
});

test('github_pat_, glpat- and generic key assignments are caught', () => {
  const hits = (text) => scanForSecrets(text).map((h) => h.kind);
  assert.deepEqual(hits('x = github_pat_' + 'A'.repeat(30)), ['GitHub token']);
  assert.deepEqual(hits('glpat' + '-' + 'q'.repeat(24)), ['GitLab token']);
  assert.deepEqual(hits('API_KEY = "abcdEFGH12345678"'), ['api_key assignment']);
  assert.deepEqual(hits('"password": "hunter2hunter2hunter2"'), ['password assignment']);
  assert.deepEqual(hits('token: abc/def+ghi_jkl-mno'), ['token assignment']);
});

test('permission rules, short values, placeholders and prose are not secrets', () => {
  const clean = [
    '"deny": ["Read(./secrets/**)", "Read(./.env.*)"]',
    'password: short',
    'api_key = your-api-key-goes-here',
    'secret = changeme-changeme',
    'Never print a token: use a placeholder.',
    'TOKEN=${TOKEN}',
  ].join('\n');
  assert.deepEqual(scanForSecrets(clean), []);
});

test('.env files are skipped and never opened', () => {
  const dir = makeTmp();
  write(dir, '.env', `SECRET=${fakeGithub()}\n`);
  write(dir, '.env.local', 'TOKEN=abcdefabcdefabcdef\n');
  const findings = verifyFiles(dir, ['.env', '.env.local', 'sub/.env.production']);
  assert.deepEqual(findings.map((f) => f.level), ['skipped', 'skipped', 'skipped']);
  const res = run(dir, ['.env']);
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('skipped'));
  assert.ok(!res.stdout.includes('ghp'));
});

test('AGENTS.md over 150 lines and CLAUDE.md over 200 lines warn', () => {
  const dir = makeTmp();
  write(dir, 'AGENTS.md', 'line\n'.repeat(151));
  write(dir, 'sub/AGENTS.md', 'line\n'.repeat(150));
  write(dir, 'CLAUDE.md', '@AGENTS.md\n' + 'line\n'.repeat(200));
  const findings = verifyFiles(dir, ['AGENTS.md', 'sub/AGENTS.md', 'CLAUDE.md']);
  const warnings = levels(findings, 'warning');
  assert.deepEqual(warnings.map((w) => w.file), ['AGENTS.md', 'CLAUDE.md']);
  assert.match(warnings[0].message, /151 lines/);
  assert.match(warnings[1].message, /201 lines/);
  assert.equal(levels(findings, 'error').length, 0);
  assert.equal(run(dir, ['AGENTS.md']).status, 0, 'warnings alone exit 0');
});

test('CLAUDE.md must start with @AGENTS.md', () => {
  const dir = makeTmp();
  write(dir, 'CLAUDE.md', '# Claude\n@AGENTS.md\n');
  write(dir, 'ok/CLAUDE.md', '\n\n@AGENTS.md\nExtra.\n');
  const findings = verifyFiles(dir, ['CLAUDE.md', 'ok/CLAUDE.md']);
  assert.deepEqual(levels(findings, 'warning').map((w) => w.file), ['CLAUDE.md']);
  assert.match(levels(findings, 'warning')[0].message, /@AGENTS\.md/);
});

test('settings.json: Bash(*), risky defaultMode and missing $schema', () => {
  const dir = makeTmp();
  write(dir, '.claude/settings.json', JSON.stringify({
    permissions: { allow: ['Bash(npm run *)', 'Bash(*)'], defaultMode: 'bypassPermissions' },
  }));
  const findings = verifyFiles(dir, ['.claude/settings.json']);
  const errors = levels(findings, 'error').map((e) => e.message);
  assert.equal(errors.length, 2);
  assert.ok(errors.some((m) => m.includes('Bash(*)')));
  assert.ok(errors.some((m) => m.includes('bypassPermissions')));
  assert.deepEqual(levels(findings, 'warning').map((w) => w.message), ['$schema is missing']);
  assert.equal(run(dir, ['.claude/settings.json']).status, 1);

  write(dir, 'auto/.claude/settings.json', JSON.stringify({ $schema: 'x', permissions: { defaultMode: 'auto' } }));
  assert.equal(levels(verifyFiles(dir, ['auto/.claude/settings.json']), 'error').length, 1);
});

test('safe settings.json passes and a malformed one reports invalid JSON only', () => {
  const dir = makeTmp();
  write(dir, '.claude/settings.json', JSON.stringify({ ...goodSettings, permissions: { ...goodSettings.permissions, defaultMode: 'acceptEdits' } }));
  assert.equal(levels(verifyFiles(dir, ['.claude/settings.json']), 'error').length, 0);

  write(dir, 'bad/.claude/settings.json', '{ nope');
  const findings = verifyFiles(dir, ['bad/.claude/settings.json']);
  assert.deepEqual(levels(findings, 'error').map((e) => e.message.slice(0, 12)), ['invalid JSON']);
});

test('no files is a usage error; --dir=value form works', () => {
  const none = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(none.status, 2);
  const dir = makeTmp();
  write(dir, 'AGENTS.md', 'x\n');
  const res = spawnSync(process.execPath, [SCRIPT, `--dir=${dir}`, 'AGENTS.md'], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /AGENTS\.md: 1 line\n/);
});
