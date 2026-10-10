#!/usr/bin/env node
// Deterministic project detector for the /claude-setup skill.
//
//   node scripts/detect.mjs [dir]     prints one JSON object to stdout
//
// Zero dependencies, read-only, bounded work. It never reads .env* files,
// never follows symlinked directories, and never descends into vendored or
// build-output directories. Anything it cannot parse becomes a warning.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKIP_DIRS = new Set([
  'node_modules', '.git', 'target', 'dist', 'build', '.venv', 'venv', 'vendor',
  '__pycache__', '.next', '.turbo',
  // Caches, editor state and package stores that only add noise (or thousands of files).
  '.mypy_cache', '.pytest_cache', '.ruff_cache', '.gradle', '.cache', '.nuxt',
  '.svelte-kit', '.output', '.parcel-cache', 'coverage',
  '.yarn', '.pnpm-store', '.idea', '.vscode', '.terraform', 'Pods', 'DerivedData',
  'bower_components', '.angular', '.expo', '.dart_tool', '.tox', '.nox', '.eggs', 'obj',
]);
export const MAX_DEPTH = 3; // path segments below the root
const MAX_ENTRIES = 5000; // files + dirs seen by the walk
const MAX_FILES_PER_DIR = 500; // one huge directory must not eat the whole budget
const MAX_WORKSPACES = 2000;
const MAX_MEMBER_MANIFESTS = 300; // member manifests read for frameworks and commands
const MAX_READ_BYTES = 512 * 1024;
const MAX_PER_CATEGORY = 40; // commands per category
const MAX_HARD_RULES = 25;
const MAX_DOCS = 50;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const sortStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const uniqSorted = (items) => [...new Set(items)].sort(sortStr);
const depthOf = (rel) => rel.split('/').length;
const baseName = (rel) => rel.slice(rel.lastIndexOf('/') + 1);
const dirName = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const joinRel = (dir, name) => (dir ? `${dir}/${name}` : name);
const byDepthThenPath = (a, b) => depthOf(a) - depthOf(b) || sortStr(a, b);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function unquote(s) {
  const t = s.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    return t.slice(1, -1);
  }
  return t;
}

// Remove a trailing "# comment" that is outside quotes. YAML only treats '#'
// as a comment after whitespace; TOML treats any unquoted '#' as one.
function stripHashComment(line, yaml) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (!yaml || i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

// Specifiers that are not versions: catalog/workspace links, tags, git and file sources, "*".
const NON_VERSION = /^(?:catalog:|workspace:|file:|link:|portal:|git\+|git:|github:|gitlab:|bitbucket:|https?:|ssh:|\.{1,2}\/|~\/|\/)|^(?:latest|next|beta|canary|\*|x)$|^[\w.-]+\/[\w.-]+(?:#.*)?$/i;

// "^1.2.3" -> { range: "^", version: "1.2.3" }.
// With several specifiers (">=3,<4", "^1 || ^2") the version comes from the first one
// and `range` keeps the whole spec. Non-versions ("workspace:*", "latest") give version null
// and keep the raw text in `range`. "npm:pkg@1.2.3" aliases use the inner version.
function splitRange(value) {
  if (typeof value !== 'string') return { version: null, range: '' };
  const text = value.trim();
  const alias = text.match(/^npm:(?:@[^/]+\/)?[^@]+@(.+)$/);
  if (alias) return splitRange(alias[1]);
  if (NON_VERSION.test(text)) return { version: null, range: text };
  const parts = text.split(/\s*(?:,|\|\|)\s*|\s+(?=[<>=~^!])/).filter(Boolean);
  const m = (parts[0] || '').match(/^(\^|~>|~=|~|>=|<=|==|!=|>|<|=)?\s*(\d.*)$/);
  if (!m) return { version: text || null, range: '' };
  return { version: m[2], range: parts.length > 1 ? text : m[1] || '' };
}

// Convert a glob (workspace patterns, .gitignore lines) to a regex source.
function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return re;
}

// ---------------------------------------------------------------------------
// TOML (just enough: tables, strings, arrays, inline tables, dotted keys)
// ---------------------------------------------------------------------------

function bracketDelta(s) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
  }
  return depth;
}

function findEquals(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '=') return i;
  }
  return -1;
}

// Split on top-level commas, ignoring commas inside quotes or brackets.
function splitTop(s) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseTomlString(raw) {
  const q = raw[0];
  let out = '';
  for (let i = 1; i < raw.length; i++) {
    const c = raw[i];
    if (c === q) break;
    if (c === '\\' && q === '"') {
      const next = raw[++i];
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
    } else {
      out += c;
    }
  }
  return out;
}

function parseTomlValue(raw) {
  const v = raw.trim();
  if (!v) return '';
  if (v[0] === '"' || v[0] === "'") return parseTomlString(v);
  if (v[0] === '[') return splitTop(v.slice(1, v.lastIndexOf(']'))).map(parseTomlValue);
  if (v[0] === '{') {
    const obj = {};
    for (const part of splitTop(v.slice(1, v.lastIndexOf('}')))) {
      const eq = findEquals(part);
      if (eq > 0) obj[unquote(part.slice(0, eq))] = parseTomlValue(part.slice(eq + 1));
    }
    return obj;
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

// Returns { "<table.path>": { key: value } }. Root keys live under "".
// Dotted keys (`tokio.workspace = true`) are kept verbatim as the key.
export function parseToml(text) {
  const tables = { '': {} };
  let current = tables[''];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripHashComment(lines[i], false).trim();
    if (!line) continue;

    const header = line.match(/^\[\[?\s*([^\]]+?)\s*\]\]?$/);
    if (header) {
      const name = header[1].split('.').map((p) => unquote(p.trim())).join('.');
      current = tables[name] || (tables[name] = {});
      continue;
    }

    const eq = findEquals(line);
    if (eq < 0) continue;
    const key = unquote(line.slice(0, eq).trim());
    let raw = line.slice(eq + 1).trim();

    const fence = raw.startsWith('"""') ? '"""' : raw.startsWith("'''") ? "'''" : null;
    if (fence) {
      // Multi-line string: its content never matters here, so skip it.
      if (!raw.slice(3).includes(fence)) {
        while (i + 1 < lines.length && !lines[++i].includes(fence)) { /* skip */ }
      }
      current[key] = '';
      continue;
    }

    // Arrays and inline tables may span several lines.
    let guard = 0;
    while (bracketDelta(raw) > 0 && i + 1 < lines.length && guard++ < 500) {
      raw += ' ' + stripHashComment(lines[++i], false).trim();
    }
    current[key] = parseTomlValue(raw);
  }
  return tables;
}

const tomlTable = (toml, name) => (toml && toml[name]) || {};
const asArray = (v) => (Array.isArray(v) ? v : []);
const strings = (v) => asArray(v).filter((x) => typeof x === 'string');

// ---------------------------------------------------------------------------
// YAML (line-wise only) and small file formats
// ---------------------------------------------------------------------------

const indentOf = (line) => line.match(/^\s*/)[0].length;

// Items of a top-level `key:` list, as block ("- a") or inline ("[a, b]").
function yamlTopList(text, key) {
  const lines = text.split(/\r?\n/);
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`^${key}:\\s*(.*)$`));
    if (!m) continue;
    const inline = stripHashComment(m[1], true).trim();
    if (inline.startsWith('[')) {
      return splitTop(inline.slice(1, inline.lastIndexOf(']'))).map(unquote);
    }
    for (let j = i + 1; j < lines.length; j++) {
      const line = stripHashComment(lines[j], true);
      if (!line.trim()) continue;
      const item = line.match(/^\s*-\s+(.+)$/);
      if (item) items.push(unquote(item[1]));
      else if (indentOf(line) === 0) break;
    }
    return items;
  }
  return items;
}

// Names directly under a top-level `tasks:` map (Taskfile.yml).
function yamlTaskNames(text) {
  const lines = text.split(/\r?\n/);
  const names = [];
  const start = lines.findIndex((l) => /^tasks:\s*$/.test(stripHashComment(l, true)));
  if (start < 0) return names;
  let childIndent = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = stripHashComment(lines[i], true);
    if (!line.trim()) continue;
    const indent = indentOf(line);
    if (indent === 0) break;
    if (childIndent === null) childIndent = indent;
    if (indent !== childIndent) continue;
    const m = line.trim().match(/^["']?([A-Za-z0-9_][\w:.-]*)["']?\s*:/);
    if (m) names.push(m[1]);
  }
  return names;
}

// Folder a step runs in, as a repo-relative path. '' = repo root, null = unknown (skip the step).
function normalizeWorkingDirectory(base, value) {
  const v = unquote(stripHashComment(String(value), true).trim());
  if (!/^[\w@.-][\w@./-]*$/.test(v) || v.includes('${{')) return null; // expressions, absolute paths, ~, $VARS
  const joined = path.posix.normalize(base ? `${base}/${v}` : v);
  if (joined === '.' || joined === './') return '';
  return joined.startsWith('..') ? null : joined.replace(/\/$/, '');
}

// `working-directory:` defaults: [{ start, end, dir }] where dir may be null (unknown).
// A `defaults:` block covers the rest of its job (or the whole workflow at indent 0).
function workflowDefaults(lines) {
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)defaults:\s*$/);
    if (!m) continue;
    const indent = m[1].length;
    let dir;
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      if (indentOf(lines[j]) <= indent) break; // end of the defaults mapping itself
      const wd = lines[j].match(/^\s*working-directory:\s*(.+)$/);
      if (wd) dir = normalizeWorkingDirectory('', wd[1]);
    }
    let end = lines.length;
    for (; j < lines.length; j++) {
      if (lines[j].trim() && indentOf(lines[j]) < indent) {
        end = j;
        break;
      }
    }
    if (dir !== undefined) found.push({ start: i, end, dir });
  }
  return found;
}

// working-directory set on the same step as the `run:` at line `i` (column `col`); undefined if none.
function stepWorkingDirectory(lines, i, col) {
  let start = i;
  if (!/^\s*-\s/.test(lines[i])) {
    for (let k = i - 1; k >= 0; k--) {
      if (!lines[k].trim()) continue;
      if (indentOf(lines[k]) >= col) continue;
      start = /^\s*-\s/.test(lines[k]) ? k : -1;
      break;
    }
    if (start < 0) return undefined;
  }
  const dashIndent = indentOf(lines[start]);
  for (let k = start; k < lines.length; k++) {
    if (k > start && lines[k].trim() && indentOf(lines[k]) <= dashIndent) break;
    const m = lines[k].match(/^\s*(?:-\s+)?working-directory:\s*(.+)$/);
    if (m && lines[k].indexOf('working-directory:') === col) return normalizeWorkingDirectory('', m[1]);
  }
  return undefined;
}

// New cwd after `cd target` from `cwd`, or null when it cannot be known statically.
function cdTarget(cwd, target) {
  if (cwd === null) return null;
  return normalizeWorkingDirectory(cwd, target);
}

// Split script lines into { cmd, dir } by following simple `cd x` and `cd x && cmd` lines.
function commandsWithDirectory(lines, baseDir) {
  const out = [];
  let cwd = baseDir;
  for (const line of lines) {
    const bare = line.match(/^cd\s+(\S+)\s*$/);
    if (bare) {
      cwd = cdTarget(cwd, bare[1]);
      continue;
    }
    const chain = line.match(/^cd\s+(\S+)\s*&&\s*(.+)$/);
    if (chain) {
      cwd = cdTarget(cwd, chain[1]);
      out.push({ cmd: chain[2].trim(), dir: cwd });
      continue;
    }
    out.push({ cmd: line, dir: cwd });
  }
  return out;
}

// `run:` steps from a GitHub Actions workflow: single-line and block scalars, each with the
// directory it runs in (step or job `working-directory:`, plus `cd` lines). dir null = unknown.
function workflowRunSteps(text) {
  const lines = text.split(/\r?\n/);
  const defaults = workflowDefaults(lines);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:-\s+)?run:\s*(.*)$/);
    if (!m) continue;
    const col = lines[i].indexOf('run:');
    const stepDir = stepWorkingDirectory(lines, i, col);
    const covering = defaults.filter((d) => d.start < i && i < d.end).pop();
    const baseDir = stepDir !== undefined ? stepDir : covering ? covering.dir : '';
    const rest = stripHashComment(m[1], true).trim();
    let scriptLines;
    if (/^[|>][+-]?\d*$/.test(rest)) {
      const block = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (!lines[j].trim()) continue;
        if (indentOf(lines[j]) <= col) break;
        block.push(lines[j].trim());
      }
      i = j - 1;
      scriptLines = joinContinuations(block);
    } else if (rest) {
      scriptLines = [unquote(rest)];
    } else {
      continue;
    }
    out.push(...commandsWithDirectory(scriptLines, baseDir));
  }
  return out;
}

function joinContinuations(lines) {
  const out = [];
  let pending = '';
  for (const line of lines) {
    if (line.endsWith('\\')) {
      pending += line.slice(0, -1).trim() + ' ';
    } else {
      out.push((pending + line).trim());
      pending = '';
    }
  }
  if (pending.trim()) out.push(pending.trim());
  return out;
}

// Leading `VAR=value ` words in front of a command.
const ENV_PREFIX = /^(?:\w+=(?:"[^"]*"|'[^']*'|\$\([^)]*\)|[^\s"'(]*)\s+)+/;

// Shell plumbing and CI-only steps that mean nothing on a developer machine.
const CI_NOISE = [
  /^(?:echo|set|cd|mkdir|export|if|fi|then|else|exit|printf|cat|ls|pwd|sleep|rm|mv|cp|touch|source|true|false)(?:\s|$)/,
  /^[[\]{}:#.](?:\s|$)/,
  /^test\s+-/,
  /^(?:for|while|do|done|break|continue|case|esac|read|local)(?:\s|$)/,
  /^\S*\)\s/, // case arm: `*.py) cmd ;;`
  /;;\s*$/,
  /^"\$/,
  /^(?:sudo|apt|apt-get|brew|choco|curl|wget|tar|unzip|7z|certutil|shasum|strip|xargs|gh|git|twine)(?:\s|$)/,
  /^docker\s+(?!build\b|compose\b)/,
  /^(?:npm|pnpm|yarn|bun|cargo|uv)\s+publish\b/,
  // Scripts that live under ci/ or .github/ (optionally behind an interpreter).
  /^(?:(?:node|bash|sh|python3?|uv run)\s+)?\.?\/?(?:ci|\.github)\//,
];

function isNoisyCiCommand(cmd) {
  if (cmd.includes('${{') || /\$\{?(?:GITHUB|RUNNER)_/.test(cmd)) return true; // not runnable locally
  const core = cmd.replace(ENV_PREFIX, '');
  if (/^\w+=/.test(core)) return true; // plain variable assignment
  return CI_NOISE.some((re) => re.test(core));
}

function parseGoMod(text) {
  const out = { module: null, go: null, requires: [] };
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    if (inBlock) {
      if (line === ')') inBlock = false;
      else {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) out.requires.push({ path: parts[0], version: parts[1] });
      }
      continue;
    }
    let m;
    if ((m = line.match(/^module\s+(\S+)/))) out.module = m[1];
    else if ((m = line.match(/^go\s+(\S+)/))) out.go = m[1];
    else if (/^require\s*\($/.test(line)) inBlock = true;
    else if ((m = line.match(/^require\s+(\S+)\s+(\S+)/))) out.requires.push({ path: m[1], version: m[2] });
  }
  return out;
}

// `use ./a` and `use ( ./a ./b )` from go.work.
function parseGoWork(text) {
  const dirs = [];
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    if (inBlock) {
      if (line === ')') inBlock = false;
      else dirs.push(unquote(line));
    } else if (/^use\s*\($/.test(line)) inBlock = true;
    else {
      const m = line.match(/^use\s+(\S+)/);
      if (m) dirs.push(unquote(m[1]));
    }
  }
  return dirs;
}

// ---------------------------------------------------------------------------
// Context: bounded directory walk plus cached, safe file reads
// ---------------------------------------------------------------------------

function entryKind(root, rel, entry) {
  if (entry.isSymbolicLink()) {
    // Symlinked files count (CLAUDE.md -> AGENTS.md is common); symlinked dirs are not followed.
    try {
      return fs.statSync(path.join(root, rel)).isFile() ? 'file' : null;
    } catch {
      return null;
    }
  }
  if (entry.isDirectory()) return 'dir';
  if (entry.isFile()) return 'file';
  return null;
}

// Manifests are listed first inside each directory so a truncated walk still sees them.
const PRIORITY_FILE = /^(package\.json|Cargo\.toml|go\.mod|go\.work|pyproject\.toml|pnpm-workspace\.yaml|turbo\.json|nx\.json|lerna\.json|deno\.jsonc?|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?|Makefile|README(\..+)?|CLAUDE\.md|AGENTS\.md|\.gitignore)$/;

// Breadth-first, so a truncated walk also keeps the shallow files that matter most.
// `starts` lets the caller walk extra directories (workspace members the skip list hid).
export function walk(root, warnings, starts = [''], maxEntries = MAX_ENTRIES) {
  const files = [];
  const dirs = [];
  const queue = [...starts];
  let truncated = false;
  let crowded = 0; // directories with more files than MAX_FILES_PER_DIR
  for (let q = 0; q < queue.length && !truncated; q++) {
    const rel = queue[q];
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch (err) {
      warnings.push(`cannot read directory ${rel || '.'}: ${err.code || err.message}`);
      continue;
    }
    entries.sort((a, b) => Number(PRIORITY_FILE.test(b.name)) - Number(PRIORITY_FILE.test(a.name)) || sortStr(a.name, b.name));
    let filesHere = 0;
    let skippedHere = false;
    for (const entry of entries) {
      if (files.length + dirs.length >= maxEntries) {
        truncated = true;
        break;
      }
      const childRel = joinRel(rel, entry.name);
      const kind = entryKind(root, childRel, entry);
      if (kind === 'dir') {
        if (SKIP_DIRS.has(entry.name)) continue;
        dirs.push(childRel);
        if (depthOf(childRel) < MAX_DEPTH) queue.push(childRel);
      } else if (kind === 'file') {
        if (++filesHere > MAX_FILES_PER_DIR) {
          skippedHere = true;
          continue;
        }
        files.push(childRel);
      }
    }
    if (skippedHere) crowded++;
  }
  if (truncated) warnings.push(`walk stopped after ${maxEntries} entries; results may be incomplete`);
  if (crowded) warnings.push(`${crowded} director${crowded === 1 ? 'y has' : 'ies have'} more than ${MAX_FILES_PER_DIR} files; the extra files were not scanned`);
  return { files, dirs, truncated, crowded: crowded > 0 };
}

export function createContext(dir) {
  const root = path.resolve(dir);
  const warnings = [];
  let walked = { files: [], dirs: [], truncated: false, crowded: false };
  try {
    if (fs.statSync(root).isDirectory()) walked = walk(root, warnings);
    else warnings.push(`not a directory: ${root}`);
  } catch (err) {
    warnings.push(`cannot access ${root}: ${err.code || err.message}`);
  }
  return {
    root,
    warnings,
    files: walked.files,
    dirs: walked.dirs,
    fileSet: new Set(walked.files),
    dirSet: new Set(walked.dirs),
    // When the walk is incomplete, "not in the walk" no longer means "absent".
    incomplete: walked.truncated || walked.crowded,
    cache: new Map(),
    workspaces: [],
  };
}

// The walk answers for paths it fully covers. Everything else (deeper paths, a truncated walk,
// or a path through a skipped directory name such as a workspace called `build`) is checked on disk.
function needsDiskCheck(ctx, rel) {
  return ctx.incomplete || depthOf(rel) > MAX_DEPTH || rel.split('/').some((seg) => SKIP_DIRS.has(seg));
}

function isFile(ctx, rel) {
  if (ctx.fileSet.has(rel)) return true;
  if (!needsDiskCheck(ctx, rel)) return false;
  try {
    return fs.statSync(path.join(ctx.root, rel)).isFile();
  } catch {
    return false;
  }
}

function isDir(ctx, rel) {
  if (ctx.dirSet.has(rel)) return true;
  if (!needsDiskCheck(ctx, rel)) return false;
  try {
    return fs.statSync(path.join(ctx.root, rel)).isDirectory();
  } catch {
    return false;
  }
}

function readText(ctx, rel) {
  const key = `text:${rel}`;
  if (ctx.cache.has(key)) return ctx.cache.get(key);
  let text = null;
  // Secrets live here. Existence is reported elsewhere; contents are never read.
  if (!/(^|\/)\.env/.test(rel)) {
    try {
      const abs = path.join(ctx.root, rel);
      const stat = fs.statSync(abs);
      if (stat.size > MAX_READ_BYTES) ctx.warnings.push(`skipped large file ${rel}`);
      else text = fs.readFileSync(abs, 'utf8').replace(/^﻿/, '');
    } catch (err) {
      if (err.code !== 'ENOENT') ctx.warnings.push(`cannot read ${rel}: ${err.code || err.message}`);
    }
  }
  ctx.cache.set(key, text);
  return text;
}

function readJson(ctx, rel, { jsonc = false } = {}) {
  const key = `json:${rel}`;
  if (ctx.cache.has(key)) return ctx.cache.get(key);
  let value = null;
  let text = readText(ctx, rel);
  if (text !== null) {
    try {
      if (jsonc) text = stripJsonComments(text);
      const parsed = JSON.parse(text);
      if (isObject(parsed)) value = parsed;
      else ctx.warnings.push(`unexpected JSON shape in ${rel}`);
    } catch {
      ctx.warnings.push(`malformed JSON in ${rel}`);
    }
  }
  ctx.cache.set(key, value);
  return value;
}

// Strips // and /* */ comments plus trailing commas, leaving strings alone.
function stripJsonComments(text) {
  let out = '';
  let quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') quote = false;
    } else if (c === '"') {
      quote = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      out += c;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function readToml(ctx, rel) {
  const key = `toml:${rel}`;
  if (ctx.cache.has(key)) return ctx.cache.get(key);
  let value = null;
  const text = readText(ctx, rel);
  if (text !== null) {
    try {
      value = parseToml(text);
    } catch {
      ctx.warnings.push(`malformed TOML in ${rel}`);
    }
  }
  ctx.cache.set(key, value);
  return value;
}

function readGoMod(ctx, rel) {
  const text = readText(ctx, rel);
  return text === null ? null : parseGoMod(text);
}

// All files named `name` in the walk or in workspace member dirs, shallowest first.
function manifestPaths(ctx, name) {
  const found = new Set(ctx.files.filter((f) => baseName(f) === name));
  for (const member of ctx.workspaces.slice(0, MAX_MEMBER_MANIFESTS)) {
    const rel = joinRel(member, name);
    if (isFile(ctx, rel)) found.add(rel);
  }
  return [...found].sort(byDepthThenPath);
}

// A declared workspace member is never skipped, even when its name is on the skip list
// (packages/build, packages/dist). The main walk missed it, so list its files now.
function walkHiddenMembers(ctx) {
  const hidden = ctx.workspaces.filter((m) => !ctx.dirSet.has(m) && m.split('/').some((seg) => SKIP_DIRS.has(seg)));
  for (const member of hidden.slice(0, 50)) {
    const extra = walk(ctx.root, ctx.warnings, [member], 300);
    for (const d of [member, ...extra.dirs]) {
      if (!ctx.dirSet.has(d)) {
        ctx.dirSet.add(d);
        ctx.dirs.push(d);
      }
    }
    for (const f of extra.files) {
      if (!ctx.fileSet.has(f)) {
        ctx.fileSet.add(f);
        ctx.files.push(f);
      }
    }
  }
}

// Run one detection stage; a bug or odd input in it costs a warning, not the whole report.
function safe(ctx, label, fn, fallback) {
  try {
    return fn();
  } catch (err) {
    ctx.warnings.push(`${label} detection failed: ${err && err.message ? err.message : err}`);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Workspaces and layout
// ---------------------------------------------------------------------------

// Subdirectories of `dir`, read from disk (workspace globs must not depend on the walk budget).
function listSubdirs(ctx, dir, { dotDirs = false, skipNamed = false } = {}) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(ctx.root, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git')
    .filter((e) => dotDirs || !e.name.startsWith('.'))
    .filter((e) => !skipNamed || !SKIP_DIRS.has(e.name))
    .map((e) => joinRel(dir, e.name))
    .sort(sortStr);
}

// Directories matching one workspace pattern such as "packages/*", "apps/**" or "tools/cli".
function expandWorkspacePattern(ctx, pattern) {
  let current = [''];
  for (const seg of pattern.split('/').filter(Boolean)) {
    let next = [];
    if (seg === '**') {
      // Zero or more directory levels, bounded.
      const all = new Set(current);
      let frontier = current;
      for (let level = 0; level < 4 && all.size < MAX_WORKSPACES; level++) {
        frontier = frontier.flatMap((d) => listSubdirs(ctx, d, { skipNamed: true }));
        frontier.forEach((d) => all.add(d));
      }
      next = [...all];
    } else if (!/[*?]/.test(seg)) {
      next = current.map((d) => joinRel(d, seg)).filter((d) => isDir(ctx, d));
    } else {
      const re = new RegExp(`^${globToRegex(seg)}$`);
      const dotDirs = seg.startsWith('.');
      next = current.flatMap((d) => listSubdirs(ctx, d, { dotDirs })).filter((d) => re.test(baseName(d)));
    }
    current = next.slice(0, MAX_WORKSPACES);
    if (!current.length) break;
  }
  return current.filter(Boolean);
}

// Expand workspace patterns on disk; members must contain one of `required`.
function resolveMembers(ctx, patterns, required) {
  const include = [];
  const exclude = [];
  for (const raw of strings(patterns)) {
    const p = raw.trim().replace(/^\.\//, '').replace(/\/+$/, '');
    if (!p || p === '.') continue;
    if (p.startsWith('!')) exclude.push(p.slice(1));
    else include.push(p);
  }
  const excluded = exclude.map((g) => new RegExp(`^${globToRegex(g)}$`));
  const found = new Set();
  for (const pattern of include) for (const d of expandWorkspacePattern(ctx, pattern)) found.add(d);
  const needs = Array.isArray(required) ? required : [required];
  return [...found]
    .filter((d) => !excluded.some((re) => re.test(d)))
    .filter((d) => needs.some((f) => isFile(ctx, joinRel(d, f))))
    .sort(sortStr);
}

function detectWorkspaces(ctx) {
  const members = [];
  let marker = false;

  const pkg = isFile(ctx, 'package.json') ? readJson(ctx, 'package.json') : null;
  if (pkg && pkg.workspaces) {
    marker = true;
    const patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages;
    members.push(...resolveMembers(ctx, patterns, 'package.json'));
  }

  if (isFile(ctx, 'pnpm-workspace.yaml')) {
    marker = true;
    const text = readText(ctx, 'pnpm-workspace.yaml');
    if (text) members.push(...resolveMembers(ctx, yamlTopList(text, 'packages'), 'package.json'));
  }

  if (isFile(ctx, 'lerna.json')) {
    marker = true;
    const lerna = readJson(ctx, 'lerna.json');
    const patterns = lerna && Array.isArray(lerna.packages) ? lerna.packages : ['packages/*'];
    members.push(...resolveMembers(ctx, patterns, 'package.json'));
  }

  if (isFile(ctx, 'turbo.json')) marker = true;

  if (isFile(ctx, 'nx.json')) {
    marker = true;
    for (const f of ctx.files) {
      if (baseName(f) === 'project.json' && dirName(f)) members.push(dirName(f));
    }
  }

  if (isFile(ctx, 'Cargo.toml')) {
    const ws = tomlTable(readToml(ctx, 'Cargo.toml'), 'workspace');
    if (ws.members) {
      marker = true;
      const patterns = [...strings(ws.members), ...strings(ws.exclude).map((e) => `!${e}`)];
      members.push(...resolveMembers(ctx, patterns, 'Cargo.toml'));
    }
  }

  if (isFile(ctx, 'go.work')) {
    marker = true;
    const text = readText(ctx, 'go.work');
    if (text) members.push(...resolveMembers(ctx, parseGoWork(text), ['go.mod']));
  }

  if (isFile(ctx, 'pyproject.toml')) {
    const uv = tomlTable(readToml(ctx, 'pyproject.toml'), 'tool.uv.workspace');
    if (uv.members) {
      marker = true;
      const patterns = [...strings(uv.members), ...strings(uv.exclude).map((e) => `!${e}`)];
      members.push(...resolveMembers(ctx, patterns, 'pyproject.toml'));
    }
  }

  const unique = uniqSorted(members);
  if (unique.length > MAX_WORKSPACES) ctx.warnings.push(`more than ${MAX_WORKSPACES} workspace members; the list was cut`);
  return { workspaces: unique.slice(0, MAX_WORKSPACES), marker };
}

// ---------------------------------------------------------------------------
// Languages and primary ecosystem
// ---------------------------------------------------------------------------

const EXT_LANGUAGE = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.rs': 'rust', '.go': 'go',
  '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.scala': 'scala',
  '.rb': 'ruby', '.cs': 'csharp', '.php': 'php', '.swift': 'swift', '.dart': 'dart',
  '.ex': 'elixir', '.exs': 'elixir',
  '.c': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp',
};

// Languages whose only manifest evidence is a fixed file name.
const LANGUAGE_MANIFESTS = {
  python: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile'],
  rust: ['Cargo.toml', 'rust-toolchain.toml'],
  go: ['go.mod', 'go.work'],
  ruby: ['Gemfile'],
  php: ['composer.json'],
  swift: ['Package.swift'],
  dart: ['pubspec.yaml'],
  elixir: ['mix.exs'],
};

const JVM_MANIFESTS = ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'build.sbt'];
const CPP_MANIFESTS = ['CMakeLists.txt', 'meson.build'];
const DOTNET_EXTS = ['.csproj', '.fsproj', '.sln', '.slnx'];

function countLanguages(ctx) {
  const counts = new Map();
  const firstExt = new Map();
  for (const f of ctx.files) {
    const base = baseName(f);
    if (base.endsWith('.gradle.kts')) continue; // build scripts, not Kotlin sources
    const ext = path.extname(base);
    const lang = EXT_LANGUAGE[ext];
    if (!lang) continue;
    counts.set(lang, (counts.get(lang) || 0) + 1);
    if (!firstExt.has(lang)) firstExt.set(lang, ext);
  }
  return { counts, firstExt };
}

function evidenceFiles(ctx, match, limit = 5) {
  const test = typeof match === 'function' ? match : (f) => match.includes(baseName(f));
  return ctx.files.filter(test).sort(byDepthThenPath).slice(0, limit);
}

function detectLanguages(ctx) {
  const { counts, firstExt } = countLanguages(ctx);
  const found = new Map();
  const add = (name, evidence) => {
    const entry = found.get(name) || { name, evidence: [], files: counts.get(name) || 0 };
    entry.evidence.push(...evidence);
    found.set(name, entry);
  };

  const pkg = evidenceFiles(ctx, ['package.json'], 1);
  const tsconfigs = evidenceFiles(ctx, (f) => /^tsconfig(\..+)?\.json$/.test(baseName(f)), 2);
  const deno = evidenceFiles(ctx, ['deno.json', 'deno.jsonc'], 1);
  const hasTs = (counts.get('typescript') || 0) > 0 || tsconfigs.length > 0 || deno.length > 0;
  const hasJs = (counts.get('javascript') || 0) > 0 || (pkg.length > 0 && !hasTs);
  if (hasTs) add('typescript', [...pkg, ...tsconfigs, ...deno]);
  if (hasJs) add('javascript', hasTs ? [] : pkg);

  for (const [lang, names] of Object.entries(LANGUAGE_MANIFESTS)) {
    const ev = evidenceFiles(ctx, names);
    if (ev.length || counts.get(lang)) add(lang, ev);
  }

  // Build files belong to whichever JVM language has the most sources (java when unknown).
  const jvm = evidenceFiles(ctx, JVM_MANIFESTS);
  if (jvm.length) {
    const lead = ['java', 'kotlin', 'scala'].reduce((best, lang) => ((counts.get(lang) || 0) > (counts.get(best) || 0) ? lang : best), 'java');
    add(lead, jvm);
  }
  const cmake = evidenceFiles(ctx, CPP_MANIFESTS);
  if (cmake.length) add((counts.get('c') || 0) > (counts.get('cpp') || 0) ? 'c' : 'cpp', cmake);

  const dotnet = evidenceFiles(ctx, (f) => DOTNET_EXTS.includes(path.extname(f)));
  if (dotnet.length) add('csharp', dotnet);

  // Anything seen only through file extensions.
  for (const [lang, n] of counts) if (n > 0) add(lang, []);

  const languages = [...found.values()].map((entry) => ({
    name: entry.name,
    evidence: entry.evidence.length
      ? uniqSorted(entry.evidence).slice(0, 5)
      : [`*${firstExt.get(entry.name) || ''}`],
    files: entry.files,
  }));
  return languages.sort((a, b) => b.files - a.files || sortStr(a.name, b.name));
}

const ECOSYSTEM_ORDER = ['node', 'deno', 'python', 'rust', 'go', 'jvm', 'ruby', 'dotnet', 'php', 'swift', 'dart', 'elixir', 'cpp'];
const LANGUAGE_ECOSYSTEM = {
  typescript: 'node', javascript: 'node', python: 'python', rust: 'rust', go: 'go',
  java: 'jvm', kotlin: 'jvm', scala: 'jvm', ruby: 'ruby', csharp: 'dotnet', php: 'php',
  swift: 'swift', dart: 'dart', elixir: 'elixir', c: 'cpp', cpp: 'cpp',
};
const ROOT_MANIFESTS = {
  node: ['package.json'],
  deno: ['deno.json', 'deno.jsonc'],
  python: LANGUAGE_MANIFESTS.python,
  rust: ['Cargo.toml'],
  go: ['go.mod'],
  jvm: JVM_MANIFESTS,
  ruby: ['Gemfile'],
  php: ['composer.json'],
  swift: ['Package.swift'],
  dart: ['pubspec.yaml'],
  elixir: ['mix.exs'],
  cpp: CPP_MANIFESTS,
};

// A root manifest outranks file counts, which outrank the fixed ecosystem order.
function detectPrimary(ctx, languages) {
  const denoOnly = !isFile(ctx, 'package.json') && (isFile(ctx, 'deno.json') || isFile(ctx, 'deno.jsonc'));
  const stats = new Map();
  const touch = (eco) => {
    if (!stats.has(eco)) stats.set(eco, { files: 0, root: false });
    return stats.get(eco);
  };
  for (const lang of languages) {
    let eco = LANGUAGE_ECOSYSTEM[lang.name];
    if (!eco) continue;
    if (eco === 'node' && denoOnly) eco = 'deno';
    touch(eco).files += lang.files;
  }
  for (const [eco, names] of Object.entries(ROOT_MANIFESTS)) {
    if (names.some((n) => isFile(ctx, n))) touch(eco).root = true;
  }
  if (ctx.files.some((f) => !f.includes('/') && DOTNET_EXTS.includes(path.extname(f)))) touch('dotnet').root = true;
  if (denoOnly) stats.delete('node');
  else stats.delete('deno');

  const ranked = [...stats.entries()].sort(([ea, a], [eb, b]) => {
    return (
      Number(b.root) - Number(a.root) ||
      b.files - a.files ||
      ECOSYSTEM_ORDER.indexOf(ea) - ECOSYSTEM_ORDER.indexOf(eb)
    );
  });
  return ranked.length ? ranked[0][0] : 'unknown';
}

// ---------------------------------------------------------------------------
// Package managers
// ---------------------------------------------------------------------------

const NODE_LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'], ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'],
  ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'], // bun.lockb is only ever stat'ed
];
const NODE_PM_NAMES = ['pnpm', 'npm', 'yarn', 'bun'];
// With conflicting lockfiles and no `packageManager` field, prefer the less default tool:
// a stray package-lock.json is the usual accident.
const NODE_PM_PREFERENCE = ['pnpm', 'bun', 'yarn', 'npm'];

const PYTHON_LOCKFILES = [['uv.lock', 'uv'], ['poetry.lock', 'poetry'], ['pdm.lock', 'pdm'], ['Pipfile.lock', 'pip']];

// "pnpm@10.8.0+sha512.abc" -> "10.8.0", but only when the field names the detected manager.
function packageManagerVersion(ctx, pm) {
  const dir = nodeProjectDir(ctx);
  if (!pm || dir === null) return null;
  const pkg = readJson(ctx, joinRel(dir, 'package.json'));
  const m = pkg && typeof pkg.packageManager === 'string' ? pkg.packageManager.match(/^([^@]+)@([^+]+)/) : null;
  return m && m[1] === pm ? m[2] : null;
}

// Where Node commands should run from: the root, or the first nested package.json.
function nodeProjectDir(ctx) {
  if (isFile(ctx, 'package.json')) return '';
  const nested = manifestPaths(ctx, 'package.json')[0];
  return nested ? dirName(nested) : null;
}

function detectNodePm(ctx) {
  const dir = nodeProjectDir(ctx);
  if (dir === null) return null;
  const pkg = readJson(ctx, joinRel(dir, 'package.json'));
  const where = (f) => joinRel(dir, f);

  const fieldName = pkg && typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : null;
  const field = NODE_PM_NAMES.includes(fieldName) ? fieldName : null;

  const locks = NODE_LOCKFILES.filter(([file]) => isFile(ctx, where(file)));
  const lockPms = uniqSorted(locks.map(([, pm]) => pm));
  if (lockPms.length > 1) {
    ctx.warnings.push(
      `multiple lockfiles (${locks.map(([f]) => where(f)).join(', ')}): ${lockPms.join(' vs ')}; ask which package manager is canonical`,
    );
  }
  if (field && lockPms.length && !lockPms.includes(field)) {
    ctx.warnings.push(`packageManager field says ${field} but lockfile(s) say ${lockPms.join(', ')}`);
  }
  if (field) return field;
  if (lockPms.length) return NODE_PM_PREFERENCE.find((pm) => lockPms.includes(pm));

  if (isFile(ctx, where('pnpm-workspace.yaml'))) return 'pnpm';
  if (isFile(ctx, where('.yarnrc.yml')) || isFile(ctx, where('.yarnrc'))) return 'yarn';
  if (isFile(ctx, where('bunfig.toml'))) return 'bun';
  ctx.warnings.push('package.json found but no lockfile or packageManager field; commands are rendered with npm');
  return null;
}

function detectPythonPm(ctx) {
  const locks = PYTHON_LOCKFILES.filter(([file]) => isFile(ctx, file));
  const lockPms = uniqSorted(locks.map(([, pm]) => pm));
  if (lockPms.length > 1) {
    ctx.warnings.push(`multiple Python lockfiles (${locks.map(([f]) => f).join(', ')}): ${lockPms.join(' vs ')}`);
  }
  if (lockPms.length) return ['uv', 'poetry', 'pdm', 'pip'].find((pm) => lockPms.includes(pm));

  const toml = isFile(ctx, 'pyproject.toml') ? readToml(ctx, 'pyproject.toml') : null;
  if (toml) {
    if (toml['tool.uv'] || toml['tool.uv.workspace']) return 'uv';
    if (toml['tool.poetry'] || toml['tool.poetry.dependencies']) return 'poetry';
    if (toml['tool.pdm']) return 'pdm';
    if (toml['tool.hatch'] || Object.keys(toml).some((t) => t.startsWith('tool.hatch.'))) return 'hatch';
  }
  if (isFile(ctx, 'requirements.txt') || isFile(ctx, 'pyproject.toml') || isFile(ctx, 'setup.py')) return 'pip';
  return null;
}

function detectJvmPm(ctx) {
  const gradle = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradlew']
    .some((f) => isFile(ctx, f));
  const maven = isFile(ctx, 'pom.xml');
  if (gradle && maven) ctx.warnings.push('both Gradle and Maven build files found');
  return gradle ? 'gradle' : maven ? 'maven' : null;
}

// Yarn 2+ (Berry) dropped `--cwd`; it is recognised by the packageManager field or .yarnrc.yml.
function isYarnBerry(ctx, nodePm) {
  if (nodePm !== 'yarn') return false;
  const version = packageManagerVersion(ctx, 'yarn');
  if (version) return Number.parseInt(version, 10) >= 2;
  return isFile(ctx, '.yarnrc.yml');
}

function detectPackageManagers(ctx, primary) {
  const byEcosystem = {
    node: safe(ctx, 'node package manager', () => detectNodePm(ctx), null),
    python: safe(ctx, 'python package manager', () => detectPythonPm(ctx), null),
  };
  const overall = {
    node: byEcosystem.node,
    python: byEcosystem.python,
    rust: isFile(ctx, 'Cargo.toml') ? 'cargo' : null,
    go: isFile(ctx, 'go.mod') || isFile(ctx, 'go.work') ? 'go' : null,
    jvm: safe(ctx, 'jvm package manager', () => detectJvmPm(ctx), null),
    ruby: isFile(ctx, 'Gemfile') ? 'bundler' : null,
    php: isFile(ctx, 'composer.json') ? 'composer' : null,
    dotnet: 'dotnet',
  }[primary];
  return { ...byEcosystem, primary: overall || null, yarnBerry: isYarnBerry(ctx, byEcosystem.node) };
}

// ---------------------------------------------------------------------------
// Frameworks and tools from dependency manifests
// ---------------------------------------------------------------------------

const NODE_FRAMEWORKS = {
  next: 'next', react: 'react', vite: 'vite', astro: 'astro', nuxt: 'nuxt',
  '@remix-run/react': 'remix', '@remix-run/node': 'remix', '@remix-run/dev': 'remix',
  'react-router': 'react-router', 'react-router-dom': 'react-router', '@react-router/dev': 'react-router',
  svelte: 'svelte', '@sveltejs/kit': 'sveltekit', vue: 'vue', '@angular/core': 'angular',
  express: 'express', fastify: 'fastify', hono: 'hono', '@nestjs/core': 'nestjs',
  tailwindcss: 'tailwindcss', prisma: 'prisma', '@prisma/client': 'prisma', 'drizzle-orm': 'drizzle-orm',
  vitest: 'vitest', jest: 'jest', playwright: 'playwright', '@playwright/test': 'playwright',
  eslint: 'eslint', '@biomejs/biome': 'biome', prettier: 'prettier', turbo: 'turbo', nx: 'nx',
  typescript: 'typescript', zod: 'zod', '@trpc/server': '@trpc/server', 'react-native': 'react-native', expo: 'expo',
};
const PYTHON_FRAMEWORKS = new Set(['django', 'fastapi', 'flask', 'pydantic', 'sqlalchemy', 'pytest', 'ruff', 'mypy']);
const PYTHON_TOOL_SECTIONS = { 'tool.ruff': 'ruff', 'tool.mypy': 'mypy', 'tool.pytest.ini_options': 'pytest', 'tool.pytest': 'pytest' };
const RUST_FRAMEWORKS = new Set(['tokio', 'axum', 'actix-web', 'serde', 'reqwest', 'sqlx', 'rand']);
const GO_FRAMEWORKS = [
  ['github.com/gin-gonic/gin', 'gin'], ['github.com/labstack/echo', 'echo'],
  ['github.com/go-chi/chi', 'chi'], ['github.com/gofiber/fiber', 'fiber'],
];

// pnpm/yarn catalogs: `catalog:` (default) and `catalogs:` (named) maps in pnpm-workspace.yaml or .yarnrc.yml.
function yamlCatalogs(text) {
  const out = { default: {}, named: {} };
  let section = null;
  let named = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripHashComment(raw, true);
    if (!line.trim()) continue;
    const indent = indentOf(line);
    if (indent === 0) {
      const m = line.match(/^(catalog|catalogs):/);
      section = m ? m[1] : null;
      named = null;
      continue;
    }
    const kv = section && line.trim().match(/^("[^"]+"|'[^']+'|[^:\s][^:]*?):\s*(.*)$/);
    if (!kv) continue;
    const key = unquote(kv[1]);
    const value = unquote(kv[2].trim());
    if (section === 'catalog') {
      if (value) out.default[key] = value;
    } else if (!value && indent <= 2) {
      named = out.named[key] = out.named[key] || {};
    } else if (named && value) {
      named[key] = value;
    }
  }
  return out;
}

function loadCatalogs(ctx) {
  if (ctx.cache.has('catalogs')) return ctx.cache.get('catalogs');
  const merged = { default: {}, named: {} };
  for (const file of ['pnpm-workspace.yaml', '.yarnrc.yml']) {
    const text = isFile(ctx, file) ? readText(ctx, file) : null;
    if (!text) continue;
    const c = yamlCatalogs(text);
    Object.assign(merged.default, c.default);
    for (const [name, map] of Object.entries(c.named)) merged.named[name] = { ...(merged.named[name] || {}), ...map };
  }
  const pkg = isFile(ctx, 'package.json') ? readJson(ctx, 'package.json') : null;
  const ws = pkg && isObject(pkg.workspaces) ? pkg.workspaces : {};
  for (const source of [pkg || {}, ws]) {
    if (isObject(source.catalog)) Object.assign(merged.default, source.catalog);
    if (isObject(source.catalogs)) {
      for (const [name, map] of Object.entries(source.catalogs)) {
        if (isObject(map)) merged.named[name] = { ...(merged.named[name] || {}), ...map };
      }
    }
  }
  ctx.cache.set('catalogs', merged);
  return merged;
}

// "catalog:" / "catalog:name" -> the version from the catalog, or the raw specifier when unknown.
function resolveCatalogSpec(ctx, dep, spec) {
  if (typeof spec !== 'string' || !spec.startsWith('catalog:')) return spec;
  const name = spec.slice('catalog:'.length).trim();
  const catalogs = loadCatalogs(ctx);
  const map = !name || name === 'default' ? { ...catalogs.named.default, ...catalogs.default } : catalogs.named[name] || {};
  return typeof map[dep] === 'string' ? map[dep] : spec;
}

function nodeFrameworks(ctx, rel) {
  const pkg = readJson(ctx, rel);
  if (!pkg) return [];
  const out = [];
  const seen = new Set();
  // Earlier fields win when a package is listed in several.
  const fields = [['dependencies', 'runtime'], ['optionalDependencies', 'optional'], ['peerDependencies', 'peer'], ['devDependencies', 'dev']];
  for (const [field, group] of fields) {
    if (!isObject(pkg[field])) continue;
    for (const [dep, version] of Object.entries(pkg[field])) {
      const name = NODE_FRAMEWORKS[dep];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, dep, group, version: typeof version === 'string' ? resolveCatalogSpec(ctx, dep, version) : null, where: rel });
    }
  }
  return out;
}

// "fastapi[standard]>=0.115 ; python_version>'3'" -> { name: "fastapi", version: ">=0.115" }
function parsePep508(spec) {
  const m = spec.split(';')[0].trim().match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$/);
  if (!m) return null;
  const version = m[2].replace(/^\(|\)$/g, '').trim();
  return { name: m[1].toLowerCase().replace(/_/g, '-'), version: version || null };
}

// Dependency groups named like "test"/"tests" are test-only; other named groups are dev tooling.
const namedGroup = (name) => (/test/i.test(name) ? 'test' : 'dev');

// [{ spec, group }] from every place a pyproject can declare dependencies.
function pythonDependencySpecs(toml) {
  const specs = [];
  const add = (list, group) => specs.push(...strings(list).map((spec) => ({ spec, group })));
  const project = tomlTable(toml, 'project');
  add(project.dependencies, 'runtime');
  for (const [key, value] of Object.entries(project)) {
    if (key.startsWith('optional-dependencies.')) add(value, 'optional');
  }
  for (const list of Object.values(tomlTable(toml, 'project.optional-dependencies'))) add(list, 'optional');
  for (const [name, list] of Object.entries(tomlTable(toml, 'dependency-groups'))) add(list, namedGroup(name));
  add(tomlTable(toml, 'tool.uv')['dev-dependencies'], 'dev');
  for (const [name, list] of Object.entries(tomlTable(toml, 'tool.pdm.dev-dependencies'))) add(list, namedGroup(name));

  // Poetry keys are names; values are a version string or an inline table.
  for (const [table, entries] of Object.entries(toml)) {
    let group = null;
    if (table === 'tool.poetry.dependencies') group = 'runtime';
    else if (table === 'tool.poetry.dev-dependencies') group = 'dev';
    else {
      const m = table.match(/^tool\.poetry\.group\.([^.]+)\.dependencies$/);
      if (m) group = namedGroup(m[1]);
    }
    if (!group) continue;
    for (const [name, value] of Object.entries(entries)) {
      const version = typeof value === 'string' ? value : isObject(value) ? value.version : '';
      specs.push({ spec: `${name} ${typeof version === 'string' ? version : ''}`, group });
    }
  }
  return specs;
}

const PYTHON_TOOL_GROUP = { ruff: 'dev', mypy: 'dev', pytest: 'test' };

function pythonFrameworksFromToml(ctx, rel) {
  const toml = readToml(ctx, rel);
  if (!toml) return [];
  const out = [];
  const seen = new Set();
  for (const { spec, group } of pythonDependencySpecs(toml)) {
    const dep = parsePep508(spec);
    if (dep && PYTHON_FRAMEWORKS.has(dep.name)) {
      seen.add(dep.name);
      out.push({ name: dep.name, dep: dep.name, group, version: dep.version, where: rel });
    }
  }
  for (const [section, name] of Object.entries(PYTHON_TOOL_SECTIONS)) {
    if (toml[section] && !seen.has(name)) {
      seen.add(name);
      out.push({ name, dep: name, group: PYTHON_TOOL_GROUP[name], version: null, where: rel });
    }
  }
  return out;
}

function pythonFrameworksFromRequirements(ctx, rel) {
  const text = readText(ctx, rel);
  if (!text) return [];
  const out = [];
  const file = baseName(rel);
  const group = /test/i.test(file) ? 'test' : /dev/i.test(file) ? 'dev' : 'runtime';
  for (const line of text.split(/\r?\n/)) {
    const clean = stripHashComment(line, true).trim();
    if (!clean || clean.startsWith('-')) continue;
    const dep = parsePep508(clean);
    if (dep && PYTHON_FRAMEWORKS.has(dep.name)) out.push({ name: dep.name, dep: dep.name, group, version: dep.version, where: rel });
  }
  return out;
}

function cargoVersion(value) {
  if (typeof value === 'string') return value;
  if (isObject(value) && typeof value.version === 'string') return value.version;
  return null;
}

function rustFrameworks(ctx, rel) {
  const toml = readToml(ctx, rel);
  if (!toml) return [];
  const out = [];
  const add = (name, version, group) => {
    if (RUST_FRAMEWORKS.has(name)) out.push({ name, dep: name, group, version, where: rel });
  };
  const tables = [['dependencies', 'runtime'], ['workspace.dependencies', 'runtime'], ['dev-dependencies', 'dev'], ['build-dependencies', 'dev']];
  for (const [table, group] of tables) {
    for (const [key, value] of Object.entries(tomlTable(toml, table))) {
      const [name, sub] = key.split('.');
      // `tokio.workspace = true` has no version of its own.
      add(name, sub === undefined || sub === 'version' ? cargoVersion(value) : null, group);
    }
  }
  // `[dependencies.tokio]` style tables.
  for (const [table, entries] of Object.entries(toml)) {
    const m = table.match(/^(workspace\.)?(dev-|build-)?dependencies\.(.+)$/);
    if (m) add(m[3], cargoVersion(entries), m[2] ? 'dev' : 'runtime');
  }
  return out;
}

function goFrameworks(ctx, rel) {
  const mod = readGoMod(ctx, rel);
  if (!mod) return [];
  const out = [];
  for (const req of mod.requires) {
    for (const [prefix, name] of GO_FRAMEWORKS) {
      if (req.path === prefix || req.path.startsWith(`${prefix}/`)) out.push({ name, dep: req.path, version: req.version, where: rel });
    }
  }
  return out;
}

function rubyFrameworks(ctx, rel) {
  const text = readText(ctx, rel);
  if (!text) return [];
  const m = text.match(/^\s*gem\s+['"]rails['"](?:\s*,\s*['"]([^'"]+)['"])?/m);
  if (!m) return [];
  let version = m[1] || null;
  if (!version) {
    // No constraint in the Gemfile: the resolved version in Gemfile.lock is the declared truth.
    const lockRel = joinRel(dirName(rel), 'Gemfile.lock');
    const lock = isFile(ctx, lockRel) ? readText(ctx, lockRel) : null;
    const resolved = lock && lock.match(/^ {4}rails \((\d[^)]*)\)/m);
    version = resolved ? resolved[1] : null;
  }
  return [{ name: 'rails', group: 'runtime', version, where: rel }];
}

function phpFrameworks(ctx, rel) {
  const composer = readJson(ctx, rel);
  if (!composer) return [];
  const out = [];
  for (const [field, group] of [['require', 'runtime'], ['require-dev', 'dev']]) {
    const deps = isObject(composer[field]) ? composer[field] : {};
    if (deps['laravel/framework']) out.push({ name: 'laravel', group, version: deps['laravel/framework'], where: rel });
    const symfony = ['symfony/framework-bundle', 'symfony/symfony'].find((d) => deps[d]);
    if (symfony) out.push({ name: 'symfony', group, version: deps[symfony], where: rel });
  }
  return out;
}

// Best effort: Spring Boot version from a Maven parent or BOM, a Gradle plugin, buildscript
// dependency or BOM, or a Gradle version catalog. Null when the version is not spelled out.
function jvmFrameworks(ctx, rel) {
  const text = readText(ctx, rel);
  if (!text || !/spring-?boot|org\.springframework\.boot/i.test(text)) return [];
  let version = null;
  if (baseName(rel) === 'libs.versions.toml') {
    const toml = parseToml(text);
    const versions = tomlTable(toml, 'versions');
    const key = Object.keys(versions).find((k) => /^spring-?boot$/i.test(k));
    version = key ? versions[key] : null;
    for (const entry of Object.values(tomlTable(toml, 'plugins'))) {
      if (isObject(entry) && entry.id === 'org.springframework.boot' && typeof entry.version === 'string') version = entry.version;
    }
  } else {
    const patterns = [
      /spring-boot-starter-parent<\/artifactId>\s*<version>([^<]+)</,
      /spring-boot-dependencies<\/artifactId>\s*<version>([^<]+)</,
      /<spring-boot\.version>([^<]+)</,
      /org\.springframework\.boot['"]\)?\s+version\s+['"]([^'"]+)['"]/,
      /org\.springframework\.boot:spring-boot-(?:gradle-plugin|dependencies):([\w.-]+)/,
      /springBootVersion\s*=\s*['"]([^'"]+)['"]/,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        version = m[1].trim();
        break;
      }
    }
    // Maven property reference such as ${spring.boot.version}.
    const ref = version && version.match(/^\$\{(.+)\}$/);
    if (ref) {
      const prop = text.match(new RegExp(`<${ref[1].replace(/[.]/g, '\\.')}>([^<]+)<`));
      version = prop ? prop[1].trim() : null;
    }
  }
  return [{ name: 'spring-boot', group: 'runtime', version: typeof version === 'string' ? version : null, where: rel }];
}

const normalizePyName = (name) => name.toLowerCase().replace(/_/g, '-');
const stripGoMajor = (modulePath) => modulePath.replace(/\/v\d+$/, '');

// Packages this repo defines itself, so they are not reported as its own dependencies
// (create-t3-app is not a "next" project because a sibling depends on next, chi is not "chi" via its examples).
function localPackageNames(ctx) {
  const names = new Set();
  for (const rel of manifestPaths(ctx, 'package.json')) {
    const pkg = readJson(ctx, rel);
    if (pkg && typeof pkg.name === 'string') names.add(`node:${pkg.name}`);
  }
  for (const rel of manifestPaths(ctx, 'pyproject.toml')) {
    const toml = readToml(ctx, rel);
    const name = tomlTable(toml, 'project').name ?? tomlTable(toml, 'tool.poetry').name;
    if (typeof name === 'string') names.add(`python:${normalizePyName(name)}`);
  }
  for (const rel of manifestPaths(ctx, 'Cargo.toml')) {
    const name = tomlTable(readToml(ctx, rel), 'package').name;
    if (typeof name === 'string') names.add(`rust:${name}`);
  }
  for (const rel of manifestPaths(ctx, 'go.mod')) {
    const mod = readGoMod(ctx, rel);
    if (mod && mod.module) names.add(`go:${stripGoMajor(mod.module)}`);
  }
  return names;
}

// Ecosystem of a manifest, used to match a dependency against local package names.
function isLocalDependency(local, f) {
  if (!f.dep) return false;
  const file = baseName(f.where);
  if (file === 'package.json') return local.has(`node:${f.dep}`);
  if (file === 'pyproject.toml' || /^requirements/.test(file)) return local.has(`python:${normalizePyName(f.dep)}`);
  if (file === 'Cargo.toml') return local.has(`rust:${f.dep}`);
  if (file === 'go.mod') return local.has(`go:${stripGoMajor(f.dep)}`);
  return false;
}

const GROUP_ORDER = ['runtime', 'optional', 'peer', 'dev', 'test'];

function collectFrameworks(ctx) {
  const found = [];
  const scan = (name, fn) => {
    for (const rel of manifestPaths(ctx, name)) found.push(...safe(ctx, `frameworks in ${rel}`, () => fn(ctx, rel), []));
  };
  scan('package.json', nodeFrameworks);
  scan('pyproject.toml', pythonFrameworksFromToml);
  for (const rel of ctx.files.filter((f) => /^requirements([-_.].+)?\.txt$/.test(baseName(f)))) {
    found.push(...safe(ctx, `frameworks in ${rel}`, () => pythonFrameworksFromRequirements(ctx, rel), []));
  }
  scan('Cargo.toml', rustFrameworks);
  scan('go.mod', goFrameworks);
  scan('Gemfile', rubyFrameworks);
  scan('composer.json', phpFrameworks);
  for (const name of ['pom.xml', 'build.gradle', 'build.gradle.kts', 'libs.versions.toml']) scan(name, jvmFrameworks);

  // One entry per framework, taken from the shallowest manifest that declares a version.
  const local = localPackageNames(ctx);
  const byName = new Map();
  for (const f of found.filter((x) => !isLocalDependency(local, x))) {
    if (!byName.has(f.name)) byName.set(f.name, []);
    byName.get(f.name).push(f);
  }
  const out = [];
  for (const [name, entries] of byName) {
    for (const e of entries) e.parsed = splitRange(e.version);
    entries.sort((a, b) => Number(a.parsed.version === null) - Number(b.parsed.version === null) || byDepthThenPath(a.where, b.where));
    const first = entries[0];
    const { version, range } = first.parsed;
    // The strongest role wins: a package that is runtime anywhere is a runtime dependency.
    const group = entries.map((e) => e.group || 'runtime').sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b))[0];
    out.push({
      name,
      version,
      range,
      group,
      where: first.where,
      alsoIn: uniqSorted(entries.slice(1).map((e) => e.where).filter((w) => w !== first.where)).slice(0, 20),
    });
  }
  return out.sort((a, b) => sortStr(a.name, b.name));
}

// ---------------------------------------------------------------------------
// Language versions
// ---------------------------------------------------------------------------

const firstLine = (text) => (text || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || null;

function nodeVersion(ctx) {
  for (const rel of manifestPaths(ctx, 'package.json')) {
    const pkg = readJson(ctx, rel);
    if (pkg && isObject(pkg.engines) && typeof pkg.engines.node === 'string') return pkg.engines.node;
  }
  for (const file of ['.nvmrc', '.node-version']) {
    if (isFile(ctx, file)) {
      const line = firstLine(readText(ctx, file));
      if (line) return line.slice(0, 40);
    }
  }
  return null;
}

function pythonVersion(ctx) {
  for (const rel of manifestPaths(ctx, 'pyproject.toml')) {
    const toml = readToml(ctx, rel);
    const required = tomlTable(toml, 'project')['requires-python'];
    if (typeof required === 'string') return required;
    const poetry = tomlTable(toml, 'tool.poetry.dependencies').python;
    if (typeof poetry === 'string') return poetry;
  }
  if (isFile(ctx, '.python-version')) {
    const line = firstLine(readText(ctx, '.python-version'));
    if (line) return line.slice(0, 40);
  }
  return null;
}

function rustVersion(ctx) {
  const out = {};
  for (const rel of manifestPaths(ctx, 'Cargo.toml')) {
    const toml = readToml(ctx, rel);
    for (const table of ['workspace.package', 'package']) {
      const t = tomlTable(toml, table);
      if (!out.edition && typeof t.edition === 'string') out.edition = t.edition;
      if (!out.rustVersion && typeof t['rust-version'] === 'string') out.rustVersion = t['rust-version'];
    }
  }
  if (isFile(ctx, 'rust-toolchain.toml')) {
    const channel = tomlTable(readToml(ctx, 'rust-toolchain.toml'), 'toolchain').channel;
    if (typeof channel === 'string') out.toolchain = channel;
  } else if (isFile(ctx, 'rust-toolchain')) {
    const line = firstLine(readText(ctx, 'rust-toolchain'));
    if (line) out.toolchain = line;
  }
  return Object.keys(out).length ? out : null;
}

function goVersion(ctx) {
  for (const rel of manifestPaths(ctx, 'go.mod')) {
    const mod = readGoMod(ctx, rel);
    if (mod && mod.go) return mod.go;
  }
  return null;
}

function firstMatch(text, patterns) {
  for (const re of patterns) {
    const m = text && text.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

function javaVersion(ctx) {
  const pomRe = [
    /<maven\.compiler\.release>\s*([^<\s]+)\s*</, /<java\.version>\s*([^<\s]+)\s*</,
    /<maven\.compiler\.source>\s*([^<\s]+)\s*</, /<maven\.compiler\.target>\s*([^<\s]+)\s*</,
  ];
  const gradleRe = [
    /JavaLanguageVersion\.of\(\s*(\d+)\s*\)/, /jvmToolchain\(\s*(\d+)\s*\)/,
    /(?:source|target)Compatibility\s*=\s*JavaVersion\.VERSION_(\w+)/, /(?:source|target)Compatibility\s*=\s*['"]?([\d.]+)['"]?/,
  ];
  for (const rel of manifestPaths(ctx, 'pom.xml')) {
    const v = firstMatch(readText(ctx, rel), pomRe);
    if (v && !v.startsWith('${')) return v;
  }
  for (const name of ['build.gradle.kts', 'build.gradle']) {
    for (const rel of manifestPaths(ctx, name)) {
      const v = firstMatch(readText(ctx, rel), gradleRe);
      if (v) return v.replace(/_/g, '.');
    }
  }
  if (isFile(ctx, '.java-version')) return firstLine(readText(ctx, '.java-version'));
  if (isFile(ctx, '.sdkmanrc')) return firstMatch(readText(ctx, '.sdkmanrc'), [/^java\s*=\s*(\S+)/m]);
  return null;
}

function dotnetVersion(ctx) {
  const projects = ctx.files.filter((f) => /\.(cs|fs)proj$/.test(f) || baseName(f) === 'Directory.Build.props').sort(byDepthThenPath);
  for (const rel of projects) {
    const v = firstMatch(readText(ctx, rel), [/<TargetFrameworks?>\s*([^<;\s]+)/]);
    if (v) return v;
  }
  if (isFile(ctx, 'global.json')) {
    const sdk = (readJson(ctx, 'global.json') || {}).sdk;
    if (isObject(sdk) && typeof sdk.version === 'string') return `sdk ${sdk.version}`;
  }
  return null;
}

function rubyVersion(ctx) {
  if (isFile(ctx, '.ruby-version')) {
    const line = firstLine(readText(ctx, '.ruby-version'));
    if (line) return line.replace(/^ruby-/, '');
  }
  if (isFile(ctx, 'Gemfile')) {
    const v = firstMatch(readText(ctx, 'Gemfile'), [/^\s*ruby\s+['"]([^'"]+)['"]/m]);
    if (v) return v;
  }
  return isFile(ctx, '.tool-versions') ? firstMatch(readText(ctx, '.tool-versions'), [/^ruby\s+(\S+)/m]) : null;
}

function phpVersion(ctx) {
  const composer = isFile(ctx, 'composer.json') ? readJson(ctx, 'composer.json') : null;
  return composer && isObject(composer.require) && typeof composer.require.php === 'string' ? composer.require.php : null;
}

function detectLanguageVersions(ctx) {
  const out = {};
  const node = safe(ctx, 'node version', () => nodeVersion(ctx), null);
  const python = safe(ctx, 'python version', () => pythonVersion(ctx), null);
  const rust = safe(ctx, 'rust version', () => rustVersion(ctx), null);
  const go = safe(ctx, 'go version', () => goVersion(ctx), null);
  const java = safe(ctx, 'java version', () => javaVersion(ctx), null);
  const dotnet = safe(ctx, 'dotnet version', () => dotnetVersion(ctx), null);
  const ruby = safe(ctx, 'ruby version', () => rubyVersion(ctx), null);
  const php = safe(ctx, 'php version', () => phpVersion(ctx), null);
  if (java) out.java = java;
  if (dotnet) out.dotnet = dotnet;
  if (ruby) out.ruby = ruby;
  if (php) out.php = php;
  if (node) out.node = node;
  if (python) out.python = python;
  if (rust) out.rust = rust;
  if (go) out.go = go;
  return out;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const CATEGORIES = ['build', 'test', 'lint', 'format', 'typecheck', 'dev', 'setup', 'other'];

// Order matters: the first matching rule wins. Works on script names and on command lines.
const CLASSIFY_RULES = [
  ['setup', /^(setup|bootstrap)$/],
  ['typecheck', /type-?check|check-?types|(^|[^a-z])tsc([^a-z]|$)|mypy|pyright/],
  ['lint', /lint|clippy|flake8|rubocop|golangci|go vet|ruff check|biome (check|lint|ci)/],
  ['format', /(^|[^a-z])format|(^|[^a-z])fmt([^a-z]|$)|prettier|(^|[^a-z])black([^a-z]|$)|isort|gofmt|ruff format/],
  ['test', /(^|[^a-z])tests?([^a-z]|$)|pytest|vitest|jest|e2e|nextest|playwright/],
  ['build', /(^|[^a-z])(build|compile|bundle(?!\s+exec))/],
  ['dev', /(^|[\s:_-])(dev|serve|watch|start)($|[\s:_-])/],
];

// Dependency installation, recognised from the command line itself.
const SETUP_COMMAND = new RegExp(
  '^(?:npm\\s+(?:ci|install|i)|pnpm\\s+(?:install|i)|yarn(?=$|\\s+--)|yarn\\s+install|bun\\s+(?:install|i)' +
  '|uv\\s+(?:sync|pip\\s+install)|(?:python3?\\s+-m\\s+)?pip3?\\s+install|poetry\\s+install' +
  '|bundle(?=$|\\s+--)|bundle\\s+install|go\\s+mod\\s+download|cargo\\s+fetch|composer\\s+install)(?:\\s|$)',
);

// Classify a script or target name.
export function classify(name) {
  const lower = name.toLowerCase();
  for (const [category, re] of CLASSIFY_RULES) if (re.test(lower)) return category;
  return 'other';
}

// Classify a command line: installs first, then the name rules. `dev` is skipped because
// flags like --no-dev or --group dev say nothing about starting a dev server.
export function classifyCommand(cmd) {
  const lower = cmd.toLowerCase();
  if (SETUP_COMMAND.test(lower)) return 'setup';
  for (const [category, re] of CLASSIFY_RULES) {
    if (category !== 'dev' && category !== 'setup' && re.test(lower)) return category;
  }
  return 'other';
}

const isCiSource = (source) => source.startsWith('.github/workflows/');
const MAX_CI_WITH_LOCAL = 3; // CI-derived entries per category when local sources exist
const MAX_CI_ONLY = 10;

function createCommands(ctx) {
  const cmds = Object.fromEntries(CATEGORIES.map((c) => [c, []]));
  let capped = false;
  return {
    cmds,
    add(category, cmd, source) {
      const list = cmds[category] || cmds.other;
      const same = list.find((e) => e.cmd === cmd);
      if (same) {
        // Identical command from another source: keep the first, note the rest.
        if (same.source !== source && !(same.alsoIn || []).includes(source) && (same.alsoIn || []).length < 5) {
          same.alsoIn = [...(same.alsoIn || []), source];
        }
        return;
      }
      if (isCiSource(source)) {
        const hasLocal = list.some((e) => !isCiSource(e.source));
        const ciCount = list.filter((e) => isCiSource(e.source)).length;
        if (ciCount >= (hasLocal ? MAX_CI_WITH_LOCAL : MAX_CI_ONLY)) return;
      }
      if (list.length >= MAX_PER_CATEGORY) {
        if (!capped) ctx.warnings.push(`command lists capped at ${MAX_PER_CATEGORY} per category`);
        capped = true;
        return;
      }
      list.push({ cmd, source });
    },
  };
}

// Quote a word for a POSIX shell unless it is plainly safe.
export function shellQuote(word) {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${String(word).replace(/'/g, `'\\''`)}'`;
}

// How to invoke package.json script `name` in `dir` ('' = root) with package manager `pm`.
// Names and dirs come from the repo, so they are quoted before they reach a command line.
function renderScript(pm, name, dir, { berry = false } = {}) {
  const manager = pm || 'npm';
  const n = shellQuote(name);
  const d = shellQuote(dir);
  if (dir) {
    if (manager === 'yarn' && berry) return `cd ${d} && yarn ${n}`; // Berry has no --cwd
    return {
      npm: `npm --prefix ${d} run ${n}`,
      pnpm: `pnpm -C ${d} run ${n}`,
      yarn: `yarn --cwd ${d} ${n}`,
      bun: `bun run --cwd ${d} ${n}`,
    }[manager];
  }
  const lifecycle = name === 'test' || name === 'start';
  return {
    npm: lifecycle ? `npm ${n}` : `npm run ${n}`,
    pnpm: lifecycle ? `pnpm ${n}` : `pnpm run ${n}`,
    yarn: `yarn ${n}`,
    bun: `bun run ${n}`, // `bun test` would be bun's own runner, so always `run`
  }[manager];
}

function nodeProjectDirs(ctx) {
  const dirs = new Set(ctx.workspaces);
  if (isFile(ctx, 'package.json')) dirs.add('');
  // Sub-projects one level down (frontend/, docs/) even without workspace config.
  for (const f of ctx.files) if (depthOf(f) === 2 && baseName(f) === 'package.json') dirs.add(dirName(f));
  // Root first, then by depth.
  return [...dirs].sort((a, b) => Number(b === '') - Number(a === '') || depthOf(a) - depthOf(b) || sortStr(a, b));
}

function addPackageScripts(ctx, out, nodePm, berry) {
  for (const dir of nodeProjectDirs(ctx)) {
    const rel = joinRel(dir, 'package.json');
    const pkg = readJson(ctx, rel);
    if (!pkg || !isObject(pkg.scripts)) continue;
    for (const [name, body] of Object.entries(pkg.scripts)) {
      if (typeof body !== 'string') continue;
      const hook = name.match(/^(pre|post)(.+)$/);
      if (hook && typeof pkg.scripts[hook[2]] === 'string') continue; // lifecycle hook, not user-invoked
      out.add(classify(name), renderScript(nodePm, name, dir, { berry }), `${rel}#scripts.${name}`);
    }
  }
}

function addDenoTasks(ctx, out) {
  for (const file of ['deno.json', 'deno.jsonc']) {
    if (!isFile(ctx, file)) continue;
    const config = readJson(ctx, file, { jsonc: file.endsWith('c') });
    if (!config || !isObject(config.tasks)) continue;
    for (const name of Object.keys(config.tasks)) out.add(classify(name), `deno task ${shellQuote(name)}`, `${file}#tasks.${name}`);
  }
}

function addComposerScripts(ctx, out) {
  const composer = isFile(ctx, 'composer.json') ? readJson(ctx, 'composer.json') : null;
  if (!composer || !isObject(composer.scripts)) return;
  for (const name of Object.keys(composer.scripts)) {
    if (/^(pre|post)-/.test(name)) continue; // composer event hooks
    out.add(classify(name), `composer run ${shellQuote(name)}`, `composer.json#scripts.${name}`);
  }
}

function addMakeTargets(ctx, out) {
  const file = ['Makefile', 'makefile', 'GNUmakefile'].find((f) => isFile(ctx, f));
  const text = file && readText(ctx, file);
  if (!text) return;
  let inDefine = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^define\s/.test(line)) inDefine = true;
    else if (/^endef\b/.test(line)) inDefine = false;
    if (inDefine) continue; // macro bodies are not targets
    const m = line.match(/^([A-Za-z0-9_][A-Za-z0-9_. -]*?)\s*:(?![=:])/);
    if (!m) continue;
    for (const target of m[1].split(/\s+/)) {
      if (!target.startsWith('.')) out.add(classify(target), `make ${target}`, `${file}#${target}`);
    }
  }
}

function addJustRecipes(ctx, out) {
  const file = ['justfile', 'Justfile', '.justfile'].find((f) => isFile(ctx, f));
  const text = file && readText(ctx, file);
  if (!text) return;
  for (const line of text.split(/\r?\n/)) {
    if (/^(set|export|alias|import|mod|default)\b/.test(line)) continue;
    const m = line.match(/^@?([A-Za-z_][\w-]*)[^:\n]*?:(?!=)/);
    if (m) out.add(classify(m[1]), `just ${m[1]}`, `${file}#${m[1]}`);
  }
}

function addTaskfileTasks(ctx, out) {
  const file = ['Taskfile.yml', 'Taskfile.yaml', 'taskfile.yml', 'taskfile.yaml'].find((f) => isFile(ctx, f));
  const text = file && readText(ctx, file);
  if (!text) return;
  for (const name of yamlTaskNames(text)) out.add(classify(name), `task ${name}`, `${file}#${name}`);
}

function addPythonCommands(ctx, out, pythonPm, frameworks) {
  const toml = isFile(ctx, 'pyproject.toml') ? readToml(ctx, 'pyproject.toml') : null;
  if (toml) {
    for (const [table, entries] of Object.entries(toml)) {
      if (table === 'tool.poe.tasks') {
        for (const name of Object.keys(entries)) out.add(classify(name), `poe ${shellQuote(name)}`, `pyproject.toml#tool.poe.tasks.${name}`);
      } else if (table.startsWith('tool.poe.tasks.')) {
        const name = table.slice('tool.poe.tasks.'.length);
        out.add(classify(name), `poe ${shellQuote(name)}`, `pyproject.toml#tool.poe.tasks.${name}`);
      } else if (table === 'project.scripts' || table === 'tool.poetry.scripts') {
        for (const name of Object.keys(entries)) out.add(classify(name), name, `pyproject.toml#${table}.${name}`);
      }
    }
  }
  // Tools the project depends on or configures, run through its environment manager.
  const prefix = { uv: 'uv run ', poetry: 'poetry run ', pdm: 'pdm run ' }[pythonPm] || '';
  const tools = new Map(frameworks.filter((f) => /\.(toml|txt)$/.test(f.where)).map((f) => [f.name, f.where]));
  if (tools.has('pytest')) out.add('test', `${prefix}pytest`, `implied:${tools.get('pytest')}`);
  if (tools.has('ruff')) {
    out.add('lint', `${prefix}ruff check .`, `implied:${tools.get('ruff')}`);
    out.add('format', `${prefix}ruff format .`, `implied:${tools.get('ruff')}`);
  }
  if (tools.has('mypy')) out.add('typecheck', `${prefix}mypy .`, `implied:${tools.get('mypy')}`);
}

function addCargoCommands(ctx, out) {
  if (!isFile(ctx, 'Cargo.toml')) return;
  const source = 'implied:Cargo.toml';
  const ws = ctx.workspaces.length > 0 ? ' --workspace' : '';
  out.add('build', `cargo build${ws}`, source);
  out.add('test', `cargo test${ws}`, source);
  out.add('lint', `cargo clippy${ws} --all-targets`, source);
  out.add('format', ws ? 'cargo fmt --all' : 'cargo fmt', source);
  out.add('typecheck', `cargo check${ws}`, source);
}

function addGoCommands(ctx, out) {
  if (!isFile(ctx, 'go.mod') && !isFile(ctx, 'go.work')) return;
  const source = 'implied:go.mod';
  out.add('build', 'go build ./...', source);
  out.add('test', 'go test ./...', source);
  out.add('lint', 'go vet ./...', source);
}

function addWorkflowCommands(ctx, out, ciFiles) {
  // Workflows that look like the main pipeline go first so they win the per-category cap.
  const main = (f) => /(^|\/)(ci|test|tests|build|check|lint|main)[^/]*\.ya?ml$/.test(f);
  const workflows = ciFiles
    .filter(isCiSource)
    .sort((a, b) => Number(main(b)) - Number(main(a)) || sortStr(a, b));
  for (const rel of workflows) {
    const text = readText(ctx, rel);
    if (!text) continue;
    for (const step of workflowRunSteps(text)) {
      const cmd = step.cmd.trim().slice(0, 200);
      if (step.dir === null || !cmd || !/[a-z]/i.test(cmd) || isNoisyCiCommand(cmd)) continue;
      // Keep the folder: `npm test` run in frontend/ is not the same command as `npm test` at the root.
      out.add(classifyCommand(cmd), step.dir ? `cd ${shellQuote(step.dir)} && ${cmd}` : cmd, rel);
    }
  }
}

// Build and test commands implied by the build files of JVM, .NET, Ruby, PHP, sbt and CMake
// projects. Each one needs its file on disk; wrappers (mvnw, gradlew, bin/rails) win.
function addPlatformCommands(ctx, out) {
  const first = (...files) => files.find((f) => isFile(ctx, f));

  if (isFile(ctx, 'pom.xml')) {
    const mvn = isFile(ctx, 'mvnw') ? './mvnw' : 'mvn';
    out.add('build', `${mvn} verify`, 'implied:pom.xml');
    out.add('test', `${mvn} test`, 'implied:pom.xml');
  }
  const gradleFile = first('build.gradle.kts', 'build.gradle', 'settings.gradle.kts', 'settings.gradle');
  if (gradleFile) {
    const gradle = isFile(ctx, 'gradlew') ? './gradlew' : 'gradle';
    out.add('build', `${gradle} build`, `implied:${gradleFile}`);
    out.add('test', `${gradle} test`, `implied:${gradleFile}`);
    out.add('other', `${gradle} check`, `implied:${gradleFile}`);
  }
  if (isFile(ctx, 'build.sbt')) {
    out.add('build', 'sbt compile', 'implied:build.sbt');
    out.add('test', 'sbt test', 'implied:build.sbt');
  }

  const dotnet = ctx.files.filter((f) => depthOf(f) <= MAX_DEPTH && DOTNET_EXTS.includes(path.extname(f))).sort(byDepthThenPath);
  const target = dotnet.find((f) => /\.slnx?$/.test(f)) || dotnet[0];
  if (target) {
    const arg = dirName(target) ? ` ${shellQuote(target)}` : '';
    const source = `implied:${target}`;
    out.add('build', `dotnet build${arg}`, source);
    out.add('test', `dotnet test${arg}`, source);
    out.add('format', `dotnet format${arg} --verify-no-changes`, source);
  }

  if (isFile(ctx, 'Gemfile')) {
    if (isDir(ctx, 'spec') || isFile(ctx, '.rspec')) out.add('test', 'bundle exec rspec', isFile(ctx, '.rspec') ? 'implied:.rspec' : 'implied:Gemfile');
    else if (isFile(ctx, 'bin/rails')) out.add('test', 'bin/rails test', 'implied:bin/rails');
    else if (isFile(ctx, 'Rakefile')) out.add('test', 'bundle exec rake', 'implied:Rakefile');
    if (isFile(ctx, '.rubocop.yml')) out.add('lint', 'bundle exec rubocop', 'implied:.rubocop.yml');
  }

  if (isFile(ctx, 'composer.json')) {
    const composer = readJson(ctx, 'composer.json') || {};
    const dev = isObject(composer['require-dev']) ? composer['require-dev'] : {};
    const pest = isFile(ctx, 'tests/Pest.php') || dev['pestphp/pest'];
    const phpunit = first('phpunit.xml', 'phpunit.xml.dist') || dev['phpunit/phpunit'];
    if (isFile(ctx, 'artisan')) out.add('test', 'php artisan test', 'implied:artisan');
    else if (pest) out.add('test', 'vendor/bin/pest', isFile(ctx, 'tests/Pest.php') ? 'implied:tests/Pest.php' : 'implied:composer.json');
    else if (phpunit) out.add('test', 'vendor/bin/phpunit', typeof phpunit === 'string' && isFile(ctx, phpunit) ? `implied:${phpunit}` : 'implied:composer.json');
  }

  if (isFile(ctx, 'CMakeLists.txt')) {
    out.add('build', 'cmake -S . -B build && cmake --build build', 'implied:CMakeLists.txt');
    out.add('test', 'ctest --test-dir build', 'implied:CMakeLists.txt');
  }
}

// Install command for the detected package manager, used when no setup command is declared locally.
function impliedSetup(ctx, pm) {
  const has = (f) => isFile(ctx, f);
  const pick = (cmd, ...files) => {
    const file = files.find(has);
    return file ? { cmd, source: `implied:${file}` } : null;
  };
  switch (pm) {
    case 'pnpm': return has('package.json') ? pick('pnpm install', 'pnpm-lock.yaml', 'package.json') : null;
    case 'yarn': return has('package.json') ? pick('yarn install', 'yarn.lock', 'package.json') : null;
    case 'bun': return has('package.json') ? pick('bun install', 'bun.lock', 'bun.lockb', 'package.json') : null;
    case 'npm':
      if (!has('package.json')) return null;
      return has('package-lock.json') ? pick('npm ci', 'package-lock.json') : pick('npm install', 'package.json');
    case 'uv': return pick('uv sync', 'uv.lock', 'pyproject.toml');
    case 'poetry': return pick('poetry install', 'poetry.lock', 'pyproject.toml');
    case 'pdm': return pick('pdm install', 'pdm.lock', 'pyproject.toml');
    case 'pip': return has('requirements.txt') ? pick('pip install -r requirements.txt', 'requirements.txt') : null;
    case 'bundler': return pick('bundle install', 'Gemfile.lock', 'Gemfile');
    case 'composer': return pick('composer install', 'composer.lock', 'composer.json');
    case 'go': return pick('go mod download', 'go.sum', 'go.mod');
    default: return null;
  }
}

function addImpliedSetup(ctx, out, pm) {
  if (out.cmds.setup.length > 0) return; // something local already declares setup
  const implied = impliedSetup(ctx, pm);
  if (implied) out.add('setup', implied.cmd, implied.source);
}

function detectCommands(ctx, pms, frameworks, ciFiles) {
  const out = createCommands(ctx);
  safe(ctx, 'package.json scripts', () => addPackageScripts(ctx, out, pms.node, pms.yarnBerry), null);
  safe(ctx, 'deno tasks', () => addDenoTasks(ctx, out), null);
  safe(ctx, 'composer scripts', () => addComposerScripts(ctx, out), null);
  safe(ctx, 'Makefile', () => addMakeTargets(ctx, out), null);
  safe(ctx, 'justfile', () => addJustRecipes(ctx, out), null);
  safe(ctx, 'Taskfile', () => addTaskfileTasks(ctx, out), null);
  safe(ctx, 'python commands', () => addPythonCommands(ctx, out, pms.python, frameworks), null);
  safe(ctx, 'cargo commands', () => addCargoCommands(ctx, out), null);
  safe(ctx, 'go commands', () => addGoCommands(ctx, out), null);
  safe(ctx, 'platform commands', () => addPlatformCommands(ctx, out), null);
  // Before CI, so an identical CI command folds into this entry instead of replacing it.
  safe(ctx, 'implied setup', () => addImpliedSetup(ctx, out, pms.primary), null);
  safe(ctx, 'workflow commands', () => addWorkflowCommands(ctx, out, ciFiles), null);
  return out.cmds;
}

// ---------------------------------------------------------------------------
// CI, agent configs, docs, hard-rule candidates
// ---------------------------------------------------------------------------

function detectCi(ctx) {
  const found = ctx.files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));
  for (const f of ['.gitlab-ci.yml', '.circleci/config.yml', 'azure-pipelines.yml', 'Jenkinsfile', 'bitbucket-pipelines.yml', '.travis.yml']) {
    if (isFile(ctx, f)) found.push(f);
  }
  return uniqSorted(found);
}

// Files below `rel`, up to `maxDepth` levels, without following symlinked dirs.
function listTree(ctx, rel, maxDepth, cap = 100) {
  const out = [];
  const visit = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(ctx.root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => sortStr(a.name, b.name));
    for (const entry of entries) {
      if (out.length >= cap) return;
      const child = joinRel(dir, entry.name);
      const kind = entryKind(ctx.root, child, entry);
      if (kind === 'file') out.push(child);
      else if (kind === 'dir' && depth < maxDepth && !SKIP_DIRS.has(entry.name)) visit(child, depth + 1);
    }
  };
  visit(rel, 1);
  return out;
}

const AGENT_ROOT_FILES = {
  'CLAUDE.local.md': 'claude', 'GEMINI.md': 'gemini', '.cursorrules': 'cursor',
  '.github/copilot-instructions.md': 'copilot', '.windsurfrules': 'windsurf', '.clinerules': 'cline',
  'CONVENTIONS.md': 'aider', '.aider.conf.yml': 'aider', '.rules': 'zed', '.mcp.json': 'mcp',
  '.worktreeinclude': 'claude', '.junie/guidelines.md': 'junie',
  'opencode.json': 'opencode', 'opencode.jsonc': 'opencode', 'AGENTS.override.md': 'codex',
  '.cursor/mcp.json': 'cursor',
};
const AGENT_NESTED_FILES = { 'CLAUDE.md': 'claude', 'AGENTS.md': 'agents' }; // valid in subdirectories too
const AGENT_DIRS = [
  ['.claude', 'claude', 3], ['.cursor/rules', 'cursor', 3], ['.github/instructions', 'copilot', 2],
  ['.windsurf/rules', 'windsurf', 3], ['.clinerules', 'cline', 3],
  ['.gemini', 'gemini', 2], ['.codex', 'codex', 2], ['.kiro', 'kiro', 3], ['.opencode', 'opencode', 3],
  ['.agents', 'agents', 3], ['.junie', 'junie', 2], ['.zed', 'zed', 2], ['.continue', 'continue', 3],
  ['.roo', 'roo', 3],
];

function detectAgentConfigs(ctx) {
  const found = new Map();
  for (const f of ctx.files) {
    if (AGENT_ROOT_FILES[f]) found.set(f, AGENT_ROOT_FILES[f]);
    const nested = AGENT_NESTED_FILES[baseName(f)];
    if (nested) found.set(f, nested);
  }
  for (const [dir, tool, depth] of AGENT_DIRS) {
    if (isDir(ctx, dir)) for (const f of listTree(ctx, dir, depth)) found.set(f, tool);
  }
  return [...found.entries()].sort(([a], [b]) => sortStr(a, b)).map(([p, tool]) => ({ path: p, tool }));
}

const DOC_TEXT_EXTENSIONS = new Set(['', '.md', '.markdown', '.txt', '.rst', '.adoc']);
const ADR_DIRS = ['docs/adr', 'docs/adrs', 'docs/decisions', 'docs/rfcs', 'docs/architecture'];
const MAX_DOC_WALK = 3000; // directory entries visited when looking for docs/**/contributing*.md
const MAX_CONTRIBUTING_DOCS = 3;

// Files under `rel` (any depth up to maxDepth) whose name passes `test`, without following symlinked dirs.
function findFiles(ctx, rel, maxDepth, test) {
  const out = [];
  let visited = 0;
  const visit = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(ctx.root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => sortStr(a.name, b.name));
    for (const entry of entries) {
      if (++visited > MAX_DOC_WALK) return;
      const child = joinRel(dir, entry.name);
      const kind = entryKind(ctx.root, child, entry);
      if (kind === 'file' && test(entry.name)) out.push(child);
      else if (kind === 'dir' && depth < maxDepth && !SKIP_DIRS.has(entry.name)) visit(child, depth + 1);
    }
  };
  visit(rel, 1);
  return out;
}

// docs/<lang>/docs/... translations repeat the English page; keep English only.
const TRANSLATED_DOCS = /^docs\/(?!en\/)[a-z]{2}(?:-[A-Za-z]+)?\/docs\//;

function detectDocs(ctx) {
  const rootFiles = ctx.files.filter((f) => !f.includes('/'));
  const readmes = rootFiles.filter((f) => /^README(\..+)?$/i.test(f)).sort(sortStr);
  const contributing = rootFiles.filter((f) => /^CONTRIBUTING(\..+)?$/i.test(f)).sort(sortStr);
  if (isDir(ctx, 'docs')) {
    const nested = findFiles(ctx, 'docs', 5, (name) => /^contributing(\..+)?\.md$/i.test(name))
      .filter((f) => !TRANSLATED_DOCS.test(f))
      .sort(byDepthThenPath)
      .slice(0, MAX_CONTRIBUTING_DOCS);
    contributing.push(...nested);
  }
  const adrs = ctx.files.filter((f) => ADR_DIRS.includes(dirName(f))).sort(sortStr);
  // Instruction files already in the repo state rules too.
  const agentDocs = ctx.files.filter((f) => ['AGENTS.md', 'CLAUDE.md'].includes(baseName(f))).sort(byDepthThenPath);
  return { readmes, contributing, adrs, agentDocs };
}

// Hard-rule candidates. Instruction files, ADRs and contributing guides state rules, so any
// line with a modal word counts there. README mostly describes the product, so a line counts only
// under a rules-like heading or when it uses RFC-style capitals.
// "always" and "required" are only rules in imperative form ("Always run the linter", "X is required").
const RULE_WORDS = /\b(must not|must|never|do not|don[’']t|forbidden|banned|locked|invariants?|shall|should not|shouldn[’']t)\b|(?:^|[.!?:]\s+)always\b|\b(?:is|are|be) required\b/i;
const SHOUTED_RULE = /\b(MUST NOT|MUST|NEVER|SHALL)\b/;
const RULE_HEADING = /rules|conventions|guidelines|contributing|development|architecture|constraints/i;
const NOT_A_RULE = [
  /if you want/i, // optional-feature notes: "Required if you want to use the TestClient"
  /^\[?`[^`]+`\]?(?:\([^)]*\))?\s+[-–—]\s/, // option or parameter description: "`name` - ..."
  /\?$/, // questions
];
const MAX_RULES_PER_FILE = 10;
const MAX_RULE_CHARS = 240;

// Whole sentence(s) up to the limit: cut at a sentence end, else at a word with an ellipsis.
function fitSentence(text, signal) {
  if (text.length <= MAX_RULE_CHARS) return text;
  const sentences = text.split(/(?<=[.!?])\s+/);
  const hit = sentences.find((s) => signal.test(s)) || sentences[0];
  if (hit.length <= MAX_RULE_CHARS) return hit;
  const cut = hit.slice(0, MAX_RULE_CHARS - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).replace(/[\s,;:(\-]+$/, '')}…`;
}

// Sections /claude-setup writes into AGENTS.md and CLAUDE.md. Their lines are its own output,
// so they are never offered back as evidence (that would cite its own text as a source).
const GENERATED_SECTION = /^(?:commands|version notes|boundaries|working agreements|hard rules|repo map)\b/i;

// A sentence that runs into a short code block finishes in it: "... which is done by running"
// followed by a block holding `pnpm changeset` becomes "... by running `pnpm changeset`.".
// Only when the text does not already end a sentence (. ! ?) and the block has 1 to 3 lines.
function finishWithCode(para, lines, open) {
  if (!para || /[.!?]$/.test(para.text)) return;
  const body = [];
  let close = open;
  while (close < lines.length && !/^(```|~~~)/.test(lines[close].trim())) {
    if (lines[close].trim()) body.push(lines[close].trim());
    close++;
  }
  if (close >= lines.length || body.length < 1 || body.length > 3) return;
  if (body.some((l) => l.includes('`'))) return;
  para.text = `${para.text} \`${body.join(' && ')}\`.`;
}

// Paragraphs and list items (hard-wrapped lines joined) with the line they start on.
function markdownBlocks(text, skipHeading) {
  const blocks = [];
  const headings = [];
  let current = null;
  let pending = null; // paragraph closed by blank lines; a code block right after it may finish it
  let inFence = false;
  const lines = text.split(/\r?\n/);
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };
  const start = (content, line) => ({
    text: content,
    line,
    underRulesHeading: headings.some((h) => RULE_HEADING.test(h.text)),
    skipped: Boolean(skipHeading) && headings.some((h) => skipHeading.test(h.text)),
  });
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^(```|~~~)/.test(trimmed)) {
      if (!inFence) finishWithCode(current || pending, lines, i + 1);
      flush();
      pending = null;
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!trimmed || trimmed.startsWith('<!--') || trimmed.startsWith('|')) {
      if (current) pending = current;
      flush();
      continue;
    }
    pending = null;
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      while (headings.length && headings[headings.length - 1].level >= heading[1].length) headings.pop();
      headings.push({ level: heading[1].length, text: heading[2] });
      continue;
    }
    const item = trimmed.match(/^(?:>\s*)?(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      flush();
      current = start(item[1], i + 1);
    } else if (current) {
      current.text += ` ${trimmed.replace(/^>\s*/, '')}`;
    } else {
      current = start(trimmed.replace(/^>\s*/, ''), i + 1);
    }
  }
  flush();
  return blocks;
}

function ruleLinesFromFile(ctx, rel, strict, skipHeading = null) {
  const text = readText(ctx, rel);
  if (!text) return [];
  const found = [];
  for (const block of markdownBlocks(text, skipHeading)) {
    if (found.length >= MAX_RULES_PER_FILE) break;
    if (block.skipped) continue;
    const line = block.text.replace(/\s+/g, ' ').trim();
    const shouted = SHOUTED_RULE.test(line);
    if (strict && !shouted && !block.underRulesHeading) continue;
    const signal = shouted ? SHOUTED_RULE : RULE_WORDS;
    if (!signal.test(line)) continue;
    if (NOT_A_RULE.some((re) => re.test(line))) continue;
    found.push({ text: fitSentence(line, signal), source: `${rel}:${block.line}` });
  }
  return found;
}

function hardRuleCandidates(ctx, docs) {
  const sources = [
    ...docs.adrs.map((f) => [f, false, null]),
    ...docs.contributing.map((f) => [f, false, null]),
    ...docs.agentDocs.map((f) => [f, false, GENERATED_SECTION]),
    ...docs.readmes.map((f) => [f, true, null]),
  ];
  const out = [];
  const seen = new Set();
  for (const [rel, strict, skipHeading] of sources) {
    if (!DOC_TEXT_EXTENSIONS.has(path.extname(rel).toLowerCase())) continue;
    for (const candidate of ruleLinesFromFile(ctx, rel, strict, skipHeading)) {
      if (out.length >= MAX_HARD_RULES) return out;
      if (seen.has(candidate.text)) continue;
      seen.add(candidate.text);
      out.push(candidate);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Infra, env, .gitignore, release signals
// ---------------------------------------------------------------------------

function detectInfra(ctx) {
  const names = ctx.files.map(baseName);
  const has = (...wanted) => names.some((n) => wanted.includes(n));
  const matches = (re) => names.some((n) => re.test(n));
  return {
    docker: matches(/^Dockerfile(\..+)?$/) || matches(/\.dockerfile$/i),
    compose: matches(/^(docker-)?compose(\..+)?\.ya?ml$/),
    terraform: matches(/\.tf$/),
    kubernetes: has('kustomization.yaml', 'kustomization.yml', 'skaffold.yaml') ||
      ctx.dirs.some((d) => ['k8s', 'kubernetes'].includes(baseName(d))),
    helm: has('Chart.yaml'),
    serverless: matches(/^serverless\.(ya?ml|ts|js)$/),
    vercel: has('vercel.json'),
    netlify: has('netlify.toml'),
    cloudflareWorkers: has('wrangler.toml', 'wrangler.json', 'wrangler.jsonc'),
    fly: has('fly.toml'),
  };
}

// Just enough .gitignore: comments, negation, anchoring, dir-only, *, **, ?.
function loadGitignore(ctx) {
  const text = isFile(ctx, '.gitignore') ? readText(ctx, '.gitignore') : null;
  if (!text) return () => false;
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    line = line.replace(/^\\(?=[#!])/, '');
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes('/');
    line = line.replace(/^\//, '');
    if (!line) continue;
    const body = globToRegex(line);
    rules.push({ negate, dirOnly, re: new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`) });
  }
  const ignoredAt = (rel, isDirectory) => {
    let ignored = false;
    for (const rule of rules) {
      if (rule.dirOnly && !isDirectory) continue;
      if (rule.re.test(rel)) ignored = !rule.negate;
    }
    return ignored;
  };
  // A path is ignored if it or any parent directory is.
  return (rel) => {
    const parts = rel.split('/');
    return parts.some((_, i) => ignoredAt(parts.slice(0, i + 1).join('/'), i < parts.length - 1));
  };
}

const GITIGNORE_CANDIDATES = ['.env', '.env.local', 'CLAUDE.local.md', '.claude/settings.local.json', '.mcp.json'];

function detectEnv(ctx) {
  // Names only. Contents of .env* files are never read.
  const files = ctx.files.filter((f) => /^\.env(\..+)?$/.test(baseName(f)));
  const isIgnored = loadGitignore(ctx);
  return {
    files: uniqSorted(files),
    gitignored: uniqSorted(GITIGNORE_CANDIDATES.filter((f) => isIgnored(f))),
  };
}

function detectVersionFiles(ctx) {
  const found = [];
  for (const dir of ['', ...ctx.workspaces].slice(0, 21)) {
    const pkgRel = joinRel(dir, 'package.json');
    if (isFile(ctx, pkgRel) && typeof (readJson(ctx, pkgRel) || {}).version === 'string') found.push(pkgRel);

    const cargoRel = joinRel(dir, 'Cargo.toml');
    if (isFile(ctx, cargoRel)) {
      const toml = readToml(ctx, cargoRel);
      const version = tomlTable(toml, 'package').version ?? tomlTable(toml, 'workspace.package').version;
      if (typeof version === 'string') found.push(cargoRel);
    }

    const pyRel = joinRel(dir, 'pyproject.toml');
    if (isFile(ctx, pyRel)) {
      const toml = readToml(ctx, pyRel);
      const project = tomlTable(toml, 'project');
      const poetry = tomlTable(toml, 'tool.poetry');
      if (project.version || poetry.version || strings(project.dynamic).includes('version')) found.push(pyRel);
    }
  }
  for (const f of ctx.files.filter((f) => !f.includes('/'))) {
    if (/^(CHANGELOG|CHANGES|HISTORY)(\..+)?$/i.test(f)) found.push(f);
    if (['VERSION', 'release-please-config.json', '.release-please-manifest.json', '.release-it.json'].includes(f)) found.push(f);
    if (/^\.releaserc(\..+)?$/.test(f)) found.push(f);
  }
  if (isFile(ctx, 'lerna.json') && typeof (readJson(ctx, 'lerna.json') || {}).version === 'string') found.push('lerna.json');
  if (isDir(ctx, '.changeset')) found.push('.changeset/');
  return uniqSorted(found);
}

// ---------------------------------------------------------------------------
// Generated files: do not edit by hand
// ---------------------------------------------------------------------------

const GENERATED_EXTENSIONS = new Set([
  '.go', '.rs', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.kt', '.cs',
  '.rb', '.php', '.swift', '.dart', '.c', '.h', '.cc', '.cpp', '.hpp', '.proto', '.sql', '.graphql', '.gql',
  '.md', '.mdx', '.json', '.yml', '.yaml', '.toml', '.html', '.css', '.scss',
]);
const MAX_HEADER_BYTES = 2048;
const MAX_HEADER_FILE_BYTES = 256 * 1024;
const MAX_HEADER_FILES = 3000;
const MAX_GENERATED = 30;

// "DO NOT EDIT" and "Code generated" are conventions with fixed capitalisation (Go's is exact).
const GENERATED_MARKER = /DO NOT EDIT|Code generated/;
const GENERATED_MARKER_LOOSE = /@generated|auto-?generated|This file is (?:automatically )?generated/i;
// The marker must sit in a comment line (or be an @generated tag), not in prose.
const COMMENT_LINE = /^(?:\/\/|\/\*|\*|#|<!--|--|;|%)/;

function firstLines(ctx, rel, count) {
  let fd;
  try {
    const abs = path.join(ctx.root, rel);
    if (fs.statSync(abs).size > MAX_HEADER_FILE_BYTES) return [];
    fd = fs.openSync(abs, 'r');
    const buffer = Buffer.alloc(MAX_HEADER_BYTES);
    const read = fs.readSync(fd, buffer, 0, MAX_HEADER_BYTES, 0);
    return buffer.toString('utf8', 0, read).split(/\r?\n/).slice(0, count);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function generatedByHeader(ctx) {
  const out = [];
  let checked = 0;
  for (const rel of ctx.files) {
    if (baseName(rel).startsWith('.env')) continue;
    if (!GENERATED_EXTENSIONS.has(path.extname(rel).toLowerCase())) continue;
    if (++checked > MAX_HEADER_FILES) break;
    for (const line of firstLines(ctx, rel, 5)) {
      const text = line.trim();
      const tagged = /@generated/i.test(text);
      if (!tagged && !COMMENT_LINE.test(text)) continue;
      if (tagged || GENERATED_MARKER.test(text) || GENERATED_MARKER_LOOSE.test(text)) {
        out.push({ path: rel, evidence: `header says: ${text.slice(0, 100)}` });
        break;
      }
    }
  }
  return out;
}

// Units of "name + command text" from config files that run scripts.
function preCommitHooks(text) {
  const hooks = [];
  let hook = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripHashComment(raw, true);
    const id = line.match(/^\s*-\s+id:\s*(\S+)/);
    if (id) {
      hook = { name: id[1], text: id[1], commands: [] };
      hooks.push(hook);
      continue;
    }
    const field = hook && line.match(/^\s+(name|entry):\s*(.+)$/);
    if (!field) continue;
    hook.text += ` ${unquote(field[2])}`;
    if (field[1] === 'entry') hook.commands.push(unquote(field[2]));
  }
  return hooks.map((h) => ({ file: '.pre-commit-config.yaml', task: h.name, label: h.text, commands: h.commands }));
}

function makefileUnits(text, file) {
  const units = [];
  let unit = null;
  for (const line of text.split(/\r?\n/)) {
    const target = line.match(/^([A-Za-z0-9_][\w.-]*)\s*:(?![=:])/);
    if (target) {
      unit = { file, task: target[1], label: target[1], commands: [] };
      units.push(unit);
    } else if (unit && /^\t/.test(line)) {
      unit.commands.push(line.trim().replace(/^[@-]+/, ''));
    } else if (line.trim() && !/^\s/.test(line)) {
      unit = null;
    }
  }
  return units;
}

function configUnits(ctx) {
  const units = [];
  if (isFile(ctx, '.pre-commit-config.yaml')) {
    const text = readText(ctx, '.pre-commit-config.yaml');
    if (text) units.push(...preCommitHooks(text));
  }
  const make = ['Makefile', 'makefile', 'GNUmakefile'].find((f) => isFile(ctx, f));
  if (make) {
    const text = readText(ctx, make);
    if (text) units.push(...makefileUnits(text, make));
  }
  const pkg = isFile(ctx, 'package.json') ? readJson(ctx, 'package.json') : null;
  if (pkg && isObject(pkg.scripts)) {
    for (const [name, body] of Object.entries(pkg.scripts)) {
      if (typeof body === 'string') units.push({ file: 'package.json', task: name, label: name, commands: [body] });
    }
  }
  const poe = isFile(ctx, 'pyproject.toml') ? tomlTable(readToml(ctx, 'pyproject.toml'), 'tool.poe.tasks') : {};
  for (const [name, value] of Object.entries(poe)) {
    const cmd = typeof value === 'string' ? value : isObject(value) && typeof value.cmd === 'string' ? value.cmd : null;
    if (cmd) units.push({ file: 'pyproject.toml', task: name, label: name, commands: [cmd] });
  }
  return units;
}

// An existing, non-ignored file named by a path-like token.
function trackedFile(ctx, token, isIgnored) {
  const rel = token.replace(/^["']|["']$/g, '').replace(/^\.\//, '');
  if (!rel || rel.startsWith('/') || rel.includes('..') || !isFile(ctx, rel) || isIgnored(rel)) return null;
  return rel;
}

// `uv run ./scripts/docs.py generate-readme` -> { script: "scripts/docs.py", task: "generate-readme" }
function scriptInCommand(ctx, command) {
  const tokens = command.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    if (!/\.(py|sh|bash|js|mjs|cjs|ts|rb)$/.test(tokens[i])) continue;
    const script = trackedFile(ctx, tokens[i], () => false);
    if (!script) continue;
    const arg = tokens.slice(i + 1).find((t) => !t.startsWith('-'));
    return { script, task: arg || null };
  }
  return null;
}

// "python generate.py" names generate.py as the generator, not as a generated file.
const runsAsScript = (text, file) =>
  new RegExp(`(?:python3?|node|bash|sh|ruby|tsx|ts-node|run|exec)\\s+(?:\\./)?${file.replace(/[.+^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`).test(text);

const GENERATE_FILE = /\bgenerat\w*\s+(?:the\s+)?([\w./-]+\.\w{1,8})\b/i;
const REDIRECT_FILE = /(?:^|[^>&\d])>\s*([\w./-]+\.\w{1,8})\s*$/;

function generatedByScripts(ctx, isIgnored) {
  const out = [];
  for (const unit of configUnits(ctx)) {
    // 1) "generate FILE": the hook, task or command says it generates a file that exists.
    for (const text of [unit.label, ...unit.commands]) {
      const m = GENERATE_FILE.exec(text);
      const target = m && trackedFile(ctx, m[1], isIgnored);
      if (!target || runsAsScript(text, target)) continue;
      const via = unit.commands.map((c) => scriptInCommand(ctx, c)).find(Boolean);
      if (via) {
        // The script has to mention the file, otherwise the name alone proves nothing.
        const body = readText(ctx, via.script) || '';
        if (!body.includes(baseName(target))) continue;
        out.push({ path: target, evidence: `written by ${via.script} (${via.task || unit.task})` });
      } else {
        out.push({ path: target, evidence: `written by ${unit.file} (${unit.task})` });
      }
      break;
    }
    // 2) `command > FILE` into a file that exists.
    for (const command of unit.commands) {
      const m = REDIRECT_FILE.exec(command);
      const target = m && trackedFile(ctx, m[1], isIgnored);
      if (target) out.push({ path: target, evidence: `written by ${unit.file} (${unit.task})` });
    }
  }
  // Shell scripts that redirect into a tracked file.
  for (const rel of ctx.files.filter((f) => /^scripts\/[^/]+\.(sh|bash)$/.test(f))) {
    const text = readText(ctx, rel);
    if (!text) continue;
    for (const line of text.split(/\r?\n/)) {
      const m = REDIRECT_FILE.exec(line.trim());
      const target = m && trackedFile(ctx, m[1], isIgnored);
      if (target && target !== rel) out.push({ path: target, evidence: `written by ${rel} (> ${target})` });
    }
  }
  return out;
}

function detectGenerated(ctx) {
  const isIgnored = loadGitignore(ctx);
  const byPath = new Map();
  for (const entry of [...generatedByHeader(ctx), ...generatedByScripts(ctx, isIgnored)]) {
    const evidence = byPath.get(entry.path) || [];
    if (!evidence.includes(entry.evidence)) evidence.push(entry.evidence);
    byPath.set(entry.path, evidence);
  }
  return [...byPath.entries()]
    .sort(([a], [b]) => sortStr(a, b))
    .slice(0, MAX_GENERATED)
    .map(([p, evidence]) => ({ path: p, evidence: evidence.slice(0, 3).join('; ') }));
}

// ---------------------------------------------------------------------------
// Project name
// ---------------------------------------------------------------------------

function manifestName(ctx, ecosystem) {
  if (ecosystem === 'node' || ecosystem === 'deno') {
    const pkg = isFile(ctx, 'package.json') ? readJson(ctx, 'package.json') : null;
    return pkg && typeof pkg.name === 'string' ? pkg.name : null;
  }
  if (ecosystem === 'python') {
    const toml = isFile(ctx, 'pyproject.toml') ? readToml(ctx, 'pyproject.toml') : null;
    const name = tomlTable(toml, 'project').name ?? tomlTable(toml, 'tool.poetry').name;
    return typeof name === 'string' ? name : null;
  }
  if (ecosystem === 'rust') {
    const toml = isFile(ctx, 'Cargo.toml') ? readToml(ctx, 'Cargo.toml') : null;
    const name = tomlTable(toml, 'package').name;
    return typeof name === 'string' ? name : null;
  }
  if (ecosystem === 'go') {
    const mod = isFile(ctx, 'go.mod') ? readGoMod(ctx, 'go.mod') : null;
    return mod && mod.module ? stripGoMajor(mod.module).split('/').pop() : null;
  }
  if (ecosystem === 'php') {
    const composer = isFile(ctx, 'composer.json') ? readJson(ctx, 'composer.json') : null;
    return composer && typeof composer.name === 'string' ? composer.name : null;
  }
  if (ecosystem === 'cpp') {
    const text = isFile(ctx, 'CMakeLists.txt') ? readText(ctx, 'CMakeLists.txt') : null;
    const m = text && text.match(/^\s*project\s*\(\s*([A-Za-z0-9_.-]+)/im);
    return m ? m[1] : null;
  }
  if (ecosystem === 'jvm') {
    const text = ['settings.gradle', 'settings.gradle.kts'].filter((f) => isFile(ctx, f)).map((f) => readText(ctx, f)).find(Boolean);
    const m = text && text.match(/rootProject\.name\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  }
  return null;
}

function detectName(ctx, primary) {
  const order = [primary, ...ECOSYSTEM_ORDER.filter((e) => e !== primary)];
  for (const eco of order) {
    const name = safe(ctx, `${eco} name`, () => manifestName(ctx, eco), null);
    if (name) return name;
  }
  return path.basename(ctx.root);
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export function detect(dir = process.cwd()) {
  const ctx = createContext(dir);

  const { workspaces, marker } = safe(ctx, 'workspace', () => detectWorkspaces(ctx), { workspaces: [], marker: false });
  ctx.workspaces = workspaces;
  safe(ctx, 'workspace member walk', () => walkHiddenMembers(ctx), null);

  const languages = safe(ctx, 'language', () => detectLanguages(ctx), []);
  const primary = safe(ctx, 'primary', () => detectPrimary(ctx, languages), 'unknown');
  const pms = safe(ctx, 'package manager', () => detectPackageManagers(ctx, primary), { node: null, python: null, primary: null });
  const frameworks = safe(ctx, 'framework', () => collectFrameworks(ctx), []);
  const ci = safe(ctx, 'ci', () => detectCi(ctx), []);
  const docs = safe(ctx, 'docs', () => detectDocs(ctx), { readmes: [], contributing: [], adrs: [], agentDocs: [] });
  const docFiles = [...docs.readmes, ...docs.contributing, ...docs.adrs];

  return {
    root: ctx.root,
    name: detectName(ctx, primary),
    languages,
    primary,
    layout: workspaces.length > 0 || marker ? 'monorepo' : 'single',
    workspaces,
    packageManager: pms.primary,
    packageManagerVersion: safe(ctx, 'package manager version', () => packageManagerVersion(ctx, pms.primary), null),
    frameworks,
    languageVersion: detectLanguageVersions(ctx),
    commands: detectCommands(ctx, pms, frameworks, ci),
    ci,
    agentConfigs: safe(ctx, 'agent config', () => detectAgentConfigs(ctx), []),
    docs: uniqSorted(docFiles).slice(0, MAX_DOCS),
    hardRuleCandidates: safe(ctx, 'hard rule', () => hardRuleCandidates(ctx, docs), []),
    infra: safe(ctx, 'infra', () => detectInfra(ctx), {}),
    env: safe(ctx, 'env', () => detectEnv(ctx), { files: [], gitignored: [] }),
    versionFiles: safe(ctx, 'version file', () => detectVersionFiles(ctx), []),
    generated: safe(ctx, 'generated file', () => detectGenerated(ctx), []),
    warnings: uniqSorted(ctx.warnings),
  };
}

// True when this file is the process entry point, including via a symlinked path.
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function main() {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('-'));
  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    process.stdout.write('usage: node detect.mjs [dir]\nPrints project detection results as JSON.\n');
    return;
  }
  let result;
  try {
    result = detect(arg || process.cwd());
  } catch (err) {
    result = { root: path.resolve(arg || process.cwd()), warnings: [`detection failed: ${err && err.message ? err.message : err}`] };
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isEntryPoint()) main();
