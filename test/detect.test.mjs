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
  assert.deepEqual(names(r.frameworks), ['eslint', 'react', 'vite', 'vitest']);
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
    'versionFiles', 'warnings',
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
  assert.ok(r.warnings.some((w) => w.startsWith('walk stopped')));
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
    'Handlers MUST be idempotent. ' + 'x'.repeat(300),
  ].join('\n'));
  write(dir, 'docs/adr/0001-db.md', 'We don\u2019t use ORMs here.\n');
  const r = detect(dir);
  assert.deepEqual(r.hardRuleCandidates.map((c) => c.source), ['docs/adr/0001-db.md:1', 'CONTRIBUTING.md:2', 'CONTRIBUTING.md:8']);
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
  assert.deepEqual(fixtureScripts, []);

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
  ].join('\n'));
  const r = detect(dir);
  assert.deepEqual(r.hardRuleCandidates.map((c) => c.source), ['CONTRIBUTING.md:2', 'CONTRIBUTING.md:3', 'CONTRIBUTING.md:4']);
  // Line 3 is cut at the sentence that carries the rule, with no ellipsis.
  assert.ok(r.hardRuleCandidates[1].text.startsWith('word word'));
  assert.ok(r.hardRuleCandidates[1].text.endsWith('under the limit.'));
  // Line 4 has no sentence end within the limit, so it is cut at a word with an ellipsis.
  assert.ok(r.hardRuleCandidates[2].text.endsWith('…'));
  for (const c of r.hardRuleCandidates) assert.ok(c.text.length <= 240, String(c.text.length));
});

test('hard rules are capped at 25', () => {
  const dir = makeTmp();
  write(dir, 'CONTRIBUTING.md', Array.from({ length: 40 }, (_, i) => `Never do thing number ${i}.`).join('\n'));
  write(dir, 'docs/adr/a.md', Array.from({ length: 40 }, (_, i) => `Never do adr thing ${i}.`).join('\n'));
  write(dir, 'AGENTS.md', Array.from({ length: 40 }, (_, i) => `Never do agent thing ${i}.`).join('\n'));
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
