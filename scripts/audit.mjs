#!/usr/bin/env node
// Claims audit for a project that /claude-setup has written. Zero dependencies. Node 18+.
//
//   node scripts/audit.mjs [dir] [--json]
//
// verify.mjs checks that the files are well formed. This checks that what AGENTS.md says is true of the repo:
//   commands       every command under "## Commands" traces to the detector, a package script, a Makefile
//                  target, a CI step or other repo text, or is a single-test form of a runner the repo uses
//   hard rules     every `- "quote" (path:line)` is found near that line of that file, and no qualifier
//                  ("unless", "except") was trimmed from the sentence it came from
//   version notes  every `- Name N: ...` is for a dependency the project declares, at that major version
//
// Sections that are absent are not checked. Nothing is executed and .env files are never opened.
// Exit 1 when any error was found, otherwise 0. Exit 2 on usage errors.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detect } from './detect.mjs';

const MAX_TEXT = 512 * 1024;
const MAX_NOTES = 10;
const WINDOW_BEFORE = 2;
const WINDOW_AFTER = 4;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function sections(markdown) {
  const out = new Map();
  let name = null;
  let fence = false;
  for (const [i, line] of markdown.split(/\r?\n/).entries()) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = !fence && line.match(/^##\s+(.+?)\s*$/);
    if (h) { name = h[1].trim().toLowerCase(); out.set(name, { start: i + 1, lines: [] }); continue; }
    if (name) out.get(name).lines.push({ n: i + 1, text: line });
  }
  return out;
}

const bullets = (sec) => (sec ? sec.lines.filter((l) => /^\s*[-*]\s+\S/.test(l.text)).map((l) => ({ n: l.n, text: l.text.replace(/^\s*[-*]\s+/, '').trim() })) : []);

// Normalizes prose for quote matching: drops markdown emphasis, smart quotes and extra space.
const norm = (s) => s
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

function readRepoFile(root, rel) {
  if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..') || /(^|[\\/])\.env/.test(rel)) return null;
  try {
    const abs = path.join(root, rel);
    if (fs.statSync(abs).size > MAX_TEXT) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const PM = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const NPM_DIRECT = new Set(['test', 'start', 'stop', 'restart']);
// Runners whose single-test form is not a repo script. The runner must show up in the detector output.
const SINGLE_TEST = [
  [/^(?:uv run |poetry run |pipenv run |hatch run |pdm run )?(?:python -m )?pytest\b/, 'pytest'],
  [/^(?:npx |pnpm (?:exec )?|yarn |bunx? )?vitest\b/, 'vitest'],
  [/^(?:npx |pnpm (?:exec )?|yarn |bunx? )?jest\b/, 'jest'],
  [/^(?:npx |pnpm (?:exec )?|yarn |bunx? )?playwright test\b/, 'playwright'],
  [/^go test\b/, 'go'],
  [/^cargo (?:test|nextest run)\b/, 'cargo'],
  [/^(?:bundle exec )?rspec\b/, 'rspec'],
  [/^(?:vendor\/bin\/)?phpunit\b/, 'phpunit'],
  [/^dotnet test\b/, 'dotnet'],
  [/^node --test\b/, 'node'],
  [/^(?:bun|deno) test\b/, 'bun|deno'],
  [/^python3? -m unittest\b/, 'python'],
  [/^(?:bundle exec )?rake test\b/, 'ruby'],
  [/^(?:\.\/)?mvnw? .*-Dtest/, 'maven'],
  [/^(?:\.\/)?gradlew? .*--tests/, 'gradle'],
];
const REPO_TEXT = ['README.md', 'CONTRIBUTING.md', 'Makefile', 'makefile', 'justfile', 'Justfile', 'Taskfile.yml', 'package.json', 'pyproject.toml', 'tox.ini', 'noxfile.py', 'composer.json', 'Rakefile'];

const flat = (s) => s.replace(/\s+/g, ' ').trim();

function repoTexts(root) {
  const texts = [];
  const take = (rel) => { const t = readRepoFile(root, rel); if (t !== null) texts.push(flat(t)); };
  for (const rel of REPO_TEXT) take(rel);
  for (const dir of ['.github/workflows', 'docs', 'scripts']) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, dir), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name); } catch { /* absent */ }
    for (const n of names.slice(0, 60)) if (/\.(ya?ml|md|sh|mjs|js|py|toml)$/.test(n)) take(`${dir}/${n}`);
  }
  return texts;
}

function packageScripts(root, det) {
  const out = new Set();
  const dirs = new Set(['', ...(det.workspaces || []).map((w) => (typeof w === 'string' ? w : w && w.path)).filter(Boolean)]);
  for (const d of dirs) {
    try { for (const k of Object.keys(JSON.parse(readRepoFile(root, path.posix.join(d, 'package.json')) || '{}').scripts || {})) out.add(k); } catch { /* not JSON */ }
  }
  return out;
}

function makeTargets(root) {
  const out = new Set();
  for (const f of ['Makefile', 'makefile', 'GNUmakefile']) {
    for (const m of (readRepoFile(root, f) || '').matchAll(/^([A-Za-z0-9_][\w./-]*)\s*:(?!=)/gm)) out.add(m[1]);
  }
  return out;
}

// The script name a package-manager command runs, or null when it is not a script invocation.
function scriptOf(tokens) {
  if (!PM.has(tokens[0])) return null;
  const pm = tokens[0];
  let i = 1;
  while (i < tokens.length && tokens[i].startsWith('-')) i += ['-C', '--filter', '-F', '--workspace', '-w', '--prefix', '--cwd'].includes(tokens[i]) && tokens[i] !== '-w' ? 2 : 1;
  if (i >= tokens.length) return null;
  if (tokens[i] === 'run' || tokens[i] === 'run-script') {
    i++;
    while (i < tokens.length && tokens[i].startsWith('-')) i++;
    return tokens[i] || null;
  }
  if (pm === 'npm') return NPM_DIRECT.has(tokens[i]) ? tokens[i] : null;
  return tokens[i];
}

// A backticked span can hold several commands (a && b), carry an env prefix (CI=1 npm test), or not be a command at
// all (`DATABASE_URL`, `.env`, a path). Only command-shaped parts come back.
const SHELL_WORDS = new Set(['cd', 'export', 'echo', 'set', 'source', 'unset']);
const BINARIES = new Set(['make', 'pytest', 'tox', 'nox', 'just', 'task', 'cargo', 'go', 'mvn', 'gradle', 'rake', 'bundle', 'composer', 'dotnet', 'npm', 'pnpm', 'yarn', 'bun', 'uv', 'poetry', 'pip', 'npx', 'deno']);
export function commandsIn(span) {
  const out = [];
  for (const part of span.split(/\s*(?:&&|\|\||;|\|)\s*/)) {
    const tokens = flat(part).split(' ').filter(Boolean);
    while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
    if (!tokens.length || SHELL_WORDS.has(tokens[0]) || tokens[0].startsWith('-')) continue;
    if (tokens.length === 1 && !BINARIES.has(tokens[0]) && !tokens[0].startsWith('./')) continue;
    out.push(tokens.join(' '));
  }
  return out;
}

export function auditCommands(root, det, section) {
  const results = [];
  const known = new Set();
  for (const list of Object.values(det.commands || {})) for (const c of list) { known.add(flat(c.cmd)); for (const a of c.alsoIn || []) known.add(flat(a)); }
  const scripts = packageScripts(root, det);
  const targets = makeTargets(root);
  const haystack = `${JSON.stringify(det.commands || {})} ${(det.frameworks || []).map((f) => f.name).join(' ')} ${det.packageManager || ''} ${det.primary || ''}`.toLowerCase();
  const texts = repoTexts(root);
  for (const b of bullets(section)) {
    for (const span of b.text.matchAll(/`([^`\n]+)`/g)) {
      for (const cmd of commandsIn(span[1])) {
        const tokens = cmd.split(' ');
        const placeholder = cmd.indexOf('<');
        const probe = placeholder > 0 ? flat(cmd.slice(0, placeholder)) : cmd;
        let via = null;
        if (known.has(cmd)) via = 'detector';
        else if ([...known].some((k) => probe === k || probe.startsWith(`${k} `))) via = 'detector command plus arguments';
        else if (scriptOf(tokens) && scripts.has(scriptOf(tokens))) via = `package script ${scriptOf(tokens)}`;
        else if (tokens[0] === 'make' && tokens[1] && targets.has(tokens[1])) via = `Makefile target ${tokens[1]}`;
        else if (SINGLE_TEST.some(([re, needs]) => re.test(cmd) && needs.split('|').some((n) => haystack.includes(n)))) via = 'single-test form of a detected runner';
        else if (tokens.length === 1 && haystack.includes(tokens[0])) via = 'tool the repo uses';
        else if (texts.some((t) => t.includes(probe))) via = 'repo text';
        results.push({ line: b.n, cmd, ok: via !== null, via });
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Hard rules
// ---------------------------------------------------------------------------

const RULE = /^"(.+)"\s+\(([^():]+?):(\d+)\)\s*[.]?$/;
const QUALIFIER = /\b(unless|except|only if|but not|as long as|provided that)\b/i;

export function auditHardRules(root, section) {
  const results = [];
  for (const b of bullets(section)) {
    const m = b.text.match(RULE);
    if (!m) { results.push({ line: b.n, ok: false, problem: 'not in the form - "quote" (path:line)' }); continue; }
    const [, quote, rel, lineNo] = m;
    const text = readRepoFile(root, rel);
    const entry = { line: b.n, source: `${rel}:${lineNo}`, quote };
    if (text === null) { results.push({ ...entry, ok: false, problem: `${rel} cannot be read` }); continue; }
    const lines = text.split(/\r?\n/);
    const at = Number(lineNo);
    if (at < 1 || at > lines.length) { results.push({ ...entry, ok: false, problem: `${rel} has ${lines.length} lines, not ${at}` }); continue; }
    const window = norm(lines.slice(Math.max(0, at - 1 - WINDOW_BEFORE), at + WINDOW_AFTER).join(' '));
    // A cut in the middle of the quote is written as an ellipsis. Each part must appear, in order.
    // Trailing punctuation is ignored: a quote cut mid-sentence still ends with a full stop.
    const parts = quote.split(/…|\.\.\./).map((p) => norm(p).replace(/[.,;:!?]+$/, '')).filter(Boolean);
    let pos = 0;
    let found = parts.length > 0;
    let first = -1;
    for (const p of parts) {
      const i = window.indexOf(p, pos);
      if (i < 0) { found = false; break; }
      if (first < 0) first = i;
      pos = i + p.length;
    }
    if (!found) { results.push({ ...entry, ok: false, problem: `quote not found within a few lines of ${rel}:${at}` }); continue; }
    // The sentence that holds the quote: a trimmed qualifier ("unless ...") would turn it into a different rule.
    const start = Math.max(window.lastIndexOf('. ', first) + 2, 0);
    const tail = window.slice(pos).match(/^[^.!?]*[.!?]?/)[0];
    const sentence = window.slice(start, pos) + tail;
    const quoted = norm(quote);
    const lost = sentence.match(QUALIFIER);
    if (lost && !QUALIFIER.test(quoted)) { results.push({ ...entry, ok: false, problem: `the sentence in ${rel} says "${lost[0]}", the quote does not` }); continue; }
    results.push({ ...entry, ok: true });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Version notes
// ---------------------------------------------------------------------------

const NOTE = /^(.+?)\s+v?(\d+)(?:\.(?:\d+|x))*\s*[:,—-]\s*\S/;
const ALIAS = { next: 'next', nextjs: 'next', turborepo: 'turbo', tailwind: 'tailwindcss', tailwindcss: 'tailwindcss', node: 'node', nodejs: 'node' };
const key = (s) => s.toLowerCase().replace(/\.js\b/g, '').replace(/[^a-z0-9]/g, '');
const major = (v) => { const m = String(v || '').match(/\d+/); return m ? Number(m[0]) : null; };

function declared(det) {
  const map = new Map(); // key -> majors seen
  const add = (name, version) => { const k = ALIAS[key(name)] || key(name); if (!map.has(k)) map.set(k, new Set()); if (major(version) !== null) map.get(k).add(major(version)); };
  for (const f of det.frameworks || []) add(f.name, f.version || f.range);
  for (const [lang, v] of Object.entries(det.languageVersion || {})) add(lang, v);
  if (det.packageManager) add(det.packageManager, det.packageManagerVersion);
  for (const l of det.languages || []) if (!map.has(key(l.name))) map.set(key(l.name), new Set());
  return map;
}

export function auditVersionNotes(det, section) {
  const results = [];
  const map = declared(det);
  const items = bullets(section);
  for (const b of items) {
    const m = b.text.match(NOTE);
    if (!m) { results.push({ line: b.n, ok: false, problem: 'not in the form "Name N: note"' }); continue; }
    const name = m[1].replace(/`/g, '').trim();
    const want = Number(m[2]);
    const seen = map.get(ALIAS[key(name)] || key(name));
    if (!seen) results.push({ line: b.n, name, version: want, ok: false, problem: `the project does not declare ${name}` });
    else if (seen.size && !seen.has(want)) results.push({ line: b.n, name, version: want, ok: false, problem: `the project declares ${name} ${[...seen].join(' / ')}, not ${want}` });
    else results.push({ line: b.n, name, version: want, ok: true });
  }
  if (items.length > MAX_NOTES) results.push({ line: section.start, ok: false, problem: `${items.length} version notes, the limit is ${MAX_NOTES}` });
  return results;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export function audit(dir, { detection } = {}) {
  const root = path.resolve(dir);
  const file = path.join(root, 'AGENTS.md');
  const report = { root, checked: { commands: 0, hardRules: 0, versionNotes: 0 }, commands: [], hardRules: [], versionNotes: [], errors: [], warnings: [] };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { report.errors.push('AGENTS.md: cannot be read'); return report; }
  const det = detection || detect(root);
  const secs = sections(text);
  const sec = (...names) => { for (const n of names) if (secs.has(n)) return secs.get(n); return null; };
  const run = (id, results, label) => {
    report[id] = results;
    report.checked[id] = results.length;
    for (const r of results) if (!r.ok) report.errors.push(`AGENTS.md:${r.line}: ${label(r)}`);
  };
  run('commands', auditCommands(root, det, sec('commands')), (r) => `command \`${r.cmd}\` does not trace to the repo (no detector entry, script, Makefile target, CI step or repo text)`);
  run('hardRules', auditHardRules(root, sec('hard rules')), (r) => `hard rule ${r.source || ''}: ${r.problem}`.replace('rule :', 'rule:'));
  run('versionNotes', auditVersionNotes(det, sec('version notes')), (r) => `version note: ${r.problem}`);
  if (!sec('commands')) report.warnings.push('AGENTS.md has no "## Commands" section');
  return report;
}

export function formatReport(r) {
  const lines = [];
  const total = Object.values(r.checked).reduce((a, b) => a + b, 0);
  for (const e of r.errors) lines.push(`error: ${e}`);
  for (const w of r.warnings) lines.push(`warning: ${w}`);
  lines.push(`audit: ${r.errors.length ? 'FAILED' : 'ok'} (${total} claim(s): ${r.checked.commands} command(s), ${r.checked.hardRules} hard rule(s), ${r.checked.versionNotes} version note(s); ${r.errors.length} error(s), ${r.warnings.length} warning(s))`);
  return lines.join('\n');
}

function isEntryPoint() {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

function main(argv) {
  const json = argv.includes('--json');
  const rest = argv.filter((a) => a !== '--json');
  if (rest.some((a) => a.startsWith('-')) || rest.length > 1) {
    console.error('usage: node scripts/audit.mjs [dir] [--json]');
    return 2;
  }
  const report = audit(rest[0] || '.');
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.errors.length ? 1 : 0;
}

if (isEntryPoint()) process.exit(main(process.argv.slice(2)));
