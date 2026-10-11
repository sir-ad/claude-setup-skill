import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { deriveRoster, renderRosterMarkdown, toRouterConfig } from '../scripts/roster.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'roster.mjs');
const fixture = (name) => path.join(HERE, 'fixtures', name);
const names = (r) => r.roles.map((x) => x.name);
const role = (r, n) => r.roles.find((x) => x.name === n);

const tmpDirs = [];
function makeTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-test-'));
  tmpDirs.push(dir);
  return dir;
}
process.on('exit', () => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const FIXTURES = ['roster-next-prisma', 'roster-fastapi', 'roster-go-cli', 'roster-monorepo', 'roster-auth', 'roster-cli-template'];

test('every role has evidence, sane tools and tiers, and no Agent tool', () => {
  for (const f of FIXTURES) {
    const r = deriveRoster(fixture(f));
    assert.ok(names(r).includes('explorer'), `${f}: explorer`);
    assert.ok(r.roles.some((x) => x.kind === 'reviewer'), `${f}: reviewer`);
    for (const x of r.roles) {
      assert.ok(x.why.length > 0 && x.why.every((w) => typeof w === 'string' && w), `${f}/${x.name}: why`);
      assert.ok(!x.tools.includes('Agent'), `${f}/${x.name}: no Agent tool`);
      assert.ok(['fast', 'standard', 'deep'].includes(x.tier));
      assert.ok(Array.isArray(x.scope) && Array.isArray(x.writes));
      const readOnly = ['explorer', 'reviewer', 'security'].includes(x.kind) || x.name === 'test-runner';
      if (readOnly) {
        assert.deepEqual(x.writes, [], `${f}/${x.name}: read-only`);
        assert.ok(!x.tools.includes('Edit') && !x.tools.includes('Write'));
      } else assert.ok(x.tools.includes('Edit') && x.tools.includes('Write'));
    }
    assert.equal(role(r, 'explorer').tier, 'fast');
    assert.equal(role(r, 'explorer').tools.includes('Bash'), false);
    assert.deepEqual(role(r, 'explorer').tools, ['Read', 'Grep', 'Glob']);
    assert.ok(r.roles.filter((x) => x.kind !== 'explorer').length <= 8);
    assert.deepEqual(r.tiers, { fast: 'haiku', standard: 'sonnet', deep: 'opus' });
  }
});

test('output is deterministic', () => {
  for (const f of FIXTURES) {
    assert.equal(JSON.stringify(deriveRoster(fixture(f))), JSON.stringify(deriveRoster(fixture(f))), f);
  }
  const a = spawnSync(process.execPath, [SCRIPT, fixture('roster-monorepo')], { encoding: 'utf8' });
  const b = spawnSync(process.execPath, [SCRIPT, fixture('roster-monorepo')], { encoding: 'utf8' });
  assert.equal(a.status, 0);
  assert.equal(a.stdout, b.stdout);
});

test('next + prisma + vitest + changelog', () => {
  const r = deriveRoster(fixture('roster-next-prisma'));
  for (const n of ['frontend', 'backend', 'data', 'test-runner', 'test-writer', 'ts-reviewer', 'release']) assert.ok(names(r).includes(n), n);
  assert.ok(!names(r).includes('security-reviewer'));
  assert.ok(role(r, 'frontend').why.some((w) => /next@15.*package\.json/.test(w)));
  assert.ok(role(r, 'frontend').why.some((w) => /dir app\/ \(\d+ files?\)/.test(w)));
  assert.ok(role(r, 'frontend').why.some((w) => /^\d+ files? imports? next \(app/.test(w)), role(r, 'frontend').why.join('|'));
  assert.ok(role(r, 'data').scope.includes('prisma/**'));
  assert.equal(role(r, 'ts-reviewer').tier, 'deep');
  assert.equal(role(r, 'test-runner').tier, 'fast');
  assert.ok(role(r, 'test-runner').tools.includes('Bash') && !role(r, 'test-runner').tools.includes('Edit'));
  assert.equal(role(r, 'test-writer').tier, 'standard');
  assert.ok(role(r, 'test-writer').writes.every((g) => /test/.test(g)), 'test-writer writes only tests');
  assert.ok(role(r, 'release').scope.includes('CHANGELOG.md'));
});

test('fastapi + sqlalchemy + alembic + pytest + Dockerfile', () => {
  const r = deriveRoster(fixture('roster-fastapi'));
  for (const n of ['backend', 'data', 'infra', 'test-runner', 'test-writer', 'python-reviewer']) assert.ok(names(r).includes(n), n);
  assert.ok(!names(r).includes('frontend'));
  assert.ok(role(r, 'data').why.some((w) => /alembic/.test(w)));
  assert.ok(role(r, 'infra').scope.includes('Dockerfile*'));
  assert.ok(role(r, 'test-writer').writes.includes('tests/**'));
  assert.ok(!names(r).includes('release'), 'no changelog, no release role');
});

test('go cli has no frontend, data, backend or infra roles', () => {
  const r = deriveRoster(fixture('roster-go-cli'));
  for (const n of ['frontend', 'data', 'backend', 'infra', 'mobile', 'docs', 'security-reviewer']) assert.ok(!names(r).includes(n), n);
  assert.ok(names(r).includes('go-reviewer'));
  assert.ok(names(r).includes('test-runner'));
});

function project(files) {
  const dir = makeTmp();
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof text === 'string' ? text : JSON.stringify(text));
  }
  return dir;
}

test('dev and test dependencies do not create roles; imports in scope dirs do', () => {
  const r = deriveRoster(fixture('roster-fastapi'));
  const all = JSON.stringify(r.roles.map((x) => x.why));
  assert.ok(!/flask|sqlmodel|pyjwt/.test(all), 'dev-group flask/sqlmodel/pyjwt are ignored');
  assert.ok(role(r, 'backend').why.some((w) => /^\d+ files? imports? fastapi \(app\)/.test(w)), role(r, 'backend').why.join('|'));
  assert.deepEqual(role(r, 'test-runner').scope, ['**']);
  assert.ok(!role(r, 'security-reviewer' ) && !names(r).includes('security-reviewer'));

  const devOnly = deriveRoster(project({ 'package.json': { name: 'x', version: '1.0.0', devDependencies: { next: '15.0.0', react: '19.0.0' } }, 'src/a.ts': 'export const a = 1;' }));
  assert.ok(!names(devOnly).includes('frontend'));

  // scaffolder: app deps are devDependencies of cli/ and the template files import them
  const scaf = deriveRoster(project({
    'package.json': { name: 'root', private: true, workspaces: ['cli'] },
    'cli/package.json': { name: 'cli', version: '1.0.0', devDependencies: { next: '15.0.0' } },
    'cli/template/app/page.tsx': "import Link from 'next/link';\nexport default () => <Link href='/' />;\n",
    'cli/template/app/layout.tsx': "import Link from 'next/link';\nexport default () => <Link href='/' />;\n",
  }));
  const fe = role(scaf, 'frontend');
  assert.ok(fe, 'frontend from imported dev dependency');
  assert.ok(fe.why.some((w) => /^2 files import next \(cli\/template\/app\), framework|^2 files import next \(cli\/template\/app\), dependency next@15\.0\.0 \(dev\) in cli\/package\.json/.test(w)), fe.why.join('|'));
  assert.deepEqual(fe.scope, ['cli/template/app/**']);
});

test('runtime dependency without imports counts only in the root package next to conventional dirs', () => {
  const deps = { dependencies: { express: '4.0.0' } };
  const member = deriveRoster(project({ 'package.json': { name: 'r', workspaces: ['apps/*'] }, 'apps/api/package.json': { name: 'api', ...deps }, 'apps/api/src/a.ts': 'export const a = 1;' }));
  assert.ok(!names(member).includes('backend'));
  const noDirs = deriveRoster(project({ 'package.json': { name: 'r', ...deps }, 'src/a.ts': 'export const a = 1;' }));
  assert.ok(!names(noDirs).includes('backend'));
  const root = deriveRoster(project({ 'package.json': { name: 'r', ...deps }, 'server/a.ts': 'export const a = 1;', 'server/b.ts': 'export const b = 1;' }));
  assert.ok(names(root).includes('backend'));
  assert.deepEqual(role(root, 'backend').scope, ['server/**']);
});

test('monorepo scopes by workspace members, not one role per workspace', () => {
  const r = deriveRoster(fixture('roster-monorepo'));
  assert.ok(r.roles.length - 1 <= 8);
  assert.ok(role(r, 'frontend').scope.includes('apps/web/app/**'));
  assert.ok(role(r, 'backend').scope.includes('apps/api/**'));
  assert.ok(role(r, 'data').scope.includes('packages/db/**'));
  assert.ok(role(r, 'mobile').scope.includes('apps/mobile/**'));
  assert.ok(!r.roles.some((x) => /^(web|api|db|ui|docs|mobile)-/.test(x.name)));
  assert.ok(r.roles.length < 12);
  // docs, release and the rest exceed the cap, so the lowest-evidence roles are merged with a warning
  assert.ok(r.warnings.some((w) => /merged docs into frontend/.test(w)), r.warnings.join('\n'));
  assert.ok(role(r, 'frontend').scope.includes('apps/docs/**'));
  assert.deepEqual(role(r, 'frontend').merged, ['docs']);
});

test('stripe and next-auth produce a deep read-only security-reviewer', () => {
  const r = deriveRoster(fixture('roster-auth'));
  const s = role(r, 'security-reviewer');
  assert.ok(s, 'security-reviewer');
  assert.equal(s.tier, 'deep');
  assert.deepEqual(s.writes, []);
  assert.ok(s.why.some((w) => /next-auth/.test(w)) && s.why.some((w) => /stripe/.test(w)));
  assert.ok(s.scope.includes('lib/auth/**'));
  assert.ok(!toRouterConfig(r).roles.some((x) => x.name === 'security-reviewer'));
});

test('intent adds a role only for a named capability, with unknown scope', () => {
  const base = deriveRoster(fixture('roster-go-cli'));
  const r = deriveRoster(fixture('roster-go-cli'), { intent: 'an admin dashboard with a REST API and a database, deploy to k8s' });
  for (const n of ['frontend', 'backend', 'data', 'infra']) {
    const x = role(r, n);
    assert.ok(x, n);
    assert.equal(x.why.length, 1);
    assert.match(x.why[0], /^intent: /);
    assert.deepEqual(x.scope, []);
    assert.ok(r.warnings.some((w) => w.includes(`role ${n} `) && /scope is unknown/.test(w)));
  }
  assert.equal(role(r, 'frontend').why[0], 'intent: admin dashboard');
  assert.equal(role(r, 'infra').why[0], 'intent: deploy to k8s');
  assert.deepEqual(deriveRoster(fixture('roster-go-cli'), { intent: 'refactor the error handling' }).roles.map((x) => x.name), names(base));
  const m = deriveRoster(fixture('roster-go-cli'), { intent: 'a mobile app for field staff' });
  assert.equal(role(m, 'mobile').why[0], 'intent: mobile app');
  // an intent never replaces roles that exist from evidence
  const n = deriveRoster(fixture('roster-next-prisma'), { intent: 'admin dashboard' });
  assert.ok(role(n, 'frontend').why.every((w) => !w.startsWith('intent:')));
});

test('role cap of 8 is respected and reported on a synthetic overload', () => {
  const dir = makeTmp();
  const put = (rel, text = '') => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  put('package.json', JSON.stringify({ name: 'x', version: '1.0.0', scripts: { test: 'vitest' }, dependencies: { next: '15.0.0', express: '4.0.0', prisma: '6.0.0', 'next-auth': '4.0.0', 'react-native': '0.7.0', vitepress: '1.0.0' } }));
  put('CHANGELOG.md', '# c');
  put('Dockerfile', 'FROM node');
  put('a.test.ts', '');
  put('app/page.tsx', "import Link from 'next/link';\nexport default () => <Link href='/' />;\n");
  put('app/b.tsx', "import Link from 'next/link';\nexport default () => <Link href='/' />;\n");
  put('app/c.tsx', "import Link from 'next/link';\nexport default () => <Link href='/' />;\n");
  put('server/a.ts', "import express from 'express';\nexport default express();\n");
  put('server/b.ts', "import express from 'express';\nexport default express();\n");
  put('prisma/schema.prisma', 'model A { id Int @id }');
  put('lib/auth/x.ts', "import NextAuth from 'next-auth';\nexport default NextAuth;\n");
  put('ios/App.swift', '');
  put('mobile/a.tsx', "import { View } from 'react-native';\nexport default View;\n");
  put('docs/guide.md', '# g');
  put('mkdocs.yml', 'site_name: x');
  const r = deriveRoster(dir, { intent: 'REST API' });
  assert.ok(r.roles.filter((x) => x.kind !== 'explorer').length <= 8);
  assert.ok(r.warnings.some((w) => /role cap 8/.test(w)));
  for (const x of r.roles) assert.ok(!x.tools.includes('Agent'));
});

test('router config has exactly the agreed shape', () => {
  const roster = deriveRoster(fixture('roster-next-prisma'));
  const c = toRouterConfig(roster);
  assert.deepEqual(Object.keys(c), ['version', 'roles', 'tiers', 'thresholds', 'defaults', 'log']);
  assert.equal(c.version, 1);
  assert.deepEqual(c.tiers, { fast: 'haiku', standard: 'sonnet', deep: 'opus' });
  assert.deepEqual(c.thresholds, { confidence: 0.55 });
  assert.deepEqual(c.defaults, { role: 'main' });
  assert.equal(c.log, true);
  assert.ok(c.roles.length > 0);
  for (const x of c.roles) {
    assert.deepEqual(Object.keys(x), ['name', 'agent', 'tier', 'paths', 'keywords']);
    assert.ok(typeof x.name === 'string' && typeof x.agent === 'string');
    assert.ok(['fast', 'standard', 'deep'].includes(x.tier));
    assert.ok(Array.isArray(x.paths) && Array.isArray(x.keywords) && x.keywords.length > 0);
    assert.ok(!['explorer', 'security-reviewer'].includes(x.name) && !/-reviewer$/.test(x.name));
  }
  const fe = c.roles.find((x) => x.name === 'frontend');
  assert.ok(fe.keywords.includes('component') && fe.keywords.includes('next') && fe.paths.includes('app/**'));
  assert.ok(c.roles.find((x) => x.name === 'data').keywords.includes('prisma'));
  assert.equal(JSON.stringify(c), JSON.stringify(toRouterConfig(roster)));
  // never throws on junk
  assert.equal(toRouterConfig(null).roles.length, 0);
});

test('precomputed detection and graph are accepted', () => {
  const dir = fixture('roster-fastapi');
  const plain = deriveRoster(dir);
  const again = deriveRoster(dir, { detection: { primary: 'python', languages: [{ name: 'python', files: 9 }], commands: {}, frameworks: [], infra: {}, ci: [], versionFiles: [] }, graph: { nodes: [], testFiles: 2 } });
  assert.ok(role(again, 'backend'), 'manifests are still read from disk');
  assert.equal(names(plain).includes('python-reviewer'), true);
  assert.equal(names(again).includes('python-reviewer'), true);
});

test('markdown has the roster and routing tables', () => {
  const md = renderRosterMarkdown(deriveRoster(fixture('roster-next-prisma')));
  assert.match(md, /\| Role \| Agent file \| Tier \| Scope \| Why \|/);
  assert.match(md, /\| Signals \| Role \|/);
  assert.match(md, /\.claude\/agents\/ts-reviewer\.md/);
  assert.match(md, /prisma\/\*\*/);
});

test('empty or missing directories give a minimal roster and never throw', () => {
  const dir = makeTmp();
  const r = deriveRoster(dir);
  assert.deepEqual(names(r), ['explorer', 'code-reviewer']);
  assert.doesNotThrow(() => deriveRoster(path.join(dir, 'does-not-exist')));
  assert.doesNotThrow(() => renderRosterMarkdown(undefined));
});

test('CLI: modes, intent and usage errors', () => {
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  const j = run(fixture('roster-auth'));
  assert.equal(j.status, 0);
  assert.ok(JSON.parse(j.stdout).roles.length > 0);
  assert.equal(run(fixture('roster-auth'), '--json').stdout, j.stdout);
  assert.match(run(fixture('roster-auth'), '--markdown').stdout, /## Roster/);
  assert.equal(JSON.parse(run(fixture('roster-auth'), '--router-config').stdout).version, 1);
  const i = JSON.parse(run(fixture('roster-go-cli'), '--intent', 'a REST API').stdout);
  assert.ok(i.roles.some((x) => x.name === 'backend' && x.why[0] === 'intent: rest api'));
  assert.equal(run('--bogus').status, 2);
  assert.equal(run(fixture('roster-auth'), '--intent').status, 2);
  assert.equal(run(fixture('roster-auth'), '--json', '--markdown').status, 2);
  assert.equal(run(path.join(fixture('roster-auth'), 'nope')).status, 2);
});

test('bin CLI owns its source; a scaffold template imports next and is marked as scaffold output', () => {
  const r = deriveRoster(fixture('roster-cli-template'));
  const c = role(r, 'cli');
  assert.ok(c, names(r).join(','));
  assert.deepEqual(c.scope, ['src/**']);
  assert.equal(c.tier, 'standard');
  assert.deepEqual(c.tools, ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash']);
  assert.ok(c.why.includes('entry point src/index.ts (bin mini-cli)'), c.why.join('|'));
  assert.ok(c.why.includes('largest source area src (4 files)'), c.why.join('|'));
  assert.ok(c.why.every((w) => !/scaffold/.test(w)), 'the product role is not scaffold');
  const fe = role(r, 'frontend');
  assert.ok(fe, 'frontend from the template import');
  assert.deepEqual(fe.scope, ['template/app/**']);
  assert.ok(fe.why.length > 0 && fe.why.every((w) => /\(scaffold output\)$/.test(w)), fe.why.join('|'));
  assert.equal(names(r).includes('library') || names(r).includes('core'), false);
});

test('a template package with no own code: scaffold roles keep their scope and no product role appears', () => {
  const r = deriveRoster(project({
    'package.json': { name: 'gen', version: '1.0.0', devDependencies: { next: '15.0.0', express: '4.0.0', '@prisma/client': '6.0.0' } },
    'template/app/page.tsx': "import Link from 'next/link';\nexport default () => <Link href='/' />;\n",
    'template/app/api.ts': "import express from 'express';\nexport default express();\n",
    'template/app/db.ts': "import { PrismaClient } from '@prisma/client';\nexport const db = new PrismaClient();\n",
  }));
  assert.ok(!names(r).some((n) => ['cli', 'library', 'core'].includes(n)), names(r).join(','));
  for (const n of ['frontend', 'backend', 'data']) assert.ok(role(r, n), n);
  assert.ok(r.warnings.some((w) => /frontend, backend and data share the scope template\/app\/\*\*/.test(w)), r.warnings.join('\n'));
});

test('product role names: library for a package that exports, core for a plain source area', () => {
  const lib = deriveRoster(project({ 'package.json': { name: 'lib', version: '1.0.0', main: './dist/index.js' }, 'src/index.ts': 'export const a = 1;\n', 'src/util.ts': 'export const b = 2;\n' }));
  const l = role(lib, 'library');
  assert.ok(l, names(lib).join(','));
  assert.deepEqual(l.scope, ['src/**']);
  assert.ok(l.why.includes('entry point src/index.ts (package-main)'), l.why.join('|'));
  assert.ok(!names(lib).includes('cli'));

  const core = deriveRoster(project({ 'package.json': { name: 'app', version: '1.0.0' }, 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 2;\n' }));
  const c = role(core, 'core');
  assert.ok(c, names(core).join(','));
  assert.deepEqual(c.scope, ['src/**']);
  assert.ok(toRouterConfig(core).roles.find((x) => x.name === 'core').keywords.includes('src'));

  // one file is not an area: no product role for a single-file source dir
  const one = deriveRoster(project({ 'package.json': { name: 'one', version: '1.0.0' }, 'src/only.ts': 'export const a = 1;\n' }));
  assert.ok(!names(one).some((n) => ['cli', 'library', 'core'].includes(n)), names(one).join(','));
});

test('a largest source area outside every role scope is reported', () => {
  const r = deriveRoster(project({
    'package.json': { name: 'x', version: '1.0.0', bin: { x: './dist/x.js' } },
    'src/x.ts': 'export const x = 1;\n',
    'lib/a.ts': 'export const a = 1;\n',
    'lib/b.ts': 'export const b = 2;\n',
    'lib/c.ts': 'export const c = 3;\n',
    'lib/d.ts': 'export const d = 4;\n',
  }));
  assert.deepEqual(role(r, 'cli').scope, ['src/**'], names(r).join(','));
  assert.ok(r.warnings.some((w) => /^largest source area lib \(4 files\) is outside every role scope$/.test(w)), r.warnings.join('\n'));
});

test('keywords: ci is no longer a test-runner keyword, bump is no longer a release keyword', () => {
  const c = toRouterConfig(deriveRoster(fixture('roster-fastapi')));
  const tr = c.roles.find((x) => x.name === 'test-runner');
  assert.ok(tr && tr.keywords.includes('lint') && tr.keywords.includes('flaky'));
  assert.ok(!tr.keywords.includes('ci'), tr.keywords.join(','));
  assert.ok(c.roles.find((x) => x.name === 'infra').keywords.includes('ci'), 'infra still owns ci');

  const rel = toRouterConfig(deriveRoster(fixture('roster-next-prisma'))).roles.find((x) => x.name === 'release');
  assert.ok(rel && rel.keywords.includes('changelog') && rel.keywords.includes('semver'));
  assert.ok(!rel.keywords.includes('bump'), rel.keywords.join(','));

  const cli = toRouterConfig(deriveRoster(fixture('roster-cli-template'))).roles.find((x) => x.name === 'cli');
  for (const k of ['command', 'flag', 'option', 'argument', 'prompt', 'cli']) assert.ok(cli.keywords.includes(k), k);
});

test('data keywords: detected ORM and migration deps add their bare names, generic db words always', () => {
  const kw = (r) => toRouterConfig(r).roles.find((x) => x.name === 'data').keywords;
  const base = kw(deriveRoster(fixture('roster-next-prisma')));
  for (const k of ['schema', 'migration', 'database', 'db', 'prisma']) assert.ok(base.includes(k), k);
  assert.ok(!base.includes('drizzle') && !base.includes('sqlalchemy'), base.join(','));

  const py = kw(deriveRoster(fixture('roster-fastapi')));
  assert.ok(py.includes('sqlalchemy') && py.includes('alembic'), py.join(','));
  assert.ok(!py.includes('prisma'), py.join(','));

  const mono = kw(deriveRoster(fixture('roster-monorepo')));
  assert.ok(mono.includes('drizzle-orm') && mono.includes('drizzle'), mono.join(','));

  // a scaffold repo: drizzle only in a template dir still counts as detected
  const t3 = deriveRoster(project({
    'package.json': { name: 't3', version: '1.0.0', devDependencies: { 'drizzle-orm': '^0.30.0', 'drizzle-kit': '^0.20.0' } },
    'template/extras/db/schema.ts': "import { pgTable } from 'drizzle-orm/pg-core';\nexport const t = pgTable('t', {});\n",
  }));
  assert.ok(kw(t3).includes('drizzle'), kw(t3).join(','));
});
