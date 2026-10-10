import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { verifyFiles, scanForSecrets, parseArgs } from '../scripts/verify.mjs';

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
const fakes = {
  'Anthropic API key': () => 'sk' + '-ant-' + 'api03-' + 'Ab9'.repeat(12),
  'OpenAI API key': () => 'sk' + '-proj-' + 'Qq7'.repeat(12),
  'Stripe key': () => 'sk' + '_live_' + 'Mm5'.repeat(8),
  'Stripe restricted key': () => 'rk' + '_live_' + 'Mm5'.repeat(8),
  'Google API key': () => 'AI' + 'za' + 'SyA1234567890abcdefghijklmnopqrstuv',
  'GitHub OAuth token': () => 'gh' + 'o_' + 'a1'.repeat(15),
  'GitHub server token': () => 'gh' + 's_' + 'a1'.repeat(15),
  'GitLab token': () => 'glpat' + '-' + 'q'.repeat(24),
  'Slack token': () => 'xox' + 'p-' + '1234567890-abcdefghij',
  'npm token': () => 'npm' + '_' + 'Xy3'.repeat(12),
  'AWS temporary key': () => 'AS' + 'IA' + 'C'.repeat(16),
  JWT: () => 'ey' + 'JhbGciOiJIUzI1NiJ9' + '.' + 'ey' + 'JzdWIiOiIxMjM0NTY3ODkwIn0' + '.' + 'dBjftJeZ4CVPmB92K27uhbUJU1p1r',
  'URL credentials': () => 'postgres' + '://app:' + 'hunter2pass' + '@db.internal.example/app',
};

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
  assert.match(res.stdout, /error\s+data\.json: invalid JSON at line 1, column 8\n/);
  assert.match(res.stdout, /1 error/);
});

test('invalid JSON reports only line and column, never a snippet of the file', () => {
  const dir = makeTmp();
  const key = fakes['Anthropic API key']();
  write(dir, 'bad.json', `{\n  "env": {\n    "ANTHROPIC_API_KEY": ${key}\n  }\n}\n`);
  const res = run(dir, ['bad.json']);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /bad\.json: invalid JSON at line 3, column 26\n/);
  assert.ok(!res.stdout.includes(key.slice(0, 10)), 'JSON error leaked file content');
  assert.ok(!/Unexpected|not valid JSON|api03/.test(res.stdout), 'parser message echoed');
  for (const text of ['', '{', '[1,]', '{"a":1}}', '{"a":"\n"}', "{'a':1}", '{"a":01}']) {
    write(dir, 'x.json', text);
    const out = verifyFiles(dir, ['x.json']).find((f) => f.level === 'error');
    assert.match(out.message, /^invalid JSON( at line \d+, column \d+)?$/, JSON.stringify(text));
  }
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
  assert.match(res.stdout, /line 1: possible secret \(AWS access key\)/);
});

test('current key formats are caught, each with the right kind', () => {
  const expected = {
    'Anthropic API key': 'Anthropic API key',
    'OpenAI API key': 'OpenAI API key',
    'Stripe key': 'Stripe key',
    'Stripe restricted key': 'Stripe key',
    'Google API key': 'Google API key',
    'GitHub OAuth token': 'GitHub token',
    'GitHub server token': 'GitHub token',
    'GitLab token': 'GitLab token',
    'Slack token': 'Slack token',
    'npm token': 'npm token',
    'AWS temporary key': 'AWS access key',
    JWT: 'JWT',
    'URL credentials': 'URL credentials',
  };
  for (const [name, make] of Object.entries(fakes)) {
    const secret = make();
    assert.deepEqual(scanForSecrets(`token ${secret} end`).map((h) => h.kind), [expected[name]], name);
    // And through the CLI: reported by line, never printed.
    const dir = makeTmp();
    write(dir, 'AGENTS.md', `# x\n\nuse ${secret} here\n`);
    const res = run(dir, ['AGENTS.md']);
    assert.equal(res.status, 1, name);
    assert.match(res.stdout, new RegExp(`line 3: possible secret \\(${expected[name]}\\)`), name);
    assert.ok(!res.stdout.includes(secret.slice(4)), `${name} leaked`);
  }
  const plainSk = 'sk' + '-' + 'Zz9'.repeat(8);
  assert.deepEqual(scanForSecrets(plainSk).map((h) => h.kind), ['OpenAI API key']);
  const ghPat = 'github_pat_' + 'A'.repeat(30);
  assert.deepEqual(scanForSecrets(`x = ${ghPat}`).map((h) => h.kind), ['GitHub token']);
  assert.deepEqual(scanForSecrets(fakes['GitHub OAuth token']().replace('gho_', 'ghp_')).map((h) => h.kind), ['GitHub token']);
});

test('generic assignments need a literal-looking value', () => {
  const hits = (text) => scanForSecrets(text).map((h) => h.kind);
  assert.deepEqual(hits('API_KEY = "abcdEFGH12345678"'), ['api_key assignment']);
  assert.deepEqual(hits('"password": "hunter2hunter2hunter2"'), ['password assignment']);
  assert.deepEqual(hits('ANTHROPIC_API_KEY=Zk93jd82hf72hd91Kd82'), ['api_key assignment']);
  assert.deepEqual(hits("client_secret: 'Q8x2/ab+cd9ZZ1qq7w=='"), ['secret assignment']);
});

test('prose, calls, templates, paths and placeholders are not secrets', () => {
  const clean = [
    '"deny": ["Read(./secrets/**)", "Read(./.env.*)"]',
    'password: short',
    'api_key = your-api-key-goes-here',
    'api_key: your-key-here-12345678',
    'secret = changeme-changeme',
    'secret = changeme-changeme1',
    'Never print a token: use a placeholder.',
    'TOKEN=${TOKEN}',
    'token: ${CI_JOB_TOKEN_1234567890}',
    'API_KEY=<your-api-key-1234567890>',
    'API_KEY=xxxxxxxxxxxxxxxxxxxxxxxx',
    '- Auth token: refresh-token-rotation-enabled',
    '- password = hashPassword(req.body)',
    '- password = hashPassword2(req.body.password)',
    'password: "correct horse battery staple 2"',
    'token: src/auth/tokens2/handler.ts',
    'secret: process.env.SECRET_KEY_1234',
    'See https://example.com/docs/a1b2c3',
    'DATABASE_URL=postgres://user:password@localhost:5432/db',
    'DATABASE_URL=postgres://postgres:postgres@localhost/db',
    'DATABASE_URL=postgres://user:<password>@host/db',
    'DATABASE_URL=postgres://user:${DB_PASS}@host/db',
    'a JWT starts with eyJ and has three parts',
    'sk-learn is a Python package; skip-this-line-because-it-is-prose',
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

test('CLAUDE.md must start with @AGENTS.md: warning alone, error when AGENTS.md exists', () => {
  const dir = makeTmp();
  write(dir, 'CLAUDE.md', '# Claude\n@AGENTS.md\n');
  write(dir, 'ok/CLAUDE.md', '\n\n@AGENTS.md\nExtra.\n');
  const findings = verifyFiles(dir, ['CLAUDE.md', 'ok/CLAUDE.md']);
  assert.deepEqual(levels(findings, 'warning').map((w) => w.file), ['CLAUDE.md']);
  assert.match(levels(findings, 'warning')[0].message, /@AGENTS\.md/);
  assert.equal(levels(findings, 'error').length, 0);
  assert.equal(run(dir, ['CLAUDE.md']).status, 0);

  write(dir, 'AGENTS.md', '# Project\n');
  const strict = verifyFiles(dir, ['CLAUDE.md', 'ok/CLAUDE.md']);
  assert.deepEqual(levels(strict, 'error').map((e) => e.file), ['CLAUDE.md']);
  assert.equal(levels(strict, 'warning').length, 0);
  assert.equal(run(dir, ['CLAUDE.md']).status, 1);
  // A nested CLAUDE.md is judged by AGENTS.md next to it, not the root one.
  assert.equal(levels(verifyFiles(dir, ['ok/CLAUDE.md']), 'error').length, 0);
  write(dir, 'ok/AGENTS.md', '# Sub\n');
  write(dir, 'ok/CLAUDE.md', '# no import\n');
  assert.equal(levels(verifyFiles(dir, ['ok/CLAUDE.md']), 'error').length, 1);
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

const settingsFindings = (settings, setup) => {
  const dir = makeTmp();
  write(dir, '.claude/settings.json', typeof settings === 'string' ? settings : JSON.stringify(settings));
  if (setup) setup(dir);
  return { dir, findings: verifyFiles(dir, ['.claude/settings.json']) };
};
const withSchema = (o) => ({ $schema: 'x', ...o });

test('settings.json: every spelling of unrestricted Bash is an error', () => {
  for (const rule of ['Bash', 'Bash(*)', 'Bash( * )', 'Bash(:*)', 'Bash(**)', 'Bash()', ' Bash(*) ', 'Bash(*:*)']) {
    const { findings } = settingsFindings(withSchema({ permissions: { allow: ['Bash(npm test)', rule] } }));
    const errors = levels(findings, 'error');
    assert.equal(errors.length, 1, rule);
    assert.match(errors[0].message, /allows every shell command/, rule);
  }
  for (const rule of ['Bash(npm run *)', 'Bash(git diff *)', 'Read(*)', 'Bash(*.test.js)']) {
    const { findings } = settingsFindings(withSchema({ permissions: { allow: [rule] } }));
    assert.equal(levels(findings, 'error').length, 0, rule);
  }
});

test('settings.json: enableAllProjectMcpServers and risky defaultMode are errors', () => {
  const { findings } = settingsFindings(withSchema({ enableAllProjectMcpServers: true, permissions: { defaultMode: 'auto' } }));
  const errors = levels(findings, 'error').map((e) => e.message);
  assert.equal(errors.length, 2);
  assert.ok(errors.some((m) => m.includes('enableAllProjectMcpServers')));
  assert.ok(errors.some((m) => m.includes('"auto"')));
  assert.equal(levels(settingsFindings(withSchema({ enableAllProjectMcpServers: false })).findings, 'error').length, 0);
  assert.equal(levels(settingsFindings(withSchema({ defaultMode: 'bypassPermissions' })).findings, 'error').length, 1);
});

test('settings.json: env values that look like secrets are errors and are not printed', () => {
  const key = fakes['Anthropic API key']();
  const url = fakes['URL credentials']();
  const lit = 'Zk93jd82hf72hd91Kd82xQ';
  const { dir, findings } = settingsFindings(
    withSchema({ env: { ANTHROPIC_API_KEY: key, DB: url, SOMETHING_ELSE: lit, NODE_ENV: 'production', LOG_LEVEL: 'debug', N: 5 } }),
  );
  const envErrors = levels(findings, 'error').filter((e) => e.message.startsWith('env.'));
  assert.deepEqual(envErrors.map((e) => e.message.split(' ')[0]), ['env.ANTHROPIC_API_KEY', 'env.DB', 'env.SOMETHING_ELSE']);
  const res = run(dir, ['.claude/settings.json']);
  assert.equal(res.status, 1);
  for (const secret of [key, url, lit]) assert.ok(!res.stdout.includes(secret.slice(5, 20)), 'env secret leaked');
  assert.equal(levels(settingsFindings(withSchema({ env: { NODE_ENV: 'test', FEATURE_FLAG: 'on', TOKEN_FILE: './token.txt' } })).findings, 'error').length, 0);
});

test('settings.json: allow rules for network and shell-escape tools warn, with the tool name only', () => {
  const rules = [
    ['Bash(curl *)', 'curl'],
    ['Bash(wget https://x.example/*)', 'wget'],
    ['Bash(ssh *)', 'ssh'],
    ['Bash(scp *)', 'scp'],
    ['Bash(nc *)', 'nc'],
    ['Bash(bash -c *)', 'bash -c'],
    ['Bash(sh -c *)', 'sh -c'],
    ['Bash(eval *)', 'eval'],
    ['Bash(curl:*)', 'curl'],
    ['Bash(npm test && curl -H "X-Key: abc" *)', 'curl'],
  ];
  for (const [rule, tool] of rules) {
    const { findings } = settingsFindings(withSchema({ permissions: { allow: [rule] } }));
    const warnings = levels(findings, 'warning');
    assert.equal(warnings.length, 1, rule);
    assert.ok(warnings[0].message.includes(` ${tool} `), `${rule}: ${warnings[0].message}`);
    assert.ok(!warnings[0].message.includes('Bash('), 'the rule text must not be echoed');
    assert.equal(levels(findings, 'error').length, 0, rule);
  }
  const quiet = settingsFindings(withSchema({ permissions: { allow: ['Bash(npm test)', 'Bash(git status)', 'Bash(bash scripts/check.sh)', 'Bash(ncu *)'] } }));
  assert.equal(levels(quiet.findings, 'warning').length, 0);
});

test('settings.json: warns when the project has .env* files but no Read deny for them', () => {
  const noDeny = withSchema({ permissions: { allow: ['Bash(npm test)'], deny: ['Read(./secrets/**)'] } });
  const missing = settingsFindings(noDeny, (dir) => write(dir, '.env.local', 'X=1\n'));
  assert.equal(levels(missing.findings, 'warning').length, 1);
  assert.match(levels(missing.findings, 'warning')[0].message, /has \.env\* files but permissions\.deny has no Read rule/);
  assert.equal(levels(missing.findings, 'error').length, 0);

  const covered = withSchema({ permissions: { deny: ['Read(./.env)', 'Read(./.env.*)'] } });
  assert.equal(levels(settingsFindings(covered, (dir) => write(dir, '.env', 'X=1\n')).findings, 'warning').length, 0);
  assert.equal(levels(settingsFindings(withSchema({ permissions: { deny: ['Read(**/.env*)'] } }), (dir) => write(dir, '.env', 'X=1\n')).findings, 'warning').length, 0);
  // No .env* file, no warning.
  assert.equal(levels(settingsFindings(noDeny).findings, 'warning').length, 0);
  // The .env file itself is only checked for existence: its content is never read.
  const secretEnv = settingsFindings(noDeny, (dir) => write(dir, '.env', `KEY=${fakeGithub()}\n`));
  assert.ok(secretEnv.findings.every((f) => f.file === '.claude/settings.json'));
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

test('AGENTS.md and CLAUDE.md: dangling links and backticked paths are errors', () => {
  const dir = makeTmp();
  write(dir, 'docs/architecture.md', '# Arch\n');
  write(dir, '.claude/agents/explorer.md', '# Explorer\n');
  write(dir, 'docs/plans/.keep', '');
  write(dir, 'AGENTS.md', [
    'See [architecture](docs/architecture.md) and [config](docs/config.md).',
    'Agents: `.claude/agents/explorer.md`, `.claude/agents/reviewer.md`.',
    'Also `docs/architecture.md#intro` and [top](#top).',
  ].join('\n'));
  const res = run(dir, ['AGENTS.md']);
  assert.equal(res.status, 1);
  const errors = levels(verifyFiles(dir, ['AGENTS.md']), 'error');
  assert.deepEqual(errors.map((e) => [e.file, e.message]), [
    ['AGENTS.md', 'links to docs/config.md, which does not exist'],
    ['AGENTS.md', 'links to .claude/agents/reviewer.md, which does not exist'],
  ]);
  assert.match(res.stdout, /error {3}AGENTS\.md: links to docs\/config\.md, which does not exist/);
});

test('AGENTS.md link check: existing links, exempt paths, URLs, globs, placeholders and code are not errors', () => {
  const dir = makeTmp();
  write(dir, 'docs/guide.md', '# Guide\n');
  write(dir, 'CLAUDE.local.md', 'private\n');
  write(dir, 'AGENTS.md', [
    'Good: [guide](./docs/guide.md) and `docs/guide.md` and `docs/`.',
    'Created later: `docs/plans/`, [plan](docs/plans/2026-01.md), `.claude/handoff.md`, `.claude/agent-memory/notes.md`.',
    'Not files: [site](https://example.com/docs/x.md), [mail](mailto:a@b.dev), `~/notes/x.md`, `/etc/hosts`.',
    'Not paths: `docs/*.md`, `docs/<name>.md`, `pnpm test`, `CLAUDE.local.md`, `.claude/settings.local.json`.',
    '```',
    'See `docs/never-written.md` in this example.',
    '```',
  ].join('\n'));
  assert.deepEqual(levels(verifyFiles(dir, ['AGENTS.md']), 'error'), []);
  assert.equal(run(dir, ['AGENTS.md']).status, 0);
});

test('link check runs only on AGENTS.md and CLAUDE.md', () => {
  const dir = makeTmp();
  write(dir, 'README.md', 'See [missing](docs/missing.md) and `docs/gone.md`.\n');
  write(dir, 'CLAUDE.md', '@AGENTS.md\nSee `docs/gone.md`.\n');
  write(dir, 'AGENTS.md', '# Project\n');
  const findings = verifyFiles(dir, ['README.md', 'CLAUDE.md']);
  assert.deepEqual(levels(findings, 'error').map((e) => [e.file, e.message]), [
    ['CLAUDE.md', 'links to docs/gone.md, which does not exist'],
  ]);
});

test('--expect: each missing planned path is an error; present paths pass', () => {
  const dir = makeTmp();
  write(dir, 'docs/config.md', '# Config\n');
  write(dir, 'AGENTS.md', '# Project\n');
  const missing = spawnSync(process.execPath, [SCRIPT, '--dir', dir, '--expect', 'docs/config.md,docs/api.md, docs/plans/x.md'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /error {3}--expect: expected docs\/api\.md from the plan, but it was not written/);
  assert.match(missing.stdout, /expected docs\/plans\/x\.md from the plan, but it was not written/);
  assert.doesNotMatch(missing.stdout, /expected docs\/config\.md/);

  const ok = spawnSync(process.execPath, [SCRIPT, `--dir=${dir}`, '--expect=docs/config.md', 'AGENTS.md'], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /verify: 1 file, 0 errors, 0 warnings/);
});

test('--expect works without files, and parseArgs reads both forms', () => {
  const dir = makeTmp();
  assert.equal(run(dir, []).status, 2, 'no files and no expect is a usage error');
  const onlyExpect = spawnSync(process.execPath, [SCRIPT, '--dir', dir, '--expect', 'AGENTS.md'], { encoding: 'utf8' });
  assert.equal(onlyExpect.status, 1);
  assert.deepEqual(parseArgs(['--dir', 'p', '--expect', 'a.md, b/ ,', 'AGENTS.md']), { dir: 'p', files: ['AGENTS.md'], expect: ['a.md', 'b/'] });
  assert.deepEqual(parseArgs(['--expect=x.md']), { dir: '.', files: [], expect: ['x.md'] });
});

test('AGENTS.md: slash words in prose are not treated as paths', () => {
  const dir = makeTmp();
  write(dir, 'src/index.ts', 'export {};\n');
  write(dir, 'AGENTS.md', 'Use `and/or` and `read/write` freely. Code lives in `src/` and `src/index.ts`.\n');
  const errors = levels(verifyFiles(dir, ['AGENTS.md']), 'error');
  assert.deepEqual(errors, []);
});
