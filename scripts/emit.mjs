#!/usr/bin/env node
// Deterministic file writer for the /claude-setup skill. The model does not copy mechanical
// content (router script and config, roster and graph sections, agent mirrors); this does.
//
//   node scripts/emit.mjs [dir] --write <items> [--stage] [--targets <tools>] [--intent "<text>"]
//                         [--model-map fast=X,standard=Y,deep=Z] [--dry-run]
//
// items: router, agents-doc, structure-doc, drafts, mirrors (comma separated). Prints one line per
// file: write | update | stage | remove | skip (--dry-run adds plan, for mirrors that do not exist
// yet), then a summary. Exit 0, or 2 on usage errors.
// --stage writes every .claude/ output under .claude-setup/staged/ plus apply.mjs, for permission
// modes that refuse writes under .claude/. .claude/<rel> is staged at staged/claude/<rel>, because
// Claude Code also refuses a path with a .claude segment. drafts: files the model wrote under
// .claude-setup/drafts/ (rules/x.md for .claude/rules/x.md, permissions.json merged into
// settings.json). Zero dependencies; all logic is in this repo's scripts.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { detect } from './detect.mjs';
import { buildGraph, renderMarkdown } from './graph.mjs';
import { deriveRoster, renderRosterMarkdown, toRouterConfig } from './roster.mjs';
import { syncAgents, TARGETS, parseModelMap, parseAgent, mirrorPath } from './sync-agents.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTE_SRC = path.join(HERE, 'router', 'route.mjs');
const ITEMS = ['router', 'agents-doc', 'structure-doc', 'drafts', 'mirrors'];
const AGENTS = '.claude/agents';
const STAGE_DIR = '.claude-setup/staged';
const DRAFTS_DIR = '.claude-setup/drafts';
const SETTINGS = '.claude/settings.json';
const PERM_KEYS = ['allow', 'ask', 'deny'];
const SCHEMA = 'https://json.schemastore.org/claude-code-settings.json';
const ROUTE_CMD = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/route.mjs"';
const HOOK_SPEC = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: ROUTE_CMD, timeout: 5 }] }] } };
const ROUTE_LOG = '.claude/route-log.jsonl';
const USAGE = `usage: node scripts/emit.mjs [dir] --write <items> [--stage] [--targets <tools>] [--intent "<text>"]
                        [--model-map fast=X,standard=Y,deep=Z] [--dry-run]
items: router, agents-doc, structure-doc, drafts, mirrors (comma separated)
`;

class UsageError extends Error {}
const fence = (name) => [`<!-- claude-setup:begin ${name} -->`, `<!-- claude-setup:end ${name} -->`];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};
// File bytes, or null when missing.
function readIf(abs) {
  try { return fs.readFileSync(abs); } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  }
}
// First directory prefix of rel (under dir) that exists as a non-directory, or null.
function blockedBy(dir, rel) {
  const parts = rel.split('/');
  for (let i = 1; i < parts.length; i++) {
    const p = path.join(dir, ...parts.slice(0, i));
    if (fs.existsSync(p) && !fs.statSync(p).isDirectory()) return parts.slice(0, i).join('/');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Settings merge. Pure. Existing keys win; a hook group is added only when none of its commands
// is already registered for that event. permissions.allow/ask/deny are unioned (existing entries
// first); other keys inside permissions keep existing-wins. Shared with .claude-setup/apply.mjs,
// which inlines it.
// ---------------------------------------------------------------------------

export function mergeSettings(current, desired) {
  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isPlainObject(current)) throw new Error('settings.json must be a JSON object');
  const out = { ...current };
  for (const [key, value] of Object.entries(desired)) {
    if (key === 'hooks' || key === 'permissions') continue;
    if (out[key] === undefined) out[key] = value;
  }
  if (desired.permissions !== undefined) {
    if (out.permissions === undefined) out.permissions = {};
    if (!isPlainObject(out.permissions) || !isPlainObject(desired.permissions)) {
      throw new Error('settings.json: "permissions" must be an object');
    }
    const perms = { ...out.permissions };
    for (const [key, value] of Object.entries(desired.permissions)) {
      if (!['allow', 'ask', 'deny'].includes(key)) {
        if (perms[key] === undefined) perms[key] = value;
        continue;
      }
      const have = perms[key] === undefined ? [] : perms[key];
      if (!Array.isArray(have) || !Array.isArray(value)) throw new Error(`settings.json: permissions.${key} must be an array`);
      perms[key] = [...have, ...value.filter((v, i) => !have.includes(v) && value.indexOf(v) === i)];
    }
    out.permissions = perms;
  }
  if (desired.hooks === undefined) return out;
  if (out.hooks === undefined) out.hooks = {};
  if (!isPlainObject(out.hooks)) throw new Error('settings.json: "hooks" must be an object');
  const hooks = { ...out.hooks };
  for (const [event, groups] of Object.entries(desired.hooks)) {
    const have = hooks[event] === undefined ? [] : hooks[event];
    if (!Array.isArray(have)) throw new Error(`settings.json: hooks.${event} must be an array`);
    const seen = new Set();
    for (const g of have) {
      for (const h of (g && Array.isArray(g.hooks) ? g.hooks : [])) if (h && h.command) seen.add(h.command);
    }
    const next = [...have];
    for (const g of groups) {
      const cmds = g.hooks.map((h) => h.command);
      if (cmds.some((c) => seen.has(c))) continue;
      next.push(g);
      for (const c of cmds) seen.add(c);
    }
    hooks[event] = next;
  }
  out.hooks = hooks;
  return out;
}

// ---------------------------------------------------------------------------
// Planning. Each planner returns entries { rel, verb: write|update|skip, data?, reason? }.
// ---------------------------------------------------------------------------

function fileEntry(rel, now, data, reason) {
  const buf = Buffer.from(data);
  if (now === null) return { rel, verb: 'write', data: buf, reason };
  if (now.equals(buf)) return { rel, verb: 'skip', reason: 'unchanged' };
  return { rel, verb: 'update', data: buf, reason };
}

// settings.json with `desired` merged in. -> { entry } or { error } (unreadable or malformed file).
function planSettings(dir, desired, reason) {
  const now = readIf(path.join(dir, SETTINGS));
  let current = null;
  let merged;
  try {
    if (now !== null) current = JSON.parse(now.toString('utf8'));
    merged = mergeSettings(now === null ? { $schema: SCHEMA } : current, desired);
  } catch (e) {
    return { error: e.message };
  }
  if (now !== null && JSON.stringify(merged) === JSON.stringify(current)) {
    return { entry: { rel: SETTINGS, verb: 'skip', reason: `${reason} already present` } };
  }
  return { entry: { rel: SETTINGS, verb: now === null ? 'write' : 'update', reason,
    data: Buffer.from(`${JSON.stringify(merged, null, 2)}\n`) } };
}

// Router unit: all four files or none. Any precondition failure skips every file of the unit.
// `perms` (from drafts) is merged into the same settings.json write. -> { entries, skipped }.
function planRouter(dir, roster, perms) {
  const rels = ['.claude/hooks/route.mjs', '.claude/router.json', SETTINGS, '.gitignore'];
  const unit = (why) => ({ skipped: true, entries: rels.map((rel) => ({ rel, verb: 'skip', reason: `router unit skipped: ${why}` })) });
  const blocked = blockedBy(dir, rels[0]);
  if (blocked) return unit(`${blocked} is not a directory`);
  const routeSrc = fs.readFileSync(ROUTE_SRC);
  const routeNow = readIf(path.join(dir, rels[0]));
  if (routeNow !== null && !routeNow.equals(routeSrc)) return unit(`${rels[0]} differs from the skill copy`);

  const hook = perms ? { ...HOOK_SPEC, permissions: perms } : HOOK_SPEC;
  const planned = planSettings(dir, hook, perms ? 'UserPromptSubmit hook, permissions' : 'UserPromptSubmit hook');
  if (planned.error) return unit(`${rels[2]}: ${planned.error}`);
  const settings = planned.entry;

  const ignoreNow = readIf(path.join(dir, rels[3]));
  let ignore;
  if (ignoreNow === null) ignore = { rel: rels[3], verb: 'write', data: Buffer.from(`${ROUTE_LOG}\n`) };
  else {
    const text = ignoreNow.toString('utf8');
    if (text.split(/\r?\n/).some((l) => l.trim() === ROUTE_LOG)) ignore = { rel: rels[3], verb: 'skip', reason: 'already listed' };
    else {
      const sep = text === '' || text.endsWith('\n') ? '' : '\n';
      ignore = { rel: rels[3], verb: 'update', reason: 'route log', data: Buffer.from(`${text}${sep}${ROUTE_LOG}\n`) };
    }
  }

  return {
    skipped: false,
    entries: [
      fileEntry(rels[0], routeNow, routeSrc),
      fileEntry(rels[1], readIf(path.join(dir, rels[1])), `${JSON.stringify(toRouterConfig(roster), null, 2)}\n`),
      settings,
      ignore,
    ],
  };
}

// Fenced doc: replace only the text between the markers. A missing file is created with `head`.
function planFence(dir, rel, name, body, head) {
  const [begin, end] = fence(name);
  const blocked = blockedBy(dir, rel);
  if (blocked) return [{ rel, verb: 'skip', reason: `${blocked} is not a directory` }];
  const block = body.endsWith('\n') ? body : `${body}\n`;
  const now = readIf(path.join(dir, rel));
  if (now === null) return [{ rel, verb: 'write', data: Buffer.from(`${head}${begin}\n${block}${end}\n`) }];
  const text = now.toString('utf8');
  if (text.split(begin).length !== 2 || text.split(end).length !== 2) {
    return [{ rel, verb: 'skip', reason: `${name} fence: each marker must appear exactly once` }];
  }
  const m = new RegExp(`(^${esc(begin)}[ \\t]*\\r?\\n)([\\s\\S]*?)(^${esc(end)}[ \\t\\r]*$)`, 'm').exec(text);
  if (!m) return [{ rel, verb: 'skip', reason: `${name} fence: markers are out of order` }];
  const next = text.slice(0, m.index) + m[1] + block + m[3] + text.slice(m.index + m[0].length);
  if (next === text) return [{ rel, verb: 'skip', reason: 'unchanged' }];
  return [{ rel, verb: 'update', data: Buffer.from(next), reason: 'fence' }];
}

// Files under abs, as sorted '/'-separated paths relative to it. Symlinks are ignored.
function walkFiles(abs, rel = '') {
  let ents;
  try { ents = fs.readdirSync(path.join(abs, rel), { withFileTypes: true }); } catch { return []; }
  return ents.flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return walkFiles(abs, r);
    return e.isFile() ? [r] : [];
  }).sort();
}

// Allow/ask/deny lists from permissions.json (flat, or under "permissions"). Other keys are
// ignored. -> { perms } (null when empty) or { error }. Never echoes file content.
function parsePermissions(buf) {
  let v;
  try { v = JSON.parse(buf.toString('utf8')); } catch { return { error: 'invalid JSON' }; }
  if (v && typeof v === 'object' && !Array.isArray(v) && v.permissions !== undefined) v = v.permissions;
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return { error: 'expected an object with allow, ask, deny' };
  const perms = {};
  for (const k of PERM_KEYS) {
    if (v[k] === undefined) continue;
    if (!Array.isArray(v[k]) || v[k].some((x) => typeof x !== 'string')) return { error: `${k} must be an array of strings` };
    if (v[k].length) perms[k] = v[k];
  }
  return { perms: Object.keys(perms).length ? perms : null };
}

// Draft files (.claude-setup/drafts/<rel> -> .claude/<rel>) as entries, plus the permissions to merge
// into settings.json. In place, a draft never replaces a different existing file; staging does,
// as apply.mjs does. ok is false when a draft was left behind, so the folder is kept.
// -> { present, entries, perms, ok }
function planDrafts(dir, stage) {
  const base = path.join(dir, DRAFTS_DIR);
  const files = walkFiles(base);
  const out = { present: isDir(base), entries: [], perms: null, ok: true };
  const skipDraft = (rel, reason) => {
    out.entries.push({ rel, verb: 'skip', reason });
    out.ok = false;
  };
  for (const rel of files) {
    const src = `${DRAFTS_DIR}/${rel}`;
    const dest = `.claude/${rel}`;
    if (rel === 'permissions.json') {
      const r = parsePermissions(fs.readFileSync(path.join(base, rel)));
      if (r.error) skipDraft(src, r.error);
      else out.perms = r.perms;
      continue;
    }
    if (rel === 'settings.json') { skipDraft(src, 'put permissions in permissions.json'); continue; }
    const blocked = blockedBy(dir, dest);
    if (blocked) { skipDraft(dest, `${blocked} is not a directory`); continue; }
    if (isDir(path.join(dir, dest))) { skipDraft(dest, 'is a directory'); continue; }
    const e = fileEntry(dest, readIf(path.join(dir, dest)), fs.readFileSync(path.join(base, rel)), 'draft');
    if (e.verb === 'update' && !stage) skipDraft(dest, 'exists and differs');
    else out.entries.push(e);
  }
  return out;
}

// Names of agents waiting to be applied: drafts and anything already staged. Agents without a
// description are left out, as sync-agents skips them.
function pendingAgentNames(dir) {
  const names = [];
  for (const where of [`${DRAFTS_DIR}/agents`, `${STAGE_DIR}/claude/agents`, `${STAGE_DIR}/.claude/agents`]) {
    for (const rel of walkFiles(path.join(dir, where)).filter((f) => f.endsWith('.md'))) {
      const a = parseAgent(fs.readFileSync(path.join(dir, where, rel), 'utf8'), path.basename(rel, '.md'));
      if (a.description) names.push(a.name);
    }
  }
  return [...new Set(names)];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function line(res, text) { res.out.write(`${text}\n`); }
function skip(res, rel, reason) {
  line(res, `skip ${rel}${reason ? ` (${reason})` : ''}`);
  res.n.skip++;
}

// Writes (unless dry run) and prints one line.
function put(res, o, rel, verb, data, reason) {
  line(res, `${verb} ${rel}${reason ? ` (${reason})` : ''}`);
  if (o.dryRun) return;
  const abs = path.join(o.dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
}

// Under --stage, .claude/ outputs go to the staging folder instead, as claude/<rel>: the path
// has no .claude segment, which Claude Code's Write tool refuses.
const stagedRel = (rel) => `${STAGE_DIR}/${rel.startsWith('.claude/') ? `claude/${rel.slice('.claude/'.length)}` : rel}`;

function emitEntries(res, o, entries) {
  for (const e of entries) {
    if (e.verb === 'skip') { skip(res, e.rel, e.reason); continue; }
    const staged = o.stage && e.rel.startsWith('.claude/');
    const verb = staged ? 'stage' : e.verb;
    put(res, o, staged ? stagedRel(e.rel) : e.rel, verb, e.data, e.reason);
    res.n[verb]++;
  }
}

function hasAgentFiles(dir) {
  const walk = (rel) => {
    let ents;
    try { ents = fs.readdirSync(path.join(dir, AGENTS, rel), { withFileTypes: true }); } catch { return false; }
    return ents.some((e) => (e.isDirectory() ? walk(path.join(rel, e.name)) : e.name.endsWith('.md')));
  };
  return walk('');
}

// getRoster() derives the roster on demand; used only to plan mirrors in a dry run.
function runMirrors(res, o, getRoster) {
  if (!hasAgentFiles(o.dir)) {
    const pending = pendingAgentNames(o.dir);
    if (o.dryRun) {
      // Nothing to read yet: plan from the agents that will exist, else from the roster.
      const names = pending.length ? pending : getRoster().roles.map((r) => r.name);
      if (!names.length) return skip(res, 'mirrors', 'no agents');
      for (const t of o.targets) for (const n of names) line(res, `plan ${mirrorPath(t, n)} (mirror)`);
      return undefined;
    }
    if (pending.length) return skip(res, 'mirrors', o.stage ? 'agents are staged; apply.mjs creates the mirrors' : 'agents are staged, not applied');
    return skip(res, 'mirrors', 'no .claude/agents');
  }
  const r = syncAgents({ dir: o.dir, targets: o.targets, modelMap: o.modelMap, dryRun: o.dryRun });
  for (const w of r.warnings) res.err.write(`warn: ${w}\n`);
  for (const a of r.actions) {
    if (a.action === 'unchanged') skip(res, a.file, 'unchanged');
    else if (a.action === 'conflict') { line(res, `skip mirrors ${a.target}: ${a.file}`); res.n.skip++; }
    else { line(res, `${a.action} ${a.file}`); res.n[a.action]++; }
  }
  return undefined;
}

// Runs in the staged project: copies each staged file over its real path. settings.json is merged.
// staged/claude/<rel> goes to .claude/<rel> (staged/.claude/<rel> is accepted too); any other
// staged path keeps its path. `sync`, when set, is { script, targets, modelMap }: after a clean
// apply, sync-agents mirrors .claude/agents to the other tools.
// Source is written verbatim into .claude-setup/apply.mjs, so it must stay self-contained.
function applyMain(sync) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const staged = path.join(root, '.claude-setup', 'staged');
  const walk = (base, rel) => fs.readdirSync(path.join(base, rel), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(base, path.join(rel, e.name)) : [path.join(rel, e.name).split(path.sep).join('/')]));
  const files = fs.existsSync(staged) ? walk(staged, '').sort() : [];
  if (!files.length) {
    console.log('nothing staged');
    return 0;
  }
  let failed = 0;
  for (const file of files) {
    const rel = file.startsWith('claude/') ? `.claude/${file.slice('claude/'.length)}` : file;
    const dest = path.join(root, rel);
    const data = fs.readFileSync(path.join(staged, file));
    const now = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
    try {
      let text = data;
      let note = '';
      if (rel === '.claude/settings.json') {
        const want = JSON.parse(data.toString('utf8'));
        const cur = now === null ? null : JSON.parse(now.toString('utf8'));
        const merged = cur === null ? want : mergeSettings(cur, want);
        if (cur !== null && JSON.stringify(merged) === JSON.stringify(cur)) {
          console.log(`skip ${rel} (unchanged)`);
          continue;
        }
        text = Buffer.from(`${JSON.stringify(merged, null, 2)}\n`);
        note = ' (merged)';
      } else if (now !== null && now.equals(data)) {
        console.log(`skip ${rel} (unchanged)`);
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, text);
      console.log(`${now === null ? 'write' : 'update'} ${rel}${note}`);
    } catch (e) {
      failed++;
      console.error(`fail ${rel}: ${e.message}`);
    }
  }
  if (failed) {
    console.error('staged files kept; fix the errors above and run again');
    return 1;
  }
  fs.rmSync(staged, { recursive: true, force: true });
  console.log('removed .claude-setup/staged');
  if (!sync || !fs.existsSync(path.join(root, '.claude', 'agents')) || !walk(path.join(root, '.claude', 'agents'), '').some((f) => f.endsWith('.md'))) return 0;
  const args = [sync.script, '--dir', root, '--targets', sync.targets.join(',')];
  if (sync.modelMap) args.push('--model-map', sync.modelMap);
  const shown = ['node', ...args].map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : JSON.stringify(a))).join(' ');
  if (!fs.existsSync(sync.script)) {
    console.log(`sync-agents.mjs not found at ${sync.script}; to create the agent mirrors run:\n${shown}`);
    return 0;
  }
  console.log(`run ${shown}`);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`sync-agents failed (${r.error ? r.error.message : `exit ${r.status}`}); applied files stay in place. Fix it and run:\n${shown}`);
    return 1;
  }
  return 0;
}

function applySource(sync) {
  return [
    '#!/usr/bin/env node',
    '// Generated by scripts/emit.mjs --stage: copies the staged files into place. Zero dependencies.',
    '// Run from the project root: node .claude-setup/apply.mjs',
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { spawnSync } from 'node:child_process';",
    "import { fileURLToPath } from 'node:url';",
    '',
    mergeSettings.toString(),
    '',
    applyMain.toString(),
    '',
    `process.exitCode = applyMain(${JSON.stringify(sync)});`,
    '',
  ].join('\n');
}

const STAGE_README = [
  '# Staged Claude Code config',
  '',
  'claude-setup staged these `.claude/` files here because Claude Code refused writes under `.claude/` in this permission mode.',
  'The folder `staged/claude/` stands for `.claude/`: `staged/claude/rules/code-style.md` is installed as `.claude/rules/code-style.md`.',
  'Any other path under `staged/` is installed at the same path. `settings.json` is merged into the real file, never overwritten:',
  'permission lists are added to, and existing settings and hooks stay.',
  'To apply them, run from the project root: `node .claude-setup/apply.mjs`',
  'On success the script deletes `staged/`. If agent mirrors were requested, it then runs sync-agents to create them.',
  'Delete this folder to discard the staged files.',
  '',
].join('\n');

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

// Fence bodies. runItems and fenceBody both build them here, so verify.mjs compares against the
// text that emit.mjs writes.
const rosterBody = (roster) => renderRosterMarkdown(roster).replace(/^## /gm, '### ');
const graphBody = (graph) => renderMarkdown(graph, { maxNodes: 25 });

// The text emit.mjs puts between the markers of fence `name`, or null for any other name. Writes
// nothing. Builds only what the fence needs: roster needs detection, the graph and the roster.
export function fenceBody(dir, name, { intent = '' } = {}) {
  const root = path.resolve(dir);
  if (name === 'roster') {
    const detection = detect(root);
    const graph = buildGraph(root);
    return rosterBody(deriveRoster(root, { intent, detection, graph }));
  }
  if (name === 'graph') return graphBody(buildGraph(root));
  return null;
}

function runItems(o, res) {
  const want = (i) => o.items.includes(i);
  let graph = null;
  let roster = null;
  const getRoster = () => {
    if (!roster) {
      graph = graph || buildGraph(o.dir);
      roster = deriveRoster(o.dir, { intent: o.intent, detection: detect(o.dir), graph });
    }
    return roster;
  };
  if (want('router') || want('agents-doc') || want('structure-doc')) {
    graph = buildGraph(o.dir);
    if (want('router') || want('agents-doc')) getRoster();
  }
  const drafts = want('drafts') ? planDrafts(o.dir, o.stage) : null;
  let settingsDone = false;
  if (want('router')) {
    const router = planRouter(o.dir, roster, drafts && drafts.perms);
    emitEntries(res, o, router.entries);
    settingsDone = !router.skipped;
  }
  if (want('agents-doc')) {
    emitEntries(res, o, planFence(o.dir, 'docs/agents.md', 'roster', rosterBody(roster),
      '# Agents\n\nRoles, scopes and model tiers for agents working in this repo.\n\n'));
  }
  if (want('structure-doc')) {
    emitEntries(res, o, planFence(o.dir, 'docs/project-structure.md', 'graph', graphBody(graph),
      '# Project structure\n\n'));
  }
  if (drafts && !drafts.present) skip(res, 'drafts', `no ${DRAFTS_DIR}`);
  else if (drafts) {
    emitEntries(res, o, drafts.entries);
    if (drafts.perms && !settingsDone) {
      const blocked = blockedBy(o.dir, SETTINGS);
      const planned = blocked ? { error: `${blocked} is not a directory` } : planSettings(o.dir, { permissions: drafts.perms }, 'permissions');
      if (planned.error) { skip(res, SETTINGS, planned.error); drafts.ok = false; }
      else emitEntries(res, o, [planned.entry]);
    }
  }
  if (want('mirrors')) runMirrors(res, o, getRoster);
  if (o.stage && res.n.stage > 0) {
    const sync = o.targets.length && (want('mirrors') || pendingAgentNames(o.dir).length)
      ? { script: path.join(HERE, 'sync-agents.mjs'), targets: o.targets,
        modelMap: Object.entries(o.modelMap).map(([k, v]) => `${k}=${v}`).join(',') || null }
      : null;
    put(res, o, '.claude-setup/apply.mjs', 'write', applySource(sync));
    put(res, o, '.claude-setup/README.md', 'write', STAGE_README);
  }
  // Drafts are copies of what was written or staged; keep them when something was left behind.
  if (drafts && drafts.present && drafts.ok) {
    line(res, `remove ${DRAFTS_DIR}`);
    res.n.remove++;
    if (!o.dryRun) fs.rmSync(path.join(o.dir, DRAFTS_DIR), { recursive: true, force: true });
  } else if (drafts && drafts.present) {
    line(res, `note: kept ${DRAFTS_DIR}; some drafts were not written`);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { dir: null, items: [], stage: false, dryRun: false, targets: [], intent: '', modelMap: {}, help: false };
  const list = (v) => [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))];
  for (let i = 0; i < argv.length; i++) {
    const eq = /^(--[\w-]+)=(.*)$/s.exec(argv[i]);
    const flag = eq ? eq[1] : argv[i];
    const value = () => {
      if (eq) return eq[2];
      if (i + 1 >= argv.length) throw new UsageError(`${flag} needs a value`);
      return argv[++i];
    };
    if (flag === '-h' || flag === '--help') o.help = true;
    else if (flag === '--stage' || flag === '--dry-run') {
      if (eq) throw new UsageError(`${flag} takes no value`);
      if (flag === '--stage') o.stage = true;
      else o.dryRun = true;
    } else if (flag === '--write') {
      o.items = list(value());
      const bad = o.items.filter((x) => !ITEMS.includes(x));
      if (bad.length) throw new UsageError(`unknown item: ${bad.join(', ')}`);
    } else if (flag === '--targets') {
      o.targets = list(value());
      const bad = o.targets.filter((t) => !TARGETS[t]);
      if (bad.length || !o.targets.length) throw new UsageError(`unknown target: ${bad.join(', ') || '(empty)'}`);
    } else if (flag === '--intent') o.intent = value();
    else if (flag === '--model-map') {
      const parsed = parseModelMap(value());
      if (parsed.error) throw new UsageError(parsed.error);
      o.modelMap = parsed.map;
    } else if (flag.startsWith('-')) throw new UsageError(`unknown option ${flag}`);
    else if (o.dir !== null) throw new UsageError('only one directory allowed');
    else o.dir = argv[i];
  }
  if (o.help) return o;
  if (!o.items.length) throw new UsageError('missing --write <items>');
  if (o.items.includes('mirrors') && !o.targets.length) throw new UsageError('mirrors needs --targets <tools>');
  o.items = ITEMS.filter((x) => o.items.includes(x));
  o.dir = path.resolve(o.dir || process.cwd());
  return o;
}

// Returns the exit code.
export function run(argv, out = process.stdout, err = process.stderr) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err.write(`emit: ${e.message}\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    out.write(USAGE);
    return 0;
  }
  if (!isDir(o.dir)) {
    err.write(`emit: not a directory: ${o.dir}\n`);
    return 2;
  }
  const res = { out, err, n: { write: 0, update: 0, stage: 0, remove: 0, skip: 0 } };
  runItems(o, res);
  const { n } = res;
  const mode = o.dryRun ? ' (dry run: nothing written)' : '';
  out.write(`summary: ${n.write} written, ${n.update} updated, ${n.stage} staged, ${n.remove} removed, ${n.skip} skipped${mode}\n`);
  return 0;
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`emit: ${e && e.message ? e.message : e}\n`);
    process.exitCode = 1;
  }
}
