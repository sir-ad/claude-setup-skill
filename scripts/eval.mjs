#!/usr/bin/env node
// Evals for the /claude-setup output. Zero dependencies. Node 18+.
//
//   node scripts/eval.mjs --list
//   node scripts/eval.mjs --golden [--case <id>]       score the reference outputs in evals/golden/ (offline, no model)
//   node scripts/eval.mjs --score <dir> [--case <id>]  score a project that /claude-setup already wrote
//   node scripts/eval.mjs --run [--case <id>] [--model <m>] [--timeout <s>] [--keep]
//                                                      run /claude-setup headless on a copy of each fixture, then score it
//
// A score is the sum of four checks. verify.mjs: the files are well formed and safe. audit.mjs: every command, hard rule
// and version note in AGENTS.md is true of the repo. Case expectations (evals/cases.json): required commands and hard
// rules are present, forbidden version notes are absent. Surface: with --run, nothing outside the files the skill is
// allowed to write was created or changed.
//
// --golden and --score need no model. --run needs the `claude` CLI, a login, and the skill installed in
// ~/.claude/skills/claude-setup; it spends model usage, so CI does not run it. Exit 1 when a case fails, 2 on usage errors.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { audit } from './audit.mjs';
import { verifyFiles } from './verify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASES_FILE = path.join(ROOT, 'evals', 'cases.json');
const MAX_SNAPSHOT_FILES = 5000;

// Paths /claude-setup may create or change. Anything else written during a run is plan drift.
export const ALLOWED_SURFACE = [
  /^(AGENTS|CLAUDE)\.md$/, /^\.claude\//, /^docs\//, /^\.claude-setup\//, /^\.gitignore$/, /^\.worktreeinclude$/,
  /^\.gemini\//, /^\.aider\.conf\.yml$/, /^\.codex\//, /^\.opencode\//, /^\.mcp\.json$/,
  /^\.cursor\/rules\//, /^\.windsurf\/rules\//, /^\.clinerules\//, /^\.github\/(?:agents|instructions)\//,
];

export function loadCases(file = CASES_FILE) {
  if (!fs.existsSync(file)) return []; // evals/ is not part of the npm package; --score <dir> still works
  const cases = JSON.parse(fs.readFileSync(file, 'utf8')).cases;
  for (const c of cases) {
    if (!c.id || !c.fixture) throw new Error(`evals case needs "id" and "fixture": ${JSON.stringify(c)}`);
  }
  return cases;
}

// ---------------------------------------------------------------------------
// Snapshots and scoring
// ---------------------------------------------------------------------------

export function snapshot(dir) {
  const out = new Map();
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && out.size < MAX_SNAPSHOT_FILES) out.set(p, crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, p))).digest('hex'));
    }
  };
  walk('');
  return out;
}

export function surfaceErrors(before, after) {
  const errors = [];
  for (const [p, hash] of after) {
    if (before.get(p) === hash || ALLOWED_SURFACE.some((re) => re.test(p))) continue;
    errors.push(`${before.has(p) ? 'changed' : 'created'} ${p}, which /claude-setup does not write`);
  }
  for (const p of before.keys()) if (!after.has(p)) errors.push(`deleted ${p}`);
  return errors.sort();
}

// Files verify.mjs should look at: what the skill wrote, found by comparing with the snapshot or by name.
function generatedFiles(dir, before) {
  const after = snapshot(dir);
  const files = [...after.keys()].filter((p) => (!before || before.get(p) !== after.get(p)) && /^(AGENTS\.md|CLAUDE\.md|\.claude\/settings\.json|docs\/.*\.md|\.claude\/.*\.(md|json))$/.test(p));
  return before ? files : files.filter((p) => /^(AGENTS\.md|CLAUDE\.md|\.claude\/settings\.json)$/.test(p));
}

export function scoreProject(dir, c = {}, { before = null } = {}) {
  const failures = [];
  const files = generatedFiles(dir, before);
  if (!files.includes('AGENTS.md')) failures.push('AGENTS.md was not written');

  for (const f of verifyFiles(dir, files, { fenceCheck: false })) if (f.level === 'error') failures.push(`verify ${f.file}: ${f.message}`);

  const report = audit(dir);
  failures.push(...report.errors.map((e) => `audit ${e}`));

  const commands = report.commands.map((x) => x.cmd);
  for (const want of c.requireCommands || []) {
    if (!commands.some((cmd) => cmd === want || cmd.startsWith(`${want} `))) failures.push(`missing command \`${want}\``);
  }
  for (const want of c.requireHardRules || []) {
    if (!report.hardRules.some((r) => (r.quote || '').includes(want))) failures.push(`missing hard rule containing "${want}"`);
  }
  for (const banned of c.forbidVersionNotes || []) {
    for (const n of report.versionNotes) if (n.name && n.name.toLowerCase().includes(banned.toLowerCase())) failures.push(`version note for ${n.name} ${n.version} must not appear in this case`);
  }
  if (before) failures.push(...surfaceErrors(before, snapshot(dir)).map((e) => `surface: ${e}`));

  return { id: c.id || path.basename(dir), ok: failures.length === 0, failures, claims: report.checked, files };
}

// ---------------------------------------------------------------------------
// Golden outputs and live runs
// ---------------------------------------------------------------------------

function tmpCopy(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-setup-eval-'));
  fs.cpSync(src, dir, { recursive: true });
  return dir;
}

export function scoreGolden(c) {
  const dir = tmpCopy(path.join(ROOT, c.fixture));
  try {
    const golden = path.join(ROOT, 'evals', 'golden', c.id);
    if (!fs.existsSync(golden)) return { id: c.id, ok: false, failures: [`no golden output in evals/golden/${c.id}`], claims: {}, files: [] };
    fs.cpSync(golden, dir, { recursive: true });
    return scoreProject(dir, c);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SKILL_DIR = path.join(os.homedir(), '.claude', 'skills', 'claude-setup');

function claude(args, cwd, timeoutS) {
  return spawnSync('claude', args, { cwd, encoding: 'utf8', timeout: timeoutS * 1000, maxBuffer: 64 * 1024 * 1024 });
}

export function runLive(c, { model = '', timeout = 900, keep = false } = {}) {
  if (!fs.existsSync(path.join(SKILL_DIR, 'SKILL.md'))) {
    return { id: c.id, ok: false, failures: [`the skill is not installed at ${SKILL_DIR}; run: npx -y @claude-setup-skill/install`], claims: {}, files: [] };
  }
  const dir = tmpCopy(path.join(ROOT, c.fixture));
  const before = snapshot(dir);
  const common = ['--permission-mode', 'acceptEdits', '--add-dir', SKILL_DIR, ...(model ? ['--model', model] : [])];
  // Turn 1 prints the plan and stops at the Proceed gate; turn 2 answers it in the same session.
  const plan = claude(['-p', '/claude-setup', ...common], dir, timeout);
  const go = plan.error ? plan : claude(['-p', 'Proceed: yes. Router hook yes. Formatter hook no. Handoff hook no. Code-search MCP no. Codex config no. Fastest check no.', '--continue', ...common], dir, timeout);
  const err = plan.error || go.error;
  if (!err && fs.existsSync(path.join(dir, '.claude-setup', 'apply.mjs'))) spawnSync(process.execPath, [path.join(dir, '.claude-setup', 'apply.mjs')], { cwd: dir, encoding: 'utf8' });
  const result = err
    ? { id: c.id, ok: false, failures: [`claude did not finish: ${err.code || err.message}`], claims: {}, files: [] }
    : scoreProject(dir, c, { before });
  result.dir = keep ? dir : undefined;
  if (!keep) fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function formatResults(results) {
  const lines = [];
  for (const r of results) {
    lines.push(`${r.ok ? 'pass' : 'FAIL'}  ${r.id}${r.claims && r.claims.commands !== undefined ? `  (${r.claims.commands} commands, ${r.claims.hardRules} hard rules, ${r.claims.versionNotes} version notes)` : ''}${r.dir ? `  kept in ${r.dir}` : ''}`);
    for (const f of r.failures) lines.push(`      - ${f}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  lines.push(`eval: ${results.length - failed}/${results.length} case(s) passed`);
  return lines.join('\n');
}

function parse(argv) {
  const o = { mode: null, case: null, dir: null, model: '', timeout: 900, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`); return v; };
    if (a === '--list' || a === '--golden' || a === '--run') o.mode = a.slice(2);
    else if (a === '--score') { o.mode = 'score'; o.dir = val(); }
    else if (a === '--case') o.case = val();
    else if (a === '--model') o.model = val();
    else if (a === '--timeout') { o.timeout = Number(val()); if (!(o.timeout > 0)) throw new Error('--timeout must be a positive number of seconds'); }
    else if (a === '--keep') o.keep = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.mode) throw new Error('choose one of --list, --golden, --score <dir>, --run');
  return o;
}

function isEntryPoint() {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

function main(argv) {
  let o;
  try { o = parse(argv); } catch (e) {
    console.error(`${e.message}\nusage: node scripts/eval.mjs --list | --golden | --score <dir> | --run [--case <id>] [--model <m>] [--timeout <s>] [--keep]`);
    return 2;
  }
  let cases = loadCases();
  if (!cases.length && o.mode !== 'score') {
    console.error('evals/cases.json was not found. The corpus ships with the git repository, not the npm package: clone https://github.com/sir-ad/claude-setup-skill and run it there. `--score <dir>` works anywhere.');
    return 2;
  }
  if (o.case) {
    cases = cases.filter((c) => c.id === o.case);
    if (!cases.length) { console.error(`no case "${o.case}"; see --list`); return 2; }
  }
  if (o.mode === 'list') {
    for (const c of cases) console.log(`${c.id.padEnd(22)} ${c.fixture}${c.golden ? '  (golden)' : ''}`);
    return 0;
  }
  let results;
  if (o.mode === 'golden') results = cases.filter((c) => c.golden).map(scoreGolden);
  else if (o.mode === 'score') results = [scoreProject(path.resolve(o.dir), cases.length === 1 ? cases[0] : {})];
  else results = cases.map((c) => runLive(c, o));
  console.log(formatResults(results));
  return results.every((r) => r.ok) ? 0 : 1;
}

if (isEntryPoint()) process.exit(main(process.argv.slice(2)));
