#!/usr/bin/env node
// Deterministic file writer for the /claude-setup skill. The model does not copy mechanical
// content (router script and config, roster and graph sections, agent mirrors); this does.
//
//   node scripts/emit.mjs [dir] --write <items> [--stage] [--targets <tools>] [--intent "<text>"]
//                         [--model-map fast=X,standard=Y,deep=Z] [--dry-run]
//
// items: router, agents-doc, structure-doc, mirrors (comma separated). Prints one line per file:
// write | update | stage | remove | skip, then a summary. Exit 0, or 2 on usage errors.
// --stage writes every .claude/ output under .claude-setup/staged/ plus apply.mjs, for permission
// modes that refuse writes under .claude/. Zero dependencies; all logic is in this repo's scripts.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detect } from './detect.mjs';
import { buildGraph, renderMarkdown } from './graph.mjs';
import { deriveRoster, renderRosterMarkdown, toRouterConfig } from './roster.mjs';
import { syncAgents, TARGETS, parseModelMap } from './sync-agents.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTE_SRC = path.join(HERE, 'router', 'route.mjs');
const ITEMS = ['router', 'agents-doc', 'structure-doc', 'mirrors'];
const AGENTS = '.claude/agents';
const STAGE_DIR = '.claude-setup/staged';
const SCHEMA = 'https://json.schemastore.org/claude-code-settings.json';
const ROUTE_CMD = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/route.mjs"';
const HOOK_SPEC = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: ROUTE_CMD, timeout: 5 }] }] } };
const ROUTE_LOG = '.claude/route-log.jsonl';
const USAGE = `usage: node scripts/emit.mjs [dir] --write <items> [--stage] [--targets <tools>] [--intent "<text>"]
                        [--model-map fast=X,standard=Y,deep=Z] [--dry-run]
items: router, agents-doc, structure-doc, mirrors (comma separated)
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
// is already registered for that event. Shared with .claude-setup/apply.mjs, which inlines it.
// ---------------------------------------------------------------------------

export function mergeSettings(current, desired) {
  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isPlainObject(current)) throw new Error('settings.json must be a JSON object');
  const out = { ...current };
  for (const [key, value] of Object.entries(desired)) {
    if (key !== 'hooks' && out[key] === undefined) out[key] = value;
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

// Router unit: all four files or none. Any precondition failure skips every file of the unit.
function planRouter(dir, roster) {
  const rels = ['.claude/hooks/route.mjs', '.claude/router.json', '.claude/settings.json', '.gitignore'];
  const unit = (why) => rels.map((rel) => ({ rel, verb: 'skip', reason: `router unit skipped: ${why}` }));
  const blocked = blockedBy(dir, rels[0]);
  if (blocked) return unit(`${blocked} is not a directory`);
  const routeSrc = fs.readFileSync(ROUTE_SRC);
  const routeNow = readIf(path.join(dir, rels[0]));
  if (routeNow !== null && !routeNow.equals(routeSrc)) return unit(`${rels[0]} differs from the skill copy`);

  const settingsNow = readIf(path.join(dir, rels[2]));
  let current = null;
  let merged;
  try {
    if (settingsNow !== null) current = JSON.parse(settingsNow.toString('utf8'));
    merged = mergeSettings(settingsNow === null ? { $schema: SCHEMA } : current, HOOK_SPEC);
  } catch (e) {
    return unit(`${rels[2]}: ${e.message}`);
  }
  let settings;
  if (settingsNow !== null && JSON.stringify(merged) === JSON.stringify(current)) {
    settings = { rel: rels[2], verb: 'skip', reason: 'UserPromptSubmit hook already present' };
  } else {
    settings = { rel: rels[2], verb: settingsNow === null ? 'write' : 'update', reason: 'UserPromptSubmit hook',
      data: Buffer.from(`${JSON.stringify(merged, null, 2)}\n`) };
  }

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

  return [
    fileEntry(rels[0], routeNow, routeSrc),
    fileEntry(rels[1], readIf(path.join(dir, rels[1])), `${JSON.stringify(toRouterConfig(roster), null, 2)}\n`),
    settings,
    ignore,
  ];
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

// Under --stage, .claude/ outputs go to the staging folder instead.
function emitEntries(res, o, entries) {
  for (const e of entries) {
    if (e.verb === 'skip') { skip(res, e.rel, e.reason); continue; }
    const staged = o.stage && e.rel.startsWith('.claude/');
    const verb = staged ? 'stage' : e.verb;
    put(res, o, staged ? `${STAGE_DIR}/${e.rel}` : e.rel, verb, e.data, e.reason);
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

function runMirrors(res, o) {
  if (!hasAgentFiles(o.dir)) return skip(res, 'mirrors', 'no .claude/agents');
  const r = syncAgents({ dir: o.dir, targets: o.targets, modelMap: o.modelMap, dryRun: o.dryRun });
  for (const w of r.warnings) res.err.write(`warn: ${w}\n`);
  for (const a of r.actions) {
    if (a.action === 'unchanged') skip(res, a.file, 'unchanged');
    else if (a.action === 'conflict') { line(res, `skip mirrors ${a.target}: ${a.file}`); res.n.skip++; }
    else { line(res, `${a.action} ${a.file}`); res.n[a.action]++; }
  }
}

// Runs in the staged project: copies each staged file over its real path. settings.json is merged.
// Source is written verbatim into .claude-setup/apply.mjs, so it must stay self-contained.
function applyMain() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const staged = path.join(root, '.claude-setup', 'staged');
  const walk = (rel) => fs.readdirSync(path.join(staged, rel), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(rel, e.name)) : [path.join(rel, e.name).split(path.sep).join('/')]));
  const files = fs.existsSync(staged) ? walk('').sort() : [];
  if (!files.length) {
    console.log('nothing staged');
    return 0;
  }
  let failed = 0;
  for (const rel of files) {
    const dest = path.join(root, rel);
    const data = fs.readFileSync(path.join(staged, rel));
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
  return 0;
}

function applySource() {
  return [
    '#!/usr/bin/env node',
    '// Generated by scripts/emit.mjs --stage: copies the staged .claude/ files into place. Zero dependencies.',
    '// Run from the project root: node .claude-setup/apply.mjs',
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    '',
    mergeSettings.toString(),
    '',
    applyMain.toString(),
    '',
    'process.exitCode = applyMain();',
    '',
  ].join('\n');
}

const STAGE_README = [
  '# Staged Claude Code config',
  '',
  'claude-setup staged these `.claude/` files here because Claude Code refused writes under `.claude/` in this permission mode.',
  'Each file under `staged/` sits at the path it replaces. `settings.json` is merged into the real file, never overwritten.',
  'To apply them, run from the project root: `node .claude-setup/apply.mjs`',
  'On success the script deletes `staged/`. Delete this folder to discard the staged files.',
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
  if (want('router') || want('agents-doc') || want('structure-doc')) {
    const detection = detect(o.dir);
    graph = buildGraph(o.dir);
    if (want('router') || want('agents-doc')) roster = deriveRoster(o.dir, { intent: o.intent, detection, graph });
  }
  if (want('router')) emitEntries(res, o, planRouter(o.dir, roster));
  if (want('agents-doc')) {
    emitEntries(res, o, planFence(o.dir, 'docs/agents.md', 'roster', rosterBody(roster),
      '# Agents\n\nRoles, scopes and model tiers for agents working in this repo.\n\n'));
  }
  if (want('structure-doc')) {
    emitEntries(res, o, planFence(o.dir, 'docs/project-structure.md', 'graph', graphBody(graph),
      '# Project structure\n\n'));
  }
  if (want('mirrors')) runMirrors(res, o);
  if (o.stage && res.n.stage > 0) {
    put(res, o, '.claude-setup/apply.mjs', 'write', applySource());
    put(res, o, '.claude-setup/README.md', 'write', STAGE_README);
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
