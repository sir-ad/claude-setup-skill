#!/usr/bin/env node
// Prints everything the /claude-setup skill needs as one markdown document:
// the detector JSON, the chosen template, the matching knowledge notes and the
// reference files. Headless Claude cannot read files in the skill directory,
// so this script reads them and prints them whole.
//
//   node scripts/context.mjs [dir]                 core context (default dir: current directory)
//   node scripts/context.mjs [dir] --full          core plus all blueprints, references and practices
//   node scripts/context.mjs --show <path>...     print guidance files from blueprints/, reference/,
//                                                  knowledge/ or templates/ (several per call)
//
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
// Above this many lines the injected context starts to crowd out the task itself.
const MAX_CORE_LINES = 1200;
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

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Drops nulls, empty strings, empty lists and objects, and false flags; caps long lists and
// records how many items were cut under `_omitted`.
export function compactDetection(detection) {
  const omitted = {};
  const capFor = (key) => {
    if (LIST_CAPS[key]) return LIST_CAPS[key];
    return key.startsWith('commands.') ? LIST_CAPS['commands.*'] : 0;
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

function repoGraphSection({ graph, error }) {
  if (!graph) return `## Repo graph\n(repo graph unavailable: ${error})`;
  try {
    return `## Repo graph\n${renderMarkdown(graph, { maxNodes: 25 }).replace(/\s+$/, '')}`;
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

// Demote markdown headings by `by` levels (outside code fences) so they stay below the section heading.
function demoteHeadings(text, by) {
  let inFence = false;
  return text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) return line;
    const m = line.match(/^(#{1,6})(\s.*)$/);
    return m ? `${'#'.repeat(Math.min(6, m[1].length + by))}${m[2]}` : line;
  }).join('\n');
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

function guidanceIndex(injected) {
  const readme = readSkillFile('blueprints/README.md');
  const paths = [
    ...listBlueprints().filter((rel) => rel !== 'blueprints/README.md'),
    PRACTICES,
    ...listReferences().filter((rel) => rel !== ALWAYS_REFERENCE),
  ].filter((rel) => !injected.has(rel));
  const lines = paths.map((rel) => {
    const summary = firstSentence(readSkillFile(rel) || '');
    return summary ? `- ${rel}: ${summary}` : `- ${rel}`;
  });
  return [
    '## Guidance index',
    readme === null ? '(missing: blueprints/README.md could not be read)' : demoteHeadings(readme, 2),
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

function assemble(dir, detection, shared, template, knowledge, { full, trimVersions }) {
  const knowledgeSection = (rel) => {
    const raw = section(`Knowledge: ${rel}`, rel);
    return trimVersions ? withoutCurrentVersions(raw) : raw;
  };
  let detectionText;
  if (full) {
    const json = JSON.stringify(detection, null, 2);
    const fence = fenceFor(json);
    detectionText = `## Detection\n${fence}json\n${json}\n${fence}`;
  } else {
    const json = prettyJson(compactDetection(detection));
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
    { name: 'Repo graph', text: repoGraphSection(shared.graph) },
    { name: 'Agent roster', text: shared.roster.roster },
    { name: 'Router config', text: shared.roster.router },
  ];
  if (full) {
    sections.push({ name: `Knowledge: ${PRACTICES}`, text: knowledgeSection(PRACTICES) });
    for (const rel of listBlueprints()) sections.push({ name: `Blueprint: ${rel}`, text: section(`Blueprint: ${rel}`, rel) });
    for (const rel of listReferences()) sections.push({ name: `Reference: ${rel}`, text: section(`Reference: ${rel}`, rel) });
  } else {
    sections.push({ name: `Reference: ${ALWAYS_REFERENCE}`, text: section(`Reference: ${ALWAYS_REFERENCE}`, ALWAYS_REFERENCE) });
    sections.push({ name: 'Guidance index', text: guidanceIndex(new Set([ALWAYS_REFERENCE])) });
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

// Default: the core (detection, template, stack notes, graph, roster, router, one reference, and an
// index of everything else). `full: true` injects all guidance, as older versions did.
export function buildContext(dirArg = process.cwd(), opts = {}) {
  const full = Boolean(opts.full);
  const dir = path.resolve(dirArg);
  const detection = detect(dir);
  const template = chooseTemplate(detection.primary, detection.layout);
  const knowledge = chooseKnowledge(detection, dir);
  const graph = computeGraph(dir);
  const shared = { graph, roster: rosterSections(dir, detection, graph.graph) };
  const cap = full ? MAX_FULL_LINES : MAX_CORE_LINES;
  const first = assemble(dir, detection, shared, template, knowledge, { full, trimVersions: false });
  if (first.split('\n').length - 1 <= cap) return first;
  return assemble(dir, detection, shared, template, knowledge, { full, trimVersions: true });
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
