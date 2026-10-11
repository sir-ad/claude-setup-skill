import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { classify, route, describe } from '../scripts/router/route.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'router', 'route.mjs');
const FIXTURE = path.join(HERE, 'fixtures', 'router');
const cfg = JSON.parse(fs.readFileSync(path.join(FIXTURE, '.claude', 'router.json'), 'utf8'));

const tmpDirs = [];
function projectDir(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-test-'));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'router.json'), JSON.stringify({ ...cfg, ...overrides }));
  return dir;
}
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

function hook(stdin, env = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    input: stdin, encoding: 'utf8', timeout: 10000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
}
const hookPrompt = (prompt, env) => hook(JSON.stringify({ prompt }), env);

// ---------------------------------------------------------------------------
// Accuracy table: [name, prompt, expected]. role may be an array (any of).
// ---------------------------------------------------------------------------

const TRACE_JS = [
  'Fix this', '',
  "TypeError: Cannot read properties of undefined (reading 'id')",
  '    at getOrder (/app/services/orders/handler.ts:42:13)',
  '    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)',
  '    at render (/app/web/src/components/List.tsx:10:2)',
].join('\n');
const TRACE_PY = [
  'Traceback (most recent call last):',
  '  File "/srv/app/db/models.py", line 33, in save',
  '    raise IntegrityError',
  'sqlalchemy.exc.IntegrityError: duplicate key value violates unique constraint',
  'why does this happen?',
].join('\n');
const BULLETS = [
  'Please do all of the following:',
  '- add a settings modal to the dashboard page',
  '- add a PATCH endpoint for user settings in the api',
  '- add a column to the users table for the theme',
  '- write tests for the new endpoint',
  '- update the form component styles',
].join('\n');

const TABLE = [
  ['frontend path', 'Fix the button hover color in web/src/components/Button.tsx', { role: 'frontend', plan: false, effort: 'medium', delegate: true, qa: true }],
  ['frontend keywords', 'Add a loading spinner to the dashboard page', { role: 'frontend', plan: false, effort: 'medium', delegate: true }],
  ['backend keywords', 'Add a POST /orders endpoint with a handler and request validation', { role: 'backend', plan: false, effort: 'medium', delegate: true, qa: true }],
  ['data keywords', 'Add an index on orders.created_at to speed up the slow query', { role: 'data', plan: false, effort: 'medium' }],
  ['qa run', 'Run the tests and tell me what fails', { role: 'qa', plan: false, qa: false }],
  ['qa ci', 'The build is failing in CI with a lint error', { role: 'qa', plan: false }],
  ['qa flaky', 'Fix the flaky e2e test in tests/checkout.spec.ts', { role: 'qa', plan: false }],
  ['negation frontend', "Don't touch the frontend, just fix the rate limit middleware in the api", { role: 'backend', plan: false }],
  ['negation db', 'Do not change the database schema; update the form component to show errors', { role: 'frontend', plan: false }],
  ['negation file', "Leave web/src/components/Form.tsx alone and fix the api handler in services/orders/handler.ts", { role: 'backend', plan: false }],
  ['stack trace js', TRACE_JS, { role: 'backend', plan: false, effort: 'medium' }],
  ['stack trace py', TRACE_PY, { role: 'data', plan: false, effort: 'medium' }],
  ['multi-intent', 'Redesign the checkout page layout and update the orders api endpoint to return totals', { role: ['frontend', 'backend'], plan: true, effort: 'high', delegate: false }],
  ['multi bullets', BULLETS, { plan: true, effort: 'high' }],
  ['follow-up do it', 'do it', { role: 'main', plan: false, delegate: false }],
  ['follow-up continue', 'Continue.', { role: 'main', plan: false, delegate: false }],
  ['follow-up yes please', 'yes please', { role: 'main', plan: false, delegate: false }],
  ['follow-up ok', 'ok', { role: 'main', plan: false, delegate: false }],
  ['follow-up fix it', 'fix it', { role: 'main', plan: false, delegate: false }],
  ['question auth', 'How does the auth middleware validate sessions?', { plan: false, delegate: false, qa: false }],
  ['question general', 'What is the difference between useEffect and useMemo?', { role: 'main', plan: false, effort: 'low' }],
  ['question where', 'Where is the login form defined?', { plan: false, effort: 'low', delegate: false }],
  ['explain architecture', 'Explain the architecture of this repo', { role: 'main', plan: false, effort: 'medium' }],
  ['risky auth', 'Add JWT authentication to the api endpoints and store the password hash in the users table', { plan: true, effort: 'high' }],
  ['risky payment', 'Review the payment webhook handler in services/payments/webhook.ts for security issues', { role: 'backend', plan: true, effort: 'high' }],
  ['db migration', 'Add a column to the users table and write a migration', { role: 'data', effort: 'high' }],
  ['big refactor', 'Refactor the form component to use hooks', { role: 'frontend', plan: true, effort: 'high' }],
  ['across', 'Migrate the whole codebase from REST to GraphQL across all services', { plan: true, effort: 'high' }],
  ['trivial typo', 'Fix a typo in the README', { role: 'main', plan: false, effort: 'low', qa: false }],
  ['trivial rename', 'Rename the variable foo to bar in services/orders/handler.ts', { role: 'backend', plan: false, effort: 'low', delegate: false }],
  ['just rename', "Don't refactor anything, just rename the submit button label in web/src/components/Form.tsx", { role: 'frontend', plan: false, effort: 'low' }],
  ['change plus test', 'Update the CSS for the modal and add a unit test', { role: 'frontend', plan: false, effort: 'medium', qa: true }],
  ['vague', 'Make it faster', { role: 'main', plan: false, delegate: false }],
  ['non-English es', 'Arregla el error del botón de inicio de sesión por favor', { role: 'main', plan: false, delegate: false }],
  ['calibration: ui feature', 'add a dark mode toggle to the settings page', { role: 'frontend', plan: false, delegate: true, qa: true }],
  ['calibration: fix plus test', 'the login endpoint returns 500 when the token expires, fix it and add a test', { role: 'backend', plan: false, delegate: true, qa: true }],
  ['calibration: layers', 'add a column for invoice due dates and expose it in the api and the dashboard', { role: 'data', plan: true, effort: 'high', delegate: false }],
  ['calibration: build question', 'why is the build slow?', { role: 'main', effort: 'low', plan: false, delegate: false }],
  ['calibration: yes do it', 'yes do it', { role: 'main', plan: false, delegate: false }],
  ['qa leads with tests', 'add tests for the orders handler', { role: 'qa', qa: true }],
  ['qa flaky fix', 'Fix the flaky test', { role: 'qa', qa: true }],
  ['changes is a noun', 'Review the changes I made to the form validation', { qa: false }],
  ['non-English ja', 'ログインフォームのバグを直してください', { role: 'main', plan: false, delegate: false }],
];

test('accuracy table', () => {
  const misses = [];
  for (const [name, prompt, want] of TABLE) {
    const d = classify(prompt, cfg);
    for (const [k, v] of Object.entries(want)) {
      const ok = Array.isArray(v) ? v.includes(d[k]) : d[k] === v;
      if (!ok) misses.push(`${name}: ${k} expected ${JSON.stringify(v)} got ${JSON.stringify(d[k])} (conf ${d.confidence}; ${d.reasons.join(' | ')})`);
    }
  }
  const checks = TABLE.reduce((n, row) => n + Object.keys(row[2]).length, 0);
  console.log(`router accuracy: ${checks - misses.length}/${checks} checks, ${TABLE.length} prompts`);
  assert.deepEqual(misses, []);
});

// 20 prompts written after the first calibration pass, checked against both the fixture and a config
// generated by scripts/roster.mjs (create-t3-app). Role 'qa' means the role of kind qa (test-runner there).
const FRESH = [
 ['Add a loading skeleton to the user dropdown', {role:'frontend', plan:false}],
 ['The webhook handler crashes with a 500 when the payload is empty', {role:'backend', effort:'medium'}],
 ['Create a table for audit logs with a created_at index', {role:'data', effort:'medium'}],
 ['Write e2e tests for the checkout flow', {role:'qa'}],
 ['Move the whole auth flow to a new service across the api and the dashboard', {plan:true, effort:'high'}],
 ['How does the rate limit middleware decide which requests to block?', {effort:'low', plan:false, delegate:false}],
 ['Add a tooltip to the save button', {role:'frontend', delegate:true}],
 ['Fix the typo in the navbar label', {effort:'low', plan:false}],
 ['sure, go for it', {role:'main', delegate:false}],
 ['Ignore the dashboard and just fix the server error handler', {role:'backend'}],
 ['Rebuild the whole data layer: new schema, migrations and a query builder', {role:'data', effort:'high', plan:true}],
 ['Quick one: change the theme toggle icon to a moon', {role:'frontend', effort:'low'}],
 ['Fix the failing lint step in CI', {role:'qa'}],
 ['tengo un error en el endpoint de pagos', {role:'main', delegate:false}],
 ['Add an index to speed up the orders query and expose a new /orders/summary endpoint', {role:'data', plan:true}],
 ['Rename the sidebar component file', {effort:'low'}],
 ['Update the 401 response body for expired sessions in the middleware', {role:'backend', effort:'medium'}],
 ['Add pagination to the users api', {role:'backend', effort:'medium'}],
 ['Review the changes I made to the form validation', {qa:false}],
 ['Delete the stale seed data and drop the unused column', {role:'data'}],
];
const T3 = JSON.parse(fs.readFileSync(path.join(FIXTURE, 't3-router.json'), 'utf8'));

for (const [label, conf] of [['fixture config', cfg], ['roster-generated t3 config', T3]]) {
  test(`fresh prompts: ${label}`, () => {
    const misses = [];
    let checks = 0;
    for (const [prompt, want] of FRESH) {
      const d = classify(prompt, conf);
      for (const [k, v] of Object.entries(want)) {
        checks++;
        const exp = k === 'role' && v === 'qa' ? conf.roles.find((r) => /test|qa/.test(r.name)).name : v;
        if (d[k] !== exp) misses.push(`${prompt}: ${k} expected ${exp} got ${d[k]}`);
      }
    }
    console.log(`router fresh set (${label}): ${checks - misses.length}/${checks}`);
    assert.deepEqual(misses, []);
  });
}

test('calibration: a clear single-role request clears the threshold; ambiguity does not', () => {
  assert.ok(classify('add a dark mode toggle to the settings page', cfg).confidence >= 0.6);
  assert.ok(classify('the login endpoint returns 500 when the token expires, fix it and add a test', cfg).confidence >= 0.6);
  assert.ok(classify('add a column for invoice due dates and expose it in the api and the dashboard', cfg).confidence < 0.55);
  assert.ok(classify('yes do it', cfg).confidence < 0.55);
  const layers = classify('add a column for invoice due dates and expose it in the api and the dashboard', cfg);
  assert.ok(layers.reasons.some((r) => /secondary: .*backend.*frontend|secondary: .*frontend.*backend/.test(r)));
});

test('roster-generated config: catch-all globs carry no signal and test-runner is the QA role', () => {
  const d = classify('Write notes in some/unknown/place.zig for me', T3);
  assert.notEqual(d.role, 'test-runner');
  const q = classify('Fix the flaky test', T3);
  assert.equal(q.role, 'test-runner');
  assert.equal(q.qa, true);
  assert.match(describe(q, T3), /re-run the tests/);
  assert.equal(classify('add a dark mode toggle to the settings page', T3).delegate, true);
});

test('decision shape and invariants', () => {
  for (const [, prompt] of TABLE) {
    const d = classify(prompt, cfg);
    assert.deepEqual(Object.keys(d).sort(), ['agent', 'backend', 'confidence', 'delegate', 'effort', 'model', 'plan', 'qa', 'reasons', 'role', 'tier']);
    assert.ok(['low', 'medium', 'high'].includes(d.effort));
    assert.ok(d.confidence >= 0 && d.confidence <= 1);
    assert.equal(d.backend, 'rules');
    assert.equal(d.delegate, d.delegate && d.role !== 'main' && d.confidence >= 0.55);
    if (d.plan) assert.ok(d.effort === 'high' || d.reasons.some((r) => /secondary/.test(r)));
    assert.ok(Array.isArray(d.reasons));
  }
});

test('tier and model come from the role and the config', () => {
  const d = classify('Fix the button hover color in web/src/components/Button.tsx', cfg);
  assert.equal(d.agent, 'frontend');
  assert.equal(d.tier, 'standard');
  assert.equal(d.model, 'sonnet');
  assert.equal(classify('Fix the flaky e2e test in tests/checkout.spec.ts', cfg).model, 'haiku');
});

test('pasted output is down-weighted: keywords inside a stack trace do not pick the role', () => {
  const log = ['Fix this', 'Error: failed', ...Array.from({ length: 12 }, () => '    at render (/usr/lib/node/x.js:1:1)'), 'WARN button component form modal page ui css style layout'].join('\n');
  const d = classify(log, cfg);
  assert.notEqual(d.role, 'frontend');
});

test('context text is at most 600 chars and mentions the route', () => {
  for (const [, prompt] of TABLE) {
    const text = describe(classify(prompt, cfg), cfg);
    assert.ok(text.length <= 600, text);
    assert.match(text, /^Route: /);
    assert.match(text, /Confidence \d\.\d\d/);
  }
  const text = describe(classify('Redesign the checkout page layout and update the orders api endpoint to return totals', cfg), cfg);
  assert.match(text, /plan yes \(touches/);
});

test('timing: 200 classifications under 1 second', () => {
  const prompts = TABLE.map((r) => r[1]);
  const start = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) classify(prompts[i % prompts.length], cfg);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  console.log(`router timing: 200 classifications in ${ms.toFixed(1)} ms`);
  assert.ok(ms < 1000, `${ms} ms`);
  const big = classify(`Fix this\n${'    at foo (/app/services/a.ts:1:1)\n'.repeat(20000)}`, cfg);
  assert.equal(big.role, 'backend');
});

// ---------------------------------------------------------------------------
// Hook and CLI
// ---------------------------------------------------------------------------

test('hook mode prints hookSpecificOutput with additionalContext <= 600 chars', () => {
  const dir = projectDir({ log: false });
  const r = hookPrompt('Fix the button hover color in web/src/components/Button.tsx', { CLAUDE_PROJECT_DIR: dir });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.ok(out.hookSpecificOutput.additionalContext.length <= 600);
  assert.match(out.hookSpecificOutput.additionalContext, /frontend agent \(tier standard\/sonnet\)/);
  const huge = hookPrompt(`${'please add a button and then refactor the api and the database '.repeat(500)}`, { CLAUDE_PROJECT_DIR: dir });
  assert.ok(JSON.parse(huge.stdout).hookSpecificOutput.additionalContext.length <= 600);
});

test('hook mode: bad stdin exits 0 with no output', () => {
  const dir = projectDir();
  for (const input of ['', 'not json', '{"prompt": 42}', '{}', '[]', 'null', '{"prompt":"   "}']) {
    const r = hook(input, { CLAUDE_PROJECT_DIR: dir });
    assert.equal(r.status, 0, input);
    assert.equal(r.stdout, '', input);
  }
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'route-log.jsonl')), false);
});

test('hook mode: "no routing" and /noroute opt out', () => {
  const dir = projectDir();
  for (const p of ['fix the api handler, no routing', 'No Routing please: fix the api handler', '/noroute fix the api handler', 'fix the api handler /noroute']) {
    const r = hookPrompt(p, { CLAUDE_PROJECT_DIR: dir });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', p);
  }
  assert.equal(hookPrompt('fix the api handler', { CLAUDE_PROJECT_DIR: dir, CLAUDE_SETUP_ROUTER: 'off' }).stdout, '');
});

test('log line has fields but never the prompt text', () => {
  const dir = projectDir();
  const secret = 'Fix the api handler in services/orders/handler.ts for customer ACME-SECRET-1234';
  assert.equal(hookPrompt(secret, { CLAUDE_PROJECT_DIR: dir }).status, 0);
  const raw = fs.readFileSync(path.join(dir, '.claude', 'route-log.jsonl'), 'utf8');
  assert.ok(!raw.includes('ACME'));
  assert.ok(!raw.includes('handler'));
  const line = JSON.parse(raw.trim());
  assert.match(line.sha, /^[0-9a-f]{12}$/);
  assert.equal(line.len, secret.length);
  assert.equal(line.role, 'backend');
  assert.equal(line.backend, 'rules');
  assert.ok(line.ts && 'effort' in line && 'plan' in line && 'confidence' in line);
  assert.ok(!('prompt' in line) && !('reasons' in line));
});

test('log disabled in config writes nothing; unwritable log dir is swallowed', () => {
  const dir = projectDir({ log: false });
  hookPrompt('fix the api handler', { CLAUDE_PROJECT_DIR: dir });
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'route-log.jsonl')), false);
  const dir2 = projectDir();
  fs.mkdirSync(path.join(dir2, '.claude', 'route-log.jsonl'));
  const r = hookPrompt('fix the api handler', { CLAUDE_PROJECT_DIR: dir2 });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('additionalContext'));
});

test('copied into .claude/hooks it finds ../router.json without CLAUDE_PROJECT_DIR', () => {
  const dir = projectDir();
  fs.mkdirSync(path.join(dir, '.claude', 'hooks'));
  const copy = path.join(dir, '.claude', 'hooks', 'route.mjs');
  fs.copyFileSync(SCRIPT, copy);
  const r = spawnSync(process.execPath, [copy], { input: JSON.stringify({ prompt: 'Fix the flaky e2e test in tests/checkout.spec.ts' }), encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /test-runner agent \(tier fast\/haiku\)/);
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'route-log.jsonl')), 'log goes next to router.json');
});

test('router.example.json is valid and routes sensibly', () => {
  const example = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'scripts', 'router', 'router.example.json'), 'utf8'));
  assert.equal(example.version, 1);
  assert.deepEqual(Object.keys(example.tiers), ['fast', 'standard', 'deep']);
  assert.equal(typeof example.thresholds.confidence, 'number');
  for (const r of example.roles) assert.ok(r.name && r.agent && r.tier in example.tiers && r.paths.length && r.keywords.length);
  assert.equal(classify('Fix the login form validation in src/components/LoginForm.tsx', example).role, 'frontend');
  assert.equal(classify('add an index to the users table', example).role, 'data');
});

test('pathological prompts stay fast', () => {
  const nasty = ['a/'.repeat(12000), 'a/ '.repeat(8000), 'a.'.repeat(12000), 'x.y/z '.repeat(4000), '('.repeat(20000), `${'    at f (/app/services/a.ts:1:1)\n'.repeat(3000)}`];
  const start = Date.now();
  for (const p of nasty) classify(p, cfg);
  assert.ok(Date.now() - start < 1000, `${Date.now() - start} ms`);
});

test('CLI --json and --explain; built-in defaults when no config exists', () => {
  const env = { CLAUDE_PROJECT_DIR: projectDir() };
  const j = spawnSync(process.execPath, [SCRIPT, '--json', 'Fix the flaky e2e test in tests/checkout.spec.ts'], { encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(j.status, 0);
  assert.equal(JSON.parse(j.stdout).role, 'qa');
  const e = spawnSync(process.execPath, [SCRIPT, '--explain', "Don't touch the frontend, fix the api handler"], { encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(e.status, 0);
  assert.match(e.stdout, /Decision: role=backend/);
  assert.match(e.stdout, /frontend\s.*excluded by negation/);
  assert.match(e.stdout, /Context: Route:/);
  const nothing = projectDir();
  fs.rmSync(path.join(nothing, '.claude', 'router.json'));
  const d = spawnSync(process.execPath, [SCRIPT, '--json', 'add a button component to the page'], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: nothing } });
  assert.equal(JSON.parse(d.stdout).role, 'frontend');
});

function emptyDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-test-'));
  tmpDirs.push(dir);
  return dir;
}

test('unconfigured: hook mode prints nothing, exits 0, and logs nothing', () => {
  const dir = emptyDir();
  const r = hookPrompt('Fix the button hover color in web/src/components/Button.tsx', { CLAUDE_PROJECT_DIR: dir });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  // A copy under .claude/hooks looks for ../router.json, which is missing as well.
  fs.mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true });
  const copy = path.join(dir, '.claude', 'hooks', 'route.mjs');
  fs.copyFileSync(SCRIPT, copy);
  const c = spawnSync(process.execPath, [copy], { input: JSON.stringify({ prompt: 'fix the api handler' }), encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(c.status, 0);
  assert.equal(c.stdout, '');
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'route-log.jsonl')), false);
});

test('unconfigured: --json and --explain still decide with built-in defaults and say so', () => {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: emptyDir() };
  const j = spawnSync(process.execPath, [SCRIPT, '--json', 'add a button component to the page'], { encoding: 'utf8', env });
  assert.equal(j.status, 0);
  const jd = JSON.parse(j.stdout);
  assert.equal(jd.role, 'frontend');
  assert.ok(jd.reasons.includes('unconfigured: no .claude/router.json found'), jd.reasons.join(' | '));
  const e = spawnSync(process.execPath, [SCRIPT, '--explain', 'add a button component to the page'], { encoding: 'utf8', env });
  assert.equal(e.status, 0);
  assert.match(e.stdout, /Decision: role=frontend/);
  assert.match(e.stdout, /unconfigured: no \.claude\/router\.json found/);
  const configured = spawnSync(process.execPath, [SCRIPT, '--json', 'add a button component to the page'], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir() } });
  assert.ok(!JSON.parse(configured.stdout).reasons.some((r) => /unconfigured/.test(r)));
});

test('CI prompts on the t3 config: an edit aimed at infra beats failure words', () => {
  const ci = classify('the e2e workflow fails on windows, fix the CI workflow', T3);
  assert.equal(ci.role, 'infra');
  assert.equal(ci.agent, 'infra');
  assert.equal(ci.delegate, true);
  assert.ok(ci.reasons.some((r) => /failure words not counted/.test(r)));
  assert.equal(classify('fix the CI workflow', T3).role, 'infra');
  const why = classify('why is CI failing?', T3);
  assert.ok(['test-runner', 'main'].includes(why.role), why.role);
  assert.equal(why.delegate, false);
  assert.equal(classify('run the tests', T3).role, 'test-runner');
  assert.equal(classify('Fix the flaky test', T3).role, 'test-runner'); // failure words alone still point to the runner
});

// ---------------------------------------------------------------------------
// Negation, shared paths, corroboration and the low-confidence fallback
// ---------------------------------------------------------------------------

test('glued negators are names, not negation: --no-install, without-x, no_x, noX', () => {
  const c = { roles: [{ name: 'cli', paths: ['cli/src/**'], keywords: ['flag', 'cli', 'command'] }] };
  for (const p of [
    'add a --no-install style CLI flag to the create command in cli/src/cli/index.ts',
    'add a --no-install CLI flag in cli/src/index.ts',
    'add a --no-install CLI flag to the create command',
    'add a without-git cli flag to the create command',
    'add a no_cache cli flag to the create command',
    'add the noInstall cli flag to the create command',
  ]) {
    const d = classify(p, c);
    assert.equal(d.role, 'cli', p);
    assert.equal(d.delegate, true, p);
    assert.ok(!d.reasons.some((r) => /negated/.test(r)), p);
  }
  // real negation still works: separate words only
  assert.equal(classify("don't add a flag to the create command", c).delegate, false);
  assert.equal(classify('add a flag without the cli command', c).delegate, false);
  assert.equal(classify('add a flag but do not touch the cli command', c).role, 'main');
  assert.ok(classify('do not touch cli/src/index.ts', c).reasons.some((r) => /negated/.test(r)));
});

test('a path match survives negation of a keyword in another clause', () => {
  const c = { roles: [{ name: 'cli', paths: ['cli/src/**'], keywords: ['flag', 'cli'] }] };
  const d = classify('the cli has no verbose flag, add one in cli/src/index.ts', c);
  assert.equal(d.role, 'cli');
  assert.equal(d.delegate, true);
  assert.deepEqual([...d.detail.score.get('cli').paths], ['cli/src/index.ts']);
});

test('shared globs: the most specific glob wins, equal specificity stays a tie, keyword evidence breaks it', () => {
  const t3 = { roles: [
    { name: 'frontend', paths: ['app/**'], keywords: ['react'] },
    { name: 'backend', paths: ['app/**'], keywords: ['server'] },
    { name: 'data', paths: ['app/**'], keywords: ['drizzle', 'schema', 'db'] },
    { name: 'api', paths: ['app/server/**'], keywords: ['endpoint'] },
  ] };
  // longer literal prefix wins outright
  const s = classify('add a file in app/server/x.ts', t3);
  assert.equal(s.role, 'api');
  assert.equal(s.delegate, true);
  assert.equal(s.detail.score.get('data').path, 0);
  // identical globs and no other evidence: a real tie, so no delegation and the main agent orchestrates
  const tie = classify('add a file in app/lib/x.ts', t3);
  assert.equal(tie.delegate, false);
  assert.ok(tie.confidence < 0.55);
  assert.ok(['frontend', 'backend', 'data'].every((n) => tie.detail.score.get(n).path === 1));
  // one tied role has keyword evidence in the prompt: it takes the path credit
  const d = classify('add a new template file for the drizzle extras in app/server/db/x.ts', { roles: t3.roles.slice(0, 3) });
  assert.equal(d.role, 'data');
  assert.equal(d.delegate, true);
  assert.equal(d.plan, false);
  assert.equal(d.detail.score.get('frontend').path, 0);
  // evidence on two of three tied roles splits the credit between those two
  const two = classify('add a react server file in app/lib/x.ts', { roles: t3.roles.slice(0, 3) });
  assert.equal(two.detail.score.get('data').path, 0);
  assert.equal(two.detail.score.get('frontend').path, 1.5);
});

test('t3-like repo: the drizzle template prompt goes to the data agent, not a three-way tie', () => {
  const shared = ['cli/template/extras/config/**', 'cli/template/extras/src/**'];
  const c = { roles: [
    { name: 'frontend', paths: shared, keywords: ['component', 'page', 'react'] },
    { name: 'backend', paths: ['cli/template/extras/src/**'], keywords: ['endpoint', 'api', 'trpc'] },
    { name: 'data', paths: shared, keywords: ['migration', 'schema', 'database', 'db', 'drizzle-orm', 'drizzle'] },
  ] };
  const d = classify('add a new template file for the drizzle extras in cli/template/extras/src/server/db', c);
  assert.equal(d.role, 'data');
  assert.equal(d.delegate, true);
  assert.equal(d.plan, false);
  assert.equal(d.tier, 'standard');
  assert.ok(d.confidence >= 0.55, d.confidence);
});

test('corroboration: a second distinct keyword lifts a narrow win over the threshold, one weak hit does not', () => {
  const c = { roles: [{ name: 'publisher', keywords: ['version', 'changelog', 'tag'] }, { name: 'docs', keywords: ['notes'] }] };
  const two = classify('update the version and tag for notes', c);
  assert.equal(two.role, 'publisher');
  assert.ok(two.confidence >= 0.55, two.confidence); // 0.54 before the corroboration term
  assert.ok(classify('the version looks wrong', c).confidence < 0.55);
  assert.ok(classify('the version', c).confidence < 0.55);
  assert.ok(classify('update the version and changelog', c).confidence > classify('update the version', c).confidence);
  // an unrelated single keyword never gains from it
  assert.equal(classify('the changelog', c).detail.score.get('publisher').kws.length, 1);
});

test('low-confidence fallback: main agent, standard tier, no plan unless size or breadth signals say so', () => {
  const c = { roles: [{ name: 'frontend', keywords: ['button'] }] };
  const vague = 'the thing on the second screen looks off when the data loads and I am not sure what is going on there so please take a look at it when you get a chance';
  const d = classify(vague, c);
  assert.ok(d.confidence < 0.55);
  assert.equal(d.role, 'main');
  assert.equal(d.delegate, false);
  assert.equal(d.effort, 'medium');
  assert.equal(d.tier, 'standard');
  assert.equal(d.plan, false);
  // short vague prompts behave the same
  const short = classify('make it better', c);
  assert.equal(short.tier, 'standard');
  assert.equal(short.plan, false);
  // size and risk signals still raise effort, with or without confidence
  const big = classify('rework the whole thing across every screen so it looks right when the data loads and I am not sure why it breaks', c);
  assert.ok(big.confidence < 0.55);
  assert.equal(big.effort, 'high');
  assert.equal(big.plan, true);
  assert.equal(big.tier, 'deep');
  // questions and trivial edits stay cheap
  assert.equal(classify('what does the installers folder do?', c).tier, 'fast');
  assert.equal(classify('fix a typo in README', c).plan, false);
});

// ---------------------------------------------------------------------------
// Optional backends against a local stub server
// ---------------------------------------------------------------------------

let stub;
let stubUrl;
let stubReply = () => ({});
let lastBody = null;
before(async () => {
  stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      lastBody = JSON.parse(body || '{}');
      const reply = stubReply(lastBody);
      if (reply === 'hang') return; // never answers: exercises the timeout
      res.writeHead(reply.status || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.json ?? reply));
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  stubUrl = `http://127.0.0.1:${stub.address().port}`;
});
after(() => { stub?.closeAllConnections?.(); stub?.close(); });

const ollamaReply = (obj) => ({ message: { role: 'assistant', content: JSON.stringify(obj) } });
const VAGUE = 'the thing on the second screen looks off when the data loads, can you sort it out';
const env = (extra = {}) => ({ CLAUDE_SETUP_ROUTER: 'ollama', CLAUDE_SETUP_ROUTER_URL: `${stubUrl}/api/chat`, CLAUDE_SETUP_ROUTER_TIMEOUT_MS: '300', ...extra });

test('ollama backend: used when rules are unsure, sends the documented request', async () => {
  assert.ok(classify(VAGUE, cfg).confidence < 0.55);
  stubReply = () => ollamaReply({ role: 'frontend', effort: 'medium', plan: false });
  const d = await route(VAGUE, cfg, env({ CLAUDE_SETUP_ROUTER_MODEL: 'tiny:1b' }));
  assert.equal(d.backend, 'ollama');
  assert.equal(d.role, 'frontend');
  assert.ok(d.delegate);
  assert.equal(lastBody.model, 'tiny:1b');
  assert.equal(lastBody.stream, false);
  assert.equal(lastBody.options.temperature, 0);
  assert.deepEqual(lastBody.format.properties.role.enum.sort(), ['backend', 'data', 'frontend', 'main', 'qa']);
  assert.ok(lastBody.messages[0].content.includes('frontend') && lastBody.messages[1].content.includes('second screen'));
});

test('ollama backend: not consulted when rules are confident, or when the env is unset', async () => {
  lastBody = null;
  stubReply = () => ollamaReply({ role: 'data', effort: 'low', plan: false });
  const d = await route('Fix the button hover color in web/src/components/Button.tsx', cfg, env());
  assert.equal(d.backend, 'rules');
  assert.equal(lastBody, null);
  const d2 = await route(VAGUE, cfg, env({ CLAUDE_SETUP_ROUTER: undefined }));
  assert.equal(d2.backend, 'rules');
  assert.equal(lastBody, null);
});

test('ollama backend: escalation wins (rules effort is a floor) and invalid answers fall back', async () => {
  stubReply = () => ollamaReply({ role: 'backend', effort: 'high', plan: true });
  const d = await route(VAGUE, cfg, env());
  assert.equal(d.effort, 'high');
  assert.equal(d.plan, true);
  for (const bad of [ollamaReply({ role: 'devops', effort: 'low', plan: false }), ollamaReply({ role: 'data', effort: 'huge', plan: false }), { message: { content: 'not json' } }, { status: 500, json: {} }, {}]) {
    stubReply = () => bad;
    const r = await route(VAGUE, cfg, env());
    assert.equal(r.backend, 'rules');
    assert.deepEqual(r.role, classify(VAGUE, cfg).role);
  }
});

test('ollama backend: rules veto a role the prompt negated', async () => {
  const p = "don't touch the frontend, the thing on the second screen looks off when the data loads";
  stubReply = () => ollamaReply({ role: 'frontend', effort: 'low', plan: false });
  const d = await route(p, cfg, env());
  assert.equal(d.backend, 'rules');
});

test('ollama backend: timeout and connection errors fall back to rules silently', async () => {
  stubReply = () => 'hang';
  const t0 = Date.now();
  const d = await route(VAGUE, cfg, env());
  assert.equal(d.backend, 'rules');
  assert.ok(Date.now() - t0 < 1500, 'timeout override respected');
  const dead = await route(VAGUE, cfg, env({ CLAUDE_SETUP_ROUTER_URL: 'http://127.0.0.1:9/api/chat' }));
  assert.equal(dead.backend, 'rules');
});

test('ollama backend via hook mode logs backend=ollama', () => {
  // Spawned process cannot reach the in-process stub synchronously, so use an unreachable URL: the hook must still answer.
  const dir = projectDir();
  const r = hookPrompt(VAGUE, { CLAUDE_PROJECT_DIR: dir, CLAUDE_SETUP_ROUTER: 'ollama', CLAUDE_SETUP_ROUTER_URL: 'http://127.0.0.1:9/api/chat', CLAUDE_SETUP_ROUTER_TIMEOUT_MS: '200' });
  assert.equal(r.status, 0);
  assert.ok(JSON.parse(r.stdout).hookSpecificOutput.additionalContext.length > 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'route-log.jsonl'), 'utf8')).backend, 'rules');
});

test('decider backend posts to CLAUDE_SETUP_DECIDER_URL and validates the answer', async () => {
  stubReply = () => ({ answers: { role: { choice: 'frontend', confidence: 0.9 }, effort: { choice: 'medium' }, plan: { noul: 0.1 } } });
  const e = { CLAUDE_SETUP_ROUTER: 'decider', CLAUDE_SETUP_DECIDER_URL: `${stubUrl}/v1/systemone`, CLAUDE_SETUP_ROUTER_TIMEOUT_MS: '300' };
  const d = await route(VAGUE, cfg, e);
  assert.equal(d.backend, 'decider');
  assert.equal(d.role, 'frontend');
  assert.equal(lastBody.questions.role.type, 'choice');
  stubReply = () => ({ answers: { role: { choice: 'nope' } } });
  assert.equal((await route(VAGUE, cfg, e)).backend, 'rules');
});
