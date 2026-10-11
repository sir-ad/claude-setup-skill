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
  assert.match(r.out, /^stage \.claude-setup\/staged\/claude\/hooks\/route\.mjs$/m);
  assert.match(r.out, /^stage \.claude-setup\/staged\/claude\/settings\.json \(UserPromptSubmit hook\)$/m);
  assert.match(r.out, /^write docs\/agents\.md$/m, 'files outside .claude/ are written directly');
  assert.deepEqual(tree(dir).filter((f) => f.startsWith('.claude/')), claudeBefore);
  assert.equal(read(dir, '.claude/settings.json'), settingsBefore);
  assert.ok(exists(dir, '.claude-setup/staged/claude/router.json'));
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
  assert.match(apply.stdout, /^removed \.claude-setup$/m);
  assert.equal(exists(dir, '.claude-setup'), false, 'the staging folder is removed after a successful apply');
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
  assert.match(r.out, /^stage \.claude-setup\/staged\/claude\/hooks\/route\.mjs$/m);
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

// ---------------------------------------------------------------------------
// Staging layout, drafts, permissions merge, mirrors after apply
// ---------------------------------------------------------------------------

const SYNC_SCRIPT = path.join(HERE, '..', 'scripts', 'sync-agents.mjs');
const applyIn = (dir) => spawnSync(process.execPath, [path.join(dir, '.claude-setup/apply.mjs')], { cwd: dir, encoding: 'utf8' });
const stagedFiles = (dir) => (exists(dir, '.claude-setup/staged') ? tree(dir, '.claude-setup/staged').map((f) => path.relative('.claude-setup/staged', f)) : []);
const PERMS = { allow: ['Bash(npm test)', 'Bash(npm run lint)'], ask: ['Bash(git push:*)'], deny: ['Read(./.env)'] };
const FRONTEND = '---\nname: frontend\ndescription: Builds UI.\ntools: Read, Edit\nmodel: sonnet\n---\nBuild UI.\n';
const draft = (rel, text) => [`.claude-setup/drafts/${rel}`, text];

test('mergeSettings unions permission lists, existing entries first', () => {
  const cur = { permissions: { allow: ['a', 'b'], defaultMode: 'plan' }, env: { X: '1' } };
  const out = mergeSettings(cur, { permissions: { allow: ['b', 'c', 'c'], ask: ['q'], deny: ['d'], defaultMode: 'acceptEdits', extra: 1 }, env: { X: '2' } });
  assert.deepEqual(out.permissions.allow, ['a', 'b', 'c']);
  assert.deepEqual(out.permissions.ask, ['q']);
  assert.deepEqual(out.permissions.deny, ['d']);
  assert.equal(out.permissions.defaultMode, 'plan', 'other permission keys: existing wins');
  assert.equal(out.permissions.extra, 1);
  assert.deepEqual(out.env, { X: '1' });
  assert.deepEqual(cur.permissions.allow, ['a', 'b'], 'input is not changed');
  assert.deepEqual(mergeSettings(out, { permissions: { allow: ['a', 'c'] } }), out, 'idempotent');
  assert.deepEqual(mergeSettings({}, { permissions: { allow: ['a'] } }), { permissions: { allow: ['a'] } });
  assert.throws(() => mergeSettings({ permissions: [] }, { permissions: { allow: ['a'] } }), /"permissions" must be an object/);
  assert.throws(() => mergeSettings({ permissions: { allow: 'a' } }, { permissions: { allow: ['a'] } }), /permissions\.allow must be an array/);
});

test('staged .claude outputs have no .claude path segment, and apply.mjs maps them back', () => {
  const dir = project();
  const r = emit(dir, ['--write', 'router', '--stage']);
  assert.equal(r.code, 0, r.err);
  const files = stagedFiles(dir);
  assert.deepEqual(files, ['claude/hooks/route.mjs', 'claude/router.json', 'claude/settings.json']);
  for (const f of tree(dir, '.claude-setup')) assert.ok(!f.split(path.sep).includes('.claude'), f);
  assert.match(read(dir, '.claude-setup/README.md'), /staged\/claude\//);
  const a = applyIn(dir);
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /^write \.claude\/router\.json$/m);
  assert.ok(exists(dir, '.claude/hooks/route.mjs'));
  assert.equal(hookCount(dir), 1);
  assert.equal(stagedFiles(dir).length, 0);
});

test('apply.mjs still accepts the old staged/.claude layout and keeps other staged paths', () => {
  const dir = project();
  assert.equal(emit(dir, ['--write', 'router', '--stage']).code, 0);
  // Re-create the staging area the old way, plus a non-.claude file.
  fs.rmSync(path.join(dir, '.claude-setup/staged'), { recursive: true });
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  put('.claude-setup/staged/.claude/rules/old.md', 'old layout\n');
  put('.claude-setup/staged/claude/rules/new.md', 'new layout\n');
  put('.claude-setup/staged/docs/extra.md', 'plain path\n');
  const a = applyIn(dir);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(read(dir, '.claude/rules/old.md'), 'old layout\n');
  assert.equal(read(dir, '.claude/rules/new.md'), 'new layout\n');
  assert.equal(read(dir, 'docs/extra.md'), 'plain path\n');
  assert.equal(exists(dir, '.claude/.claude'), false);
  assert.equal(exists(dir, '.claude/claude'), false);
});

test('drafts are written in place, permissions merge into settings.json, and the folder is removed', () => {
  const existing = { permissions: { allow: ['Bash(ls)'], deny: ['Read(./.env)'] }, env: { A: '1' } };
  const dir = project({
    '.claude/settings.json': JSON.stringify(existing),
    '.claude/rules/mine.md': 'mine\n',
    ...Object.fromEntries([
      draft('rules/code-style.md', '# Style\n'),
      draft('rules/mine.md', 'different\n'),
      draft('agents/frontend.md', FRONTEND),
      draft('skills/orchestrate/SKILL.md', '# Orchestrate\n'),
      draft('permissions.json', JSON.stringify(PERMS)),
    ]),
  });
  const r = emit(dir, ['--write', 'drafts']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^write \.claude\/rules\/code-style\.md \(draft\)$/m);
  assert.match(r.out, /^write \.claude\/agents\/frontend\.md \(draft\)$/m);
  assert.match(r.out, /^write \.claude\/skills\/orchestrate\/SKILL\.md \(draft\)$/m);
  assert.match(r.out, /^skip \.claude\/rules\/mine\.md \(exists and differs\)$/m);
  assert.match(r.out, /^update \.claude\/settings\.json \(permissions\)$/m);
  assert.equal(read(dir, '.claude/rules/mine.md'), 'mine\n', 'a different existing file is not overwritten in place');
  assert.equal(read(dir, '.claude/rules/code-style.md'), '# Style\n');
  assert.equal(exists(dir, '.claude/permissions.json'), false, 'permissions.json is merged, never copied');
  const settings = JSON.parse(read(dir, '.claude/settings.json'));
  assert.deepEqual(settings.permissions.allow, ['Bash(ls)', 'Bash(npm test)', 'Bash(npm run lint)']);
  assert.deepEqual(settings.permissions.ask, PERMS.ask);
  assert.deepEqual(settings.permissions.deny, ['Read(./.env)']);
  assert.deepEqual(settings.env, { A: '1' });
  assert.equal(exists(dir, '.claude-setup/drafts'), true, 'kept: one draft was left behind');
  assert.match(r.out, /^note: kept \.claude-setup\/drafts/m);

  fs.rmSync(path.join(dir, '.claude-setup/drafts/rules/mine.md'));
  const again = emit(dir, ['--write', 'drafts']);
  assert.match(again.out, /^skip \.claude\/rules\/code-style\.md \(unchanged\)$/m);
  assert.match(again.out, /^skip \.claude\/settings\.json \(permissions already present\)$/m);
  assert.match(again.out, /^remove \.claude-setup\/drafts$/m);
  assert.equal(exists(dir, '.claude-setup/drafts'), false);
});

test('permissions draft creates settings.json with the schema, accepts the permissions wrapper, and ignores other keys', () => {
  const dir = project(Object.fromEntries([
    draft('permissions.json', JSON.stringify({ permissions: { allow: ['Bash(npm test)'], defaultMode: 'bypassPermissions' } })),
  ]));
  const r = emit(dir, ['--write', 'drafts']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^write \.claude\/settings\.json \(permissions\)$/m);
  assert.deepEqual(JSON.parse(read(dir, '.claude/settings.json')), {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    permissions: { allow: ['Bash(npm test)'] },
  });
  assert.equal(exists(dir, '.claude-setup/drafts'), false);
});

test('invalid permissions.json is skipped without echoing content, other drafts still land', () => {
  const secret = 'SECRET-TOKEN-123';
  const dir = project(Object.fromEntries([
    draft('permissions.json', `{ "allow": ["${secret}"`),
    draft('rules/a.md', 'a\n'),
  ]));
  const r = emit(dir, ['--write', 'drafts']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^skip \.claude-setup\/drafts\/permissions\.json \(invalid JSON\)$/m);
  assert.doesNotMatch(r.out + r.err, new RegExp(secret));
  assert.equal(read(dir, '.claude/rules/a.md'), 'a\n');
  assert.equal(exists(dir, '.claude/settings.json'), false);
  assert.equal(exists(dir, '.claude-setup/drafts/permissions.json'), true, 'kept so the model can fix it');
  const bad = project(Object.fromEntries([draft('permissions.json', '{"allow":[1]}')]));
  assert.match(emit(bad, ['--write', 'drafts']).out, /^skip \.claude-setup\/drafts\/permissions\.json \(allow must be an array of strings\)$/m);
});

test('--stage stages drafts, and one staged settings.json carries the permissions and the router hook', () => {
  const existing = { permissions: { allow: ['Bash(ls)'] } };
  const dir = project({
    '.claude/settings.json': JSON.stringify(existing),
    '.claude/rules/mine.md': 'mine\n',
    ...Object.fromEntries([
      draft('rules/mine.md', 'replacement\n'),
      draft('rules/new.md', 'new\n'),
      draft('permissions.json', JSON.stringify(PERMS)),
    ]),
  });
  const claudeBefore = tree(dir).filter((f) => f.startsWith('.claude/'));
  const r = emit(dir, ['--write', 'router,drafts', '--stage']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^stage \.claude-setup\/staged\/claude\/rules\/new\.md \(draft\)$/m);
  assert.match(r.out, /^stage \.claude-setup\/staged\/claude\/rules\/mine\.md \(draft\)$/m);
  assert.equal((r.out.match(/settings\.json/g) || []).length, 1, 'one settings line');
  assert.match(r.out, /^stage \.claude-setup\/staged\/claude\/settings\.json \(UserPromptSubmit hook, permissions\)$/m);
  assert.deepEqual(tree(dir).filter((f) => f.startsWith('.claude/')), claudeBefore, 'nothing written under .claude/');
  assert.equal(exists(dir, '.claude-setup/drafts'), false);
  const staged = JSON.parse(read(dir, '.claude-setup/staged/claude/settings.json'));
  assert.deepEqual(staged.permissions.allow, ['Bash(ls)', ...PERMS.allow]);
  assert.deepEqual(staged.permissions.deny, PERMS.deny);
  assert.equal(staged.hooks.UserPromptSubmit.length, 1);

  const a = applyIn(dir);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(read(dir, '.claude/rules/mine.md'), 'replacement\n', 'apply overwrites, as the user approved');
  assert.equal(read(dir, '.claude/rules/new.md'), 'new\n');
  const settings = JSON.parse(read(dir, '.claude/settings.json'));
  assert.deepEqual(settings.permissions.ask, PERMS.ask);
  assert.equal(hookCount(dir), 1);
});

test('permissions draft alone is staged as settings.json when the router is not written', () => {
  const dir = project(Object.fromEntries([draft('permissions.json', JSON.stringify(PERMS))]));
  const r = emit(dir, ['--write', 'drafts', '--stage']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^stage \.claude-setup\/staged\/claude\/settings\.json \(permissions\)$/m);
  assert.equal(exists(dir, '.claude/settings.json'), false);
  assert.ok(exists(dir, '.claude-setup/apply.mjs'));
  assert.equal(applyIn(dir).status, 0);
  assert.deepEqual(JSON.parse(read(dir, '.claude/settings.json')).permissions, PERMS);
});

test('permissions still land when the router unit is skipped', () => {
  const dir = project({
    '.claude/hooks/route.mjs': '// hand-written hook\n',
    ...Object.fromEntries([draft('permissions.json', JSON.stringify(PERMS))]),
  });
  const r = emit(dir, ['--write', 'router,drafts']);
  assert.match(r.out, /^skip \.claude\/router\.json \(router unit skipped: /m);
  assert.match(r.out, /^write \.claude\/settings\.json \(permissions\)$/m);
  assert.deepEqual(JSON.parse(read(dir, '.claude/settings.json')).permissions, PERMS);
  assert.equal(JSON.parse(read(dir, '.claude/settings.json')).hooks, undefined);
});

test('--dry-run with drafts writes and removes nothing', () => {
  const dir = project(Object.fromEntries([draft('rules/a.md', 'a\n'), draft('permissions.json', JSON.stringify(PERMS))]));
  const before = tree(dir);
  const r = emit(dir, ['--write', 'drafts,router', '--stage', '--dry-run']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^stage \.claude-setup\/staged\/claude\/rules\/a\.md \(draft\)$/m);
  assert.match(r.out, /^remove \.claude-setup\/drafts$/m);
  assert.deepEqual(tree(dir), before);
  assert.equal(emit(project(), ['--write', 'drafts']).out.split('\n')[0], 'skip drafts (no .claude-setup/drafts)');
});

test('--dry-run mirrors lists planned mirror paths before any agent file exists', () => {
  // From drafts and staged agents.
  const dir = project({
    ...Object.fromEntries([draft('agents/frontend.md', FRONTEND)]),
    '.claude-setup/staged/claude/agents/backend.md': '---\nname: backend\ndescription: Builds APIs.\n---\nAPIs.\n',
  });
  const before = tree(dir);
  const r = emit(dir, ['--write', 'mirrors', '--targets', 'codex,gemini', '--dry-run']);
  assert.equal(r.code, 0, r.err);
  for (const f of ['.codex/agents/frontend.toml', '.codex/agents/backend.toml', '.gemini/agents/frontend.md', '.gemini/agents/backend.md']) {
    assert.match(r.out, new RegExp(`^plan ${f.replace(/\./g, '\\.')} \\(mirror\\)$`, 'm'));
  }
  assert.deepEqual(tree(dir), before);

  // From the roster when nothing else is known.
  const bare = project();
  const roster = deriveRoster(bare, { intent: '' });
  const rr = emit(bare, ['--write', 'mirrors', '--targets', 'codex', '--dry-run']);
  assert.equal(rr.code, 0, rr.err);
  const planned = rr.out.match(/^plan \.codex\/agents\/\S+\.toml \(mirror\)$/gm) || [];
  assert.deepEqual(planned, roster.roles.map((x) => `plan .codex/agents/${x.name}.toml (mirror)`));
  assert.ok(planned.some((l) => l.includes('/explorer.toml')));

  // Real (non-dry) run before apply: nothing generated, says why.
  const live = emit(dir, ['--write', 'mirrors', '--targets', 'codex']);
  assert.match(live.out, /^skip mirrors \(agents are staged, not applied\)$/m);
  assert.equal(exists(dir, '.codex'), false);
});

test('apply.mjs runs sync-agents after applying staged agents', () => {
  const dir = project(Object.fromEntries([draft('agents/frontend.md', FRONTEND)]));
  const r = emit(dir, ['--write', 'drafts,mirrors', '--stage', '--targets', 'codex', '--model-map', 'standard=gpt-5-mini']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^stage \.claude-setup\/staged\/claude\/agents\/frontend\.md \(draft\)$/m);
  assert.match(r.out, /^skip mirrors \(agents are staged; apply\.mjs creates the mirrors\)$/m);
  const source = read(dir, '.claude-setup/apply.mjs');
  assert.ok(source.includes(JSON.stringify(SYNC_SCRIPT)), 'absolute sync-agents path embedded');
  assert.equal(exists(dir, '.codex'), false);

  const a = applyIn(dir);
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.match(a.stdout, /^write \.claude\/agents\/frontend\.md$/m);
  assert.match(a.stdout, /write\s+codex\s+\.codex\/agents\/frontend\.toml/);
  assert.match(read(dir, '.codex/agents/frontend.toml'), /^model = "gpt-5-mini"$/m);
  assert.equal(exists(dir, '.claude-setup/staged'), false);
});

test('apply.mjs without --targets or agents does not run sync-agents', () => {
  const dir = project();
  assert.equal(emit(dir, ['--write', 'router', '--stage']).code, 0);
  assert.ok(!read(dir, '.claude-setup/apply.mjs').includes('sync-agents.mjs"'));
  const a = applyIn(dir);
  assert.equal(a.status, 0, a.stderr);
  assert.doesNotMatch(a.stdout, /sync-agents/);
});

test('apply.mjs exits 1 when sync-agents fails and keeps the applied files; a missing script prints the command', () => {
  // A hand-written file at the mirror path makes sync-agents exit 1.
  const dir = project(Object.fromEntries([draft('agents/frontend.md', FRONTEND)]));
  fs.mkdirSync(path.join(dir, '.codex/agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.codex/agents/frontend.toml'), 'hand written\n');
  assert.equal(emit(dir, ['--write', 'drafts', '--stage', '--targets', 'codex']).code, 0);
  const a = applyIn(dir);
  assert.equal(a.status, 1, a.stdout + a.stderr);
  assert.match(a.stderr, /sync-agents failed/);
  assert.match(a.stderr, new RegExp(`node ${SYNC_SCRIPT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} --dir `));
  assert.ok(exists(dir, '.claude/agents/frontend.md'), 'applied files stay');
  assert.equal(exists(dir, '.claude-setup/staged'), false, 'staged files are not restored');
  assert.equal(read(dir, '.codex/agents/frontend.toml'), 'hand written\n');

  const gone = project(Object.fromEntries([draft('agents/frontend.md', FRONTEND)]));
  assert.equal(emit(gone, ['--write', 'drafts', '--stage', '--targets', 'codex,gemini']).code, 0);
  const apply = path.join(gone, '.claude-setup/apply.mjs');
  fs.writeFileSync(apply, read(gone, '.claude-setup/apply.mjs').replace(JSON.stringify(SYNC_SCRIPT), JSON.stringify(path.join(gone, 'missing-sync.mjs'))));
  const b = applyIn(gone);
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stdout, /sync-agents\.mjs not found/);
  assert.match(b.stdout, /--targets codex,gemini/);
  assert.ok(exists(gone, '.claude/agents/frontend.md'));
});
