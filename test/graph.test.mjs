import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildGraph, renderMarkdown } from '../scripts/graph.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'graph.mjs');
const fixture = (name) => path.join(HERE, 'fixtures', name);

const tmpDirs = [];
function makeTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-test-'));
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

const edgeMap = (g) => Object.fromEntries(g.edges.map((e) => [`${e.from} > ${e.to}`, e.weight]));
const entry = (g, p) => g.entryPoints.find((e) => e.path === p);
const external = (g, name) => g.externals.find((e) => e.name === name);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

test('graph-ts: relative, index, alias, workspace and external imports', () => {
  const g = buildGraph(fixture('graph-ts'));
  assert.equal(g.files, 8);
  assert.equal(g.testFiles, 1, 'util.test.ts is flagged, not graphed');
  assert.deepEqual(g.languages.map((l) => l.name), ['typescript', 'javascript']);
  assert.deepEqual(g.nodes.map((n) => n.id), ['packages/ui/src', 'src', 'src/api', 'src/lib']);
  assert.deepEqual(edgeMap(g), {
    'src > packages/ui/src': 1, // @acme/ui resolved through its package.json "module"
    'src > src/api': 1, // './api' resolves to api/index.ts
    'src > src/lib': 2, // '@/lib/util' via tsconfig paths, plus require('./lib/legacy')
    'src/api > src': 1, // '../types' from handlers.ts
    'src/api > src/lib': 2, // relative '../lib/util' and aliased '@/lib/util'
  });
  // node: builtins, relative and aliased imports never show up as externals.
  assert.deepEqual(g.externals.map((e) => e.name), ['clsx', 'lodash', 'react']);
  assert.equal(entry(g, 'src/index.ts').kind, 'package-main');
  assert.equal(entry(g, 'packages/ui/src/index.ts').kind, 'package-main');
  const util = g.central.files.find((f) => f.path === 'src/lib/util.ts');
  assert.equal(util.inDegree, 3);
  assert.equal(g.central.files[0].path, 'src/lib/util.ts');
  const symbols = (p) => g.repoMap.find((r) => r.path === p).symbols;
  assert.deepEqual(symbols('src/lib/util.ts'), ['slug', 'Util', 'makeSlug']);
  assert.deepEqual(symbols('src/index.ts'), ['main', 'default']);
  assert.deepEqual(symbols('src/lib/legacy.js'), ['legacyThing']);
  assert.deepEqual(g.warnings, []);
});

test('graph-py: package, relative and external imports', () => {
  const g = buildGraph(fixture('graph-py'));
  assert.equal(g.files, 7);
  assert.equal(g.testFiles, 1);
  assert.deepEqual(g.nodes.map((n) => n.id), ['myapp', 'myapp/core']);
  assert.deepEqual(edgeMap(g), { 'myapp > myapp/core': 2, 'myapp/core > myapp': 2 });
  // Stdlib is dropped, and an import inside a docstring is ignored.
  assert.deepEqual(g.externals.map((e) => e.name), ['numpy', 'pydantic', 'requests']);
  assert.equal(entry(g, 'myapp/cli.py').kind, 'python-script');
  assert.equal(entry(g, 'myapp/__main__.py').kind, 'python-main');
  const cli = g.repoMap.find((r) => r.path === 'myapp/cli.py');
  assert.deepEqual(cli.symbols, ['main', 'Cli'], 'underscore names are private');
  assert.deepEqual(g.warnings, []);
});

test('graph-go: module-path imports', () => {
  const g = buildGraph(fixture('graph-go'));
  assert.equal(g.files, 3);
  assert.equal(g.testFiles, 1);
  assert.deepEqual(g.nodes.map((n) => n.id), ['.', 'internal/server', 'internal/store']);
  assert.deepEqual(edgeMap(g), { '. > internal/server': 1, 'internal/server > internal/store': 1 });
  assert.deepEqual(g.externals.map((e) => e.name), ['github.com/go-chi/chi', 'github.com/jackc/pgx']);
  assert.equal(entry(g, 'main.go').kind, 'go-main');
  const server = g.repoMap.find((r) => r.path === 'internal/server/server.go');
  assert.deepEqual(server.symbols, ['Server', 'New'], 'lower-case helper is not exported');
  assert.equal(g.central.files[0].path, 'internal/store/store.go');
});

test('graph-rust: workspace crates, mod declarations and Cargo dependencies', () => {
  const g = buildGraph(fixture('graph-rust'));
  assert.equal(g.files, 6);
  assert.deepEqual(g.nodes.map((n) => [n.id, n.kind]), [
    ['crates/app', 'workspace'], ['crates/engine', 'workspace'],
    ['crates/extras', 'workspace'], ['crates/util', 'workspace'],
  ]);
  assert.deepEqual(edgeMap(g), {
    'crates/app > crates/engine': 1, // one grouped `use engine_core::{Engine, run}` is one import
    'crates/app > crates/util': 1, // only declared in Cargo.toml
    'crates/engine > crates/util': 1,
  });
  assert.deepEqual(g.externals.map((e) => e.name), ['serde']);
  assert.equal(entry(g, 'crates/app/src/main.rs').kind, 'rust-bin');
  const engine = g.repoMap.find((r) => r.path === 'crates/engine/src/engine.rs');
  assert.deepEqual(engine.symbols, ['Engine', 'Mode', 'Runner']);
  // `mod cli;` links main.rs to cli.rs inside one module, so no edge appears.
  assert.equal(g.central.files.find((f) => f.path === 'crates/app/src/cli.rs').inDegree, 1);
});

// ---------------------------------------------------------------------------
// Behaviour on temp repos
// ---------------------------------------------------------------------------

test('flat grouping for monorepos with four or more members', () => {
  const dir = makeTmp();
  write(dir, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));
  for (const name of ['a', 'b', 'c', 'd']) {
    write(dir, `packages/${name}/package.json`, JSON.stringify({ name: `@m/${name}`, main: 'src/index.ts' }));
    write(dir, `packages/${name}/src/deep/more.ts`, 'export const x = 1;\n');
  }
  write(dir, 'packages/a/src/index.ts', "import { b } from '@m/b';\nimport { x } from './deep/more';\nexport { b, x };\n");
  write(dir, 'packages/b/src/index.ts', 'export const b = 1;\n');
  const g = buildGraph(dir);
  assert.deepEqual(g.nodes.map((n) => [n.id, n.kind]), [
    ['packages/a', 'workspace'], ['packages/b', 'workspace'], ['packages/c', 'workspace'], ['packages/d', 'workspace'],
  ]);
  assert.deepEqual(edgeMap(g), { 'packages/a > packages/b': 1 });
});

test('file cap and per-file size cap', () => {
  const dir = makeTmp();
  fs.mkdirSync(path.join(dir, 'many'));
  for (let i = 0; i < 20050; i++) fs.writeFileSync(path.join(dir, 'many', `f${i}.js`), 'export const a = 1;\n');
  const g = buildGraph(dir);
  assert.equal(g.files, 20000);
  assert.ok(g.warnings.some((w) => /cap/.test(w)), 'truncation is reported');

  const big = makeTmp();
  write(big, 'huge.js', `import 'big-external';\n${'// padding\n'.repeat(250000)}`);
  write(big, 'small.js', "import 'small-external';\n");
  assert.ok(fs.statSync(path.join(big, 'huge.js')).size > 2 * 1024 * 1024);
  const h = buildGraph(big);
  assert.deepEqual(h.externals.map((e) => e.name), ['small-external']);
  assert.ok(h.warnings.some((w) => /over 2 MB/.test(w)));
});

test('.env* files are never opened', () => {
  const dir = makeTmp();
  write(dir, '.env.ts', "import 'leaked-from-env';\n");
  write(dir, 'config/.env.local.js', "require('leaked-too');\n");
  write(dir, 'src/app.js', "import 'fine';\n");
  const opened = [];
  const real = fs.readFileSync;
  fs.readFileSync = function patched(file, ...rest) {
    opened.push(String(file));
    return real.call(this, file, ...rest);
  };
  let g;
  try {
    g = buildGraph(dir);
  } finally {
    fs.readFileSync = real;
  }
  assert.deepEqual(g.externals.map((e) => e.name), ['fine']);
  assert.ok(opened.some((p) => p.endsWith('app.js')), 'the spy sees ordinary reads');
  assert.deepEqual(opened.filter((p) => /\.env/.test(p)), []);
});

test('skip rules: vendored, build and generated dirs, symlinks, generated headers', () => {
  const dir = makeTmp();
  write(dir, 'src/a.ts', "import 'kept';\n");
  for (const skipped of ['node_modules/x', 'dist', 'build', 'target', 'vendor', '.venv', '__pycache__', 'generated', '.git']) {
    write(dir, `${skipped}/z.js`, "import 'skipped-pkg';\n");
  }
  write(dir, 'src/gen.ts', "// @generated by tool\nimport 'from-generated';\n");
  write(dir, 'src/types.d.ts', "import 'from-dts';\n");
  fs.symlinkSync(path.join(dir, 'src'), path.join(dir, 'linked'));
  const g = buildGraph(dir);
  assert.equal(g.files, 1);
  assert.deepEqual(g.externals.map((e) => e.name), ['kept']);
});

test('mermaid ids are sanitized, unique and safe', () => {
  const dir = makeTmp();
  const weird = ['end', '1st', 'a-b', 'a_b', 'we ird (dir)', 'x.y', 'graph', 'c"q"'];
  for (const name of weird) write(dir, `src/${name}/index.js`, "import '../end/index.js';\nimport '../graph/index.js';\n");
  const md = renderMarkdown(buildGraph(dir), { maxNodes: 25 });
  const block = md.match(/```mermaid\n([\s\S]*?)\n```/)[1];
  const lines = block.split('\n');
  assert.equal(lines[0], 'flowchart LR');
  const ids = [];
  for (const line of lines.slice(1)) {
    const decl = line.match(/^ {2}([^\s["]+)\["([^"]*)"\]$/);
    if (decl) {
      assert.match(decl[1], /^[A-Za-z0-9_]+$/);
      assert.ok(!/["<>#`]/.test(decl[2]), `label is clean: ${decl[2]}`);
      ids.push(decl[1]);
    } else {
      assert.match(line, /^ {2}[A-Za-z0-9_]+ -->(\|\d+\| | )[A-Za-z0-9_]+$/);
    }
  }
  assert.equal(ids.length, weird.length);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique even when names collide after sanitizing');
  assert.ok(!ids.includes('end') && !ids.includes('graph'), 'no bare reserved words');
});

test('markdown sections, edge labels, node cap and footer', () => {
  const g = buildGraph(fixture('graph-ts'));
  const md = renderMarkdown(g, { maxNodes: 25 });
  const headings = md.split('\n').filter((l) => l.startsWith('### '));
  assert.deepEqual(headings, ['### Module graph', '### Entry points', '### Central modules', '### Repo map']);
  assert.match(md, /Showing all 4 modules\./);
  assert.match(md, /-->\|2\|/, 'weights above one are labelled');
  assert.doesNotMatch(md, /-->\|1\|/, 'weight one is not labelled');
  assert.doesNotMatch(md, /claude-setup:(begin|end)/, 'markers belong to the skill');
  assert.ok(md.trimEnd().endsWith('Generated by scripts/graph.mjs. Re-run /claude-setup --update to refresh.'));

  const small = renderMarkdown(g, { maxNodes: 2 });
  assert.match(small, /Showing 2 of 4 modules, chosen by centrality; 2 hidden\./);
  assert.equal(small.match(/\["[^"]+"\]/g).length, 2);
});

test('repo map respects the line budget and caps symbols per file', () => {
  const dir = makeTmp();
  const names = Array.from({ length: 12 }, (_, i) => `export const s${i} = ${i};`).join('\n');
  for (let i = 0; i < 6; i++) write(dir, `src/m${i}.ts`, `${names}\n`);
  const g = buildGraph(dir, { budget: 4 });
  assert.equal(g.repoMap.length, 4);
  assert.ok(g.repoMap.every((r) => r.symbols.length === 8));
  assert.equal(buildGraph(dir, { budget: 0 }).repoMap.length, 0);
});

test('output is deterministic', () => {
  for (const name of ['graph-ts', 'graph-py', 'graph-go', 'graph-rust']) {
    const a = buildGraph(fixture(name));
    const b = buildGraph(fixture(name));
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(renderMarkdown(a), renderMarkdown(b));
  }
});

test('empty and missing directories never throw', () => {
  const dir = makeTmp();
  const g = buildGraph(dir);
  assert.equal(g.files, 0);
  assert.deepEqual(g.nodes, []);
  assert.deepEqual(g.edges, []);
  assert.deepEqual(g.warnings, []);
  const md = renderMarkdown(g);
  assert.match(md, /No source files found\./);
  assert.match(md, /### Repo map/);

  const missing = buildGraph(path.join(dir, 'nope'));
  assert.equal(missing.files, 0);
  assert.equal(missing.warnings.length, 1);
});

test('malformed manifests become warnings or are ignored', () => {
  const dir = makeTmp();
  write(dir, 'package.json', '{ not json');
  write(dir, 'tsconfig.json', '{ "compilerOptions": ');
  write(dir, 'Cargo.toml', '[package\nname = ');
  write(dir, 'src/a.ts', "import './b';\n");
  write(dir, 'src/b.ts', 'export const b = 1;\n');
  const g = buildGraph(dir);
  assert.equal(g.files, 2);
  assert.ok(g.warnings.some((w) => /malformed JSON in package\.json/.test(w)));
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('cli: markdown is the default and --json prints the graph', () => {
  const md = run([fixture('graph-go')]);
  assert.equal(md.status, 0);
  assert.match(md.stdout, /^Source files: \d+ \(plus \d+ test files\)\. Languages: /);
  assert.match(md.stdout, /^### Module graph$/m);

  const json = run([fixture('graph-go'), '--json']);
  assert.equal(json.status, 0);
  const parsed = JSON.parse(json.stdout);
  assert.deepEqual(Object.keys(parsed), [
    'root', 'languages', 'files', 'testFiles', 'nodes', 'edges', 'externals', 'central', 'entryPoints', 'repoMap', 'warnings',
  ]);
  assert.equal(parsed.root, fixture('graph-go'));
});

test('cli: options are honoured', () => {
  const r = run([fixture('graph-ts'), '--max-nodes', '2', '--budget', '1']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /2 hidden/);
  const map = r.stdout.match(/### Repo map\n\n```text\n([\s\S]*?)\n```/)[1];
  assert.equal(map.split('\n').length, 1);
  assert.equal(run([fixture('graph-ts'), '--max-nodes=3']).status, 0);
});

test('cli: usage errors exit 2, everything else exits 0', () => {
  for (const args of [['--bogus'], ['--max-nodes', 'x'], ['--max-nodes', '0'], ['--budget'], ['a', 'b'], ['--json', '--markdown']]) {
    const r = run(args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /usage:/);
  }
  assert.equal(run(['--help']).status, 0);
  const missing = run([path.join(os.tmpdir(), 'graph-test-does-not-exist'), '--json']);
  assert.equal(missing.status, 0);
  assert.equal(JSON.parse(missing.stdout).files, 0);
});
