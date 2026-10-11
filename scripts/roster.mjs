#!/usr/bin/env node
// Deterministic agent-roster deriver. Roles exist only where the repo shows evidence.
// Usage: node scripts/roster.mjs [dir] [--intent "text"] [--json | --markdown | --router-config]
// Zero dependencies, never throws. Exit 0 (2 on usage error).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, SKIP_DIRS } from './detect.mjs';
import { buildGraph } from './graph.mjs';

const MAX_ROLES = 8; // besides explorer
const MAX_WALK = 12000;
const MAX_DEPTH = 8;
const MAX_MANIFESTS = 80;
const MAX_SCAN = 4000; // source files read for the import scan
const MAX_READ = 256 * 1024;
const TIERS = { fast: 'haiku', standard: 'sonnet', deep: 'opus' };
const RO = ['Read', 'Grep', 'Glob'];
const TOOLS = { ro: RO, run: [...RO, 'Bash'], write: [...RO, 'Edit', 'Write', 'Bash'] };
const TIER = { explorer: 'fast', 'test-runner': 'fast', docs: 'fast', release: 'fast', 'test-writer': 'standard',
  frontend: 'standard', backend: 'standard', data: 'standard', infra: 'standard', mobile: 'standard' };

// Dependency evidence. `node` rules match package.json deps, `other` rules match tokens of other manifests.
// A trailing * is a prefix match; otherwise exact (or a Go-style path prefix).
const DEPS = {
  frontend: {
    node: ['next', 'react', 'react-dom', 'vue', 'nuxt', 'svelte', '@sveltejs/kit', '@angular/core', 'astro', 'solid-js', '@remix-run/react', 'react-router', 'react-router-dom', 'preact', '@builder.io/qwik'],
    other: [] },
  backend: {
    node: ['express', 'fastify', 'hono', '@nestjs/core', 'koa', '@hapi/hapi', '@trpc/server', 'elysia'],
    other: ['django', 'fastapi', 'flask', 'starlette', 'aiohttp', 'tornado', 'sanic', 'litestar', 'rails', 'sinatra', 'spring-boot-starter-web*', 'quarkus*', 'micronaut*',
      'laravel/framework', 'symfony/framework-bundle', 'slim/slim', 'github.com/gin-gonic/gin', 'github.com/labstack/echo', 'github.com/go-chi/chi', 'github.com/gofiber/fiber',
      'github.com/gorilla/mux', 'axum', 'actix-web', 'rocket'] },
  data: {
    node: ['prisma', '@prisma/client', 'drizzle-orm', 'drizzle-kit', 'typeorm', 'sequelize', 'mongoose', 'knex', 'kysely', '@mikro-orm/core'],
    other: ['sqlalchemy', 'alembic', 'sqlmodel', 'tortoise-orm', 'peewee', 'activerecord', 'flyway*', 'liquibase*', 'spring-boot-starter-data-jpa', 'sqlx', 'diesel', 'sea-orm',
      'gorm.io/gorm', 'github.com/pressly/goose', 'github.com/golang-migrate/migrate', 'entgo.io/ent', 'doctrine/orm', 'doctrine/dbal'] },
  mobile: {
    node: ['react-native', 'expo', '@capacitor/core', '@ionic/core', 'nativescript'],
    other: ['flutter'] },
  docs: {
    node: ['@astrojs/starlight', '@docusaurus/core', 'vitepress', 'nextra', 'vuepress'],
    other: ['mkdocs', 'mkdocs-material', 'sphinx', 'mdbook'] },
  security: {
    node: ['next-auth', '@auth/*', 'passport', 'passport-*', 'lucia', 'lucia-auth', '@clerk/*', '@supabase/ssr', '@supabase/auth-helpers-*', '@supabase/auth-js', 'better-auth', '@auth0/*',
      'stripe', '@stripe/*', 'braintree', '@paddle/*', '@adyen/*', 'jsonwebtoken', 'jose', 'bcrypt', 'bcryptjs', 'argon2', 'express-session', 'cookie-session', 'iron-session', '@fastify/session'],
    other: ['authlib', 'fastapi-users', 'python-jose', 'pyjwt', 'passlib', 'flask-login', 'flask-session', 'stripe', 'braintree', 'paddle*', 'adyen', 'bcrypt', 'argon2-cffi', 'cryptography',
      'devise', 'spring-security*', 'spring-boot-starter-security', 'laravel/sanctum', 'laravel/passport', 'github.com/golang-jwt/jwt', 'golang.org/x/crypto', 'jsonwebtoken', 'argon2', 'ring'] },
};
const EXCLUDE_IF = [
  { drop: ['react', 'react-dom', 'react-router', 'react-router-dom'], when: ['react-native', 'expo'] },
  { drop: ['astro'], when: ['@astrojs/starlight'] },
  { drop: ['next', 'react', 'react-dom'], when: ['nextra'] },
];
const NAME_ALIAS = { '@sveltejs/kit': 'sveltekit', '@angular/core': 'angular', '@remix-run/react': 'remix', '@nestjs/core': 'nestjs', '@trpc/server': 'trpc',
  '@prisma/client': 'prisma', '@astrojs/starlight': 'starlight', '@docusaurus/core': 'docusaurus', '@mikro-orm/core': 'mikro-orm', '@capacitor/core': 'capacitor',
  'github.com/gin-gonic/gin': 'gin', 'github.com/labstack/echo': 'echo', 'github.com/go-chi/chi': 'chi', 'github.com/gofiber/fiber': 'fiber', 'github.com/gorilla/mux': 'gorilla-mux',
  'gorm.io/gorm': 'gorm', 'laravel/framework': 'laravel' };

const KW = {
  frontend: 'component page ui css style layout button form render hook tailwind modal navbar responsive theme view'.split(' '),
  backend: 'endpoint api route handler controller middleware server request response auth validation rest graphql webhook'.split(' '),
  data: 'migration schema model query table index orm database sql seed column relation'.split(' '),
  infra: 'docker dockerfile deploy ci pipeline terraform k8s kubernetes helm env workflow container compose'.split(' '),
  'test-runner': 'flaky failing lint typecheck regression ci run'.split(' '),
  'test-writer': 'test spec coverage e2e assertion mock fixture snapshot'.split(' '),
  docs: 'docs documentation readme guide tutorial example typo'.split(' '),
  mobile: 'screen ios android expo native navigation simulator'.split(' '),
  release: 'release version changelog publish bump tag semver'.split(' '),
};
const ORDER = ['frontend', 'backend', 'data', 'infra', 'mobile', 'docs', 'test-runner', 'test-writer', 'reviewer', 'security-reviewer', 'release'];
// Merge targets when over the role cap, nearest first; evicted lowest-evidence first (ties by this order).
const MERGE = { release: ['docs', 'infra', 'backend', 'frontend'], docs: ['frontend', 'backend'], mobile: ['frontend'], infra: ['backend'],
  'test-writer': ['backend', 'frontend'], data: ['backend'], frontend: ['backend'], backend: ['frontend'] };
const EVICT = ['release', 'docs', 'mobile', 'infra', 'test-writer', 'data', 'frontend', 'backend'];
const REVIEWER = { node: 'ts', deno: 'ts', python: 'python', go: 'go', rust: 'rust', jvm: 'jvm', ruby: 'ruby', dotnet: 'dotnet', php: 'php' };

const INTENT = [
  ['mobile', /\b(?:mobile app|ios app|android app|react native|flutter|expo)\b/i],
  ['frontend', /\b(?:admin dashboard|dashboard|web ?app|website|front-?end|landing page|user interface|ui)\b/i],
  ['backend', /\b(?:rest(?:ful)? api|graphql|api|back-?end|server|microservices?|webhooks?)\b/i],
  ['data', /\b(?:database|postgres(?:ql)?|mysql|sqlite|mongodb|data model|migrations?)\b/i],
  ['infra', /\b(?:deploy(?:ing)?\s+(?:it\s+)?to\s+(?:k8s|kubernetes|aws|gcp|azure|docker|fly|cloud)|kubernetes|k8s|terraform|docker|ci\/cd|infrastructure)\b/i],
  ['docs', /\b(?:docs site|documentation site)\b/i],
];

const SRC_EXT = new Set('ts tsx js jsx mjs cjs py go rs java kt rb php cs ex swift dart vue svelte astro'.split(' '));
const UI_EXT = new Set(['tsx', 'jsx', 'vue', 'svelte', 'astro']);
const EXCL = /(^|\/)(node_modules|examples?|_examples|fixtures?|tests?|__tests__|spec|docs?|docs_src|vendor|templates?|samples?|e2e|cypress|scripts|\.github)(\/|$)/;
const EXCL_MANIFEST = /(^|\/)(node_modules|examples?|_examples|fixtures?|templates?|samples?|vendor)(\/|$)/;
const KEEP_DOT = new Set(['.github', '.changeset', '.vitepress']);
const DIR_KINDS = {
  frontend: ['app', 'pages', 'components', 'views', 'ui', 'layouts'],
  backend: ['api', 'server', 'routes', 'controllers', 'handlers', 'backend', 'endpoints'],
  data: ['prisma', 'migrations', 'migrate', 'alembic', 'drizzle', 'db'],
  security: ['auth', 'authentication', 'security', 'sessions', 'payments', 'billing', 'checkout'],
};
const DATA_FILE = /(^|\/)(schema\.prisma|alembic\.ini|sqlc\.ya?ml|knexfile\.\w+|drizzle\.config\.\w+|ormconfig\.\w+|flyway\.conf|liquibase\.properties)$/;
const MANIFEST = /^(package\.json|pyproject\.toml|requirements[\w.-]*\.txt|Pipfile|go\.mod|Cargo\.toml|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?|pubspec\.yaml)$/;

const uniq = (a) => [...new Set(a)];
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const depth = (p) => (p ? p.split('/').length : 0);
const short = (n) => NAME_ALIAS[n] || n.replace(/^@/, '').split('/')[0].replace(/-\*$/, '');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function readText(root, rel) {
  try {
    const fd = fs.openSync(path.join(root, rel), 'r');
    try {
      const buf = Buffer.alloc(MAX_READ);
      return buf.subarray(0, fs.readSync(fd, buf, 0, MAX_READ, 0)).toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

function walkTree(root) {
  const files = [];
  const queue = [''];
  let seen = 0;
  while (queue.length && seen < MAX_WALK) {
    const rel = queue.shift();
    let ents;
    try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of ents) {
      seen++;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || (e.name.startsWith('.') && !KEEP_DOT.has(e.name))) continue;
        if (depth(r) < MAX_DEPTH) queue.push(r);
      } else if (e.isFile()) files.push(r);
    }
  }
  const dirs = new Map(); // dir -> { total, ui, src }
  for (const f of files) {
    const ext = f.includes('.') ? f.slice(f.lastIndexOf('.') + 1) : '';
    for (let d = dirOf(f); d; d = dirOf(d)) {
      const s = dirs.get(d) || { total: 0, ui: 0, src: 0 };
      s.total++;
      if (UI_EXT.has(ext)) s.ui++;
      if (SRC_EXT.has(ext)) s.src++;
      dirs.set(d, s);
    }
  }
  return { files, dirs };
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*/;
const DEVKEY = /^(dev|devel|development|test|tests|testing|lint|docs?|typing|types|check|ci|qa|build)/i;
const LANG_OF = { 'package.json': 'js', 'pyproject.toml': 'py', Pipfile: 'py', 'go.mod': 'go', 'Cargo.toml': 'rs' };
const manLang = (base) => LANG_OF[base] || (/^requirements/.test(base) ? 'py' : '');
const RANK = { runtime: 4, optional: 3, peer: 2, dev: 1, test: 0 };

// Parse a non-JSON manifest into [name, group] pairs; group is runtime|optional|dev.
function parseText(base, text) {
  const out = [];
  const add = (n, g) => { const m = NAME.exec(String(n).trim()); if (m) out.push([m[0].toLowerCase().replace(/_/g, '-'), g]); };
  const lines = text.split('\n').map((l) => l.replace(/(^|\s)#.*$/, ''));
  if (base === 'pyproject.toml' || base === 'Cargo.toml' || base === 'Pipfile') {
    let sec = '';
    let grp = null;
    let arr = false;
    for (const l of lines) {
      const h = /^\s*\[+\s*([^\]]+?)\s*\]+\s*$/.exec(l);
      if (h) {
        sec = h[1]; grp = null; arr = false;
        const t = /^(?:[\w.-]+\.)?(dependencies|dev-dependencies|build-dependencies)\.([\w-]+)$/.exec(sec);
        if (base === 'Cargo.toml' && t) add(t[2], t[1] === 'dependencies' ? 'runtime' : 'dev');
        continue;
      }
      const k = /^\s*([\w.-]+)\s*=\s*(.*)$/.exec(l);
      if (base === 'Cargo.toml') { if (k && /(^|\.)(dev-|build-)?dependencies$/.test(sec)) add(k[1].split('.')[0], /(dev|build)-/.test(sec) ? 'dev' : 'runtime'); continue; }
      if (base === 'Pipfile') { if (k && /^(dev-)?packages$/.test(sec)) add(k[1], sec === 'packages' ? 'runtime' : 'dev'); continue; }
      if (!arr && k) {
        grp = null;
        if (sec === 'project' && k[1] === 'dependencies') grp = 'runtime';
        else if (sec === 'project.optional-dependencies') grp = DEVKEY.test(k[1]) ? 'dev' : 'optional';
        else if (sec === 'dependency-groups' || sec === 'tool.pdm.dev-dependencies' || (sec === 'tool.uv' && k[1] === 'dev-dependencies')) grp = 'dev';
        else if (/^tool\.poetry(\.group\.main)?\.dependencies$/.test(sec)) add(k[1], 'runtime');
        else if (/^tool\.poetry(\.dev-dependencies|\.group\.[\w-]+\.dependencies)$/.test(sec)) add(k[1], 'dev');
        if (grp) { for (const s of k[2].matchAll(/"([^"]+)"|'([^']+)'/g)) add(s[1] || s[2], grp); arr = !/\]/.test(k[2]); if (!arr) grp = null; }
      } else if (arr && grp) {
        for (const s of l.matchAll(/"([^"]+)"|'([^']+)'/g)) add(s[1] || s[2], grp);
        if (/\]/.test(l)) { arr = false; grp = null; }
      }
    }
  } else if (/^requirements/.test(base)) {
    const g = /dev|test|lint|doc/i.test(base) ? 'dev' : 'runtime';
    for (const l of lines) if (!/^\s*-/.test(l)) add(l, g);
  } else if (base === 'go.mod') {
    for (const l of text.split('\n')) {
      const m = /^\s*(?:require\s+)?([\w.~-]+\.[\w.~-]*\/[\w./~-]+)\s+v\S+/.exec(l);
      if (m && !/\/\/\s*indirect/.test(l)) out.push([m[1].toLowerCase(), 'runtime']);
    }
  } else if (base === 'Gemfile') {
    const stack = [];
    for (const l of lines) {
      if (/^\s*group\b/.test(l) && /\bdo\b/.test(l)) stack.push(/:(development|test)/.test(l) ? 'dev' : 'runtime');
      else if (/^\s*end\b/.test(l)) stack.pop();
      const m = /^\s*gem\s+['"]([^'"]+)['"]/.exec(l);
      if (m) add(m[1], stack.includes('dev') ? 'dev' : 'runtime');
    }
  } else if (base === 'composer.json') {
    try {
      const j = JSON.parse(text);
      for (const n of Object.keys(j.require || {})) add(n, 'runtime');
      for (const n of Object.keys(j['require-dev'] || {})) add(n, 'dev');
    } catch { /* unreadable */ }
  } else if (base === 'pubspec.yaml') {
    let g = '';
    for (const l of lines) {
      const t = /^(dependencies|dev_dependencies):/.exec(l);
      if (t) g = t[1] === 'dependencies' ? 'runtime' : 'dev';
      else if (/^\S/.test(l)) g = '';
      else if (g) { const m = /^\s{2}([\w-]+):/.exec(l); if (m) add(m[1], g); }
    }
  } else { // pom.xml, build.gradle(.kts)
    for (const l of lines) {
      const g = /^\s*(test|androidTest)\w*[\s(]/.test(l) ? 'dev' : 'runtime';
      for (const t of l.toLowerCase().match(/[a-z0-9_.@/-]+/g) || []) add(t, g);
    }
  }
  return out;
}

// manifests: [{ path, dir, eco, lang, deps: Map(name -> { v: version, g: group }) }]
function scanManifests(root, tree, det) {
  const paths = tree.files.filter((f) => MANIFEST.test(baseOf(f)) && !EXCL_MANIFEST.test(dirOf(f)))
    .sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : 1)).slice(0, MAX_MANIFESTS);
  const out = [];
  const put = (m, n, v, g) => { const cur = m.deps.get(n); if (!cur || RANK[g] > RANK[cur.g]) m.deps.set(n, { v: v || (cur && cur.v) || '', g }); };
  const mkM = (p) => ({ path: p, dir: dirOf(p), eco: baseOf(p) === 'package.json' ? 'node' : 'other', lang: manLang(baseOf(p)), deps: new Map() });
  for (const p of paths) {
    const m = mkM(p);
    const text = readText(root, p);
    if (m.eco === 'node') {
      try {
        const j = JSON.parse(text);
        for (const [k, g] of [['dependencies', 'runtime'], ['optionalDependencies', 'optional'], ['peerDependencies', 'peer'], ['devDependencies', 'dev']]) {
          for (const [n, v] of Object.entries(j[k] || {})) put(m, n, typeof v === 'string' ? v : '', g);
        }
      } catch { /* unreadable manifest */ }
    } else for (const [n, g] of parseText(baseOf(p), text)) put(m, n, '', g);
    out.push(m);
  }
  for (const f of (det && det.frameworks) || []) { // detect knows catalogs and workspace ranges
    if (!f || !f.name || !f.where) continue;
    let m = out.find((x) => x.path === f.where);
    if (!m) { m = mkM(f.where); out.push(m); }
    const cur = m.deps.get(f.name);
    if (!cur) put(m, f.name, f.version, RANK[f.group] === undefined ? 'runtime' : f.group);
    else if (!cur.v && f.version) cur.v = f.version;
  }
  return out;
}

const ruleHit = (rule, dep) => (rule.endsWith('*') ? dep.startsWith(rule.slice(0, -1)) : dep === rule || (rule.includes('/') && dep.startsWith(`${rule}/`)));

function depHits(kind, manifests, det) {
  const known = new Set(((det && det.frameworks) || []).map((f) => f.name));
  const hits = [];
  for (const m of manifests) {
    const rules = DEPS[kind][m.eco];
    const dropped = new Set(EXCLUDE_IF.filter((x) => x.when.some((w) => m.deps.has(w))).flatMap((x) => x.drop));
    for (const [name, info] of [...m.deps].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (dropped.has(name) && kind === 'frontend') continue;
      if (rules.some((r) => ruleHit(r, name))) {
        const v = String(info.v || '').replace(/^[\^~>=<\s]+/, '');
        hits.push({ name, version: /^\d/.test(v) ? v : '', where: m.path, dir: m.dir, group: info.g, lang: m.lang, framework: known.has(name) });
      }
    }
  }
  return hits.sort((a, b) => depth(a.where) - depth(b.where) || (a.where < b.where ? -1 : a.where > b.where ? 1 : 0) || (a.name < b.name ? -1 : 1));
}

const depWhy = (h) => `${h.framework ? 'framework' : 'dependency'} ${h.name}${h.version ? `@${h.version}` : ''}${h.group === 'dev' || h.group === 'test' ? ' (dev)' : ''} in ${h.where}`;

// Light import scan: which source files import which declared libraries.
const FILE_LANG = { ts: 'js', tsx: 'js', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', mts: 'js', cts: 'js', vue: 'js', svelte: 'js', astro: 'js', py: 'py', go: 'go', rs: 'rs' };
const PY_ALIAS = { pyjwt: 'jwt', 'python-jose': 'jose', 'argon2-cffi': 'argon2', 'tortoise-orm': 'tortoise' };
const IMPORT_EXCL = /(^|\/)(node_modules|examples?|_examples|fixtures?|tests?|__tests__|spec|docs?|docs_src|samples?|e2e|cypress|scripts|vendor)(\/|$)|\.(test|spec)\.\w+$|(^|\/)test_[^/]*\.py$|_test\.(go|py|rs)$/;

function importSpecs(text, lang) {
  const out = new Set();
  if (lang === 'js') {
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/g)) out.add(m[1]);
  } else if (lang === 'py') {
    for (const m of text.matchAll(/^[ \t]*(?:from\s+([\w.]+)\s+import|import\s+([\w., \t]+))/gm)) {
      for (const s of (m[1] || m[2]).split(',')) out.add(s.trim().split(/\s+/)[0]);
    }
  } else if (lang === 'go') {
    for (const m of text.matchAll(/\bimport\s*(?:\(([\s\S]*?)\)|(?:[\w.]+\s+)?"([^"]+)")/g)) {
      if (m[2]) out.add(m[2]);
      else for (const s of m[1].matchAll(/"([^"]+)"/g)) out.add(s[1]);
    }
  } else for (const m of text.matchAll(/^\s*(?:pub\s+)?(?:use|extern\s+crate)\s+(\w+)/gm)) out.add(m[1]);
  return out;
}

function scanImports(root, tree, hits) {
  const idx = { js: new Map(), py: new Map(), go: [], rs: new Map() };
  const decl = new Map();
  for (const h of hits) {
    if (!h.lang) continue;
    if (!decl.has(h.name)) decl.set(h.name, new Set());
    decl.get(h.name).add(h.dir);
    if (h.lang === 'js') idx.js.set(h.name, h.name);
    else if (h.lang === 'py') idx.py.set(PY_ALIAS[h.name] || h.name.replace(/-/g, '_'), h.name);
    else if (h.lang === 'go') idx.go.push(h.name);
    else idx.rs.set(h.name.replace(/-/g, '_'), h.name);
  }
  const found = new Map(); // name -> files
  let budget = MAX_SCAN;
  for (const f of tree.files) {
    const lang = FILE_LANG[f.slice(f.lastIndexOf('.') + 1)];
    if (!lang || IMPORT_EXCL.test(f) || (lang === 'go' ? !idx.go.length : !idx[lang].size)) continue;
    if (budget-- <= 0) break;
    const names = new Set();
    for (const spec of importSpecs(readText(root, f).slice(0, 12000), lang)) {
      if (lang === 'js') {
        const s = spec.replace(/^([a-z]+):(?!\/)/, '$1');
        const parts = s.split('/');
        for (const c of [parts.slice(0, 2).join('/'), parts[0]]) if (idx.js.has(c)) { names.add(c); break; }
      } else if (lang === 'py' || lang === 'rs') {
        const n = idx[lang].get(spec.split(/\.|::/)[0].toLowerCase());
        if (n) names.add(n);
      } else for (const n of idx.go) if (spec === n || spec.startsWith(`${n}/`)) names.add(n);
    }
    for (const n of names) (found.get(n) || found.set(n, []).get(n)).push(f);
  }
  const out = new Map();
  for (const [name, files] of found) {
    const globs = new Set();
    const tops = new Map();
    for (const f of files) {
      tops.set(dirOf(f), (tops.get(dirOf(f)) || 0) + 1);
      const base = [...decl.get(name)].filter((d) => d && f.startsWith(`${d}/`)).sort((a, b) => b.length - a.length)[0] || '';
      const sub = dirOf(base ? f.slice(base.length + 1) : f).split('/').filter(Boolean).slice(0, 3);
      const g = [base, ...sub].filter(Boolean).join('/');
      globs.add(g ? `${g}/**` : `*.${f.slice(f.lastIndexOf('.') + 1)}`);
    }
    const top = [...tops].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0] || '.';
    out.set(name, { n: files.length, top, globs: [...globs].sort() });
  }
  return out;
}

// Collapse globs: drop ones covered by another, cap the count.
function tidy(globs, warnings, label) {
  let g = uniq(globs).sort();
  if (g.includes('**')) return ['**'];
  const covers = (a, b) => a !== b && a.endsWith('/**') && b.startsWith(a.slice(0, -2));
  g = g.filter((x) => !g.some((y) => covers(y, x)));
  if (g.length > 6) {
    g = uniq(g.map((x) => (x.includes('/') && !x.startsWith('**') ? `${x.split('/')[0]}/**` : x))).sort();
    g = g.filter((x) => !g.some((y) => covers(y, x)));
    if (g.length > 6) { warnings.push(`${label}: scope truncated to 6 globs`); g = g.slice(0, 6); }
  }
  return g;
}

function scopeFallback(graph) {
  const by = new Map();
  for (const n of (graph && graph.nodes) || []) {
    const seg = String(n.id).split('/')[0];
    if (seg === '.' || EXCL.test(seg)) continue;
    by.set(seg, (by.get(seg) || 0) + (n.files || 0));
  }
  const top = [...by].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map((x) => `${x[0]}/**`);
  return top.length ? top.sort() : ['**'];
}

function dirHits(kind, tree) {
  const names = new Set(DIR_KINDS[kind]);
  const out = [];
  for (const [d, s] of tree.dirs) {
    if (!names.has(baseOf(d)) || depth(d) > 4 || EXCL.test(d)) continue;
    const ok = kind === 'frontend' ? s.ui >= 3 : kind === 'data' ? s.total >= 1 && (baseOf(d) !== 'db' || s.total >= 2) : s.src >= 2;
    if (ok) out.push({ dir: d, files: s.total });
  }
  return out.sort((a, b) => b.files - a.files || (a.dir < b.dir ? -1 : 1));
}

function testInfo(tree, det) {
  const pats = new Map();
  const dirs = new Set();
  for (const f of tree.files) {
    const b = baseOf(f);
    let m;
    if ((m = /^.+\.(test|spec)\.(\w+)$/.exec(b))) pats.set(`**/*.${m[1]}.${m[2]}`, (pats.get(`**/*.${m[1]}.${m[2]}`) || 0) + 1);
    else if (/^test_.+\.py$/.test(b)) pats.set('**/test_*.py', (pats.get('**/test_*.py') || 0) + 1);
    else if ((m = /^.+_test\.(\w+)$/.exec(b))) pats.set(`**/*_test.${m[1]}`, (pats.get(`**/*_test.${m[1]}`) || 0) + 1);
    const dir = dirOf(f);
    const segs = dir.split('/');
    const i = segs.findIndex((s) => /^(tests?|__tests__|spec|e2e)$/.test(s));
    if (i >= 0 && SRC_EXT.has(b.slice(b.lastIndexOf('.') + 1)) && !/(^|\/)(fixtures?|node_modules)(\/|$)/.test(dir)) dirs.add(segs.slice(0, i + 1).join('/'));
  }
  const globs = [...[...pats].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 4).map((x) => x[0]), ...[...dirs].sort().map((d) => `${d}/**`)];
  const count = [...pats.values()].reduce((a, b) => a + b, 0);
  const cmd = ((det && det.commands && det.commands.test) || [])[0];
  return { globs, count, cmd };
}

function infraInfo(tree, det) {
  const flags = (det && det.infra) || {};
  const strong = ['docker', 'compose', 'terraform', 'kubernetes', 'helm', 'serverless', 'cloudflareWorkers', 'fly'].filter((k) => flags[k]);
  const globs = [];
  const why = [];
  for (const f of tree.files) {
    const b = baseOf(f);
    const d = dirOf(f);
    const at = (x) => (d ? `${d}/${x}` : x);
    if (/^Dockerfile/.test(b) || /\.dockerfile$/.test(b)) globs.push(at('Dockerfile*'));
    else if (/^(docker-)?compose[\w.-]*\.ya?ml$/.test(b) || /^docker-compose/.test(b)) globs.push(at('*compose*.y*ml'));
    else if (/\.tf$/.test(b)) globs.push(d ? `${d}/*.tf` : '*.tf');
    else if (/^(wrangler\.(toml|jsonc?)|serverless\.ya?ml|fly\.toml|Procfile)$/.test(b)) globs.push(at(b));
    else if (/\.(ya?ml|tpl|tf)$/.test(b)) {
      const m = /^(.*?(?:^|\/)(?:k8s|kubernetes|helm|charts|deploy|terraform))\//.exec(f);
      if (m) globs.push(`${m[1]}/**`);
    }
  }
  const ci = ((det && det.ci) || []).length;
  if (ci) globs.push('.github/workflows/**');
  return { strong, globs, ci, weak: ['vercel', 'netlify'].filter((k) => flags[k]) };
}

function intentRoles(intent, have) {
  const out = [];
  for (const [kind, re] of INTENT) {
    const m = re.exec(intent || '');
    if (m && !have.has(kind) && !out.some((o) => o.kind === kind)) out.push({ kind, phrase: m[0].toLowerCase() });
  }
  return out;
}

function mk(name, kind, why, scope, writes, tools) {
  return { name, kind, why: uniq(why), scope, tier: TIER[name] || (kind === 'reviewer' || kind === 'security' ? 'deep' : 'standard'), tools, writes };
}

export function deriveRoster(dirArg = process.cwd(), opts = {}) {
  const warnings = [];
  const roles = [];
  const fw = new Map(); // role name -> framework names (router keywords)
  try {
    const root = path.resolve(dirArg);
    let det = opts.detection;
    let graph = opts.graph;
    if (!det) { try { det = detect(root); } catch (e) { warnings.push(`detect failed: ${e && e.message}`); det = {}; } }
    if (!graph) { try { graph = buildGraph(root); } catch (e) { warnings.push(`graph failed: ${e && e.message}`); graph = {}; } }
    const tree = walkTree(root);
    const mans = scanManifests(root, tree, det);
    const fallback = scopeFallback(graph);
    const add = (r, frameworks) => { roles.push(r); if (frameworks) fw.set(r.name, uniq(frameworks.map(short))); };
    const kindHits = {};
    for (const k of ['frontend', 'backend', 'data', 'mobile', 'security', 'docs']) kindHits[k] = depHits(k, mans, det);
    const imports = scanImports(root, tree, Object.values(kindHits).flat());
    // A dependency creates evidence when source files import it (dev dependencies too: scaffolders keep app deps there),
    // or when it is a runtime/optional/peer dependency that cannot be import-checked or sits in the root package next to conventional dirs.
    const activeDeps = (kind, conv) => kindHits[kind].flatMap((h) => {
      const imp = imports.get(h.name);
      if (imp) return [{ ...h, imp }];
      const runtime = ['runtime', 'optional', 'peer'].includes(h.group);
      return runtime && (!h.lang || (h.dir === '' && conv.length)) ? [h] : [];
    });
    const depLines = (deps) => {
      const seen = new Set();
      const lines = [];
      for (const h of deps) {
        if (!h.imp) lines.push(depWhy(h));
        else if (!seen.has(h.name)) { seen.add(h.name); lines.push(`${plural(h.imp.n, 'file')} ${h.imp.n === 1 ? 'imports' : 'import'} ${h.name} (${h.imp.top}), ${depWhy(h)}`); }
      }
      return lines;
    };
    // Scope = dirs of importing files (3 levels below the declaring package) + conventional dirs; dependency-only evidence
    // falls back to its package dir, then to graph source dirs.
    const evidenceRole = (kind, deps, dirs, extraWhy = []) => {
      const lines = depLines(deps);
      const why = [...lines.slice(0, 4), ...(lines.length > 4 ? [`${lines.length - 4} more ${kind} dependencies`] : []),
        ...dirs.slice(0, 3).map((d) => `dir ${d.dir}/ (${plural(d.files, 'file')})`), ...extraWhy];
      const g = [...deps.flatMap((h) => (h.imp ? h.imp.globs : h.dir ? [`${h.dir}/**`] : [])), ...dirs.map((d) => `${d.dir}/**`)];
      return { why, scope: tidy(g.length ? g : fallback, warnings, kind) };
    };

    add(mk('explorer', 'explorer', ['always present: read-only codebase search'], ['**'], [], TOOLS.ro));

    for (const kind of ['frontend', 'backend', 'data', 'mobile']) {
      let dirs = kind === 'mobile' ? [] : dirHits(kind, tree);
      const deps = activeDeps(kind, dirs);
      const extra = [];
      if (kind === 'data') {
        const f = tree.files.filter((x) => DATA_FILE.test(x) && !EXCL.test(dirOf(x))).slice(0, 2);
        for (const x of f) { extra.push(`file ${x}`); if (dirOf(x)) dirs = [...dirs, { dir: dirOf(x), files: 1 }]; }
      }
      if (kind === 'mobile') {
        const ios = tree.dirs.get('ios');
        const droid = tree.dirs.get('android');
        const flutter = mans.some((m) => baseOf(m.path) === 'pubspec.yaml' && m.deps.has('flutter'));
        if (flutter && !deps.length) extra.push('pubspec.yaml uses flutter');
        if (ios && droid && deps.length) extra.push('dirs ios/ and android/');
        const xc = tree.files.find((f) => /\.xcodeproj\/|AndroidManifest\.xml$/.test(f) && !EXCL.test(f));
        if (xc) { extra.push(`native project file ${xc}`); }
      }
      if (!deps.length && !dirs.length && !extra.length) continue;
      const r = evidenceRole(kind, deps, dirs, extra);
      add(mk(kind, kind, r.why, r.scope, r.scope, TOOLS.write), deps.map((d) => d.name));
    }

    const inf = infraInfo(tree, det);
    if (inf.strong.length || inf.ci >= 5 || inf.globs.some((g) => !g.startsWith('.github'))) {
      const why = [...(inf.strong.length ? [`infrastructure files: ${inf.strong.join(', ')}`] : []), ...(inf.ci ? [plural(inf.ci, 'CI workflow file')] : []), ...inf.weak.map((w) => `${w} config`)];
      for (const g of uniq(inf.globs).filter((x) => !x.startsWith('.github')).sort().slice(0, 3)) why.push(`file ${g}`);
      const scope = tidy(inf.globs.length ? inf.globs : ['**'], warnings, 'infra');
      add(mk('infra', 'infra', why, scope, scope, TOOLS.write), []);
    }

    const docDeps = kindHits.docs;
    const docFiles = tree.files.filter((f) => /(^|\/)(mkdocs\.ya?ml|docusaurus\.config\.\w+|\.vitepress\/config\.\w+)$/.test(f));
    const mdCount = tree.files.filter((f) => /^docs\/.+\.(md|mdx|rst)$/.test(f)).length;
    if (docDeps.length || docFiles.length || mdCount >= 20) {
      const why = [...docDeps.slice(0, 3).map(depWhy), ...docFiles.slice(0, 2).map((f) => `file ${f}`), ...(mdCount >= 20 ? [`dir docs/ (${plural(mdCount, 'doc file')})`] : [])];
      const g = [...docDeps.filter((h) => h.dir).map((h) => `${h.dir}/**`), ...docFiles.map((f) => (dirOf(f) ? `${dirOf(f)}/**` : f)), ...(mdCount >= 20 ? ['docs/**'] : [])];
      const scope = tidy(g.length ? g : ['docs/**'], warnings, 'docs');
      add(mk('docs', 'docs', why, scope, scope, TOOLS.write), docDeps.map((d) => d.name));
    }

    const ti = testInfo(tree, det);
    const hasCmd = ['test', 'lint', 'typecheck'].some((k) => det.commands && det.commands[k] && det.commands[k].length);
    const hasTests = ti.count > 0 || (graph && graph.testFiles > 0) || !!ti.cmd;
    if (hasCmd || hasTests) {
      const cmds = ['test', 'lint', 'typecheck'].filter((k) => det.commands && det.commands[k] && det.commands[k].length)
        .map((k) => `${k} command \`${det.commands[k][0].cmd}\` (${det.commands[k][0].source})`);
      const nTests = Math.max(ti.count, (graph && graph.testFiles) || 0);
      const why = [...cmds, ...(nTests ? [plural(nTests, 'test file')] : [])];
      const globs = tidy(ti.globs.length ? ti.globs : (hasTests ? ['**/*test*'] : []), warnings, 'qa');
      const runners = ((det.frameworks || []).map((f) => f.name)).filter((n) => ['vitest', 'jest', 'pytest', 'playwright', 'mocha'].includes(n));
      add(mk('test-runner', 'qa', why, ['**'], [], TOOLS.run), runners);
      if (hasTests) add(mk('test-writer', 'qa', [...why.filter((w) => !/^(lint|typecheck)/.test(w)), ...ti.globs.slice(0, 2).map((g) => `test glob ${g}`)], globs, globs, TOOLS.write), runners);
    }

    const eco = det.primary || '';
    const langs = ((det.languages || []).slice().sort((a, b) => (b.files || 0) - (a.files || 0)));
    const lang = REVIEWER[eco] || 'code';
    const lf = langs.find((l) => (eco === 'node' ? l.name === 'typescript' : true));
    add(mk(`${lang}-reviewer`, 'reviewer', [`primary ecosystem ${eco || 'unknown'}${lf ? `, ${lf.name} (${plural(lf.files || 0, 'file')})` : ''}`, 'always present: read-only review before merge'], ['**'], [], TOOLS.ro), []);

    const secDirs = dirHits('security', tree);
    const sec = activeDeps('security', secDirs);
    const settings = tree.files.filter((f) => /(^|\/)settings([\w/]*)\.py$/.test(f)).slice(0, 5).find((f) => /django\.contrib\.auth/.test(readText(root, f)));
    if (sec.length || settings) {
      const extra = settings ? [`django.contrib.auth in ${settings}`] : [];
      const r = evidenceRole('security', sec, secDirs, extra);
      const scope = settings && dirOf(settings) ? tidy([...r.scope, `${dirOf(settings)}/**`], warnings, 'security') : r.scope;
      add(mk('security-reviewer', 'security', r.why, scope, [], TOOLS.ro), sec.map((d) => d.name));
    }

    const vf = (det.versionFiles || []).filter((x) => !/changelog|history|\.changeset/i.test(x));
    const chlog = (det.versionFiles || []).filter((x) => /changelog|\.changeset/i.test(x));
    const chFiles = tree.files.filter((f) => /^(CHANGELOG|HISTORY)(\.\w+)?$/i.test(f));
    const hasChangeset = tree.files.some((f) => f.startsWith('.changeset/'));
    if ((vf.length && (chlog.length || chFiles.length)) || hasChangeset) {
      const names = uniq([...chlog, ...chFiles, ...(hasChangeset ? ['.changeset/'] : [])]);
      const by = {};
      for (const x of vf) (by[baseOf(x)] ||= []).push(x);
      const globs = [...Object.values(by).flatMap((g) => (g.length > 2 ? [`**/${baseOf(g[0])}`] : g)), ...names.map((n) => (n.endsWith('/') ? `${n}**` : n))];
      const scope = tidy(globs, warnings, 'release');
      add(mk('release', 'release', [`version ${vf.length ? `file${vf.length > 1 ? 's' : ''} ${vf.slice(0, 3).join(', ')}` : 'managed by changesets'}`, `changelog ${names.slice(0, 2).join(', ')}`], scope, scope, TOOLS.write), []);
    }

    // Intent: add a role only when the text names a capability. Scope is unknown.
    const have = new Set(roles.map((r) => r.kind));
    for (const { kind, phrase } of intentRoles(opts.intent, have)) {
      add(mk(kind, kind, [`intent: ${phrase}`], [], [], TOOLS.write), []);
      warnings.push(`role ${kind} comes from intent only ("${phrase}"); scope is unknown, define scope and writes once code exists`);
    }
    if (!tree.files.length) warnings.push('no files found; roster has only the always-present roles');
  } catch (e) {
    warnings.push(`roster error: ${e && e.message ? e.message : e}`);
  }
  return finish(roles, fw, warnings);
}

function finish(roles, fw, warnings) {
  const out = roles;
  const body = () => out.filter((r) => r.kind !== 'explorer');
  while (body().length > MAX_ROLES) {
    const c = out.filter((r) => MERGE[r.name]).sort((a, b) => a.why.length - b.why.length || EVICT.indexOf(a.name) - EVICT.indexOf(b.name))[0];
    if (!c) { warnings.push(`role cap ${MAX_ROLES} exceeded and no role can be merged`); break; }
    out.splice(out.indexOf(c), 1);
    const t = MERGE[c.name].map((n) => out.find((r) => r.name === n)).find(Boolean);
    if (!t) { warnings.push(`role cap ${MAX_ROLES}: dropped ${c.name} (no role to merge into)`); continue; }
    t.why.push(`merged ${c.name}: ${c.why[0] || 'no evidence'}`);
    t.scope = tidy([...t.scope, ...c.scope], warnings, t.name);
    if (c.writes.length) t.writes = tidy([...t.writes, ...c.writes], warnings, t.name);
    t.merged = uniq([...(t.merged || []), c.name, ...(c.merged || [])]);
    fw.set(t.name, uniq([...(fw.get(t.name) || []), ...(fw.get(c.name) || [])]));
    warnings.push(`role cap ${MAX_ROLES}: merged ${c.name} into ${t.name}`);
  }
  const rank = (r) => (r.kind === 'explorer' ? -1 : ORDER.indexOf(r.kind === 'reviewer' ? 'reviewer' : r.name));
  out.sort((a, b) => rank(a) - rank(b));
  const routes = [];
  for (const r of out) {
    if (['explorer', 'reviewer', 'security'].includes(r.kind)) continue;
    const names = [r.name, ...(r.merged || [])];
    const keywords = uniq([...names.flatMap((n) => KW[n] || []), ...names.flatMap((n) => fw.get(n) || [])]).slice(0, 30);
    routes.push({ role: r.name, paths: r.scope.slice(), keywords });
  }
  return { roles: out, routes, tiers: { ...TIERS }, warnings: uniq(warnings) };
}

export function toRouterConfig(roster) {
  const tier = new Map(((roster && roster.roles) || []).map((r) => [r.name, r.tier]));
  return {
    version: 1,
    roles: ((roster && roster.routes) || []).map((r) => ({ name: r.role, agent: r.role, tier: tier.get(r.role) || 'standard', paths: r.paths.slice(), keywords: r.keywords.slice() })),
    tiers: { ...TIERS },
    thresholds: { confidence: 0.55 },
    defaults: { role: 'main' },
    log: true,
  };
}

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const list = (a, n) => (a.length ? a.slice(0, n).map((x) => `\`${cell(x)}\``).join(', ') + (a.length > n ? ` +${a.length - n}` : '') : 'to be defined');

export function renderRosterMarkdown(roster) {
  const roles = (roster && roster.roles) || [];
  const lines = ['## Roster', '', '| Role | Agent file | Tier | Scope | Why |', '| --- | --- | --- | --- | --- |'];
  for (const r of roles) {
    const why = r.why.slice(0, 3).map(cell).join('; ') + (r.why.length > 3 ? `; +${r.why.length - 3} more` : '');
    lines.push(`| ${r.name} | \`.claude/agents/${r.name}.md\` | ${r.tier} (${(roster.tiers || TIERS)[r.tier]}) | ${list(r.scope, 4)} | ${why} |`);
  }
  lines.push('', '## Routing', '', '| Signals | Role |', '| --- | --- |');
  for (const r of (roster && roster.routes) || []) {
    const sig = [r.paths.length ? `paths ${list(r.paths, 3)}` : '', `keywords ${r.keywords.slice(0, 8).map(cell).join(', ')}`].filter(Boolean).join('; ');
    lines.push(`| ${sig} | ${r.role} |`);
  }
  lines.push('| anything else | main session (no delegation) |');
  if (roster && roster.warnings && roster.warnings.length) lines.push('', '## Warnings', '', ...roster.warnings.map((w) => `- ${w}`));
  return `${lines.join('\n')}\n`;
}

function usage(msg) {
  process.stderr.write(`${msg ? `${msg}\n` : ''}Usage: node scripts/roster.mjs [dir] [--intent "text"] [--json | --markdown | --router-config]\n`);
  process.exit(2);
}

function main() {
  const args = process.argv.slice(2);
  let dir = null;
  let intent = '';
  let mode = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--intent') { if (i + 1 >= args.length) usage('--intent needs a value'); intent = args[++i]; }
    else if (a.startsWith('--intent=')) intent = a.slice(9);
    else if (['--json', '--markdown', '--router-config'].includes(a)) { if (mode && mode !== a) usage('choose one output flag'); mode = a; }
    else if (a.startsWith('-')) usage(`unknown option ${a}`);
    else if (dir === null) dir = a;
    else usage('only one directory allowed');
  }
  dir = path.resolve(dir || process.cwd());
  try { if (!fs.statSync(dir).isDirectory()) usage(`not a directory: ${dir}`); } catch { usage(`cannot read directory: ${dir}`); }
  let roster;
  try { roster = deriveRoster(dir, { intent }); } catch (e) { roster = { roles: [], routes: [], tiers: { ...TIERS }, warnings: [`roster error: ${e && e.message}`] }; }
  if (mode === '--markdown') process.stdout.write(renderRosterMarkdown(roster));
  else if (mode === '--router-config') process.stdout.write(`${JSON.stringify(toRouterConfig(roster), null, 2)}\n`);
  else process.stdout.write(`${JSON.stringify(roster, null, 2)}\n`);
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isEntryPoint()) main();
