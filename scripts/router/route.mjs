#!/usr/bin/env node
// Prompt router for Claude Code (UserPromptSubmit hook), part of the /claude-setup skill.
//   hook mode (stdin is not a TTY):  {"prompt": "..."} on stdin -> hookSpecificOutput JSON on stdout
//   node route.mjs --explain "text"  human-readable decision with matched rules and scores
//   node route.mjs --json "text"     decision JSON
// Self-contained and dependency-free (Node >= 18): the skill copies this file to
// .claude/hooks/route.mjs and writes .claude/router.json next to it. The router is advice,
// never authority: it always exits 0, prints nothing on bad input or when unconfigured (no router.json
// found), and never logs prompt text.
// Env: CLAUDE_SETUP_ROUTER=off|ollama|decider, CLAUDE_SETUP_ROUTER_MODEL, CLAUDE_SETUP_ROUTER_URL (ollama chat
// endpoint), CLAUDE_SETUP_ROUTER_TIMEOUT_MS (max 1500), CLAUDE_SETUP_DECIDER_URL.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const EFFORTS = ['low', 'medium', 'high'];
const TIER_OF_EFFORT = { low: 'fast', medium: 'standard', high: 'deep' };
const MAX_CONTEXT = 600;
const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat';

export const DEFAULT_CONFIG = {
  version: 1,
  roles: [
    { name: 'frontend', agent: 'frontend', tier: 'standard', paths: ['src/components/**', 'src/pages/**', 'app/**', '**/*.{tsx,jsx,vue,svelte,css,scss}'], keywords: ['ui', 'component', 'page', 'css', 'style', 'button', 'form', 'layout', 'frontend', 'react', 'vue', 'render'] },
    { name: 'backend', agent: 'backend', tier: 'standard', paths: ['src/api/**', 'src/server/**', 'server/**', 'api/**'], keywords: ['api', 'endpoint', 'route', 'handler', 'middleware', 'server', 'backend', 'controller', 'request', 'response'] },
    { name: 'data', agent: 'data', tier: 'standard', paths: ['migrations/**', 'db/**', 'prisma/**', '**/*.sql'], keywords: ['database', 'schema', 'sql', 'query', 'table', 'column', 'index', 'orm', 'model'] },
    { name: 'qa', agent: 'test-runner', tier: 'fast', paths: ['test/**', 'tests/**', '**/*.{test,spec}.*'], keywords: ['test', 'spec', 'coverage', 'flaky', 'lint', 'ci'] },
  ],
  tiers: { fast: 'haiku', standard: 'sonnet', deep: 'opus' }, thresholds: { confidence: 0.55 }, defaults: { role: 'main' }, log: true,
};

// --- Text helpers: stemming-lite, tokenizer, globs, paths ---

// Plural, -ing, -ed and trailing -e are dropped on BOTH sides, so only consistency matters.
function stem(w) {
  if (w.length <= 3) return w;
  if (/ies$/.test(w)) w = `${w.slice(0, -3)}y`;
  else if (!/(ss|us|is)$/.test(w)) w = w.replace(/s$/, '');
  if (w.length >= 5 && /ing$/.test(w)) w = undouble(w.slice(0, -3));
  else if (w.length >= 4 && /ed$/.test(w)) w = undouble(w.slice(0, -2));
  return w.length > 4 ? w.replace(/e$/, '') : w;
}
const undouble = (w) => w.replace(/([^aeiouls])\1$/, '$1');

// Tokens carry a clause index (negation scope) and a sentence index (question scope).
// A negator glued to a word is part of a name, not a negation: --no-install, without-x, no_cache, noInstall.
const GLUED = '(?:no|not|never|without|avoid|skip|ignore|except|exclude)';
const MARK = '\u2060';
function tokenize(text) {
  const marked = text
    .replace(new RegExp(`(?<![\\p{L}\\p{N}])(${GLUED})(?=[-_][\\p{L}\\p{N}])`, 'giu'), `$1${MARK}`)
    .replace(new RegExp(`(?<![\\p{L}\\p{N}])(${GLUED})(?=\\p{Lu})`, 'gu'), `$1${MARK}`);
  const spaced = marked.replace(new RegExp(`([a-z0-9${MARK}])([A-Z])`, 'g'), '$1 $2').replace(/_/g, ' ').toLowerCase().replace(/n['’]t\b/g, ' not');
  const out = [];
  let c = 0;
  let n = 0;
  for (const raw of spaced.match(new RegExp(`[\\p{L}\\p{N}]+${MARK}?|[,.;:!?\\n()]`, 'gu')) || []) {
    const cmp = raw.endsWith(MARK);
    const m = cmp ? raw.slice(0, -1) : raw;
    if (m === 'but' || m === 'however' || /^[,;:()]$/.test(m)) c++;
    else if (/^[.!?\n]$/.test(m)) { c++; n++; } else out.push({ s: stem(m), w: m, c, n, cmp });
  }
  return out;
}
const phrase = (s) => tokenize(s).map((t) => t.s);
const phrases = (s) => s.split(',').map((x) => phrase(x.trim())).filter((p) => p.length);

const find = (tokens, ph) => tokens.flatMap((_, i) => (i + ph.length <= tokens.length && ph.every((s, j) => tokens[i + j].s === s) ? [i] : []));

const NEGATORS = new Set(['not', 'no', 'never', 'without', 'avoid', 'skip', 'ignore', 'except', 'exclude'].map(stem));
const NEG_AFTER = new Set(['alone', 'untouched', 'unchanged'].map(stem));
function negated(tokens, i, len) {
  for (let j = i - 1; j >= Math.max(0, i - 5) && tokens[j].c === tokens[i].c; j--) {
    if (tokens[j].s === 'forget') return false; // "don't forget to update X"
    if (NEGATORS.has(tokens[j].s) && !tokens[j].cmp) return true;
  }
  for (let j = i + len; j < Math.min(tokens.length, i + len + 3) && tokens[j].c === tokens[i].c; j++) {
    if (NEG_AFTER.has(tokens[j].s)) return true;
  }
  return false;
}
const live = (tokens, ph) => find(tokens, ph).filter((i) => !negated(tokens, i, ph.length));

const esc = (s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&');
function globToRe(g) {
  const tail = g.endsWith('/**');
  const src = tail ? g.slice(0, -3) : g;
  let re = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '*' && src[i + 1] === '*') { i++; if (src[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{' && src.indexOf('}', i) > i) {
      const j = src.indexOf('}', i);
      re += `(?:${src.slice(i + 1, j).split(',').map(esc).map((x) => x.replace(/\*/g, '[^/]*')).join('|')})`;
      i = j;
    } else re += esc(c);
  }
  return new RegExp(`^${re}${tail ? '(?:/.*)?' : ''}$`, 'i');
}
const specificity = (g) => { const i = g.search(/[*?{]/); return i < 0 ? g.length : i; };

const EXT = 'tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|vue|svelte|css|scss|html|json|ya?ml|toml|sql|md|sh|tf|prisma|php|cs|cpp|c|h|dart|exs?|graphql|proto|lock|ini|cfg';
const PATH_RE = new RegExp(String.raw`(?<![\w@/.~-])((?:\.{1,2}/|/|~/)?(?:[\w@.+-]+/)+[\w@.+-]*|(?:[\w@+-]+\.)+(?:${EXT}))(?::\d+(?::\d+)?)?(?![\w@])`, 'gi');
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const NOT_FILES = /^(node|next|vue|react|express|nuxt|three|d3|chart|alpine|ember)\.js$/i;
const VENDORED = /node_modules|site-packages|dist-packages|\/usr\/(local\/)?lib|node:internal|\binternal\/|<anonymous>|\.cargo\/registry|\/go\/pkg\/mod/;
const normPath = (p) => p.replace(/\\/g, '/').replace(/[.,;]+$/, '').replace(/^(\.\/)+/, '');

// --- Config ---

export function loadConfig(env = process.env) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, '..', 'router.json')];
  if (env.CLAUDE_PROJECT_DIR) candidates.unshift(path.join(env.CLAUDE_PROJECT_DIR, '.claude', 'router.json'));
  for (const file of candidates) {
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cfg && Array.isArray(cfg.roles)) return { cfg, file };
    } catch { /* try the next candidate */ }
  }
  return { cfg: DEFAULT_CONFIG, file: null };
}

// Built-in term lexicon per role kind: extra evidence (weight 0.5, config keywords weigh 1).
const LEXICON = {
  frontend: 'toggle, dark mode, theme, navbar, sidebar, dropdown, tooltip, dashboard, icon, animation, checkbox, popup, spinner, ui, ux, font, hover, banner, css',
  backend: 'endpoint, 500, 404, 401, 403, status code, handler, controller, middleware, rate limit, webhook, cors, payload, server, route, api, request, response',
  data: 'column, table, index, schema, migration, query, sql, foreign key, primary key, seed, backfill, orm, database, transaction',
  infra: 'deploy, pipeline, docker, container, kubernetes, terraform, helm, staging, github actions, env var, provision, ci, workflow, workflows, .github/workflows',
  qa: 'test, spec, coverage, flaky, e2e, lint, assertion, mock, fixture, regression',
  docs: 'readme, documentation, docs, changelog',
};
const KINDS = [['frontend', /front|^ui|web|client/], ['backend', /back|api|server|service/], ['data', /data|db/], ['infra', /infra|devops|ops$|platform/], ['qa', /^qa$|test/], ['docs', /doc/]];
const LAYER = { data: 0, backend: 1, infra: 1, frontend: 2 }; // lowest layer first when a prompt spans several
const compiled = new WeakMap();
function compile(cfg) {
  if (compiled.has(cfg)) return compiled.get(cfg);
  const roles = (cfg.roles || []).filter((r) => r && typeof r.name === 'string').map((r) => ({
    name: r.name,
    agent: r.agent || r.name,
    tier: r.tier || 'standard',
    kw: (r.keywords || []).map((k) => [phrase(String(k)), String(k)]).filter(([p]) => p.length),
    kind: (KINDS.find(([, re]) => re.test(String(r.name).toLowerCase())) || [''])[0],
    ro: /runner|reviewer/i.test(`${r.name} ${r.agent || ''}`), // no explicit flag in router.json: runners and reviewers are read-only
    globs: (r.paths || []).filter((g) => !/^[*/]+$/.test(g)).map((g) => ({ re: globToRe(String(g)), spec: specificity(String(g)) })), // catch-all globs carry no signal
  }));
  for (const r of roles) r.lex = (LEXICON[r.kind] || '').split(',').filter(Boolean).map((k) => [phrase(k), k.trim()]);
  const out = { roles, tiers: { ...DEFAULT_CONFIG.tiers, ...(cfg.tiers || {}) }, defaultRole: cfg.defaults?.role || 'main', qaAgent: roles.find((r) => r.kind === 'qa')?.agent || 'test-runner',
    threshold: Number(cfg.thresholds?.confidence) || DEFAULT_CONFIG.thresholds.confidence };
  compiled.set(cfg, out);
  return out;
}

// --- Signals ---

const CHANGE = phrases('add, fix, implement, refactor, update, remove, create, build, change, rename, write, delete, replace, rewrite, migrate, convert, upgrade, patch, make, move, extract, split, merge, wire, introduce, enable, disable, optimize, improve, rework, redesign, install, bump, tweak, adjust, correct, handle, resolve, set');
const BIG = phrases('refactor, migrate, redesign, architecture, rearchitect, rewrite, overhaul, across, entire, everywhere, restructure, rework, end to end');
const RISKY = phrases('security, secure, auth, authenticate, authentication, authorization, authorize, oauth, sso, jwt, password, credential, secret, encrypt, encryption, crypto, payment, billing, stripe, refund, permission, rbac, csrf, xss, vulnerability, pii, gdpr, migration, api key');
const DOCS = phrases('readme, docs, documentation, changelog, comment');
const TRIVIAL = phrases('typo, spelling, rename, one liner, one line, single line, tiny, trivial, minor, quick, whitespace, wording, comment, bump version');
const EDIT = new Set(phrases('fix, update, change, add, remove, refactor').flat()); // edit verbs (stems)
const FAIL = new Set(phrases('fail, broken, flaky, error').flat()); // failure words; fails/failing stem to fail
const OBJ_STOP = new Set(phrases('for, to, in, on, at, of, from, with, by, and, but, so, then').flat()); // ends an edit's object
const EN_WORDS = new Set(('the a an to of and in is it this that for with on my we i you can how what why not be are add fix make please from our all should when where does if so as at by or new use run test update remove create implement rename change build move write explain review check show list find delete refactor install deploy there here have has was').split(' '));
const FOLLOW_UP = /^(yes|yep|yeah|yup|ok|okay|sure|go|go ahead|go on|continue|proceed|do it|do that|please do|please continue|sounds good|looks good|lgtm|ship it|keep going|carry on|next|try again|retry|thanks|thank you|y|k|fine|approved|that works|do so)( please| now)?$/;
const QUESTION = /^\s*(?:(?:please|pls|hey|hi|so|ok|okay|also|and|then|(?:can|could|would) you(?: please)?)[\s,]+)*(what|why|how|where|when|which|who|does|did|is|are|explain|describe|show me|tell me|walk me through|list|do (you|we|i|they|these|those|the))\b/i;
const TRACE = [
  /^\s*at\s+(?:async\s+)?\S+\s+\(.*\)\s*$/, /^\s*at\s+\S+:\d+(?::\d+)?\s*$/, /^\s*at\s+[\w.$]+\([\w.]+:\d+\)/,
  /^\s*File\s+".+",\s+line\s+\d+/, /^\s*(Traceback \(most recent|Caused by:|panic:|goroutine \d+|thread '.+' panicked)/,
  /^\s*\S+\.(go|rs|py|js|ts|java|rb|kt|c|cpp):\d+/, /^\s*(\d{4}-\d{2}-\d{2}[T ]|\[\d{4}-|\d{2}:\d{2}:\d{2}\b)/,
  /^\s*(ERROR|WARN|WARNING|INFO|DEBUG|FATAL|npm ERR!|error TS\d+|FAIL)\b/, /^\s*[\w.]*(Error|Exception)\b[:(]/,
];

// Split the prompt into prose and pasted material (logs, stack traces, long fenced blocks).
function splitPasted(text) {
  const prose = [];
  const pasted = [];
  const lines = text.split('\n');
  const isLog = (l) => TRACE.some((re) => re.test(l));
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*```/.test(lines[i])) { (isLog(lines[i]) ? pasted : prose).push(lines[i]); continue; }
    let j = i + 1;
    while (j < lines.length && !/^\s*```/.test(lines[j])) j++;
    const block = lines.slice(i + 1, j);
    const logLike = block.length > 15 || block.some(isLog);
    for (const l of block) (logLike || isLog(l) ? pasted : prose).push(l);
    i = j;
  }
  return { prose: prose.join('\n'), pasted: pasted.join('\n') };
}

function isEnglish(text, tokens) {
  const letters = text.match(/\p{L}/gu) || [];
  const foreign = letters.filter((ch) => !/[\u0000-ɏ]/.test(ch)).length;
  if (letters.length && foreign / letters.length > 0.3) return false;
  const words = tokens.filter((t) => !/^qpath\d+x$/.test(t.w));
  return words.length < 4 || words.filter((t) => EN_WORDS.has(t.w)).length / words.length >= 0.1;
}

// Roles whose best-matching glob for a path is the most specific one.
function roleByPath(C, p) {
  const segs = p.split('/').filter(Boolean).slice(-12);
  const found = [];
  for (const r of C.roles) {
    const hit = r.globs.filter((g) => segs.some((_, k) => g.re.test(segs.slice(k).join('/'))));
    if (hit.length) found.push([r, Math.max(...hit.map((g) => g.spec))]);
  }
  const best = Math.max(-1, ...found.map((f) => f[1]));
  return found.filter((f) => f[1] === best).map((f) => f[0]);
}

// --- Rules classifier ---

export function analyze(prompt, cfg = DEFAULT_CONFIG) {
  const C = compile(cfg);
  const clipped = prompt.length > 24000 ? `${prompt.slice(0, 14000)}\n${prompt.slice(-8000)}` : prompt;
  const { prose, pasted } = splitPasted(clipped.replace(/\S{120,}/g, ' ')); // minified blobs are not prose
  const paths = [];
  const body = prose.replace(URL_RE, ' ').replace(PATH_RE, (m, p) => {
    const n = normPath(p);
    if (NOT_FILES.test(n)) return m;
    if (paths.length >= 40) return ' '; // bounded work on path-spam prompts
    paths.push(n);
    return ` qpath${paths.length - 1}x `;
  });
  const tokens = tokenize(body);
  const reasons = [];
  const score = new Map(C.roles.map((r) => [r.name, { kind: r.kind, ro: r.ro, kw: 0, lex: 0, fail: 0, path: 0, frame: 0, paste: 0, first: Infinity, neg: false, kws: [], terms: [], paths: [], idx: [] }]));
  const noun = (i) => tokens[i].s === 'chang' && /^(the|these|those|my|your|this|any|recent|our|all|some)$/.test(tokens[i - 1]?.w); // "the changes I made"
  // Stack frames in pasted text: the first project frame decides.
  const frames = (pasted.replace(URL_RE, ' ').match(PATH_RE) || []).map((m) => normPath(m.replace(/:\d+(?::\d+)?$/, ''))).filter((p) => !VENDORED.test(p) && !NOT_FILES.test(p));
  frames.slice(0, 6).forEach((p, i) => {
    for (const r of roleByPath(C, p)) { const s = score.get(r.name); s.frame = Math.min(4.5, s.frame + (i === 0 ? 3 : 1.5)); if (!s.paths.includes(p)) s.paths.push(p); }
  });
  const pastedTokens = tokenize(pasted);
  for (const r of C.roles) {
    const s = score.get(r.name);
    for (const [ph, key] of r.kw) {
      const hits = find(tokens, ph);
      const ok = hits.filter((i) => !negated(tokens, i, ph.length));
      if (ok.length) { const w = (key.toLowerCase() === r.name ? 2 : 1) + Math.min(0.5, 0.25 * (ok.length - 1)); s.kw += w; if (ph.length === 1 && FAIL.has(ph[0])) s.fail += w; s.kws.push(key); s.first = Math.min(s.first, ok[0]); s.idx.push(...ok); }
      else if (hits.length) s.neg = true;
      else if (find(pastedTokens, ph).length) s.paste = Math.min(0.5, s.paste + 0.15);
    }
    for (const [ph, raw] of r.lex) {
      const ok = r.kw.some(([k]) => k.join(' ') === ph.join(' ')) ? [] : live(tokens, ph);
      if (ok.length) { const before = s.lex; s.lex = Math.min(1.5, s.lex + 0.5); if (ph.length === 1 && FAIL.has(ph[0])) s.fail += s.lex - before; s.terms.push(raw); s.first = Math.min(s.first, ok[0]); s.idx.push(...ok); }
    }
    s.kw = Math.min(4, s.kw);
    s.fail = Math.min(s.fail, s.kw + s.lex);
  }
  // Mentioned file paths (strong signal), honouring negation ("don't touch src/ui/x.tsx").
  // Roles that share the best glob split the credit; if only some of them have keyword evidence, those share it.
  paths.forEach((p, i) => {
    const idx = tokens.findIndex((t) => t.w === `qpath${i}x`);
    const isNeg = idx >= 0 && negated(tokens, idx, 1);
    let owners = roleByPath(C, p);
    const backed = owners.filter((r) => score.get(r.name).kw + score.get(r.name).lex > 0);
    if (backed.length && backed.length < owners.length) owners = backed;
    for (const s of owners.map((r) => score.get(r.name))) {
      if (isNeg) { s.neg = true; continue; } // a negated path is never an edit target
      s.idx.push(idx);
      if (!s.paths.includes(p)) { s.paths.push(p); s.path = Math.min(6, s.path + 3 / owners.length); } // shared globs split the credit
    }
  });
  for (const s of score.values()) {
    s.total = s.kw + s.lex + s.path + s.frame + s.paste;
    s.excluded = s.neg && s.kw < 2 && s.path === 0;
  }
  // An edit verb whose object (up to 4 words, same clause) names a writer role's territory ("fix the CI workflow"):
  // runner/reviewer roles then lose their failure-word points and the QA lead bonus, so the writer leads.
  const aimed = new Set();
  tokens.forEach((t, i) => {
    if (EDIT.has(t.s) && !noun(i)) for (let j = i + 1; j < tokens.length && j <= i + 4 && tokens[j].c === t.c && tokens[j].n === t.n && !OBJ_STOP.has(tokens[j].s); j++) aimed.add(j);
  });
  const writerTarget = [...score.values()].some((s) => !s.ro && s.idx.some((j) => aimed.has(j)));
  const demote = (s) => writerTarget && s.ro;
  if (writerTarget) for (const [name, s] of score) if (s.ro && s.fail) { s.total -= s.fail; reasons.push(`${name}: failure words not counted (edit aimed at a writer role)`); }
  // Test words make QA primary only when the request leads with them ("add tests for X"), not for "fix X and add a test".
  const others = [...score.values()].filter((o) => o.kind !== 'qa' && !o.excluded && o.total >= 1);
  for (const q of score.values()) {
    if (q.kind !== 'qa' || !q.total || q.path || q.frame || !others.length || demote(q)) continue;
    q.total = q.first < Math.min(...others.map((o) => o.first)) ? q.total + 2 : (q.total - q.fail) * 0.4 + q.fail; // failure words are not test words: no QA demotion for them
  }

  const has = (list) => list.some((p) => live(tokens, p).length);
  const changeHits = CHANGE.flatMap((p) => live(tokens, p).filter((i) => !noun(i)).map((i) => tokens[i].n));
  const q = QUESTION.test(body.trim()) && !changeHits.some((n) => n >= 1);
  const change = !q && changeHits.length > 0;
  const risky = has(RISKY) || paths.some((p) => /auth|payment|billing|migrat|secur|secret|credential/i.test(p));
  const [big, trivial] = [has(BIG), has(TRIVIAL)];
  const norm = body.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const reqs = (body.match(/^\s*(?:[-*•]|\d+[.)])\s+/gm) || []).length + (body.match(/\b(and then|also|additionally|as well as|finally|plus)\b/gi) || []).length;
  const ranked = [...score].map(([name, s]) => ({ name, ...s })).filter((s) => !s.excluded)
    .sort((a, b) => b.total - a.total || (a.kind === 'qa') - (b.kind === 'qa') || C.roles.findIndex((r) => r.name === a.name) - C.roles.findIndex((r) => r.name === b.name));
  const top = ranked[0] && ranked[0].total - ranked[0].paste >= 0.5 ? ranked[0] : null;
  const rival = top ? ranked.slice(1).find((s) => s.kind !== 'qa' || top.kind === 'qa') : null;
  const touched = ranked.filter((s) => s.kind !== 'qa' && top && s.total - s.frame - s.paste >= 1 && s.total >= 0.5 * top.total).map((s) => s.name);
  const lead = touched.length >= 2 ? [...touched].sort((a, b) => (LAYER[score.get(a).kind] ?? 3) - (LAYER[score.get(b).kind] ?? 3))[0] : top?.name;
  const margin = top && rival && rival.total > 0 ? (top.total - rival.total) / top.total : 1;
  // Evidence strength (paths count most, a change verb adds a little, a second distinct keyword or term adds a little more)
  // times margin over the runner-up.
  const distinct = top ? new Set([...top.kws, ...top.terms].map((k) => k.toLowerCase())).size : 0;
  const conf = top ? (1 - Math.exp(-(top.total + (change ? 0.4 : 0) + (distinct >= 2 ? 0.3 : 0)) / 1.6)) * (0.4 + 0.6 * margin) : 0.25;
  const effortN = 1 + (risky || big ? 2 : 0) + (touched.length >= 2 ? 2 : 0) + (tokens.length > 150 ? 2 : reqs >= 4 ? 2 : reqs >= 3 ? 1 : 0) - (q ? 1 : 0) - (trivial ? 1 : 0) + (pasted.trim() ? 1 : 0);
  const effort = effortN >= 3 ? 'high' : effortN <= 0 ? 'low' : 'medium';
  const followup = FOLLOW_UP.test(norm) || (tokens.length <= 3 && !top && !q && !paths.length && tokens.some((t) => /^(it|that|this|them|those|again|more)$/.test(t.w)));
  const A = { role: lead || C.defaultRole, effort, conf, touched, flags: { q, change, risky, big, trivial, followup, english: isEnglish(body, tokens), docsOnly: has(DOCS) && !top, code: !!top || paths.length > 0 || tokens.length >= 6 }, reasons, score, frames, paths };

  if (followup) {
    Object.assign(A, { role: C.defaultRole, effort: 'medium', conf: 0.15, touched: [] });
    reasons.push('continue previous route (short follow-up)');
  } else if (!A.flags.english) {
    Object.assign(A, { role: C.defaultRole, conf: Math.min(conf, 0.2), touched: [], effort: effort === 'low' ? 'medium' : effort });
    reasons.push('non-English prompt: main session decides');
  } else {
    const lr = ranked.find((x) => x.name === A.role);
    if (lr) reasons.push(`${lr.name}: ${[lr.kws.length ? `keywords ${lr.kws.join(', ')}` : '', lr.terms.length ? `terms ${lr.terms.join(', ')}` : '', lr.paths.length ? `paths ${lr.paths.slice(0, 3).join(', ')}` : ''].filter(Boolean).join('; ') || 'pasted output only'}`);
    const rest = touched.filter((n) => n !== A.role);
    if (rest.length) reasons.push(`secondary: ${rest.join(', ')}${touched.length >= 2 ? ' (multi-layer: lowest layer first, main orchestrates)' : ''}`);
    for (const [name, s] of score) if (s.neg && name !== A.role) reasons.push(`${name}: negated${s.excluded ? ' (excluded)' : ''}`);
    if (pasted.trim()) reasons.push(`pasted output down-weighted${frames.length ? `, top frame ${frames[0]}` : ''}`);
    if (q) reasons.push('question');
    if (risky) reasons.push('risky area (auth/payment/migration/security): effort raised');
    if (big) reasons.push('large-scope verb (refactor/migrate/redesign/across): effort raised');
    if (trivial) reasons.push('trivial edit cue: effort lowered');
    if (!top) reasons.push('no role signals: main session decides');
    // When unsure: never "low" for an unclear request. Doubt alone does not raise effort to high (and so does not force
    // the deep tier or a plan); only the size, risk and breadth signals above do that.
    if (A.conf < C.threshold && !q && !trivial && A.effort === 'low') A.effort = 'medium';
  }
  return A;
}

// Turn an analysis into the public decision JSON.
export function finish(A, cfg = DEFAULT_CONFIG, backend = 'rules') {
  const C = compile(cfg);
  const role = C.roles.find((r) => r.name === A.role);
  const f = A.flags;
  const plan = !f.followup && !(f.q && !f.change) && !!(A.effort === 'high' || A.touched.length >= 2 || A.forcePlan);
  const delegate = !!role && A.conf >= C.threshold && A.effort !== 'low' && !f.followup && !f.q && A.touched.length < 2;
  const tier = delegate ? (f.risky && role.tier !== 'deep' ? 'deep' : role.tier) : TIER_OF_EFFORT[A.effort];
  const d = {
    role: A.role, agent: role ? role.agent : 'main', tier, model: C.tiers[tier] || tier, effort: A.effort, plan, delegate,
    qa: !f.followup && f.change && !f.q && role?.kind !== 'docs' && !f.docsOnly && f.code && !(A.paths.length && A.paths.every((p) => /\.(md|txt|rst)$/i.test(p))),
    confidence: Number(A.conf.toFixed(2)), reasons: A.reasons.slice(), backend,
  };
  Object.defineProperty(d, 'detail', { value: A, enumerable: false });
  return d;
}

export const classify = (prompt, cfg = DEFAULT_CONFIG) => finish(analyze(String(prompt), cfg), cfg, 'rules');

// --- Optional backends (only when rules are unsure; any failure falls back to rules) ---

async function postJson(url, body, ms) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    return res.ok ? await res.json() : null;
  } finally { clearTimeout(timer); }
}

async function askBackend(kind, prompt, cfg, env) {
  const C = compile(cfg);
  const names = [C.defaultRole, ...C.roles.map((r) => r.name)];
  const ms = Math.min(Number(env.CLAUDE_SETUP_ROUTER_TIMEOUT_MS) || 1500, 1500);
  const text = prompt.slice(0, 1500);
  let ans;
  if (kind === 'ollama') {
    const sys = `Classify a coding request. Roles: ${C.roles.map((r) => `${r.name} (${r.kw.slice(0, 5).map((k) => k[1]).join(', ')})`).join('; ')}; ${C.defaultRole} (anything else). Answer JSON. Prefer medium effort unless clearly trivial or clearly hard.`;
    const format = { type: 'object', required: ['role', 'effort', 'plan'], properties: { role: { enum: names }, effort: { enum: EFFORTS }, plan: { type: 'boolean' } } };
    const model = env.CLAUDE_SETUP_ROUTER_MODEL || 'qwen2.5:1.5b';
    const j = await postJson(env.CLAUDE_SETUP_ROUTER_URL || OLLAMA_URL, { model, stream: false, keep_alive: '30m', options: { temperature: 0, num_predict: 80 }, format, messages: [{ role: 'system', content: sys }, { role: 'user', content: text }] }, ms);
    ans = JSON.parse(j.message.content);
  } else if (env.CLAUDE_SETUP_DECIDER_URL) {
    const j = await postJson(env.CLAUDE_SETUP_DECIDER_URL, { state: text, questions: {
      role: { type: 'choice', instructions: 'Which role should handle this coding request?', criteria: Object.fromEntries(names.map((n) => [n, n])) },
      effort: { type: 'choice', instructions: 'How much effort does it need?', criteria: { low: 'trivial', medium: 'normal', high: 'hard or risky' } },
      plan: { type: 'noul', instructions: 'Should work be planned before editing?' },
    } }, ms);
    const a = j.answers;
    ans = { role: a.role.choice, effort: a.effort.choice, plan: typeof a.plan.noul === 'number' ? a.plan.noul >= 0.5 : !!a.plan.noul };
  } else return null;
  if (!names.includes(ans.role) || !EFFORTS.includes(ans.effort) || typeof ans.plan !== 'boolean') return null;
  return ans;
}

export async function route(prompt, cfg = DEFAULT_CONFIG, env = process.env) {
  const A = analyze(prompt, cfg);
  const kind = env.CLAUDE_SETUP_ROUTER;
  if ((kind === 'ollama' || kind === 'decider') && A.conf < compile(cfg).threshold && !A.flags.followup) {
    try {
      const ans = await askBackend(kind, prompt, cfg, env);
      if (ans && !A.score.get(ans.role)?.excluded) { // rules keep a veto over negated roles
        const effort = EFFORTS[Math.max(EFFORTS.indexOf(A.effort), EFFORTS.indexOf(ans.effort))]; // never de-escalate
        const B = { ...A, role: ans.role, effort, forcePlan: ans.plan, conf: compile(cfg).threshold + 0.05, reasons: [...A.reasons, `${kind} backend chose ${ans.role}/${ans.effort}`] };
        return finish(B, cfg, kind);
      }
    } catch { /* silent fallback to rules */ }
  }
  return finish(A, cfg, 'rules');
}

// --- Output ---

export function describe(d, cfg = DEFAULT_CONFIG) {
  const C = compile(cfg);
  const A = d.detail;
  const tail = `Confidence ${d.confidence.toFixed(2)}. Override by saying 'no routing'.`;
  if (A.flags.followup) return `Route: continue previous route (short follow-up), no new plan. ${tail}`;
  const why = A.touched.length >= 2 ? `touches ${A.touched.slice(0, 3).join(' and ')}` : A.flags.risky ? 'risky area' : 'high effort';
  let s = `Route: ${d.delegate ? `${d.agent} agent` : 'handle in main session'} (tier ${d.tier}/${d.model}), effort ${d.effort}, ${d.plan ? `plan yes (${why})` : 'plan no'}`;
  if (d.qa) s += `, then ${C.roles.find((r) => r.name === d.role)?.kind === 'qa' ? 're-run the tests' : C.qaAgent}`;
  s += '. ';
  if (!d.delegate && d.role !== C.defaultRole) s += `Closest role: ${d.role}, not confident enough to delegate. `;
  else if (!d.delegate && d.confidence < C.threshold) s += 'No clear specialist match; decide yourself. ';
  return `${s}${tail}`.slice(0, MAX_CONTEXT);
}

function explain(d, cfg) {
  const A = d.detail;
  const lines = [
    `Decision: role=${d.role} agent=${d.agent} tier=${d.tier}/${d.model} effort=${d.effort} plan=${d.plan} delegate=${d.delegate} qa=${d.qa} confidence=${d.confidence} backend=${d.backend}`,
    `Flags: ${Object.entries(A.flags).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`,
    'Scores (keywords + terms + paths + frames + pasted = total):',
  ];
  for (const [name, s] of A.score) {
    const nums = [s.kw, s.lex, s.path, s.frame, s.paste].map((n) => n.toFixed(1)).join(' + ');
    lines.push(`  ${name.padEnd(10)} ${nums} = ${s.total.toFixed(2)}${s.excluded ? '  (excluded by negation)' : ''}${s.kws.length ? `  keywords: ${s.kws.join(', ')}` : ''}${s.terms.length ? `  terms: ${s.terms.join(', ')}` : ''}${s.paths.length ? `  paths: ${s.paths.join(', ')}` : ''}`);
  }
  return [...lines, 'Reasons:', ...d.reasons.map((r) => `  - ${r}`), `Context: ${describe(d, cfg)}`].join('\n');
}

function logDecision(dir, prompt, d) {
  try {
    const { reasons, ...fields } = d; // never the prompt text, and no reasons (they can echo paths)
    const line = { ts: new Date().toISOString(), sha: crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 12), len: prompt.length, ...fields };
    fs.appendFileSync(path.join(dir, 'route-log.jsonl'), `${JSON.stringify(line)}\n`);
  } catch { /* logging must never break the hook */ }
}

async function readStdin(ms = 5000) {
  const read = async () => { const chunks = []; for await (const c of process.stdin) chunks.push(c); return Buffer.concat(chunks).toString('utf8'); };
  return Promise.race([read(), new Promise((r) => setTimeout(r, ms, ''))]);
}

const OPT_OUT = /(^|\s)\/noroute\b|\bno routing\b/i;
const UNCONFIGURED = 'unconfigured: no .claude/router.json found';

async function hook() {
  try {
    const prompt = JSON.parse(await readStdin()).prompt;
    if (typeof prompt !== 'string' || !prompt.trim() || OPT_OUT.test(prompt) || process.env.CLAUDE_SETUP_ROUTER === 'off') return;
    const { cfg, file } = loadConfig();
    if (!file) return; // unconfigured project: stay silent
    const d = await route(prompt, cfg);
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: describe(d, cfg) } })}\n`);
    if (file && cfg.log) logDecision(path.dirname(file), prompt, d);
  } catch { /* bad input: print nothing */ }
}

async function main(argv) {
  const mode = argv.find((a) => a === '--explain' || a === '--json');
  if (mode) {
    const text = argv.slice(argv.indexOf(mode) + 1).join(' ');
    const { cfg, file } = loadConfig();
    const d = await route(text, cfg); // no config: built-in defaults decide, and say so
    if (!file) d.reasons.unshift(UNCONFIGURED);
    console.log(mode === '--json' ? JSON.stringify(d, null, 2) : explain(d, cfg));
  } else if (!process.stdin.isTTY) {
    await hook();
  } else {
    console.error('usage: route.mjs --explain "prompt" | --json "prompt" | (hook mode: JSON on stdin)');
  }
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) main(process.argv.slice(2)).catch(() => {}).finally(() => process.exit(0));
