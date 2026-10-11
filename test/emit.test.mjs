import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { mergeSettings } from '../scripts/emit.mjs';
import { deriveRoster, toRouterConfig } from '../scripts/roster.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'emit.mjs');
const ROUTE_SRC = fs.readFileSync(path.join(HERE, '..', 'scripts', 'router', 'route.mjs'));
const FIXTURE = path.join(HERE, 'fixtures', 'roster-next-prisma');
const ROUTE_CMD = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/route.mjs"';
const HOOK = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: ROUTE_CMD, timeout: 5 }] }] } };
const ROUTER = '--write=router';
const ALL = 'router,agents-doc,structure-doc';

const tmpDirs = [];
function project(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-test-'));
  tmpDirs.push(dir);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  for (const [rel, text] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}
process.on('exit', () => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const emit = (dir, args) => {
  const r = spawnSync(process.execPath, [SCRIPT, dir, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const hookCount = (dir) => JSON.parse(read(dir, '.claude/settings.json')).hooks.UserPromptSubmit
  .flatMap((g) => g.hooks).filter((h) => h.command === ROUTE_CMD).length;
function tree(dir, rel = '') {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? tree(dir, path.join(rel, e.name)) : [path.join(rel, e.name)]))
    .sort();
}
const ROSTER_BEGIN = '<!-- claude-setup:begin roster -->';
const ROSTER_END = '<!-- claude-setup:end roster -->';

test('router unit writes four files; route.mjs is byte-identical and router.json matches the roster', () => {
  const dir = project();
  const r = emit(dir, [ROUTER, '--intent', 'landing page']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^write \.claude\/hooks\/route\.mjs$/m);
  assert.match(r.out, /^write \.claude\/router\.json$/m);
  assert.match(r.out, /^write \.claude\/settings\.json \(UserPromptSubmit hook\)$/m);
  assert.match(r.out, /^write \.gitignore$/m);
  assert.ok(fs.readFileSync(path.join(dir, '.claude/hooks/route.mjs')).equals(ROUTE_SRC));
  const cfg = JSON.parse(read(dir, '.claude/router.json'));
  assert.deepEqual(cfg, toRouterConfig(deriveRoster(dir, { intent: 'landing page' })));
  assert.equal(read(dir, '.claude/router.json'), `${JSON.stringify(cfg, null, 2)}\n`);
  const settings = JSON.parse(read(dir, '.claude/settings.json'));
  assert.equal(settings.$schema, 'https://json.schemastore.org/claude-code-settings.json');
  assert.deepEqual(settings.hooks.UserPromptSubmit, [{ hooks: [{ type: 'command', command: ROUTE_CMD, timeout: 5 }] }]);
});

test('settings merge keeps existing keys and is idempotent', () => {
  const existing = {
    permissions: { allow: ['Bash(npm test)'] },
    env: { FOO: '1' },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo other' }] }] },
  };
  const dir = project({ '.claude/settings.json': `${JSON.stringify(existing, null, 2)}\n` });
  assert.equal(emit(dir, [ROUTER]).code, 0);
  const once = JSON.parse(read(dir, '.claude/settings.json'));
  assert.equal(once.$schema, undefined, 'an existing file gets no $schema key added');
  assert.deepEqual(once.permissions, existing.permissions);
  assert.deepEqual(once.env, existing.env);
  assert.deepEqual(once.hooks.PreToolUse, existing.hooks.PreToolUse);
  assert.equal(once.hooks.UserPromptSubmit.length, 2, 'existing UserPromptSubmit entry kept, route entry appended');
  assert.equal(once.hooks.UserPromptSubmit[0].hooks[0].command, 'echo other');
  assert.equal(hookCount(dir), 1);

  const again = emit(dir, [ROUTER]);
  assert.match(again.out, /^skip \.claude\/settings\.json \(UserPromptSubmit hook already present\)$/m);
  assert.equal(hookCount(dir), 1);
  assert.deepEqual(JSON.parse(read(dir, '.claude/settings.json')), once);
});

test('gitignore gets the route log line once, keeping existing lines', () => {
  const dir = project({ '.gitignore': 'node_modules' });
  assert.equal(emit(dir, [ROUTER]).code, 0);
  assert.equal(emit(dir, [ROUTER]).code, 0);
  const lines = read(dir, '.gitignore').split('\n');
  assert.equal(lines.filter((l) => l === '.claude/route-log.jsonl').length, 1);
  assert.equal(lines[0], 'node_modules');
});

test('a differing .claude/hooks/route.mjs skips the whole router unit', () => {
  const custom = '// hand-written hook\n';
  const dir = project({ '.claude/hooks/route.mjs': custom });
  const r = emit(dir, [ROUTER]);
  assert.equal(r.code, 0, r.err);
  for (const rel of ['.claude/hooks/route.mjs', '.claude/router.json', '.claude/settings.json', '.gitignore']) {
    assert.match(r.out, new RegExp(`^skip ${rel.replace(/\./g, '\\.')} \\(router unit skipped: `, 'm'));
  }
  assert.equal(read(dir, '.claude/hooks/route.mjs'), custom);
  assert.equal(exists(dir, '.claude/router.json'), false);
  assert.equal(exists(dir, '.claude/settings.json'), false);
  assert.equal(exists(dir, '.gitignore'), false);
});

test('agents-doc and structure-doc replace only the text inside their fences', () => {
  const before = '# Agents\n\nIntro prose that stays.\n\n';
  const after = '\n\nOutro prose that stays.\n';
  const old = `${ROSTER_BEGIN}\nold roster\n${ROSTER_END}`;
  const graphOld = '<!-- claude-setup:begin graph -->\nold graph\n<!-- claude-setup:end graph -->';
  const dir = project({
    'docs/agents.md': `${before}${old}${after}`,
    'docs/project-structure.md': `# Structure\n\nHand notes.\n\n${graphOld}\n\n## Notes\n- kept\n`,
  });
  const r = emit(dir, ['--write', 'agents-doc,structure-doc']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^update docs\/agents\.md \(fence\)$/m);
  assert.match(r.out, /^update docs\/project-structure\.md \(fence\)$/m);

  const agents = read(dir, 'docs/agents.md');
  assert.ok(agents.startsWith(before), 'prose before the fence is untouched');
  assert.ok(agents.endsWith(after), 'prose after the fence is untouched');
  assert.match(agents, /^### Roster$/m);
  assert.doesNotMatch(agents, /^## /m, 'roster headings are demoted to ###');
  assert.doesNotMatch(agents, /old roster/);

  const structure = read(dir, 'docs/project-structure.md');
  assert.ok(structure.startsWith('# Structure\n\nHand notes.\n\n<!-- claude-setup:begin graph -->\n'));
  assert.ok(structure.endsWith('<!-- claude-setup:end graph -->\n\n## Notes\n- kept\n'));
  assert.match(structure, /Generated by scripts\/graph\.mjs/);

  const second = emit(dir, ['--write', 'agents-doc,structure-doc']);
  assert.equal((second.out.match(/^skip docs\/.*\(unchanged\)$/gm) || []).length, 2);
});

test('missing docs are created with the fence', () => {
  const dir = project();
  const r = emit(dir, ['--write', 'agents-doc,structure-doc']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^write docs\/agents\.md$/m);
  assert.match(r.out, /^write docs\/project-structure\.md$/m);
  const agents = read(dir, 'docs/agents.md');
  assert.ok(agents.startsWith('# Agents\n\nRoles, scopes and model tiers for agents working in this repo.\n\n' + `${ROSTER_BEGIN}\n### Roster\n`));
  assert.ok(agents.endsWith(`${ROSTER_END}\n`));
  const structure = read(dir, 'docs/project-structure.md');
  assert.ok(structure.startsWith('# Project structure\n\n<!-- claude-setup:begin graph -->\n'));
  assert.ok(structure.endsWith('<!-- claude-setup:end graph -->\n'));
});

test('--stage writes .claude outputs only under .claude-setup, and apply.mjs installs them', () => {
  const existing = { permissions: { allow: ['Bash(ls)'] } };
  const dir = project({ '.claude/settings.json': JSON.stringify(existing) });
  const settingsBefore = read(dir, '.claude/settings.json');
  const claudeBefore = tree(dir).filter((f) => f.startsWith('.claude/'));

  const r = emit(dir, ['--write', 'router,agents-doc', '--stage']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^stage \.claude-setup\/staged\/\.claude\/hooks\/route\.mjs$/m);
  assert.match(r.out, /^stage \.claude-setup\/staged\/\.claude\/settings\.json \(UserPromptSubmit hook\)$/m);
  assert.match(r.out, /^write docs\/agents\.md$/m, 'files outside .claude/ are written directly');
  assert.deepEqual(tree(dir).filter((f) => f.startsWith('.claude/')), claudeBefore);
  assert.equal(read(dir, '.claude/settings.json'), settingsBefore);
  assert.ok(exists(dir, '.claude-setup/staged/.claude/router.json'));
  assert.ok(exists(dir, '.claude-setup/apply.mjs'));
  assert.ok(exists(dir, '.claude-setup/README.md'));
  const readme = read(dir, '.claude-setup/README.md');
  assert.match(readme, /node \.claude-setup\/apply\.mjs/);
  assert.match(readme, /refused writes under `\.claude\/`/);

  const apply = spawnSync(process.execPath, [path.join(dir, '.claude-setup/apply.mjs')], { cwd: dir, encoding: 'utf8' });
  assert.equal(apply.status, 0, apply.stderr);
  assert.match(apply.stdout, /^write \.claude\/hooks\/route\.mjs$/m);
  assert.match(apply.stdout, /^update \.claude\/settings\.json \(merged\)$/m);
  assert.ok(fs.readFileSync(path.join(dir, '.claude/hooks/route.mjs')).equals(ROUTE_SRC));
  const settings = JSON.parse(read(dir, '.claude/settings.json'));
  assert.deepEqual(settings.permissions, existing.permissions);
  assert.equal(hookCount(dir), 1);
  assert.equal(exists(dir, '.claude-setup/staged'), false, 'staged/ removed after a successful apply');

  const noop = spawnSync(process.execPath, [path.join(dir, '.claude-setup/apply.mjs')], { cwd: dir, encoding: 'utf8' });
  assert.equal(noop.status, 0);
  assert.match(noop.stdout, /nothing staged/);
});

test('mirrors write .codex/agents/*.toml from .claude/agents/*.md', () => {
  const agent = '---\nname: reviewer\ndescription: Reviews a diff.\ntools: Read, Grep\nmodel: opus\n---\nReview carefully.\n';
  const dir = project({ '.claude/agents/reviewer.md': agent });
  const r = emit(dir, ['--write', 'mirrors', '--targets', 'codex', '--model-map', 'deep=gpt-5']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^write \.codex\/agents\/reviewer\.toml$/m);
  assert.match(read(dir, '.codex/agents/reviewer.toml'), /^model = "gpt-5"$/m);
  const again = emit(dir, ['--write', 'mirrors', '--targets', 'codex', '--model-map', 'deep=gpt-5']);
  assert.match(again.out, /^skip \.codex\/agents\/reviewer\.toml \(unchanged\)$/m);

  const bare = project();
  const none = emit(bare, ['--write', 'mirrors', '--targets', 'codex']);
  assert.equal(none.code, 0);
  assert.match(none.out, /^skip mirrors \(no \.claude\/agents\)$/m);
});

test('--dry-run prints the plan and writes nothing', () => {
  const agent = '---\nname: reviewer\ndescription: Reviews a diff.\n---\nReview.\n';
  const dir = project({ '.claude/agents/reviewer.md': agent });
  const before = tree(dir);
  const r = emit(dir, ['--write', `${ALL},mirrors`, '--targets', 'codex', '--stage', '--dry-run']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^stage \.claude-setup\/staged\/\.claude\/hooks\/route\.mjs$/m);
  assert.match(r.out, /^write \.codex\/agents\/reviewer\.toml$/m);
  assert.match(r.out, /\(dry run: nothing written\)$/m);
  assert.deepEqual(tree(dir), before);
});

test('bad usage exits 2', () => {
  const dir = project();
  assert.equal(emit(dir, ['--write', 'router', '--bogus']).code, 2);
  assert.equal(emit(dir, ['--write', 'nope']).code, 2);
  assert.equal(emit(dir, ['--write', 'router', '--targets', 'vim']).code, 2);
  assert.equal(emit(dir, ['--write', 'mirrors']).code, 2, 'mirrors needs --targets');
  assert.equal(emit(dir, ['--write', 'mirrors', '--targets', 'codex', '--model-map', 'huge=x']).code, 2);
  assert.equal(emit(dir, []).code, 2, '--write is required');
  assert.equal(emit(path.join(dir, 'missing'), ['--write', 'router']).code, 2);
});

test('mergeSettings adds a hook group once and rejects malformed hooks', () => {
  const once = mergeSettings({ a: 1 }, HOOK);
  assert.deepEqual(mergeSettings(once, HOOK), once);
  assert.equal(once.a, 1);
  assert.throws(() => mergeSettings({ hooks: [] }, HOOK), /"hooks" must be an object/);
  assert.throws(() => mergeSettings({ hooks: { UserPromptSubmit: {} } }, HOOK), /must be an array/);
  assert.throws(() => mergeSettings(null, HOOK), /JSON object/);
});
