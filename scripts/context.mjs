#!/usr/bin/env node
// Prints everything the /claude-setup skill needs as one markdown document:
// the detector JSON, the chosen template, the matching knowledge notes and the
// reference files. Headless Claude cannot read files in the skill directory,
// so this script reads them and prints them whole.
//
//   node scripts/context.mjs [dir]                 core context (default dir: current directory)
//   node scripts/context.mjs [dir] --full          core plus all blueprints, references, practices and
//                                                  the router config, with every knowledge note whole
//   node scripts/context.mjs --show <path>...     print guidance files from blueprints/, reference/,
//                                                  knowledge/ or templates/ (several per call)
//
// The core keeps only the version notes whose gate holds for the detected versions, drops the
// "Current versions" tables, and omits the router config (scripts/roster.mjs writes it to .claude/router.json).
// Always exits 0. A missing skill file becomes a one-line note.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detect } from './detect.mjs';
import { buildGraph, renderMarkdown } from './graph.mjs';
import { deriveRoster, renderRosterMarkdown, toRouterConfig } from './roster.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// primary + layout -> template. Anything not listed uses generic.
export function chooseTemplate(primary, layout) {
  const monorepo = layout === 'monorepo';
  switch (primary) {
    case 'node': return monorepo ? 'node-monorepo' : 'node-single';
    case 'rust': return monorepo ? 'rust-workspace' : 'rust-single';
    case 'python':
    case 'go':
    case 'jvm':
    case 'ruby':
    case 'dotnet':
    case 'php':
      return primary;
    default: return 'generic'; // deno, swift, dart, elixir, unknown
  }
}

const ECOSYSTEM_NOTE = {
  node: 'node.md', python: 'python.md', rust: 'rust.md', go: 'go.md', jvm: 'jvm.md',
  ruby: 'ruby.md', dotnet: 'dotnet.md', php: 'php.md', swift: 'mobile.md', dart: 'mobile.md',
};
const LANGUAGE_ECOSYSTEM = {
  typescript: 'node', javascript: 'node', python: 'python', rust: 'rust', go: 'go',
  java: 'jvm', kotlin: 'jvm', scala: 'jvm', ruby: 'ruby', csharp: 'dotnet', php: 'php',
  swift: 'swift', dart: 'dart',
};
const FRONTEND_FRAMEWORKS = new Set([
  'react', 'next', 'vite', 'astro', 'nuxt', 'svelte', 'sveltekit', 'vue', 'angular',
  'tailwindcss', 'react-router', 'remix',
]);
const INFRA_FLAGS = ['docker', 'compose', 'terraform', 'kubernetes', 'helm'];

// A second ecosystem counts as "real" when it has at least 5 source files and at least
// 20% of all source files the detector counted (e.g. a Python API with a frontend/ app).
// A lone package.json for tooling does not qualify.
const SECONDARY_MIN_FILES = 5;
const SECONDARY_MIN_SHARE = 0.2;

function secondaryEcosystems(detection, primaryEcosystem) {
  const perEcosystem = new Map();
  let total = 0;
  for (const lang of detection.languages || []) {
    const eco = LANGUAGE_ECOSYSTEM[lang.name];
    if (!eco) continue;
    perEcosystem.set(eco, (perEcosystem.get(eco) || 0) + (lang.files || 0));
    total += lang.files || 0;
  }
  const out = [];
  for (const [eco, files] of perEcosystem) {
    if (eco === primaryEcosystem) continue;
    if (files >= SECONDARY_MIN_FILES && total > 0 && files / total >= SECONDARY_MIN_SHARE) out.push(eco);
  }
  return out.sort();
}

// Android projects are plain jvm/kotlin to the detector; the manifest gives them away.
function looksLikeAndroid(dir) {
  return ['AndroidManifest.xml', 'app/src/main/AndroidManifest.xml', 'src/main/AndroidManifest.xml']
    .some((rel) => fs.existsSync(path.join(dir, rel)));
}

export function chooseKnowledge(detection, dir) {
  const notes = [];
  const add = (file) => {
    if (file && !notes.includes(file)) notes.push(file);
  };
  const frontend = (detection.frameworks || []).some((f) => FRONTEND_FRAMEWORKS.has(f.name));

  const primaryEcosystem = detection.primary;
  add(ECOSYSTEM_NOTE[primaryEcosystem]);
  if (primaryEcosystem === 'node' && frontend) add('frontend.md');

  for (const eco of secondaryEcosystems(detection, primaryEcosystem)) {
    add(ECOSYSTEM_NOTE[eco]);
    if (eco === 'node' && frontend) add('frontend.md');
  }

  const kotlin = (detection.languages || []).some((l) => l.name === 'kotlin');
  if ((primaryEcosystem === 'jvm' || kotlin) && dir && looksLikeAndroid(dir)) add('mobile.md');

  const infra = detection.infra || {};
  if (INFRA_FLAGS.some((flag) => infra[flag])) add('infra.md');
  return notes;
}

// A fence longer than any backtick run inside the content, so the content cannot close it.
function fenceFor(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

function readSkillFile(rel) {
  try {
    return fs.readFileSync(path.join(SKILL_ROOT, rel), 'utf8').replace(/\s+$/, '');
  } catch {
    return null;
  }
}

function section(title, rel) {
  const body = readSkillFile(rel);
  return `## ${title}\n${body === null ? `(missing: ${rel} could not be read)` : body}`;
}

// Guidance that is not injected by default: fetched on demand with `--show <path>...`.
const PRACTICES = 'knowledge/practices.md';
const ALWAYS_REFERENCE = 'reference/writing-agent-files.md'; // short and needed for every file written
// Above this many lines the --full context starts to crowd out the task itself. The core is sized by its filters instead.
const MAX_FULL_LINES = 3200;

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DETECT_PATH = path.join(path.dirname(SCRIPT_PATH), 'detect.mjs');

// Markdown files below a skill directory, as posix paths relative to the skill root, sorted.
function listMarkdown(dirRel) {
  const out = [];
  const walkDir = (rel) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(SKILL_ROOT, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) walkDir(child);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(child);
    }
  };
  walkDir(dirRel);
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// blueprints/**/*.md, README first, then by path.
function listBlueprints() {
  const readme = 'blueprints/README.md';
  return listMarkdown('blueprints').sort((a, b) => Number(b === readme) - Number(a === readme) || (a < b ? -1 : a > b ? 1 : 0));
}

// Fixed order for the references that were injected before; any newer file follows alphabetically.
const REFERENCE_ORDER = [
  'writing-agent-files.md', 'claude-code.md', 'agent-adapters.md', 'agentic-pipeline.md',
  'token-efficiency.md', 'code-search.md', 'model-tiers.md', 'routing.md',
].map((f) => `reference/${f}`);

function listReferences() {
  const rank = (rel) => (REFERENCE_ORDER.includes(rel) ? REFERENCE_ORDER.indexOf(rel) : REFERENCE_ORDER.length);
  return listMarkdown('reference').sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

// Drops the "## Current versions" table from a knowledge note; version notes and the default
// toolchain stay. Used only when the context would otherwise be too large.
export function withoutCurrentVersions(body) {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => /^##\s+Current versions\b/.test(l));
  if (start < 0) return body;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  return [...lines.slice(0, start), '(Current versions table omitted to keep this context small.)', '', ...lines.slice(end)].join('\n');
}

// Removes one `## ` section (its heading and body, up to the next `## ` heading) from a note.
function removeSection(body, heading) {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return body;
  let end = lines.findIndex((l, i) => i > start && NEXT_SECTION.test(l));
  if (end < 0) end = lines.length;
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n');
}

const CURRENT_VERSIONS = /^##\s+Current versions\b/;
const DEFAULT_TOOLCHAIN = /^##\s+Default toolchain\b/;
const VERSION_NOTES = /^##\s+Version notes\s*$/;
const NEXT_SECTION = /^##\s/;

// ---------------------------------------------------------------------------
// Version gates. A knowledge note's "## Version notes" bullet starts with a gate, `- **<gate>**: ...`.
// The core keeps a bullet only when its gate holds for the detected tools and versions.
// ---------------------------------------------------------------------------

// Gate tool names that the detector spells differently. The last two are free-text gates whose tool is named
// in full: "pnpm workspaces" holds when pnpm is detected, and "Node type stripping (any version)" when Node is.
const GATE_ALIASES = {
  'go.mod go line': 'go', edition: 'rust', '.net': 'dotnet', 'shadcn cli': 'shadcn', 'spring boot': 'spring-boot',
  'pnpm workspaces': 'pnpm', 'node type stripping': 'node',
};

// Lowercase, no backticks, no `@scope/` prefix, no `.js` suffix. Gate names and detector names both go through it.
const normName = (text) => String(text).replace(/`/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
  .replace(/^@[^/]+\//, '').replace(/\.js$/, '');

const BARE_VERSION = /^\s*v?\d+(?:\.\d+)*\s*$/;
// The first dotted number in a version or range string, or null.
const numericPrefix = (text) => {
  const m = /v?(\d+(?:\.\d+)*)/.exec(String(text ?? ''));
  return m ? m[1] : null;
};

// Dotted version numbers compared numerically, component by component (`22.18` < `22.100`).
export function compareVersions(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Map of tool key -> { version, exact } from the detection JSON. `exact` means the version is a pin, not a
// range's lower bound; `<`, `<=` and `=` gates need an exact version, because a lower bound proves nothing about them.
// Scoped packages also answer to their scope name (`@trpc/server` for `trpc`), but never `@types/*`.
export function detectedTools(detection) {
  const direct = new Map();
  const scoped = new Map();
  const put = (map, name, version, exact) => {
    const key = normName(name);
    if (!key) return;
    const prev = map.get(key);
    if (!prev || (version && !prev.version)) map.set(key, { version, exact: Boolean(version && exact) });
  };
  for (const [lang, value] of Object.entries(detection.languageVersion || {})) {
    if (lang === 'rust' && value && typeof value === 'object') {
      if (value.edition) put(direct, 'rust', numericPrefix(value.edition), BARE_VERSION.test(String(value.edition)));
      if (value.rustVersion) put(direct, 'rustc', numericPrefix(value.rustVersion), BARE_VERSION.test(String(value.rustVersion)));
    } else if (typeof value === 'string') {
      put(direct, lang, numericPrefix(value), BARE_VERSION.test(value));
    } else {
      put(direct, lang, null, false);
    }
  }
  if (detection.packageManager) {
    const pmv = detection.packageManagerVersion;
    put(direct, detection.packageManager, numericPrefix(pmv), BARE_VERSION.test(String(pmv ?? '')));
  }
  for (const lang of detection.languages || []) put(direct, lang.name, null, false);
  for (const [flag, on] of Object.entries(detection.infra || {})) if (on === true) put(direct, flag, null, false);
  for (const f of detection.frameworks || []) {
    if (!f.name || /^@types\//.test(f.name)) continue;
    const version = numericPrefix(f.version);
    const exact = ['', '=', '=='].includes(String(f.range || '').trim());
    put(direct, f.name, version, exact);
    const scope = /^@([^/]+)\//.exec(f.name);
    if (scope) put(scoped, scope[1], version, exact);
  }
  for (const [key, entry] of scoped) if (!direct.has(key)) direct.set(key, entry);
  return direct;
}

// One clause of a gate: { tool, op, version }, or { tool, op: null } for presence only, or null when unparseable.
export function parseClause(text) {
  const s = String(text).trim();
  const cmp = /^(.+?)\s*(>=|<=|==|=|>|<)\s*"?v?(\d+(?:\.\d+)*)"?(?=\s|$|\()/.exec(s);
  if (cmp) return { tool: normName(cmp[1]), op: cmp[2] === '==' ? '=' : cmp[2], version: cmp[3] };
  const orOlder = /^(.+?)\s+(\d+(?:\.\d+)*)\s+or older$/i.exec(s);
  if (orOlder) return { tool: normName(orOlder[1]), op: '<=', version: orOlder[2] };
  // "<tool>" and "<tool> (any ...)" only. Other parentheticals ("Symfony 7.4 (LTS)") are not parseable.
  const bare = s.replace(/\s*\(any[^()]*\)\s*$/i, '');
  if (!bare || /[()]/.test(bare)) return null;
  return { tool: normName(bare), op: null };
}

// True when every clause of the gate holds for the detected tools. Unparseable or undetected tools fail.
export function gateHolds(gate, tools) {
  return String(gate).split(/\s+and\s+/i).every((part) => {
    const clause = parseClause(part);
    if (!clause) return false;
    const entry = tools.get(GATE_ALIASES[clause.tool] || clause.tool);
    if (!entry) return false;
    if (!clause.op) return true;
    if (!entry.version) return false;
    if (clause.op !== '>=' && clause.op !== '>' && !entry.exact) return false;
    const cmp = compareVersions(entry.version, clause.version);
    switch (clause.op) {
      case '>=': return cmp >= 0;
      case '>': return cmp > 0;
      case '<=': return cmp <= 0;
      case '<': return cmp < 0;
      case '=': return cmp === 0;
      default: return false;
    }
  });
}

const gateOf = (line) => {
  const m = /^- \*\*(.+?)\*\*:/.exec(line);
  return m ? m[1].trim() : null;
};

// Keeps the version bullets whose gate holds. The section gets one count line under its bullets:
// how many were kept, out of how many, and where the full note is.
export function filterVersionNotes(body, tools, rel) {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => VERSION_NOTES.test(l));
  if (start < 0) return body;
  let end = lines.findIndex((l, i) => i > start && NEXT_SECTION.test(l));
  if (end < 0) end = lines.length;
  const prose = [];
  const items = [];
  for (const line of lines.slice(start + 1, end)) {
    if (line.startsWith('- ')) items.push({ gate: gateOf(line), lines: [line] });
    else if (line.trim() === '') continue;
    else if (items.length) items[items.length - 1].lines.push(line);
    else prose.push(line);
  }
  const kept = items.filter((item) => item.gate !== null && gateHolds(item.gate, tools));
  const section = [lines[start], ''];
  if (prose.length) section.push(...prose, '');
  for (const item of kept) section.push(...item.lines);
  section.push('', `Kept ${kept.length} of ${items.length} version notes for detected versions. Full note: --show ${rel}`);
  return [...lines.slice(0, start), ...section, '', ...lines.slice(end)].join('\n');
}

const errorText = (err) => (err && err.message ? err.message : String(err));

// JSON with two-space indentation. Arrays of scalars and small flat objects stay on one line
// when they fit in 130 characters, which roughly halves the line count of detector output.
function prettyJson(value, indent = '') {
  const flat = (v) => JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ').replace(/\[ /g, '[').replace(/ \]/g, ']').replace(/\{ /g, '{ ').replace(/ \}/g, ' }');
  const simple = (v) => v === null || typeof v !== 'object' || (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object'));
  if (isLeaf(value)) return JSON.stringify(value);
  const inner = `${indent}  `;
  const oneLine = Array.isArray(value) ? value.every(simple) : Object.values(value).every(simple);
  if (oneLine) {
    const text = flat(value);
    if (text.length + indent.length <= 130) return text;
  }
  if (Array.isArray(value)) return `[\n${value.map((v) => inner + prettyJson(v, inner)).join(',\n')}\n${indent}]`;
  return `{\n${Object.entries(value).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${prettyJson(v, inner)}`).join(',\n')}\n${indent}}`;
}

function isLeaf(v) {
  return v === null || typeof v !== 'object';
}

// Caps for long lists in the injected copy of the detector output (the full JSON stays one command away).
const LIST_CAPS = {
  'commands.other': 8, 'commands.*': 12, hardRuleCandidates: 12, workspaces: 40, docs: 20,
  agentConfigs: 30, ci: 15, generated: 15, frameworks: 40, languages: 8,
};
// Tighter caps for the compact core, used only when the core is over its byte budget.
const COMPACT_CAPS = {
  'commands.other': 3, 'commands.*': 4, hardRuleCandidates: 6, workspaces: 20, docs: 8,
  agentConfigs: 10, ci: 5, generated: 6, frameworks: 20, languages: 4,
};
// The compact core lists this many files of the repo map; the rest stay one command away.
const COMPACT_REPO_MAP = 10;
// The core is kept under this many bytes; above it, the compact level applies.
export const CORE_MAX_BYTES = 30000;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Drops nulls, empty strings, empty lists and objects, and false flags; caps long lists and
// records how many items were cut under `_omitted`.
export function compactDetection(detection, caps = LIST_CAPS) {
  const omitted = {};
  const capFor = (key) => {
    if (caps[key]) return caps[key];
    return key.startsWith('commands.') ? caps['commands.*'] : 0;
  };
  const keep = (v) => !(v === null || v === undefined || v === '' || v === false
    || (Array.isArray(v) && v.length === 0) || (isPlainObject(v) && Object.keys(v).length === 0));
  const clean = (value, key) => {
    if (Array.isArray(value)) {
      const cap = capFor(key);
      let items = value;
      if (cap && value.length > cap) {
        omitted[key] = value.length - cap;
        items = value.slice(0, cap);
      }
      return items.map((x) => clean(x, `${key}[]`)).filter(keep);
    }
    if (isPlainObject(value)) {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        const cleaned = clean(v, key ? `${key}.${k}` : k);
        if (keep(cleaned)) out[k] = cleaned;
      }
      return out;
    }
    return value;
  };
  const out = clean(detection, '');
  if (Object.keys(omitted).length) out._omitted = omitted;
  return out;
}

// The graph is built once and shared with the roster, so the repo is not walked twice.
function computeGraph(dir) {
  try {
    return { graph: buildGraph(dir), error: null };
  } catch (err) {
    return { graph: null, error: errorText(err) };
  }
}

const GRAPH_PATH = path.join(path.dirname(SCRIPT_PATH), 'graph.mjs');

function repoGraphSection({ graph, error }, { compact = false, dir = '.' } = {}) {
  if (!graph) return `## Repo graph\n(repo graph unavailable: ${error})`;
  try {
    const map = graph.repoMap || [];
    const shown = compact && map.length > COMPACT_REPO_MAP ? { ...graph, repoMap: map.slice(0, COMPACT_REPO_MAP) } : graph;
    const more = map.length - shown.repoMap.length;
    const note = more > 0 ? `\n(${more} more files with exported symbols are left out. Full map: node "${GRAPH_PATH}" "${dir}" --markdown)` : '';
    return `## Repo graph\n${renderMarkdown(shown, { maxNodes: 25 }).replace(/\s+$/, '')}${note}`;
  } catch (err) {
    return `## Repo graph\n(repo graph unavailable: ${errorText(err)})`;
  }
}

// Roster and router config come from one derivation. Headings inside the rendered roster are
// demoted so that every `## ` line in the context is one of the sections named in the header.
function rosterSections(dir, detection, graph) {
  try {
    const roster = deriveRoster(dir, { detection, graph: graph || {} });
    const markdown = renderRosterMarkdown(roster).replace(/\s+$/, '').replace(/^## /gm, '### ');
    const config = prettyJson(toRouterConfig(roster));
    const fence = fenceFor(config);
    return {
      roster: `## Agent roster\n${markdown}`,
      router: `## Router config\n${fence}json\n${config}\n${fence}`,
    };
  } catch (err) {
    const note = `(agent roster unavailable: ${errorText(err)})`;
    return { roster: `## Agent roster\n${note}`, router: `## Router config\n${note}` };
  }
}

// First prose sentence of a markdown file, for the guidance index.
export function firstSentence(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  if (lines[0] && lines[0].trim() === '---') {
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === '---');
    i = end < 0 ? 0 : end + 1;
  }
  let inFence = false;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence || !line || /^(#|>|\||---|<!--|```|~~~)/.test(line) || /^(checked|updated|last updated)\b/i.test(line)) continue;
    const prose = line.replace(/^(?:[-*+]|\d+[.)])\s+/, '').replace(/[*_`]/g, '');
    const sentence = prose.split(/(?<=[.!?])\s/)[0];
    if (sentence.length <= 140) return sentence;
    return `${sentence.slice(0, 139).replace(/\s+\S*$/, '')}…`;
  }
  return '';
}

// Shortens a sentence to `max` characters at a word boundary.
function clip(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

// One line per file. Compact cuts each summary to 60 characters.
function guidanceIndex(injected, { compact = false } = {}) {
  const readme = readSkillFile('blueprints/README.md');
  const paths = [
    ...listBlueprints(),
    PRACTICES,
    ...listReferences(),
  ].filter((rel) => !injected.has(rel));
  const lines = paths.map((rel) => {
    const summary = compact ? clip(firstSentence(readSkillFile(rel) || ''), 60) : firstSentence(readSkillFile(rel) || '');
    return summary ? `- ${rel}: ${summary}` : `- ${rel}`;
  });
  // The README's first sentence only; the whole README is one --show away like any blueprint.
  const intro = readme === null ? '(missing: blueprints/README.md could not be read)' : firstSentence(readme);
  return [
    '## Guidance index',
    intro,
    '',
    '### Available guidance',
    '',
    'Not injected, to keep this context small. Fetch what you need right before you use it, several paths per call:',
    '',
    `\`node "${SCRIPT_PATH}" --show <path> [<path>...]\``,
    '',
    ...lines,
  ].join('\n');
}

// A knowledge note for the core: no Current versions table, version bullets filtered by their gates, and the
// Default toolchain only for the primary ecosystem's note (the others are fallbacks for stacks not detected).
function coreKnowledgeSection(rel, tools, isPrimary) {
  const heading = `## Knowledge: ${rel}`;
  const raw = readSkillFile(rel);
  if (raw === null) return `${heading}\n(missing: ${rel} could not be read)`;
  let body = filterVersionNotes(removeSection(raw, CURRENT_VERSIONS), tools, rel);
  if (!isPrimary) body = removeSection(body, DEFAULT_TOOLCHAIN);
  return `${heading}\n${body.replace(/\s+$/, '')}`;
}

function assemble(detection, shared, template, knowledge, { full, trimVersions = false, compact = false }) {
  const tools = detectedTools(detection);
  const primaryNote = ECOSYSTEM_NOTE[detection.primary];
  const knowledgeSection = (rel) => {
    if (!full) return coreKnowledgeSection(rel, tools, rel === `knowledge/${primaryNote}`);
    const raw = section(`Knowledge: ${rel}`, rel);
    return trimVersions ? withoutCurrentVersions(raw) : raw;
  };
  let detectionText;
  if (full) {
    const json = JSON.stringify(detection, null, 2);
    const fence = fenceFor(json);
    detectionText = `## Detection\n${fence}json\n${json}\n${fence}`;
  } else {
    const json = prettyJson(compactDetection(detection, compact ? COMPACT_CAPS : LIST_CAPS));
    const fence = fenceFor(json);
    detectionText = [
      '## Detection',
      `Compacted: nulls, empty lists and false flags are dropped, long lists are capped (dropped counts are in \`_omitted\`). Full output: \`node "${DETECT_PATH}" .\``,
      `${fence}json\n${json}\n${fence}`,
    ].join('\n');
  }

  const sections = [
    { name: 'Detection', text: detectionText },
    { name: `Template: templates/${template}.md`, text: section(`Template: templates/${template}.md`, `templates/${template}.md`) },
    ...knowledge.map((file) => ({ name: `Knowledge: knowledge/${file}`, text: knowledgeSection(`knowledge/${file}`) })),
    { name: 'Repo graph', text: repoGraphSection(shared.graph, { compact, dir: shared.dir }) },
    { name: 'Agent roster', text: shared.roster.roster },
  ];
  if (full) {
    sections.push({ name: 'Router config', text: shared.roster.router });
    sections.push({ name: `Knowledge: ${PRACTICES}`, text: knowledgeSection(PRACTICES) });
    for (const rel of listBlueprints()) sections.push({ name: `Blueprint: ${rel}`, text: section(`Blueprint: ${rel}`, rel) });
    for (const rel of listReferences()) sections.push({ name: `Reference: ${rel}`, text: section(`Reference: ${rel}`, rel) });
  } else {
    // The compact core leaves even this reference to the index; SKILL.md says to fetch it first.
    if (!compact) sections.push({ name: `Reference: ${ALWAYS_REFERENCE}`, text: section(`Reference: ${ALWAYS_REFERENCE}`, ALWAYS_REFERENCE) });
    sections.push({ name: 'Guidance index', text: guidanceIndex(new Set(compact ? [] : [ALWAYS_REFERENCE]), { compact }) });
  }

  const header = (size) => [
    '# claude-setup context',
    `Template: ${template} (reason: primary=${detection.primary}, layout=${detection.layout})`,
    `Knowledge: ${knowledge.length ? knowledge.join(', ') : 'none'}`,
    `Sections: ${sections.map((x) => x.name).join(', ')}`,
    `Size: ${size} lines`,
    '',
  ].join('\n');
  const body = `${sections.map((x) => x.text).join('\n\n')}\n`;
  // The size line counts itself: the header has a fixed number of lines whatever the number is.
  const lineCount = `${header(0)}\n${body}`.split('\n').length - 1;
  return `${header(lineCount)}\n${body}`;
}

// Default: the core (detection, template, the stack notes filtered to the detected versions, graph, roster,
// one reference, and an index of everything else). `full: true` injects all guidance, as older versions did.
// opts.budget overrides CORE_MAX_BYTES for the core (tests use a tiny budget to exercise the compact level).
export function buildContext(dirArg = process.cwd(), opts = {}) {
  const full = Boolean(opts.full);
  const budget = opts.budget ?? CORE_MAX_BYTES;
  const dir = path.resolve(dirArg);
  const detection = detect(dir);
  const template = chooseTemplate(detection.primary, detection.layout);
  const knowledge = chooseKnowledge(detection, dir);
  const graph = computeGraph(dir);
  const shared = { graph, dir, roster: rosterSections(dir, detection, graph.graph) };
  if (full) {
    const first = assemble(detection, shared, template, knowledge, { full: true });
    if (first.split('\n').length - 1 <= MAX_FULL_LINES) return first;
    return assemble(detection, shared, template, knowledge, { full: true, trimVersions: true });
  }
  const core = assemble(detection, shared, template, knowledge, { full: false });
  if (Buffer.byteLength(core) <= budget) return core;
  return assemble(detection, shared, template, knowledge, { full: false, compact: true });
}

// ---------------------------------------------------------------------------
// --show: print named guidance files
// ---------------------------------------------------------------------------

const SHOW_KINDS = { blueprints: 'Blueprint', reference: 'Reference', knowledge: 'Knowledge', templates: 'Template' };

// Checks one `--show` argument. Returns { rel, kind } or { error }.
export function resolveShowPath(arg) {
  if (typeof arg !== 'string' || arg === '' || arg.includes('\0') || arg.includes('\\')) return { error: 'not a valid path' };
  const rel = arg.replace(/^\.\//, '');
  const segments = rel.split('/');
  if (rel.startsWith('/') || segments.includes('..') || segments.includes('') || segments.includes('.')) {
    return { error: 'absolute paths, ".." and empty segments are not allowed' };
  }
  const [top] = segments;
  if (!SHOW_KINDS[top] || segments.length < 2) {
    return { error: `only files inside ${Object.keys(SHOW_KINDS).map((d) => `${d}/`).join(', ')} are available` };
  }
  try {
    const real = fs.realpathSync(path.join(SKILL_ROOT, rel));
    const base = fs.realpathSync(path.join(SKILL_ROOT, top));
    if (!real.startsWith(base + path.sep)) return { error: 'resolves outside the skill directory' };
    if (!fs.statSync(real).isFile()) return { error: 'not a file' };
  } catch {
    return { rel, kind: SHOW_KINDS[top], missing: true };
  }
  return { rel, kind: SHOW_KINDS[top] };
}

// One section per requested path; rejected or missing paths become one-line notes.
export function showFiles(args) {
  const parts = [];
  const seen = new Set();
  for (const arg of args) {
    const r = resolveShowPath(arg);
    if (r.error) {
      parts.push(`(rejected: ${JSON.stringify(String(arg))}: ${r.error})`);
      continue;
    }
    if (seen.has(r.rel)) continue;
    seen.add(r.rel);
    parts.push(r.missing ? `(missing: ${r.rel} does not exist)` : section(`${r.kind}: ${r.rel}`, r.rel));
  }
  if (parts.length === 0) parts.push('(nothing requested: usage: --show <path> [<path>...], paths inside blueprints/, reference/, knowledge/ or templates/)');
  return `${parts.join('\n\n')}\n`;
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
  const args = process.argv.slice(2);
  let output;
  try {
    const showAt = args.indexOf('--show');
    if (showAt >= 0) {
      output = showFiles(args.slice(showAt + 1).filter((a) => !(a.startsWith('--') && a !== '--show')));
    } else {
      const dir = args.find((a) => !a.startsWith('-')) || process.cwd();
      output = buildContext(dir, { full: args.includes('--full') });
    }
  } catch (err) {
    output = `# claude-setup context\n\nCONTEXT_ERROR: ${err && err.message ? err.message : err}\n`;
  }
  process.stdout.write(output);
}

if (isEntryPoint()) main();
