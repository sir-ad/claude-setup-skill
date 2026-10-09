#!/usr/bin/env node
// Phase 5 checks for the files /claude-setup wrote. Zero dependencies. Node 18+.
//
//   node scripts/verify.mjs [--dir <project>] <file>...
//
// Paths are relative to --dir (default: current directory). Per file: line count,
// JSON validity, secret scan, size and import rules for AGENTS.md / CLAUDE.md, and
// safety checks for .claude/settings.json. Files whose name starts with ".env" are
// never opened. Secret findings print the line number and kind, never the match.
//
// Exit 1 when any error was found, otherwise 0.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_AGENTS_LINES = 150;
const MAX_CLAUDE_LINES = 200;
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

const SECRET_PATTERNS = [
  ['private key header', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bghp_[A-Za-z0-9]{20,}/],
  ['GitHub token', /\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}/],
  ['Slack token', /\bxox[bap]-[A-Za-z0-9-]{10,}/],
  ['API key (sk-)', /(?<![A-Za-z0-9])sk-[A-Za-z0-9]{20,}/],
];
const GENERIC_SECRET = /(api[_-]?key|secret|token|password)["']?\s*[:=]\s*["']?([A-Za-z0-9/+_-]{12,})/i;
// `Read(./secrets/**)` and friends are permission rules, not secrets.
const PERMISSION_RULE = /\b(?:Read|Edit|Write|Bash|WebFetch|WebSearch|Glob|Grep)\([^)]*\)/;
const PLACEHOLDER_VALUE = /^(?:your|example|placeholder|changeme|change-me|xxx|redacted|dummy|sample|todo|replace)|^[x*]+$/i;

export function scanForSecrets(text) {
  const findings = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [kind, re] of SECRET_PATTERNS) {
      if (re.test(line)) findings.push({ line: i + 1, kind });
    }
    if (PERMISSION_RULE.test(line)) return;
    const m = GENERIC_SECRET.exec(line);
    if (m && !PLACEHOLDER_VALUE.test(m[2])) findings.push({ line: i + 1, kind: `${m[1].toLowerCase()} assignment` });
  });
  return findings;
}

function countLines(text) {
  if (text === '') return 0;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

function checkSettings(json, add) {
  const permissions = json && typeof json.permissions === 'object' && json.permissions ? json.permissions : {};
  const allow = Array.isArray(permissions.allow) ? permissions.allow : [];
  for (const entry of allow) {
    if (typeof entry === 'string' && ['Bash(*)', 'Bash(**)', 'Bash'].includes(entry.trim())) {
      add('error', `permissions.allow contains ${entry.trim()}, which allows every shell command`);
    }
  }
  for (const mode of [permissions.defaultMode, json && json.defaultMode]) {
    if (mode === 'auto' || mode === 'bypassPermissions') add('error', `defaultMode "${mode}" must not be set by generated settings`);
  }
  if (!json || typeof json.$schema !== 'string') add('warning', '$schema is missing');
}

// Findings: { level: 'error' | 'warning' | 'info' | 'skipped', file, message }.
export function verifyFiles(dir, files) {
  const findings = [];
  for (const file of files) {
    const add = (level, message) => findings.push({ level, file, message });
    const name = path.basename(file);

    if (name.startsWith('.env')) {
      add('skipped', 'env files are never opened');
      continue;
    }

    const abs = path.resolve(dir, file);
    let text;
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile()) {
        add('error', 'not a file');
        continue;
      }
      if (stat.size > MAX_SCAN_BYTES) {
        add('warning', `larger than ${MAX_SCAN_BYTES} bytes, not scanned`);
        continue;
      }
      text = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      add('error', err.code === 'ENOENT' ? 'file not found' : `cannot read (${err.code || err.message})`);
      continue;
    }

    const lines = countLines(text);
    add('info', `${lines} line${lines === 1 ? '' : 's'}`);

    let json = null;
    if (name.endsWith('.json')) {
      try {
        json = JSON.parse(text.replace(/^﻿/, ''));
      } catch (err) {
        add('error', `invalid JSON: ${err.message}`);
      }
    }

    for (const hit of scanForSecrets(text)) add('error', `line ${hit.line}: possible secret (${hit.kind})`);

    if (name === 'AGENTS.md' && lines > MAX_AGENTS_LINES) add('warning', `${lines} lines, over the ${MAX_AGENTS_LINES} line target`);
    if (name === 'CLAUDE.md') {
      if (lines > MAX_CLAUDE_LINES) add('warning', `${lines} lines, over the ${MAX_CLAUDE_LINES} line target`);
      const first = text.split(/\r?\n/).find((l) => l.trim() !== '');
      if (!first || first.trim() !== '@AGENTS.md') add('warning', 'first non-empty line is not "@AGENTS.md"');
    }

    const normalized = file.split(path.sep).join('/');
    if (normalized === '.claude/settings.json' || normalized.endsWith('/.claude/settings.json')) {
      if (json) checkSettings(json, add);
    }
  }
  return findings;
}

export function parseArgs(argv) {
  let dir = '.';
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir') dir = argv[++i] ?? '.';
    else if (arg.startsWith('--dir=')) dir = arg.slice('--dir='.length);
    else files.push(arg);
  }
  return { dir, files };
}

export function formatReport(findings, fileCount) {
  const lines = findings.map((f) => `${f.level.padEnd(7)} ${f.file}: ${f.message}`);
  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.filter((f) => f.level === 'warning').length;
  lines.push(`verify: ${fileCount} file${fileCount === 1 ? '' : 's'}, ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`);
  return { text: `${lines.join('\n')}\n`, errors };
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
  const { dir, files } = parseArgs(process.argv.slice(2));
  if (files.length === 0) {
    process.stderr.write('usage: node verify.mjs [--dir <project>] <file>...\n');
    process.exitCode = 2;
    return;
  }
  const { text, errors } = formatReport(verifyFiles(dir, files), files.length);
  process.stdout.write(text);
  process.exitCode = errors > 0 ? 1 : 0;
}

if (isEntryPoint()) main();
