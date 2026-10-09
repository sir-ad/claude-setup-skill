#!/usr/bin/env node
// Repo checks for the claude-setup skill. Zero dependencies. Node 18+.
//
// Usage: node scripts/validate.mjs
//
// Exits 1 when a check fails. Warnings never fail the run.
//
// Placeholder rule: a line counts as a placeholder when it contains TODO,
// TBD, FIXME, "<fill" or "lorem ipsum" (case-insensitive). Two things are
// ignored so that docs can describe the rule:
//   - text inside inline `code` spans
//   - lines where a negation ("no", "not", "never", "don't", "do not")
//     comes before the marker, e.g. "No placeholder TODOs".

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_LINES = 300;
const PLACEHOLDER = /\b(todo|tbd|fixme)\b|<fill|lorem ipsum/i;
const NEGATION = /\b(no|not|never|don't|do not)\b/i;

// Directories whose markdown files get the heading and placeholder checks.
const MARKDOWN_DIRS = ['templates', 'knowledge', 'reference'];
// Runtime directories. They are required only once they exist on disk.
const OPTIONAL_RUNTIME_DIRS = ['knowledge', 'reference', 'scripts'];

const failures = [];
const warnings = [];

const fail = (msg) => failures.push(msg);
const warn = (msg) => warnings.push(msg);
const abs = (rel) => path.join(ROOT, rel);
const exists = (rel) => fs.existsSync(abs(rel));
const read = (rel) => fs.readFileSync(abs(rel), 'utf8');

// Returns the marker found on a line, or null when the line is fine.
function placeholderOn(line) {
  const prose = line.replace(/`[^`]*`/g, ' ');
  const hit = PLACEHOLDER.exec(prose);
  if (!hit) return null;
  if (NEGATION.test(prose.slice(0, hit.index))) return null;
  return hit[0];
}

// Minimal frontmatter reader: `key: value` lines, plus indented block scalars
// after a bare `key:`, `key: >` or `key: |`. Returns null if there is no block.
function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return null;

  const fields = {};
  for (let i = 1; i < end; i += 1) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let value = m[2].trim();
    if (['', '>', '|', '>-', '|-'].includes(value)) {
      const block = [];
      while (i + 1 < end && /^\s+\S/.test(lines[i + 1])) {
        i += 1;
        block.push(lines[i].trim());
      }
      value = block.join(' ');
    }
    fields[m[1]] = value.replace(/^(['"])(.*)\1$/, '$2').trim();
  }
  return fields;
}

// Reads package.json "files" and the installer's ITEMS. Returns null (and
// records a failure) when either cannot be read.
function loadPackaging() {
  let pkg;
  try {
    pkg = JSON.parse(read('package.json'));
  } catch (err) {
    fail(`package.json does not parse: ${err.message}`);
    return null;
  }
  if (!exists('bin/install.js')) {
    fail('bin/install.js is missing');
    return null;
  }
  const m = /const\s+ITEMS\s*=\s*\[([\s\S]*?)\]/.exec(read('bin/install.js'));
  if (!m) {
    fail('bin/install.js: could not find the ITEMS array');
    return null;
  }
  const items = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
  return { files: Array.isArray(pkg.files) ? pkg.files : [], items };
}

// A top-level item ships when it is in both package.json "files" and the
// installer's ITEMS.
function ships(shipped, item) {
  return shipped.files.includes(item) && shipped.items.includes(item);
}

// Pulls names out of a sentence such as "The list: a, b and c." and maps
// each one to a file under dir. Returns null when the sentence is missing.
function namedFiles(skillText, sentence, dir) {
  const m = new RegExp(`${sentence} (.+?)\\.(?=\\s|$)`, 'm').exec(skillText);
  if (!m) return null;
  return m[1]
    .split(/,\s*|\s+and\s+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => `${dir}/${name.endsWith('.md') ? name : `${name}.md`}`);
}

function checkSkill(shipped) {
  if (!exists('SKILL.md')) {
    fail('SKILL.md is missing');
    return;
  }
  const text = read('SKILL.md');

  const fields = parseFrontmatter(text);
  if (!fields) {
    fail('SKILL.md has no YAML frontmatter (file must open with a --- block)');
  } else {
    for (const key of ['name', 'description']) {
      if (!fields[key]) fail(`SKILL.md frontmatter: "${key}" is missing or empty`);
    }
  }

  // Every ${CLAUDE_SKILL_DIR}/<path> must exist, and its top-level directory
  // (or file) must ship. Paths with placeholder or glob characters (<name>,
  // {x}, *) are documentation, so skip them.
  const refs = new Set();
  for (const m of text.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([^\s`'"()]+)/g)) {
    refs.add(m[1].replace(/[.,;:]+$/, ''));
  }
  const unshipped = new Set();
  for (const ref of refs) {
    if (/[<>{}*]/.test(ref)) continue;
    if (!exists(ref)) {
      fail(`SKILL.md references \${CLAUDE_SKILL_DIR}/${ref}, which does not exist`);
      continue;
    }
    const top = ref.split('/')[0];
    if (shipped && !ships(shipped, top)) unshipped.add(top);
  }
  for (const top of unshipped) {
    fail(`SKILL.md uses "${top}" but it is not in package.json "files" and bin/install.js ITEMS`);
  }

  // Lists of files named in SKILL.md: each must exist.
  const lists = [
    { label: 'template list', sentence: 'The list:', dir: 'templates' },
    { label: 'knowledge list', sentence: 'The files are', dir: 'knowledge' },
  ];
  for (const { label, sentence, dir } of lists) {
    const named = namedFiles(text, sentence, dir);
    if (!named) {
      fail(`SKILL.md: could not find the ${label} ("${sentence} ...")`);
      continue;
    }
    for (const file of named) {
      if (!exists(file)) fail(`SKILL.md ${label} names ${file}, which does not exist`);
    }
  }
}

function listMarkdown(dirRel) {
  if (!exists(dirRel)) return [];
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(abs(rel), { withFileTypes: true })) {
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(child);
    }
  };
  walk(dirRel);
  return out.sort();
}

function checkMarkdown(file) {
  const text = read(file);
  if (text.trim() === '') {
    fail(`${file}: file is empty`);
    return;
  }
  const lines = text.split(/\r?\n/);
  const first = lines.find((l) => l.trim() !== '');
  if (!first.startsWith('# ')) fail(`${file}: must start with a "# " heading`);

  lines.forEach((line, i) => {
    const marker = placeholderOn(line);
    if (marker) fail(`${file}:${i + 1}: placeholder "${marker}" found`);
  });

  if (lines.length > MAX_LINES) {
    warn(`${file}: ${lines.length} lines (over ${MAX_LINES}); consider splitting it`);
  }
}

function checkRuntimeDirs(shipped) {
  const required = ['SKILL.md', 'templates'];
  for (const dir of OPTIONAL_RUNTIME_DIRS) {
    if (exists(dir)) required.push(dir);
  }
  for (const item of required) {
    if (!shipped) continue;
    if (!shipped.files.includes(item)) fail(`"${item}" is missing from package.json "files"`);
    if (!shipped.items.includes(item)) fail(`"${item}" is missing from bin/install.js ITEMS`);
  }
  if (!shipped) return;
  for (const item of new Set([...shipped.files, ...shipped.items])) {
    if (!exists(item)) fail(`"${item}" is listed for shipping but does not exist`);
  }
}

const shipped = loadPackaging();
checkSkill(shipped);
for (const dir of MARKDOWN_DIRS) {
  for (const file of listMarkdown(dir)) checkMarkdown(file);
}
checkRuntimeDirs(shipped);

for (const w of warnings) console.log(`WARN  ${w}`);
for (const f of failures) console.log(`FAIL  ${f}`);

const summary = `${failures.length} failure(s), ${warnings.length} warning(s)`;
if (failures.length > 0) {
  console.log(`\nvalidate: failed (${summary})`);
  process.exitCode = 1;
} else {
  console.log(`validate: ok (${summary})`);
}
