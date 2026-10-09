import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildContext, chooseTemplate, chooseKnowledge } from '../scripts/context.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'context.mjs');
const fixture = (name) => path.join(HERE, 'fixtures', name);

const tmpDirs = [];
function makeTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-test-'));
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

// Only the script's own headings; the embedded files have headings of their own.
const OWN_HEADING = /^(# claude-setup context|## Detection$|## (Template|Knowledge|Reference): (templates|knowledge|reference)\/)/;
const headers = (out) => out.split('\n').filter((l) => OWN_HEADING.test(l));
const header = (out, prefix) => out.split('\n').find((l) => l.startsWith(prefix));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\s+$/, '');

test('sections appear in the documented order with whole files included', () => {
  const out = buildContext(fixture('node-pnpm-monorepo'));
  assert.deepEqual(headers(out), [
    '# claude-setup context',
    '## Detection',
    '## Template: templates/node-monorepo.md',
    '## Knowledge: knowledge/node.md',
    '## Knowledge: knowledge/frontend.md',
    '## Reference: reference/writing-agent-files.md',
    '## Reference: reference/claude-code.md',
    '## Reference: reference/agent-adapters.md',
  ]);
  assert.equal(header(out, 'Template:'), 'Template: node-monorepo (reason: primary=node, layout=monorepo)');
  assert.equal(header(out, 'Knowledge:'), 'Knowledge: node.md, frontend.md');
  for (const rel of ['templates/node-monorepo.md', 'knowledge/node.md', 'knowledge/frontend.md', 'reference/claude-code.md']) {
    assert.ok(out.includes(read(rel)), `${rel} included whole`);
  }
});

test('the detection block is the detector JSON for the given dir', () => {
  const out = buildContext(fixture('python-uv'));
  const start = out.indexOf('```json\n') + '```json\n'.length;
  const end = out.indexOf('\n```\n', start);
  const parsed = JSON.parse(out.slice(start, end));
  assert.equal(parsed.primary, 'python');
  assert.equal(parsed.packageManager, 'uv');
});

test('template mapping', () => {
  const cases = [
    ['node', 'monorepo', 'node-monorepo'], ['node', 'single', 'node-single'],
    ['python', 'single', 'python'], ['python', 'monorepo', 'python'], ['go', 'single', 'go'],
    ['rust', 'monorepo', 'rust-workspace'], ['rust', 'single', 'rust-single'],
    ['jvm', 'single', 'jvm'], ['ruby', 'single', 'ruby'], ['dotnet', 'single', 'dotnet'], ['php', 'single', 'php'],
    ['deno', 'single', 'generic'], ['swift', 'single', 'generic'], ['dart', 'single', 'generic'],
    ['elixir', 'single', 'generic'], ['unknown', 'single', 'generic'],
  ];
  for (const [primary, layout, expected] of cases) assert.equal(chooseTemplate(primary, layout), expected, `${primary}/${layout}`);
});

test('fixtures pick the expected template and knowledge', () => {
  const expected = {
    'node-pnpm-monorepo': ['node-monorepo', 'node.md, frontend.md'],
    'node-single-npm': ['node-single', 'node.md, frontend.md'],
    'node-bun': ['node-single', 'node.md'],
    'python-uv': ['python', 'python.md'],
    'rust-workspace': ['rust-workspace', 'rust.md'],
    'go-mod': ['go', 'go.md'],
    empty: ['generic', 'none'],
    'existing-agents': ['generic', 'none'],
  };
  for (const [name, [template, knowledge]] of Object.entries(expected)) {
    const out = buildContext(fixture(name));
    assert.ok(header(out, 'Template:').startsWith(`Template: ${template} (reason: `), name);
    assert.equal(header(out, 'Knowledge:'), `Knowledge: ${knowledge}`, name);
  }
});

test('generic repos still print the generic template and all references', () => {
  const out = buildContext(fixture('empty'));
  assert.ok(out.includes('## Template: templates/generic.md'));
  assert.ok(!out.includes('## Knowledge:'));
  assert.ok(out.includes('## Reference: reference/agent-adapters.md'));
});

test('infra flags add infra.md', () => {
  const dir = makeTmp();
  write(dir, 'go.mod', 'module x\n\ngo 1.22\n');
  write(dir, 'Dockerfile', 'FROM scratch\n');
  assert.equal(header(buildContext(dir), 'Knowledge:'), 'Knowledge: go.md, infra.md');
});

test('a real second ecosystem adds its note; a lone tooling manifest does not', () => {
  const withFrontend = makeTmp();
  write(withFrontend, 'pyproject.toml', '[project]\nname = "api"\n');
  for (let i = 0; i < 6; i++) write(withFrontend, `api/m${i}.py`, '');
  for (let i = 0; i < 6; i++) write(withFrontend, `frontend/c${i}.tsx`, '');
  write(withFrontend, 'frontend/package.json', JSON.stringify({ name: 'web', dependencies: { react: '^19.0.0' } }));
  assert.equal(header(buildContext(withFrontend), 'Knowledge:'), 'Knowledge: python.md, node.md, frontend.md');

  const toolingOnly = makeTmp();
  write(toolingOnly, 'pyproject.toml', '[project]\nname = "api"\n');
  for (let i = 0; i < 12; i++) write(toolingOnly, `api/m${i}.py`, '');
  write(toolingOnly, 'package.json', JSON.stringify({ name: 'tools', devDependencies: { prettier: '^3.0.0' } }));
  write(toolingOnly, 'scripts/one.js', '');
  assert.equal(header(buildContext(toolingOnly), 'Knowledge:'), 'Knowledge: python.md');
});

test('android projects add mobile.md', () => {
  const dir = makeTmp();
  write(dir, 'build.gradle.kts', 'plugins {}\n');
  write(dir, 'settings.gradle.kts', 'rootProject.name = "app"\n');
  write(dir, 'app/src/main/AndroidManifest.xml', '<manifest/>\n');
  write(dir, 'app/Main.kt', 'fun main() {}\n');
  assert.equal(header(buildContext(dir), 'Knowledge:'), 'Knowledge: jvm.md, mobile.md');
});

test('chooseKnowledge: swift and dart use mobile.md', () => {
  assert.deepEqual(chooseKnowledge({ primary: 'swift', languages: [], frameworks: [], infra: {} }), ['mobile.md']);
  assert.deepEqual(chooseKnowledge({ primary: 'dart', languages: [], frameworks: [], infra: {} }), ['mobile.md']);
  assert.deepEqual(chooseKnowledge({ primary: 'deno', languages: [], frameworks: [], infra: {} }), []);
});

test('JSON containing backtick fences cannot break out of the detection block', () => {
  const dir = makeTmp();
  write(dir, 'package.json', JSON.stringify({ name: 'p' }));
  write(dir, 'CONTRIBUTING.md', 'Never write "```" in commit messages.\n');
  const out = buildContext(dir);
  assert.ok(out.includes('````json\n'), 'fence is longer than the longest backtick run');
  assert.ok(out.includes('\n````\n'));
});

test('CLI exits 0, prints markdown, and resolves skill files independent of cwd', () => {
  const cwd = makeTmp();
  const res = spawnSync(process.execPath, [SCRIPT, fixture('go-mod')], { cwd, encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.ok(res.stdout.startsWith('# claude-setup context\n'));
  assert.ok(res.stdout.includes('## Template: templates/go.md'));
  assert.ok(res.stdout.includes(read('templates/go.md')));
});

test('CLI defaults to the current directory and exits 0 for a missing directory', () => {
  const here = spawnSync(process.execPath, [SCRIPT], { cwd: fixture('python-uv'), encoding: 'utf8' });
  assert.equal(here.status, 0);
  assert.ok(here.stdout.includes('Template: python (reason: primary=python'));

  const missing = spawnSync(process.execPath, [SCRIPT, path.join(os.tmpdir(), 'no-such-dir-xyz')], { encoding: 'utf8' });
  assert.equal(missing.status, 0);
  assert.ok(missing.stdout.includes('## Detection'));
});

test('the detection block carries the generated field', () => {
  const out = buildContext(fixture('generated-readme'));
  const start = out.indexOf('```json\n') + '```json\n'.length;
  const parsed = JSON.parse(out.slice(start, out.indexOf('\n```\n', start)));
  assert.deepEqual(parsed.generated, [{ path: 'README.md', evidence: 'written by scripts/docs.py (generate-readme)' }]);
});
