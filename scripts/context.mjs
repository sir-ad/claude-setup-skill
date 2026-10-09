#!/usr/bin/env node
// Prints everything the /claude-setup skill needs as one markdown document:
// the detector JSON, the chosen template, the matching knowledge notes and the
// reference files. Headless Claude cannot read files in the skill directory,
// so this script reads them and prints them whole.
//
//   node scripts/context.mjs [dir]     default dir: current directory
//
// Always exits 0. A missing skill file becomes a one-line note.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detect } from './detect.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REFERENCES = ['writing-agent-files.md', 'claude-code.md', 'agent-adapters.md'];

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

export function buildContext(dirArg = process.cwd()) {
  const dir = path.resolve(dirArg);
  const detection = detect(dir);
  const template = chooseTemplate(detection.primary, detection.layout);
  const knowledge = chooseKnowledge(detection, dir);

  const json = JSON.stringify(detection, null, 2);
  const fence = fenceFor(json);
  const parts = [
    '# claude-setup context',
    `Template: ${template} (reason: primary=${detection.primary}, layout=${detection.layout})`,
    `Knowledge: ${knowledge.length ? knowledge.join(', ') : 'none'}`,
    '',
    '## Detection',
    `${fence}json\n${json}\n${fence}`,
    '',
    section(`Template: templates/${template}.md`, `templates/${template}.md`),
    ...knowledge.map((file) => `\n${section(`Knowledge: knowledge/${file}`, `knowledge/${file}`)}`),
    ...REFERENCES.map((file) => `\n${section(`Reference: reference/${file}`, `reference/${file}`)}`),
  ];
  return `${parts.join('\n')}\n`;
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
  const dir = process.argv.slice(2).find((a) => !a.startsWith('-')) || process.cwd();
  let output;
  try {
    output = buildContext(dir);
  } catch (err) {
    output = `# claude-setup context\n\nCONTEXT_ERROR: ${err && err.message ? err.message : err}\n`;
  }
  process.stdout.write(output);
}

if (isEntryPoint()) main();
