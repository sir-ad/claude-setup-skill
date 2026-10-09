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

function checkSkill() {
  if (!exists('SKILL.md')) {
    fail('SKILL.md is missing');
    return;
  }
  const fields = parseFrontmatter(read('SKILL.md'));
  if (!fields) {
    fail('SKILL.md has no YAML frontmatter (file must open with a --- block)');
  } else {
    for (const key of ['name', 'description']) {
      if (!fields[key]) fail(`SKILL.md frontmatter: "${key}" is missing or empty`);
    }
  }

  // Paths like ${CLAUDE_SKILL_DIR}/templates/go.md must exist. Paths with
  // placeholder or glob characters (<name>, {x}, *) are documentation, so skip.
  const refs = new Set();
  for (const m of read('SKILL.md').matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([^\s`'"()]+)/g)) {
    refs.add(m[1].replace(/[.,;:]+$/, ''));
  }
  for (const ref of refs) {
    if (/[<>{}*]/.test(ref)) continue;
    if (!exists(ref)) fail(`SKILL.md references \${CLAUDE_SKILL_DIR}/${ref}, which does not exist`);
  }
}

function listMarkdown(dirRel, recursive) {
  if (!exists(dirRel)) return [];
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(abs(rel), { withFileTypes: true })) {
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory() && recursive) walk(child);
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

// Top-level items the installed skill needs at runtime. knowledge/ and
// scripts/ are only required once they exist on disk.
function runtimeItems() {
  const items = ['SKILL.md', 'templates'];
  for (const dir of ['knowledge', 'scripts']) {
    if (exists(dir)) items.push(dir);
  }
  return items;
}

// Reads the ITEMS array from bin/install.js with a regex (no import, so the
// installer stays free of side effects when this runs).
function parseInstallItems(src) {
  const m = /const\s+ITEMS\s*=\s*\[([\s\S]*?)\]/.exec(src);
  if (!m) return null;
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

function checkPackaging() {
  let pkg;
  try {
    pkg = JSON.parse(read('package.json'));
  } catch (err) {
    fail(`package.json does not parse: ${err.message}`);
    return;
  }

  const files = Array.isArray(pkg.files) ? pkg.files : [];
  for (const entry of files) {
    if (!exists(entry)) fail(`package.json "files" lists "${entry}", which does not exist`);
  }

  if (!exists('bin/install.js')) {
    fail('bin/install.js is missing');
    return;
  }
  const items = parseInstallItems(read('bin/install.js'));
  if (!items) {
    fail('bin/install.js: could not find the ITEMS array');
    return;
  }
  for (const item of items) {
    if (!exists(item)) fail(`bin/install.js ITEMS lists "${item}", which does not exist`);
  }

  for (const item of runtimeItems()) {
    if (!files.includes(item)) fail(`"${item}" is missing from package.json "files"`);
    if (!items.includes(item)) fail(`"${item}" is missing from bin/install.js ITEMS`);
  }
}

checkSkill();

for (const file of [...listMarkdown('templates', false), ...listMarkdown('knowledge', true)]) {
  checkMarkdown(file);
}

checkPackaging();

for (const w of warnings) console.log(`WARN  ${w}`);
for (const f of failures) console.log(`FAIL  ${f}`);

const summary = `${failures.length} failure(s), ${warnings.length} warning(s)`;
if (failures.length > 0) {
  console.log(`\nvalidate: failed (${summary})`);
  process.exitCode = 1;
} else {
  console.log(`validate: ok (${summary})`);
}
