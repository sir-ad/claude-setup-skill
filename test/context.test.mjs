import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  buildContext, chooseTemplate, chooseKnowledge, withoutCurrentVersions, compactDetection, firstSentence,
  resolveShowPath, showFiles,
} from '../scripts/context.mjs';

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
const OWN_HEADING = /^(# claude-setup context|## Detection$|## Repo graph$|## Agent roster$|## Router config$|## (Template|Knowledge|Reference|Blueprint): (templates|knowledge|reference|blueprints)\/)/;
const headers = (out) => out.split('\n').filter((l) => OWN_HEADING.test(l));
const FULL = { full: true };
const header = (out, prefix) => out.split('\n').find((l) => l.startsWith(prefix));
const BLUEPRINTS = ['blueprints/README.md', ...(() => {
  const found = [];
  const visit = (rel) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) visit(child);
      else if (e.name.endsWith('.md') && child !== 'blueprints/README.md') found.push(child);
    }
  };
  visit('blueprints');
  return found.sort();
})()];
const REFERENCES = ['writing-agent-files.md', 'claude-code.md', 'agent-adapters.md', 'agentic-pipeline.md', 'token-efficiency.md', 'code-search.md', 'model-tiers.md', 'routing.md'];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\s+$/, '');

test('sections appear in the documented order with whole files included', () => {
  const out = buildContext(fixture('node-pnpm-monorepo'), FULL);
  assert.deepEqual(headers(out), [
    '# claude-setup context',
    '## Detection',
    '## Template: templates/node-monorepo.md',
    '## Knowledge: knowledge/node.md',
    '## Knowledge: knowledge/frontend.md',
    '## Repo graph',
    '## Agent roster',
    '## Router config',
    '## Knowledge: knowledge/practices.md',
    ...BLUEPRINTS.map((rel) => `## Blueprint: ${rel}`),
    ...REFERENCES.map((file) => `## Reference: reference/${file}`),
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

test('generic repos still print the generic template and all references (full mode)', () => {
  const out = buildContext(fixture('empty'), FULL);
  assert.ok(out.includes('## Template: templates/generic.md'));
  // Only the always-on practices note; no ecosystem note.
  assert.deepEqual(out.split('\n').filter((l) => l.startsWith('## Knowledge: ')), ['## Knowledge: knowledge/practices.md']);
  assert.ok(out.includes('## Reference: reference/agent-adapters.md'));
  assert.ok(out.includes('## Knowledge: knowledge/practices.md'));
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

test('header lists the sections and the exact size', () => {
  const out = buildContext(fixture('node-pnpm-monorepo'), FULL);
  const lines = out.split('\n');
  assert.match(lines[3], /^Sections: Detection, Template: templates\/node-monorepo\.md, Knowledge: knowledge\/node\.md, Knowledge: knowledge\/frontend\.md, Repo graph, Agent roster, Router config, Knowledge: knowledge\/practices\.md, Blueprint: blueprints\/README\.md, /);
  const names = lines[3].slice('Sections: '.length).split(', ');
  assert.equal(names.length, 1 + 1 + 2 + 3 + 1 + BLUEPRINTS.length + REFERENCES.length);
  for (const name of names) assert.ok(lines.includes(`## ${name}`), name);
  assert.equal(lines[4], `Size: ${out.split('\n').length - 1} lines`);
  assert.equal(lines[5], '');
});

test('the repo graph section follows the template and notes, before practices (full mode)', () => {
  const out = buildContext(fixture('graph-ts'), FULL);
  const at = (h) => out.indexOf(`\n${h}\n`);
  assert.ok(at('## Repo graph') > at('## Template: templates/node-single.md') || at('## Repo graph') > at('## Template: templates/node-monorepo.md'));
  assert.ok(at('## Repo graph') < at('## Knowledge: knowledge/practices.md'));
  assert.ok(out.includes('### Module graph'));
  assert.ok(out.includes('### Entry points'));
  assert.ok(out.includes('### Repo map'));
  // A graph for a repo with no source files still renders, never throws.
  assert.ok(buildContext(fixture('empty')).includes('No source files found.'));
});

test('blueprints are included in full, README first, then sorted by path', () => {
  const out = buildContext(fixture('empty'), FULL);
  const order = out.split('\n').filter((l) => l.startsWith('## Blueprint: ')).map((l) => l.slice('## Blueprint: '.length));
  assert.deepEqual(order, BLUEPRINTS);
  assert.equal(order[0], 'blueprints/README.md');
  for (const rel of BLUEPRINTS) assert.ok(out.includes(read(rel)), rel);
});

test('practices and the new references are always present, after the blueprints', () => {
  for (const name of ['empty', 'python-uv', 'go-mod']) {
    const out = buildContext(fixture(name), FULL);
    const hs = out.split('\n').filter((l) => OWN_HEADING.test(l));
    assert.ok(hs.indexOf('## Knowledge: knowledge/practices.md') > hs.indexOf('## Repo graph'), name);
    assert.ok(hs.indexOf('## Reference: reference/code-search.md') > hs.lastIndexOf(`## Blueprint: ${BLUEPRINTS.at(-1)}`), name);
    assert.ok(out.includes(read('knowledge/practices.md')), name);
    assert.ok(out.includes(read('reference/token-efficiency.md')), name);
  }
});

test('current-versions tables stay while the context is small, and the trimmer keeps everything else', () => {
  assert.ok(buildContext(fixture('python-uv')).includes('## Current versions'));
  const note = '# Python\n\n## Current versions\n| a | b |\n\n## Version notes\n- note\n\n## Default toolchain\n- uv\n';
  const trimmed = withoutCurrentVersions(note);
  assert.ok(!trimmed.includes('| a | b |'));
  assert.ok(!trimmed.includes('## Current versions'));
  assert.ok(trimmed.includes('## Version notes\n- note'));
  assert.ok(trimmed.includes('## Default toolchain\n- uv'));
  assert.equal(withoutCurrentVersions('# X\n\n## Version notes\n- n\n'), '# X\n\n## Version notes\n- n\n');
});

test('roster and router config follow the repo graph, built from the same detection', () => {
  const out = buildContext(fixture('python-uv'));
  const lines = out.split('\n');
  const at = (h) => lines.indexOf(h);
  assert.ok(at('## Repo graph') < at('## Agent roster'));
  assert.ok(at('## Agent roster') < at('## Router config'));
  assert.ok(at('## Router config') < at('## Reference: reference/writing-agent-files.md'));

  // Roster: derived from this repo (python, tests, ruff), rendered as tables with demoted headings.
  const roster = lines.slice(at('## Agent roster'), at('## Router config')).join('\n');
  assert.match(roster, /### Roster/);
  assert.match(roster, /### Routing/);
  assert.match(roster, /\| python-reviewer \|/);
  assert.match(roster, /\| test-runner \|/);
  assert.ok(!lines.some((l, i) => i > at('## Agent roster') && i < at('## Router config') && l.startsWith('## ')), 'no stray ## headings inside the roster');

  // Router config: a json fence that parses, with the roster's roles.
  const start = lines.indexOf('```json', at('## Router config')) + 1;
  const end = lines.indexOf('```', start);
  const config = JSON.parse(lines.slice(start, end).join('\n'));
  assert.equal(config.version, 1);
  assert.ok(config.roles.some((r) => r.name === 'test-runner'));
  assert.ok(config.tiers && config.thresholds);
});

test('model-tiers and routing references are injected in full, after the earlier references', () => {
  const out = buildContext(fixture('empty'), FULL);
  const hs = out.split('\n').filter((l) => l.startsWith('## Reference: '));
  assert.deepEqual(hs.slice(-2), ['## Reference: reference/model-tiers.md', '## Reference: reference/routing.md']);
  assert.ok(out.includes(read('reference/model-tiers.md')));
  assert.ok(out.includes(read('reference/routing.md')));
});

test('real-size sanity: small repos stay under the line caps, so no table is trimmed', () => {
  const core = buildContext(fixture('node-pnpm-monorepo'));
  assert.ok(core.split('\n').length - 1 < 1200, 'core under 1,200 lines');
  assert.ok(core.includes('## Current versions'));
  const full = buildContext(fixture('node-pnpm-monorepo'), FULL);
  assert.ok(full.split('\n').length - 1 < 3200, 'full under 3,200 lines');
  assert.ok(full.includes('## Current versions'));
});

// ---------------------------------------------------------------------------
// Lean default, --show and --full
// ---------------------------------------------------------------------------

const cli = (args, options = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', ...options });
const BLUEPRINT_FILES = BLUEPRINTS.filter((b) => b !== 'blueprints/README.md');
const REFERENCE_FILES = fs.readdirSync(path.join(ROOT, 'reference')).filter((f) => f.endsWith('.md')).map((f) => `reference/${f}`);

test('default output is the core: no blueprints, practices or extra references, but an index of them', () => {
  const out = buildContext(fixture('node-pnpm-monorepo'));
  const lines = out.split('\n');
  assert.deepEqual(headers(out), [
    '# claude-setup context',
    '## Detection',
    '## Template: templates/node-monorepo.md',
    '## Knowledge: knowledge/node.md',
    '## Knowledge: knowledge/frontend.md',
    '## Repo graph',
    '## Agent roster',
    '## Router config',
    '## Reference: reference/writing-agent-files.md',
  ]);
  const names = lines[3].slice('Sections: '.length).split(', ');
  assert.deepEqual(names.slice(-2), ['Reference: reference/writing-agent-files.md', 'Guidance index']);
  for (const name of names) assert.ok(lines.includes(`## ${name}`), name);
  assert.equal(lines[4], `Size: ${lines.length - 1} lines`);
  for (const rel of BLUEPRINT_FILES) assert.ok(!lines.includes(`## Blueprint: ${rel}`), rel);
  assert.ok(!out.includes(read('reference/routing.md')));
  assert.ok(!out.includes('## Knowledge: knowledge/practices.md'));
  assert.ok(out.includes(read('reference/writing-agent-files.md')));
  assert.ok(out.includes(read('knowledge/node.md')));
});

test('the guidance index has the blueprints README, the fetch command and one line per other file', () => {
  const out = buildContext(fixture('empty'));
  const index = out.slice(out.indexOf('\n## Guidance index\n'));
  const readmeBody = read('blueprints/README.md').split('\n').slice(1).join('\n').trim();
  assert.ok(index.includes(readmeBody.split('\n')[0]), 'README prose is included');
  assert.ok(/^#{3,6} /m.test(index), 'README headings are demoted below the section');
  assert.ok(!index.split('\n').some((l) => /^#{1,2} /.test(l) && l !== '## Guidance index'), 'no stray top-level headings in the index');
  assert.ok(index.includes(`node "${SCRIPT}" --show <path> [<path>...]`), 'exact command with an absolute script path');
  const expected = [...BLUEPRINT_FILES, 'knowledge/practices.md', ...REFERENCE_FILES.filter((r) => r !== 'reference/writing-agent-files.md')];
  for (const rel of expected) assert.ok(new RegExp(`^- ${rel.replace(/[.]/g, '\\.')}(: .+)?$`, 'm').test(index), rel);
  assert.ok(!/^- reference\/writing-agent-files\.md/m.test(index), 'already injected, so not listed');
  assert.ok(!/^- blueprints\/README\.md/m.test(index));
  assert.match(index, /^- blueprints\/skills\/handoff\.md: .+/m);
});

test('firstSentence: skips headings, frontmatter, tables and metadata lines', () => {
  assert.equal(firstSentence('# Title\n\n> quote\n\nFirst sentence here. Second one.\n'), 'First sentence here.');
  assert.equal(firstSentence('---\nname: x\n---\n# T\n- A list item starts it. More.\n'), 'A list item starts it.');
  assert.equal(firstSentence('# T\nChecked: 2026-10.\n| a | b |\n```\ncode. here\n```\nReal text.\n'), 'Real text.');
  assert.equal(firstSentence('# only a heading\n'), '');
  const long = firstSentence(`# T\n${'word '.repeat(60)}\n`);
  assert.ok(long.length <= 140 && long.endsWith('…'));
});

test('compactDetection drops empties and false flags, caps long lists and counts what it cut', () => {
  const input = {
    name: 'x', version: null, note: '', packageManager: null, workspaces: [], infra: { docker: false, compose: false },
    frameworks: [{ name: 'a', range: '', alsoIn: [], group: 'dev' }],
    commands: { build: [], other: Array.from({ length: 20 }, (_, i) => ({ cmd: `c${i}`, source: 's' })), test: Array.from({ length: 15 }, (_, i) => ({ cmd: `t${i}`, source: 's' })) },
    hardRuleCandidates: Array.from({ length: 14 }, (_, i) => ({ text: `r${i}`, source: 'f:1' })),
    env: { files: ['.env.example'], gitignored: [] },
  };
  const out = compactDetection(input);
  assert.deepEqual(Object.keys(out), ['name', 'frameworks', 'commands', 'hardRuleCandidates', 'env', '_omitted']);
  assert.deepEqual(out.frameworks, [{ name: 'a', group: 'dev' }]);
  assert.deepEqual(out.env, { files: ['.env.example'] });
  assert.equal(out.commands.other.length, 8);
  assert.equal(out.commands.test.length, 12);
  assert.equal(out.hardRuleCandidates.length, 12);
  assert.deepEqual(out._omitted, { 'commands.other': 12, 'commands.test': 3, hardRuleCandidates: 2 });
  assert.equal(input.commands.other.length, 20, 'the input is not modified');
  assert.deepEqual(compactDetection({ a: 1 }), { a: 1 });
});

test('the injected detection is compact but keeps what the skill reads', () => {
  const out = buildContext(fixture('node-pnpm-monorepo'));
  const start = out.indexOf('```json\n') + '```json\n'.length;
  const parsed = JSON.parse(out.slice(start, out.indexOf('\n```\n', start)));
  assert.equal(parsed.primary, 'node');
  assert.equal(parsed.packageManagerVersion, '9.12.0');
  assert.deepEqual(parsed.workspaces, ['apps/web', 'packages/ui']);
  assert.ok(parsed.commands.test.length > 0);
  assert.ok(!('typecheck' in parsed.commands), 'empty command lists are dropped');
  assert.ok(!('infra' in parsed), 'all-false infra flags are dropped');
  assert.match(out, /Compacted: nulls, empty lists and false flags are dropped/);
  // Full mode keeps the complete detector JSON.
  const full = buildContext(fixture('node-pnpm-monorepo'), FULL);
  const fs0 = full.indexOf('```json\n') + '```json\n'.length;
  const complete = JSON.parse(full.slice(fs0, full.indexOf('\n```\n', fs0)));
  assert.ok('infra' in complete && 'typecheck' in complete.commands);
});

test('long detector lists are capped in the injected copy, with counts', () => {
  const dir = makeTmp();
  write(dir, 'package.json', JSON.stringify({ name: 'p', scripts: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`task${i}`, 'node x.js'])) }));
  write(dir, 'package-lock.json', '{}');
  const out = buildContext(dir);
  const start = out.indexOf('```json\n') + '```json\n'.length;
  const parsed = JSON.parse(out.slice(start, out.indexOf('\n```\n', start)));
  assert.equal(parsed.commands.other.length, 8);
  assert.equal(parsed._omitted['commands.other'], 22);
});

test('--full keeps the everything-injected output', () => {
  const res = cli([fixture('python-uv'), '--full']);
  assert.equal(res.status, 0);
  const out = res.stdout;
  assert.ok(out.includes('## Knowledge: knowledge/practices.md'));
  for (const rel of BLUEPRINTS) assert.ok(out.includes(`\n## Blueprint: ${rel}\n`), rel);
  for (const rel of REFERENCE_FILES) assert.ok(out.includes(`\n## Reference: ${rel}\n`), rel);
  assert.ok(!out.includes('## Guidance index'));
  assert.equal(out, buildContext(fixture('python-uv'), FULL));
});

test('--show prints the requested files under kind headings, in order, several per call', () => {
  const res = cli(['--show', 'blueprints/skills/handoff.md', 'reference/routing.md', 'knowledge/go.md', 'templates/go.md'], { cwd: makeTmp() });
  assert.equal(res.status, 0);
  const hs = res.stdout.split('\n').filter((l) => /^## (Blueprint|Reference|Knowledge|Template): /.test(l));
  assert.deepEqual(hs, [
    '## Blueprint: blueprints/skills/handoff.md',
    '## Reference: reference/routing.md',
    '## Knowledge: knowledge/go.md',
    '## Template: templates/go.md',
  ]);
  for (const rel of ['blueprints/skills/handoff.md', 'reference/routing.md', 'knowledge/go.md', 'templates/go.md']) {
    assert.ok(res.stdout.includes(read(rel)), rel);
  }
});

test('--show resolves against the skill root, not the working directory', () => {
  const cwd = makeTmp();
  write(cwd, 'blueprints/README.md', '# Decoy\nnot the skill file\n');
  const res = cli(['--show', 'blueprints/README.md'], { cwd });
  assert.ok(res.stdout.includes(read('blueprints/README.md')));
  assert.ok(!res.stdout.includes('Decoy'));
});

test('--show rejects paths outside the guidance directories with a one-line note and exit 0', () => {
  const bad = ['../package.json', '/etc/passwd', 'knowledge/../package.json', 'scripts/detect.mjs', 'package.json', 'SKILL.md',
    'blueprints', 'blueprints/../scripts/verify.mjs', 'blueprints\\README.md', './', 'examples/acme-saas.md', 'blueprints//README.md'];
  const res = cli(['--show', ...bad]);
  assert.equal(res.status, 0);
  const lines = res.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, bad.length, res.stdout);
  for (const line of lines) assert.match(line, /^\(rejected: ".*": .+\)$/);
  assert.ok(!res.stdout.includes('"name": "@claude-setup-skill'));
  assert.ok(!res.stdout.includes('claude-setup context'));
});

test('--show mixes valid, rejected, missing and repeated paths', () => {
  const out = showFiles(['blueprints/docs/config.md', '../x', 'blueprints/docs/nope.md', 'blueprints/docs/config.md', 'reference/']);
  const lines = out.split('\n');
  assert.equal(lines.filter((l) => l === '## Blueprint: blueprints/docs/config.md').length, 1, 'repeated paths print once');
  assert.ok(lines.includes('(rejected: "../x": absolute paths, ".." and empty segments are not allowed)'));
  assert.ok(lines.includes('(missing: blueprints/docs/nope.md does not exist)'));
  assert.ok(lines.some((l) => l.startsWith('(rejected: "reference/"')));
  assert.match(showFiles([]), /nothing requested/);
});

test('a missing --show argument list and --show without a directory both exit 0', () => {
  const res = cli(['--show']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /nothing requested/);
});

test('default output stays lean: well under 1,000 lines for small fixtures', () => {
  for (const name of ['empty', 'python-uv', 'go-mod', 'rust-workspace', 'node-pnpm-monorepo']) {
    const lines = buildContext(fixture(name)).split('\n').length - 1;
    assert.ok(lines < 900, `${name}: ${lines} lines`);
  }
});
