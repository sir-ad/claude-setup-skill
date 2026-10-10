#!/usr/bin/env node
// Deterministic repo graph for the /claude-setup skill.
//
//   node scripts/graph.mjs [dir] [--json | --markdown] [--max-nodes N] [--budget LINES]
//
// Regex-based import graph for JS/TS, Python, Go and Rust: module nodes, weighted
// edges, centrality (in-degree + PageRank), entry points and an Aider-style repo map.
// Zero dependencies, read-only, bounded work. Never opens .env* files and never
// follows symlinks. Always exits 0, except 2 for usage errors.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseToml } from './detect.mjs';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'target', 'dist', 'build', '.venv', 'venv', 'vendor', '__pycache__',
  '.next', '.turbo', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.gradle', '.cache', '.nuxt',
  '.svelte-kit', '.output', '.parcel-cache', 'coverage',
  // Generated or vendored output, and example code that only adds noise.
  'generated', '__generated__', 'site-packages', 'bower_components', 'out', 'docs_src',
]);
const MAX_FILES = 20000;
const MAX_ENTRIES = 200000; // files + dirs seen by the walk
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_EDGES = 2000;
const MAX_SYMBOLS = 8;
const TOP_CENTRAL = 10;
const MAX_MERMAID_EDGES = 80;
const ENTRY_KINDS = ['package-bin', 'package-main', 'package-module', 'package-exports', 'package-script', 'python-script', 'python-main', 'go-main', 'rust-bin', 'next-app', 'next-pages', 'remix-routes', 'sveltekit-routes'];
const CONFIG_FILE = /(^|\/)_?[\w.-]*\.config\.[cm]?[jt]s$/;
const MANIFESTS = /^(package\.json|tsconfig\.json|tsconfig\.base\.json|jsconfig\.json|go\.mod|go\.work|Cargo\.toml|pyproject\.toml|setup\.py|setup\.cfg|pnpm-workspace\.yaml)$/;

const LANG_BY_EXT = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.vue': 'vue', '.svelte': 'svelte', '.py': 'python', '.go': 'go', '.rs': 'rust',
};
const FAMILY = { typescript: 'js', javascript: 'js', vue: 'js', svelte: 'js', python: 'py', go: 'go', rust: 'rs' };
const JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte'];
const GENERATED_NAME = /(\.d\.[cm]?ts|\.min\.js|\.generated\.\w+|\.gen\.\w+|\.pb\.go|_generated\.go|_pb2(_grpc)?\.py)$/;
const GENERATED_HEAD = /@generated|Code generated|DO NOT EDIT|auto-?generated/i;
const TEST_DIR = /(^|\/)(tests?|__tests__|__mocks__|specs?|e2e|testdata|fixtures?|examples?|benches|benchmarks?)(\/|$)/;
const TEST_FILE = /(\.(test|spec)\.\w+$|_test\.(go|py)$|(^|\/)test_[^/]*\.py$|(^|\/)conftest\.py$)/;

const NODE_BUILTINS = new Set(('assert async_hooks buffer child_process cluster console constants crypto dgram ' +
  'diagnostics_channel dns domain events fs http http2 https inspector module net os path perf_hooks process ' +
  'punycode querystring readline repl stream string_decoder sys timers tls trace_events tty url util v8 vm ' +
  'wasi worker_threads zlib test').split(' '));
const PY_STDLIB = new Set(('__future__ abc argparse array ast asyncio base64 binascii bisect builtins bz2 calendar ' +
  'cgi cmath cmd codecs collections colorsys concurrent configparser contextlib contextvars copy copyreg csv ' +
  'ctypes dataclasses datetime decimal difflib dis doctest email enum errno faulthandler fcntl filecmp fnmatch ' +
  'fractions ftplib functools gc getopt getpass gettext glob graphlib gzip hashlib heapq hmac html http imaplib ' +
  'importlib inspect io ipaddress itertools json keyword linecache locale logging lzma mailbox marshal math ' +
  'mimetypes mmap multiprocessing numbers operator os pathlib pdb pickle pkgutil platform plistlib poplib ' +
  'posixpath pprint profile pstats pty pwd queue quopri random re readline reprlib resource sched secrets select ' +
  'selectors shelve shlex shutil signal site smtplib socket socketserver sqlite3 ssl stat statistics string ' +
  'struct subprocess sys sysconfig syslog tarfile tempfile termios textwrap threading time timeit tkinter token ' +
  'tokenize tomllib trace traceback tracemalloc tty types typing unicodedata unittest urllib uuid venv warnings ' +
  'wave weakref webbrowser xml xmlrpc zipapp zipfile zipimport zlib zoneinfo').split(' '));
const RUST_BUILTIN = new Set(['std', 'core', 'alloc', 'proc_macro', 'test', 'self', 'super']);
const UNRESOLVED_ALIAS = /^(?:@\/|~|#|\$|@@|virtual:|https?:|data:|bun:|npm:|jsr:)/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sortStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const baseName = (rel) => rel.slice(rel.lastIndexOf('/') + 1);
const dirName = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const joinRel = (dir, name) => (dir ? `${dir}/${name}` : name);
const joinNorm = (...parts) => {
  const p = path.posix.normalize(parts.filter(Boolean).join('/'));
  return p === '.' ? '' : p.replace(/^\.\//, '');
};
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
const bump = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n);
const extOf = (rel) => path.posix.extname(rel);
const isTestPath = (rel) => TEST_DIR.test(rel) || TEST_FILE.test(rel) ||
  (rel.endsWith('.go') && /(^|\/)_[^/]+(\/|$)/.test(rel));

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

// Strips // and /* */ comments plus trailing commas from tsconfig-style JSON, leaving strings alone.
function stripJsonComments(text) {
  const out = text.replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m[0] === '"' ? m : ' '));
  return out.replace(/,(\s*[}\]])/g, '$1');
}

// ---------------------------------------------------------------------------
// Walk and safe reads
// ---------------------------------------------------------------------------

// Breadth-first so a truncated walk keeps the shallow files. Symlinks and dot-dirs are skipped.
function walk(root, warnings) {
  const sources = [];
  const manifests = [];
  const queue = [''];
  let seen = 0;
  let capped = false;
  for (let q = 0; q < queue.length && !capped; q++) {
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, queue[q]), { withFileTypes: true });
    } catch (err) {
      warnings.push(`cannot read directory ${queue[q] || '.'}: ${err.code || err.message}`);
      continue;
    }
    entries.sort((a, b) => sortStr(a.name, b.name));
    for (const entry of entries) {
      if (++seen > MAX_ENTRIES) { capped = true; break; }
      if (entry.isSymbolicLink()) continue;
      const rel = joinRel(queue[q], entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) queue.push(rel);
      } else if (entry.isFile()) {
        if (MANIFESTS.test(entry.name)) manifests.push(rel);
        else if (LANG_BY_EXT[extOf(entry.name)] && !GENERATED_NAME.test(entry.name)) {
          if (sources.length >= MAX_FILES) capped = true;
          else sources.push(rel);
        }
      }
    }
  }
  if (capped) warnings.push(`walk stopped at the ${MAX_FILES} file / ${MAX_ENTRIES} entry cap; results may be incomplete`);
  return { sources, manifests };
}

// Bounded, text-only read. Secrets live in .env*, so those are never opened.
function readText(ctx, rel) {
  if (/(^|\/)\.env/.test(rel)) return null;
  try {
    const abs = path.join(ctx.root, rel);
    if (fs.statSync(abs).size > MAX_BYTES) { ctx.skippedLarge++; return null; }
    const raw = fs.readFileSync(abs, 'utf8');
    return raw.slice(0, 8192).includes('\0') ? null : raw.replace(/^\uFEFF/, '');
  } catch (err) {
    if (err.code !== 'ENOENT') ctx.warnings.push(`cannot read ${rel}: ${err.code || err.message}`);
    return null;
  }
}

// Manifests are parsed once; a parse failure is a warning, not an error.
function readParsed(ctx, rel, kind) {
  const key = `${kind}:${rel}`;
  if (ctx.cache.has(key)) return ctx.cache.get(key);
  let value = null;
  const text = readText(ctx, rel);
  if (text !== null) {
    try {
      value = kind === 'toml' ? parseToml(text) : JSON.parse(stripJsonComments(text));
      if (!isObject(value)) value = null;
    } catch {
      ctx.warnings.push(`malformed ${kind === 'toml' ? 'TOML' : 'JSON'} in ${rel}`);
    }
  }
  ctx.cache.set(key, value);
  return value;
}
const readJson = (ctx, rel) => readParsed(ctx, rel, 'json');
const readToml = (ctx, rel) => readParsed(ctx, rel, 'toml');

// ---------------------------------------------------------------------------
// Workspaces and grouping
// ---------------------------------------------------------------------------

function yamlPackages(text) {
  const out = [];
  let inList = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^packages:\s*$/.test(line)) inList = true;
    else if (inList) {
      const m = line.match(/^\s+-\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/);
      if (m) out.push(m[1]);
      else if (line.trim() && !/^\s/.test(line)) inList = false;
    }
  }
  return out;
}

// Directories (with a manifest named `manifest`) matched by workspace patterns.
function matchMembers(ctx, patterns, manifest) {
  const include = [];
  const exclude = [];
  for (const raw of patterns) {
    const p = raw.trim().replace(/^\.\//, '').replace(/\/+$/, '');
    if (p.startsWith('!')) exclude.push(globToRegex(p.slice(1)));
    else if (p && p !== '.') include.push(globToRegex(p));
  }
  return ctx.manifests
    .filter((m) => baseName(m) === manifest && dirName(m))
    .map(dirName)
    .filter((d) => include.some((re) => re.test(d)) && !exclude.some((re) => re.test(d)));
}

function findMembers(ctx) {
  const members = new Set();
  const has = (f) => ctx.manifestSet.has(f);
  if (has('package.json')) {
    const ws = readJson(ctx, 'package.json')?.workspaces;
    for (const d of matchMembers(ctx, strings(Array.isArray(ws) ? ws : ws?.packages), 'package.json')) members.add(d);
  }
  if (has('pnpm-workspace.yaml')) {
    for (const d of matchMembers(ctx, yamlPackages(readText(ctx, 'pnpm-workspace.yaml') || ''), 'package.json')) members.add(d);
  }
  if (has('Cargo.toml')) {
    const ws = readToml(ctx, 'Cargo.toml')?.workspace || {};
    const patterns = [...strings(ws.members), ...strings(ws.exclude).map((e) => `!${e}`)];
    for (const d of matchMembers(ctx, patterns, 'Cargo.toml')) members.add(d);
  }
  if (has('go.work')) {
    const text = readText(ctx, 'go.work') || '';
    const dirs = [...text.matchAll(/^\s*(?:use\s+)?(\.\/?[\w./-]*)\s*$/gm)].map((m) => m[1]);
    for (const d of matchMembers(ctx, dirs, 'go.mod')) members.add(d);
  }
  return [...members].sort(sortStr);
}

// Group = workspace member for real monorepos, else the directory up to depth 2 below the member/root.
function makeGrouper(members) {
  const byDepth = [...members].sort((a, b) => b.length - a.length || sortStr(a, b));
  const flat = members.length >= 4;
  const cache = new Map();
  const ofDir = (dir) => {
    if (cache.has(dir)) return cache.get(dir);
    const base = byDepth.find((m) => dir === m || dir.startsWith(`${m}/`)) || '';
    const rel = base ? dir.slice(base.length + 1) : dir;
    const segs = flat && base ? [] : rel ? rel.split('/').slice(0, 2) : [];
    const id = [base, ...segs].filter(Boolean).join('/') || '.';
    const res = { id, kind: members.includes(id) ? 'workspace' : 'module' };
    cache.set(dir, res);
    return res;
  };
  return { ofDir, ofFile: (f) => ofDir(dirName(f)) };
}

// ---------------------------------------------------------------------------
// JS / TS
// ---------------------------------------------------------------------------

const JS_FROM = /(?<![\w$.])(?:import|export)\s+(?:type\s+)?[\w$*{][^'";]{0,2000}?\sfrom\s*['"]([^'"\n]+)['"]/g;
const JS_BARE = /(?<![\w$.])import\s*['"]([^'"\n]+)['"]/g;
const JS_REQUIRE = /(?<![\w$.])require\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const JS_DYNAMIC = /(?<![\w$.])import\s*\(\s*['"]([^'"\n]+)['"]/g;
const JS_EXPORT = /^export\s+(?:declare\s+)?(default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|class|const|let|var|type|interface|enum|namespace)\s+([\w$]+)/gm;
const JS_EXPORT_LIST = /^export\s*(?:type\s*)?\{([^}]*)\}(?!\s*from)/gm;
const JS_CJS_EXPORT = /^(?:module\.)?exports\.([\w$]+)\s*=/gm;

function scriptBlocks(text) {
  return [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
}

function scanJs(text, rel) {
  const code = (/\.(vue|svelte)$/.test(rel) ? scriptBlocks(text) : text)
    .replace(/^[ \t]*(?:\/\/|\/\*|\*).*$/gm, '');
  const specs = [];
  for (const re of [JS_FROM, JS_BARE, JS_REQUIRE, JS_DYNAMIC]) {
    for (const m of code.matchAll(re)) specs.push(m[1]);
  }
  const symbols = [];
  let namedDefault = false;
  for (const m of code.matchAll(JS_EXPORT)) {
    symbols.push(m[2]);
    if (m[1]) namedDefault = true;
  }
  for (const m of code.matchAll(JS_EXPORT_LIST)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().replace(/^type\s+/, '');
      if (/^[\w$]+$/.test(name)) symbols.push(name);
    }
  }
  for (const m of code.matchAll(JS_CJS_EXPORT)) symbols.push(m[1]);
  if (!namedDefault && /^export\s+default\b/m.test(code)) symbols.push('default');
  return { raw: specs, symbols };
}

function resolveFile(ctx, base) {
  const p = base === '.' ? '' : base;
  const swap = p.match(/^(.*)\.[cm]?jsx?$/);
  const tries = [p, ...JS_EXTS.map((e) => p + e)];
  if (swap) tries.push(...['.ts', '.tsx', '.mts', '.cts'].map((e) => swap[1] + e));
  tries.push(...JS_EXTS.map((e) => joinRel(p, `index${e}`)));
  return tries.find((t) => t && ctx.fileSet.has(t)) || null;
}

// compilerOptions.paths and baseUrl, following relative `extends`. Paths are repo-relative.
function loadTsConfig(ctx, rel, depth = 0) {
  const key = `ts:${rel}`;
  if (ctx.cache.has(key)) return ctx.cache.get(key);
  const json = readJson(ctx, rel);
  const dir = dirName(rel);
  let cfg = { baseDir: null, paths: [] };
  if (json && depth < 3) {
    if (typeof json.extends === 'string' && json.extends.startsWith('.')) {
      let ext = joinNorm(dir, json.extends);
      if (!ctx.manifestSet.has(ext)) ext += '.json';
      if (ctx.manifestSet.has(ext)) cfg = loadTsConfig(ctx, ext, depth + 1);
    }
    const co = isObject(json.compilerOptions) ? json.compilerOptions : {};
    if (typeof co.baseUrl === 'string') cfg = { ...cfg, baseDir: joinNorm(dir, co.baseUrl) };
    if (isObject(co.paths)) {
      const base = typeof co.baseUrl === 'string' ? joinNorm(dir, co.baseUrl) : dir;
      const paths = Object.entries(co.paths).map(([pattern, targets]) => ({ pattern, base, targets: strings(targets) }));
      cfg = { ...cfg, paths };
    }
  }
  ctx.cache.set(key, cfg);
  return cfg;
}

function tsConfigFor(ctx, dir) {
  for (let d = dir; ; d = dirName(d)) {
    const hit = ['tsconfig.json', 'jsconfig.json'].map((n) => joinRel(d, n)).find((f) => ctx.manifestSet.has(f));
    if (hit) return loadTsConfig(ctx, hit);
    if (!d) return null;
  }
}

function resolveAlias(ctx, spec, from) {
  const cfg = tsConfigFor(ctx, dirName(from));
  if (!cfg) return null;
  const sorted = [...cfg.paths].sort((a, b) => b.pattern.length - a.pattern.length);
  for (const { pattern, base, targets } of sorted) {
    const star = pattern.indexOf('*');
    let captured = '';
    if (star < 0) { if (spec !== pattern) continue; }
    else {
      const head = pattern.slice(0, star);
      const tail = pattern.slice(star + 1);
      if (!spec.startsWith(head) || !spec.endsWith(tail) || spec.length < head.length + tail.length) continue;
      captured = spec.slice(head.length, spec.length - tail.length);
    }
    for (const t of targets) {
      const hit = resolveFile(ctx, joinNorm(base, t.replace('*', captured)));
      if (hit) return hit;
    }
  }
  return cfg.baseDir !== null ? resolveFile(ctx, joinNorm(cfg.baseDir, spec)) : null;
}

// Maps a built entry such as dist/index.js back to a source file.
function entryFile(ctx, dir, rel) {
  if (typeof rel !== 'string') return null;
  const clean = rel.replace(/^\.\//, '');
  return resolveFile(ctx, joinNorm(dir, clean)) ||
    resolveFile(ctx, joinNorm(dir, clean.replace(/^(?:dist|build|lib|out|esm|cjs)\//, 'src/')));
}

function firstLeaf(value, depth = 0) {
  if (typeof value === 'string') return value;
  if (!isObject(value) || depth > 4) return null;
  for (const key of ['import', 'default', 'require', 'types']) {
    const hit = firstLeaf(value[key], depth + 1);
    if (hit) return hit;
  }
  return null;
}

function packageEntry(ctx, info) {
  const { dir, pkg } = info;
  const exp = isObject(pkg.exports) ? (pkg.exports['.'] ?? pkg.exports) : pkg.exports;
  const cands = [firstLeaf(exp), pkg.module, pkg.main];
  for (const c of cands) {
    const hit = entryFile(ctx, dir, c);
    if (hit) return hit;
  }
  return resolveFile(ctx, joinRel(dir, 'src/index')) || resolveFile(ctx, joinRel(dir, 'index'));
}

function resolveWorkspace(ctx, spec) {
  const parts = spec.split('/');
  const min = spec.startsWith('@') ? 2 : 1;
  for (let n = parts.length; n >= min; n--) {
    const info = ctx.packages.get(parts.slice(0, n).join('/'));
    if (!info) continue;
    const sub = parts.slice(n).join('/');
    if (sub) {
      const hit = resolveFile(ctx, joinNorm(info.dir, sub)) || resolveFile(ctx, joinNorm(info.dir, 'src', sub));
      if (hit) return { file: hit };
    }
    const entry = packageEntry(ctx, info);
    return entry ? { file: entry } : { dir: info.dir };
  }
  return null;
}

const jsPackageName = (spec) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

function resolveJs(ctx, from, spec, emit) {
  if (!spec || /[\s${}]/.test(spec)) return;
  if (spec.startsWith('.')) {
    const hit = resolveFile(ctx, joinNorm(dirName(from), spec));
    if (hit) emit({ file: hit });
    return;
  }
  const alias = resolveAlias(ctx, spec, from);
  if (alias) return emit({ file: alias });
  const ws = resolveWorkspace(ctx, spec);
  if (ws) return emit(ws);
  if (spec.startsWith('node:') || NODE_BUILTINS.has(spec.split('/')[0]) || UNRESOLVED_ALIAS.test(spec)) return;
  emit({ ext: jsPackageName(spec) });
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

const PY_FROM = /^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n;#]*)/gm;
const PY_IMPORT = /^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)/gm;
const PY_DEF = /^(?:async[ \t]+)?(?:def|class)[ \t]+([A-Za-z]\w*)/gm;

function scanPy(text) {
  const code = text.replace(/("""|''')[\s\S]*?\1/g, '');
  const raw = [];
  for (const m of code.matchAll(PY_FROM)) {
    const names = m[3].replace(/[()\\]/g, ' ').split(',').map((n) => n.trim().split(/\s+/)[0]).filter((n) => /^\w+$/.test(n));
    raw.push({ dots: m[1].length, mod: m[2], names });
  }
  for (const m of code.matchAll(PY_IMPORT)) {
    for (const part of m[1].split(',')) raw.push({ dots: 0, mod: part.trim().split(/\s+/)[0], names: [] });
  }
  return { raw, symbols: [...text.matchAll(PY_DEF)].map((m) => m[1]) };
}

// dotted module name -> file, for project packages (regular packages from the repo root, or anything under a src root).
function buildPyModules(ctx) {
  const py = ctx.sources.filter((f) => f.endsWith('.py'));
  const inits = new Set(py.filter((f) => baseName(f) === '__init__.py').map(dirName));
  const roots = new Set(['', 'src', 'lib']);
  for (const m of ctx.manifests) {
    if (/^(pyproject\.toml|setup\.py|setup\.cfg)$/.test(baseName(m))) {
      roots.add(dirName(m));
      roots.add(joinRel(dirName(m), 'src'));
    }
  }
  const map = new Map();
  for (const f of py) {
    for (const root of [...roots].sort(sortStr)) {
      if (root && !f.startsWith(`${root}/`)) continue;
      const parts = (root ? f.slice(root.length + 1) : f).slice(0, -3).split('/');
      const isInit = parts[parts.length - 1] === '__init__';
      if (isInit) parts.pop();
      if (!parts.length) continue;
      const pkgDirs = isInit ? parts.length : parts.length - 1;
      let regular = true;
      for (let i = 1; i <= pkgDirs && !root; i++) regular = regular && inits.has(parts.slice(0, i).join('/'));
      if (regular && !map.has(parts.join('.'))) map.set(parts.join('.'), f);
    }
  }
  return map;
}

function resolvePy(ctx, from, imp, emit) {
  const has = (f) => ctx.fileSet.has(f);
  const fileOf = (base) => [`${base}.py`, joinRel(base, '__init__.py')].find(has) || null;
  const hits = [];
  if (imp.dots) {
    let dir = dirName(from);
    for (let i = 1; i < imp.dots; i++) dir = dirName(dir);
    const base = imp.mod ? joinNorm(dir, imp.mod.replace(/\./g, '/')) : dir;
    const subs = imp.names.map((n) => fileOf(joinNorm(base, n))).filter(Boolean);
    hits.push(...subs);
    if (!imp.names.length || subs.length < imp.names.length) {
      const own = imp.mod ? fileOf(base) : has(joinRel(base, '__init__.py')) ? joinRel(base, '__init__.py') : null;
      if (own) hits.push(own);
    }
    return hits.forEach((f) => emit({ file: f }));
  }
  const parts = imp.mod.split('.');
  for (let n = parts.length; n >= 1; n--) {
    const key = parts.slice(0, n).join('.');
    if (n === parts.length) {
      const subs = imp.names.map((nm) => ctx.pyModules.get(`${key}.${nm}`)).filter(Boolean);
      hits.push(...subs);
      if (subs.length && subs.length === imp.names.length) break;
    }
    if (ctx.pyModules.has(key)) { hits.push(ctx.pyModules.get(key)); break; }
  }
  if (!hits.length) {
    const sibling = fileOf(joinNorm(dirName(from), parts.join('/')));
    if (sibling) hits.push(sibling);
  }
  if (hits.length) return hits.forEach((f) => emit({ file: f }));
  if (imp.mod && !PY_STDLIB.has(parts[0])) emit({ ext: parts[0] });
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

function scanGo(text) {
  const code = text.replace(/^[ \t]*\/\/.*$/gm, '');
  const raw = [];
  for (const m of code.matchAll(/^import\s*\(([\s\S]*?)\)/gm)) {
    for (const s of m[1].matchAll(/(?:^|\s)(?:[\w.]+\s+)?"([^"]+)"/g)) raw.push(s[1]);
  }
  for (const m of code.matchAll(/^import\s+(?:[\w.]+\s+)?"([^"]+)"/gm)) raw.push(m[1]);
  const symbols = [...code.matchAll(/^(?:func\s+([A-Z]\w*)|type\s+([A-Z]\w*))/gm)].map((m) => m[1] || m[2]);
  return { raw, symbols, isMain: /^package\s+main\b/m.test(code) && /^func\s+main\s*\(/m.test(code) };
}

function loadGoModules(ctx) {
  const mods = [];
  for (const rel of ctx.manifests.filter((m) => baseName(m) === 'go.mod')) {
    const m = (readText(ctx, rel) || '').match(/^module\s+("?)(\S+?)\1\s*$/m);
    if (m) mods.push({ module: m[2], dir: dirName(rel) });
  }
  return mods.sort((a, b) => b.module.length - a.module.length || sortStr(a.module, b.module));
}

function goPackageFile(ctx, dir, modulePath) {
  let files = ctx.goDirs.get(dir);
  if (!files) return null;
  const segs = modulePath.split('/').filter((s) => !/^v\d+$/.test(s));
  const names = [segs[segs.length - 1], 'doc', 'main'].map((n) => joinRel(dir, `${n}.go`));
  return names.find((n) => files.includes(n)) || files[0];
}

function goExternal(spec) {
  const parts = spec.split('/');
  const wide = ['github.com', 'gitlab.com', 'bitbucket.org', 'golang.org'].includes(parts[0]);
  return parts.slice(0, wide ? 3 : 2).join('/');
}

function resolveGo(ctx, spec, emit) {
  const mod = ctx.goModules.find((m) => spec === m.module || spec.startsWith(`${m.module}/`));
  if (mod) {
    const dir = joinNorm(mod.dir, spec.slice(mod.module.length + 1));
    const file = goPackageFile(ctx, dir, spec);
    return emit(file ? { file } : { dir });
  }
  if (spec.split('/')[0].includes('.')) emit({ ext: goExternal(spec) });
}

// ---------------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------------

function scanRs(text) {
  const mods = [...text.matchAll(/^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+(\w+)[ \t]*;/gm)].map((m) => m[1]);
  const uses = [];
  // One entry per statement, so `use a::{b, c}` counts as a single import.
  for (const m of text.matchAll(/^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?use[ \t]+([^;]+);/gm)) uses.push(expandUse(m[1]));
  for (const m of text.matchAll(/^[ \t]*extern[ \t]+crate[ \t]+(\w+)/gm)) uses.push([m[1]]);
  const symbols = [...text.matchAll(/^pub(?:\([^)]*\))?\s+(?:async\s+|unsafe\s+|const\s+|extern\s+"[^"]*"\s+)*(?:fn|struct|enum|trait|type)\s+(\w+)/gm)]
    .map((m) => m[1]);
  return { raw: { mods, uses }, symbols };
}

// `a::{b, c::d}` -> ["a::b", "a::c::d"]
function expandUse(src) {
  const s = src.replace(/\s+as\s+\w+/g, '').replace(/\s+/g, '').replace(/^::/, '');
  const open = s.indexOf('{');
  if (open < 0) return [s];
  const inner = s.slice(open + 1, s.lastIndexOf('}'));
  const items = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= inner.length; i++) {
    const c = inner[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if ((c === ',' && depth === 0) || i === inner.length) { items.push(inner.slice(start, i)); start = i + 1; }
  }
  return items.filter(Boolean).flatMap((it) => expandUse(s.slice(0, open) + it));
}

function loadCrates(ctx) {
  const crates = [];
  for (const rel of ctx.manifests.filter((m) => baseName(m) === 'Cargo.toml').sort(sortStr)) {
    const toml = readToml(ctx, rel);
    const name = toml?.package?.name;
    if (typeof name !== 'string') continue;
    const dir = dirName(rel);
    const roots = [];
    const addRoot = (p, kind) => {
      const f = joinNorm(dir, p);
      if (ctx.fileSet.has(f) && !roots.some((r) => r.file === f)) roots.push({ file: f, kind });
    };
    addRoot(typeof toml.lib?.path === 'string' ? toml.lib.path : 'src/lib.rs', 'lib');
    addRoot('src/main.rs', 'bin');
    for (const f of ctx.sources) if (f.startsWith(joinRel(dir, 'src/bin/')) && f.endsWith('.rs')) addRoot(f.slice(dir ? dir.length + 1 : 0), 'bin');
    for (const m of (readText(ctx, rel) || '').matchAll(/^\[\[bin\]\][^[]*?^path\s*=\s*"([^"]+)"/gms)) addRoot(m[1], 'bin');
    const deps = new Set();
    for (const [table, entries] of Object.entries(toml)) {
      if (/^(?:dev-|build-)?dependencies$/.test(table)) for (const k of Object.keys(entries)) deps.add(k.split('.')[0]);
      const sub = table.match(/^(?:dev-|build-)?dependencies\.([^.]+)$/);
      if (sub) deps.add(sub[1]);
    }
    crates.push({ name, ident: name.replace(/-/g, '_'), dir, roots, deps });
  }
  return crates;
}

function walkModules(ctx, dir, segs) {
  let last = null;
  let cur = dir;
  for (const s of segs) {
    const a = joinNorm(cur, `${s}.rs`);
    const b = joinNorm(cur, s, 'mod.rs');
    if (ctx.fileSet.has(a)) last = a;
    else if (ctx.fileSet.has(b)) last = b;
    else break;
    cur = joinNorm(cur, s);
  }
  return last;
}

function resolveRs(ctx, from, raw, emit) {
  const owner = ctx.crates.filter((c) => !c.dir || from.startsWith(`${c.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0];
  const rootFiles = owner ? owner.roots.map((r) => r.file) : [];
  const isRoot = rootFiles.includes(from);
  const modDir = isRoot || baseName(from) === 'mod.rs' ? dirName(from) : from.slice(0, -3);
  const local = new Set(raw.mods);
  for (const mod of raw.mods) {
    const hit = [joinNorm(modDir, `${mod}.rs`), joinNorm(modDir, mod, 'mod.rs')].find((f) => ctx.fileSet.has(f));
    if (hit) emit({ file: hit });
  }
  if (!owner) return;
  const rootDir = owner.roots.map((r) => dirName(r.file)).filter((d) => !d || from.startsWith(`${d}/`))
    .sort((a, b) => b.length - a.length)[0] ?? joinRel(owner.dir, 'src');
  for (const stmt of raw.uses) {
    const done = new Set();
    const once = (t) => {
      const key = t.file || t.dir || t.ext;
      if (!done.has(key)) { done.add(key); emit(t); }
    };
    for (const use of stmt) resolveUse(ctx, from, use, { owner, rootDir, rootFiles, local }, once);
  }
}

function resolveUse(ctx, from, use, scope, emit) {
  const { owner, rootDir, rootFiles, local } = scope;
  const segs = use.split('::').filter((s) => s && s !== '*' && s !== 'self');
  const head = segs[0];
  if (!head || RUST_BUILTIN.has(head) || local.has(head)) return;
  if (head === 'crate') {
    const hit = walkModules(ctx, rootDir, segs.slice(1)) || rootFiles[0];
    if (hit && hit !== from) emit({ file: hit });
    return;
  }
  const crate = ctx.crates.find((c) => c.ident === head && c !== owner);
  if (crate) {
    ctx.crateLinks.add(`${owner.name}>${crate.name}`);
    const lib = crate.roots.find((r) => r.kind === 'lib') || crate.roots[0];
    const hit = lib && (walkModules(ctx, dirName(lib.file), segs.slice(1)) || lib.file);
    if (hit) emit({ file: hit });
  } else if ([...owner.deps].some((d) => d.replace(/-/g, '_') === head)) emit({ ext: head.replace(/_/g, '-') });
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

// edges: [from, to, weight] over string ids. Scores sum to 1; 20 iterations, damping 0.85.
function pageRank(ids, edges) {
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const out = ids.map(() => []);
  const outWeight = new Array(n).fill(0);
  for (const [a, b, w] of edges) {
    out[index.get(a)].push([index.get(b), w]);
    outWeight[index.get(a)] += w;
  }
  let rank = new Array(n).fill(1 / n);
  for (let it = 0; it < 20; it++) {
    const next = new Array(n).fill(0);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      if (!outWeight[i]) dangling += rank[i];
      else for (const [j, w] of out[i]) next[j] += (rank[i] * w) / outWeight[i];
    }
    rank = next.map((v) => (1 - 0.85) / n + 0.85 * (v + dangling / n));
  }
  return new Map(ids.map((id, i) => [id, Math.round(rank[i] * 1e6) / 1e6]));
}

function inDegrees(edges) {
  const sources = new Map();
  for (const [a, b] of edges) {
    if (!sources.has(b)) sources.set(b, new Set());
    sources.get(b).add(a);
  }
  return (id) => (sources.get(id) ? sources.get(id).size : 0);
}

const byScore = (score, indeg, key) => (a, b) =>
  score.get(b[key]) - score.get(a[key]) || indeg(b[key]) - indeg(a[key]) || sortStr(a[key], b[key]);

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function packageEntryPoints(ctx, add) {
  const dirsWithSource = new Set();
  for (const f of ctx.sources) for (let d = dirName(f); d; d = dirName(d)) dirsWithSource.add(d);
  for (const rel of ctx.manifests.filter((m) => baseName(m) === 'package.json').slice(0, 200)) {
    const pkg = readJson(ctx, rel);
    if (!pkg) continue;
    const dir = dirName(rel);
    const src = `${rel}`;
    const give = (value, kind, label) => {
      const f = entryFile(ctx, dir, value);
      if (f) add(f, kind, `${src} "${label}"`);
    };
    give(pkg.main, 'package-main', 'main');
    give(pkg.module, 'package-module', 'module');
    if (typeof pkg.bin === 'string') give(pkg.bin, 'package-bin', 'bin');
    else if (isObject(pkg.bin)) for (const [k, v] of Object.entries(pkg.bin)) give(v, 'package-bin', `bin.${k}`);
    if (pkg.exports !== undefined) give(firstLeaf(isObject(pkg.exports) ? pkg.exports['.'] ?? pkg.exports : pkg.exports), 'package-exports', 'exports');
    for (const [name, cmd] of Object.entries(isObject(pkg.scripts) ? pkg.scripts : {})) {
      if (typeof cmd !== 'string') continue;
      for (const m of cmd.matchAll(/(?:^|[\s=])(?:\.\/)?((?:[\w@.-]+\/)*[\w.-]+\.(?:[cm]?[jt]s|[jt]sx))(?=\s|$)/g)) {
        const f = joinNorm(dir, m[1]);
        if (ctx.fileSet.has(f) && !/\.config\./.test(f)) add(f, 'package-script', `${src} scripts.${name}`);
      }
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const has = (re) => Object.keys(deps).some((d) => re.test(d));
    const dirs = (kind, names) => {
      for (const n of names) {
        const d = joinNorm(dir, n);
        if (dirsWithSource.has(d)) add(d, kind, `${src} dependency`);
      }
    };
    if (has(/^next$/)) { dirs('next-app', ['app', 'src/app']); dirs('next-pages', ['pages', 'src/pages']); }
    if (has(/^@remix-run\//)) dirs('remix-routes', ['app/routes']);
    if (has(/^@sveltejs\/kit$/)) dirs('sveltekit-routes', ['src/routes']);
  }
}

function otherEntryPoints(ctx, add) {
  for (const rel of ctx.manifests.filter((m) => baseName(m) === 'pyproject.toml')) {
    const toml = readToml(ctx, rel) || {};
    for (const table of ['project.scripts', 'tool.poetry.scripts']) {
      for (const [name, target] of Object.entries(toml[table] || {})) {
        const mod = typeof target === 'string' ? target.split(':')[0].trim() : '';
        const f = ctx.pyModules.get(mod);
        if (f) add(f, 'python-script', `${rel} [${table}] ${name}`);
      }
    }
  }
  for (const f of ctx.sources) {
    if (baseName(f) === '__main__.py') add(f, 'python-main', '__main__.py');
  }
  for (const f of ctx.goMains) add(f, 'go-main', 'package main');
  for (const c of ctx.crates) {
    for (const r of c.roots) if (r.kind === 'bin') add(r.file, 'rust-bin', `${joinRel(c.dir, 'Cargo.toml')} (${c.name})`);
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function emptyGraph(root, warnings) {
  return {
    root, languages: [], files: 0, testFiles: 0, nodes: [], edges: [], externals: [],
    central: { files: [], modules: [] }, entryPoints: [], repoMap: [], warnings: [...new Set(warnings)].sort(sortStr),
  };
}

function createContext(root, warnings) {
  const { sources, manifests } = walk(root, warnings);
  const tests = sources.filter(isTestPath);
  const code = sources.filter((f) => !isTestPath(f));
  const ctx = {
    root, warnings, cache: new Map(), skippedLarge: 0, testFiles: tests.length,
    sources: code, fileSet: new Set(code), manifests, manifestSet: new Set(manifests),
    packages: new Map(), pyModules: new Map(), goModules: [], goDirs: new Map(), goMains: [], crates: [], crateLinks: new Set(),
  };
  for (const rel of manifests.filter((m) => baseName(m) === 'package.json').sort(sortStr)) {
    const name = readJson(ctx, rel)?.name;
    if (typeof name === 'string' && name && !ctx.packages.has(name)) ctx.packages.set(name, { dir: dirName(rel), pkg: readJson(ctx, rel) });
  }
  ctx.pyModules = buildPyModules(ctx);
  ctx.goModules = loadGoModules(ctx);
  for (const f of code.filter((x) => x.endsWith('.go'))) {
    if (!ctx.goDirs.has(dirName(f))) ctx.goDirs.set(dirName(f), []);
    ctx.goDirs.get(dirName(f)).push(f);
  }
  ctx.crates = loadCrates(ctx);
  return ctx;
}

// Reads every source file once: imports (resolved to deps) and exported symbols.
function scanFiles(ctx) {
  const deps = [];
  const symbols = new Map();
  const loc = (f) => (target) => deps.push({ from: f, ...target });
  for (const f of ctx.sources) {
    const text = readText(ctx, f);
    if (text === null) continue;
    if (GENERATED_HEAD.test(text.slice(0, 300))) { ctx.fileSet.delete(f); continue; }
    const emit = loc(f);
    const family = FAMILY[LANG_BY_EXT[extOf(f)]];
    let scan;
    if (family === 'js') { scan = scanJs(text, f); scan.raw.forEach((s) => resolveJs(ctx, f, s, emit)); }
    else if (family === 'py') { scan = scanPy(text); scan.raw.forEach((i) => resolvePy(ctx, f, i, emit)); }
    else if (family === 'go') {
      scan = scanGo(text);
      scan.raw.forEach((s) => resolveGo(ctx, s, emit));
      if (scan.isMain) ctx.goMains.push(f);
    } else { scan = scanRs(text); resolveRs(ctx, f, scan.raw, emit); }
    symbols.set(f, [...new Set(scan.symbols)].slice(0, MAX_SYMBOLS));
  }
  return { deps, symbols };
}

function analyze(root, opts, warnings) {
  const ctx = createContext(root, warnings);
  const members = findMembers(ctx);
  const group = makeGrouper(members);
  const { deps, symbols } = scanFiles(ctx);
  const files = ctx.sources.filter((f) => ctx.fileSet.has(f));
  if (ctx.skippedLarge) warnings.push(`skipped ${ctx.skippedLarge} file(s) over ${MAX_BYTES / 1024 / 1024} MB`);

  const fileEdges = new Map();
  const groupEdges = new Map();
  const externals = new Map();
  const kinds = new Map();
  const fileCounts = new Map();
  for (const f of files) {
    const g = group.ofFile(f);
    kinds.set(g.id, g.kind);
    bump(fileCounts, g.id);
  }
  for (const d of deps) {
    if (d.ext) { bump(externals, d.ext); continue; }
    const from = group.ofFile(d.from);
    const to = d.file ? group.ofFile(d.file) : group.ofDir(d.dir);
    if (d.file && d.file !== d.from) bump(fileEdges, `${d.from}\0${d.file}`);
    if (from.id !== to.id) {
      kinds.set(to.id, to.kind);
      bump(groupEdges, `${from.id}\0${to.id}`);
    }
  }

  // Cargo [dependencies] between workspace crates, when no `use` produced a link already.
  for (const a of ctx.crates) {
    for (const b of ctx.crates) {
      if (a === b || !a.deps.has(b.name) || !a.roots.length || !b.roots.length) continue;
      if (ctx.crateLinks.has(`${a.name}>${b.name}`)) continue;
      const from = a.roots[0].file;
      const to = (b.roots.find((r) => r.kind === 'lib') || b.roots[0]).file;
      bump(fileEdges, `${from}\0${to}`);
      const ga = group.ofFile(from);
      const gb = group.ofFile(to);
      kinds.set(ga.id, ga.kind);
      kinds.set(gb.id, gb.kind);
      if (ga.id !== gb.id) bump(groupEdges, `${ga.id}\0${gb.id}`);
    }
  }

  const fileList = [...fileEdges].map(([k, w]) => [...k.split('\0'), w]).sort((x, y) => sortStr(x[0], y[0]) || sortStr(x[1], y[1]));
  const filesById = files.slice().sort(sortStr);
  const fScore = filesById.length ? pageRank(filesById, fileList) : new Map();
  const fIn = inDegrees(fileList);

  let edgeList = [...groupEdges].map(([k, w]) => { const [from, to] = k.split('\0'); return { from, to, weight: w }; })
    .sort((x, y) => sortStr(x.from, y.from) || sortStr(x.to, y.to));
  if (edgeList.length > MAX_EDGES) {
    warnings.push(`edge list truncated to the ${MAX_EDGES} heaviest of ${edgeList.length}`);
    edgeList = edgeList.sort((x, y) => y.weight - x.weight || sortStr(x.from, y.from) || sortStr(x.to, y.to))
      .slice(0, MAX_EDGES).sort((x, y) => sortStr(x.from, y.from) || sortStr(x.to, y.to));
  }
  const ids = [...kinds.keys()].sort(sortStr);
  const triples = edgeList.map((e) => [e.from, e.to, e.weight]);
  const mScore = ids.length ? pageRank(ids, triples) : new Map();
  const mIn = inDegrees(triples);
  const nodes = ids.map((id) => ({ id, files: fileCounts.get(id) || 0, kind: kinds.get(id), score: mScore.get(id) }));

  const entries = new Map();
  const add = (p, kind, source) => { if (!entries.has(`${p}\0${kind}`)) entries.set(`${p}\0${kind}`, { path: p, kind, source }); };
  packageEntryPoints(ctx, add);
  otherEntryPoints(ctx, add);
  // One row per path; the most specific kind wins.
  const rank = (k) => ENTRY_KINDS.indexOf(k);
  const byPath = new Map();
  for (const e of entries.values()) if (!byPath.has(e.path) || rank(e.kind) < rank(byPath.get(e.path).kind)) byPath.set(e.path, e);
  const entryPoints = [...byPath.values()].sort((a, b) => sortStr(a.path, b.path)).slice(0, 50);

  const ranked = filesById.slice().sort((a, b) => fScore.get(b) - fScore.get(a) || fIn(b) - fIn(a) || sortStr(a, b));
  const repoMap = [];
  for (const f of ranked) {
    if (repoMap.length >= opts.budget) break;
    if (symbols.get(f)?.length && !CONFIG_FILE.test(f)) repoMap.push({ path: f, symbols: symbols.get(f) });
  }

  const langCounts = new Map();
  for (const f of files) bump(langCounts, LANG_BY_EXT[extOf(f)]);
  return {
    root,
    languages: [...langCounts].map(([name, n]) => ({ name, files: n })).sort((a, b) => b.files - a.files || sortStr(a.name, b.name)),
    files: files.length,
    testFiles: ctx.testFiles,
    nodes,
    edges: edgeList,
    externals: [...externals].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || sortStr(a.name, b.name)).slice(0, 20),
    central: {
      files: ranked.slice(0, TOP_CENTRAL).map((p) => ({ path: p, score: fScore.get(p), inDegree: fIn(p) })),
      modules: nodes.slice().sort(byScore(mScore, mIn, 'id')).slice(0, TOP_CENTRAL)
        .map((n) => ({ id: n.id, score: n.score, inDegree: mIn(n.id), files: n.files })),
    },
    entryPoints,
    repoMap,
    warnings: [...new Set(warnings)].sort(sortStr),
  };
}

export function buildGraph(dir = process.cwd(), opts = {}) {
  const o = { budget: 60, ...opts };
  const root = path.resolve(dir);
  const warnings = [];
  try {
    if (!fs.statSync(root).isDirectory()) {
      warnings.push(`not a directory: ${root}`);
      return emptyGraph(root, warnings);
    }
    return analyze(root, o, warnings);
  } catch (err) {
    warnings.push(`graph failed: ${err && err.message ? err.message : err}`);
    return emptyGraph(root, warnings);
  }
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const FOOTER = 'Generated by scripts/graph.mjs. Re-run /claude-setup --update to refresh.';
const mermaidLabel = (id) => (id === '.' ? '(root)' : id).replace(/["#<>`]/g, "'");

function mermaidBlock(graph, maxNodes) {
  const degree = new Map();
  for (const e of graph.edges) { bump(degree, e.from); bump(degree, e.to); }
  const shown = graph.nodes.slice()
    .sort((a, b) => b.score - a.score || (degree.get(b.id) || 0) - (degree.get(a.id) || 0) || sortStr(a.id, b.id))
    .slice(0, maxNodes).map((n) => n.id).sort(sortStr);
  const idOf = new Map();
  const used = new Set();
  for (const id of shown) {
    const base = `n_${id === '.' ? 'root' : id.replace(/[^A-Za-z0-9]/g, '_')}`;
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
    used.add(name);
    idOf.set(id, name);
  }
  let edges = graph.edges.filter((e) => idOf.has(e.from) && idOf.has(e.to));
  const hiddenEdges = Math.max(0, edges.length - MAX_MERMAID_EDGES);
  if (hiddenEdges) {
    edges = edges.sort((a, b) => b.weight - a.weight || sortStr(a.from, b.from) || sortStr(a.to, b.to))
      .slice(0, MAX_MERMAID_EDGES).sort((a, b) => sortStr(a.from, b.from) || sortStr(a.to, b.to));
  }
  const lines = ['flowchart LR'];
  for (const id of shown) lines.push(`  ${idOf.get(id)}["${mermaidLabel(id)}"]`);
  for (const e of edges) {
    lines.push(`  ${idOf.get(e.from)} -->${e.weight > 1 ? `|${e.weight}|` : ''} ${idOf.get(e.to)}`);
  }
  const hidden = graph.nodes.length - shown.length;
  let note = hidden > 0
    ? `Showing ${shown.length} of ${graph.nodes.length} modules, chosen by centrality; ${hidden} hidden.`
    : `Showing all ${shown.length} modules.`;
  if (hiddenEdges) note += ` ${hiddenEdges} lighter edges hidden.`;
  return `\`\`\`mermaid\n${lines.join('\n')}\n\`\`\`\n\n${note}`;
}

export function renderMarkdown(graph, opts = {}) {
  const maxNodes = opts.maxNodes ?? 25;
  const langs = (graph.languages || []).map((l) => l.name).join(', ') || 'none';
  const out = [`Source files: ${graph.files} (plus ${graph.testFiles} test files). Languages: ${langs}.`, '', '### Module graph', ''];
  out.push(graph.nodes.length ? mermaidBlock(graph, maxNodes) : 'No source files found.');
  out.push('', '### Entry points', '');
  if (graph.entryPoints.length) {
    for (const e of graph.entryPoints.slice(0, 20)) out.push(`- \`${e.path}\` (${e.kind}, ${e.source})`);
    if (graph.entryPoints.length > 20) out.push(`- ... ${graph.entryPoints.length - 20} more`);
  } else out.push('- None detected.');
  out.push('', '### Central modules', '');
  if (graph.central.modules.length) {
    for (const m of graph.central.modules.slice(0, 8)) {
      out.push(`- \`${m.id === '.' ? '(root)' : m.id}\`: imported by ${m.inDegree} module${m.inDegree === 1 ? '' : 's'}, ${m.files} file${m.files === 1 ? '' : 's'}`);
    }
  } else out.push('- None.');
  out.push('', '### Repo map', '', '```text');
  if (graph.repoMap.length) for (const r of graph.repoMap) out.push(`${r.path}: ${r.symbols.join(', ')}`);
  else out.push('(no exported symbols found)');
  out.push('```', '', FOOTER, '');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = 'usage: node graph.mjs [dir] [--json | --markdown] [--max-nodes N] [--budget LINES]\n';

function parseArgs(argv) {
  const o = { dir: null, format: null, maxNodes: 25, budget: 60, help: false, error: null };
  for (let i = 0; i < argv.length && !o.error; i++) {
    const [flag, inline] = argv[i].startsWith('--') ? argv[i].split(/=(.*)/s) : [argv[i]];
    if (flag === '-h' || flag === '--help') o.help = true;
    else if (flag === '--json' || flag === '--markdown') {
      if (o.format && o.format !== flag.slice(2)) o.error = '--json and --markdown are exclusive';
      o.format = flag.slice(2);
    } else if (flag === '--max-nodes' || flag === '--budget') {
      const n = Number(inline ?? argv[++i]);
      const min = flag === '--budget' ? 0 : 1;
      if (!Number.isInteger(n) || n < min) o.error = `${flag} needs an integer >= ${min}`;
      else if (flag === '--budget') o.budget = n;
      else o.maxNodes = n;
    } else if (argv[i].startsWith('-')) o.error = `unknown option ${argv[i]}`;
    else if (o.dir) o.error = 'only one directory is accepted';
    else o.dir = argv[i];
  }
  return o;
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return void process.stdout.write(USAGE);
  if (args.error) {
    process.stderr.write(`graph.mjs: ${args.error}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  const graph = buildGraph(args.dir || process.cwd(), { budget: args.budget, maxNodes: args.maxNodes });
  process.stdout.write(args.format === 'json'
    ? `${JSON.stringify(graph, null, 2)}\n`
    : renderMarkdown(graph, { maxNodes: args.maxNodes }));
}

if (isEntryPoint()) main();
