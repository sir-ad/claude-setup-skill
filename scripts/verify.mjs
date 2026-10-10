#!/usr/bin/env node
// Phase 5 checks for the files /claude-setup wrote. Zero dependencies. Node 18+.
//
//   node scripts/verify.mjs [--dir <project>] [--expect <path,...>] <file>...
//
// Paths are relative to --dir (default: current directory). Per file: line count,
// JSON validity, secret scan, size and import rules for AGENTS.md / CLAUDE.md, and
// safety checks for .claude/settings.json. Files whose name starts with ".env" are
// never opened. AGENTS.md and CLAUDE.md must not link to repo paths that do not exist
// (markdown links and backticked paths). --expect lists paths the plan says should be
// written; each one missing under --dir is an error. No message ever contains file
// content: secret findings print the line number and kind, and a JSON syntax error
// prints only its line and column.
//
// Exit 1 when any error was found, otherwise 0.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_AGENTS_LINES = 150;
const MAX_CLAUDE_LINES = 200;
const MAX_SCAN_BYTES = 2 * 1024 * 1024;
// Link targets that are created later by design, or are local-only and may be absent.
const LINK_EXEMPT = [/^docs\/plans(?:\/|$)/, /^\.claude\/agent-memory(?:\/|$)/, /^\.claude\/handoff\.md$/];
const LINK_IGNORED = new Set(['CLAUDE.local.md', '.claude/settings.local.json']);
const MD_LINK = /\[[^\]\n]*\]\(\s*([^)\s]+)(?:\s+"[^"\n]*")?\s*\)/g;
const CODE_SPAN = /`([^`\n]+)`/g;
// A token with no spaces, globs, placeholders, schemes or leading / or ~.
const PATH_TOKEN = /^[\w.@-]+(?:\/[\w.@-]+)*\/?$/;
// Markdown link targets that are not repo files: URLs, mailto:, absolute, home, globs, placeholders.
const NOT_LOCAL = /^(?:[a-z][a-z0-9+.-]*:|\/|~)|[*<>{}$]/i;

const SECRET_PATTERNS = [
  ['private key header', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Anthropic API key', /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{16,}/],
  ['OpenAI API key', /(?<![A-Za-z0-9])sk-(?!ant-)[A-Za-z0-9_-]{20,}/],
  ['Stripe key', /\b[sr]k_live_[A-Za-z0-9]{16,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ['GitHub token', /\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{30,}/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
];
// scheme://user:pass@host
const URL_CREDENTIALS = /\b[a-z][a-z0-9+.-]*:\/\/([^\s:/@'"<>`]+):([^\s@/'"<>`]+)@[^\s/'"<>`]+/i;
const PLACEHOLDER_PASSWORD = /^(?:<.*>|\$\{.*\}|\$\(.*\)|\$[A-Za-z_]\w*|\{\{.*\}\}|%\w+%|\[.*\]|x+|\*+|pass(?:word)?|pwd|secret|changeme|change-me|your.*|example.*|redacted|dummy|placeholder)$/i;

// Generic `name = value` rule. The value is captured as a quoted string or a bare token.
const GENERIC_SECRET = /(api[_-]?key|secret|token|password)["']?\s*[:=]\s*(?:"([^"\n]*)"?|'([^'\n]*)'?|([^\s'",;]+))/i;
// `Read(./secrets/**)` and friends are permission rules, not secrets.
const PERMISSION_RULE = /\b(?:Read|Edit|Write|Bash|WebFetch|WebSearch|Glob|Grep)\([^)]*\)/;
const PLACEHOLDER_VALUE = /^(?:process\.env|import\.meta\.env|os\.environ|env\.|your|example|placeholder|changeme|change-me|xxx|redacted|dummy|sample|todo|replace|insert|fake)|your[-_ ]|changeme|change-me|placeholder|redacted|dummy|xxxx|\*{3,}|^[x*]+$/i;

// True when a bare or quoted value looks like a literal secret: one token of 16+ characters
// with letters and digits. Calls, prose, templates, paths and obvious placeholders are not.
export function looksLikeSecretValue(value) {
  if (typeof value !== 'string' || value.length < 16) return false;
  if (!/^[A-Za-z0-9/+_=.~-]+$/.test(value)) return false; // spaces, ( ) < > $ { } are all out
  if (PLACEHOLDER_VALUE.test(value)) return false;
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return false;
  if (/^\.{0,2}\//.test(value) || /\.[A-Za-z]{1,5}$/.test(value)) return false; // paths and file names
  return true;
}

// -> [{ line, kind }]. The matched text is never part of a finding.
export function scanForSecrets(text) {
  const findings = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const kinds = new Set();
    for (const [kind, re] of SECRET_PATTERNS) {
      if (re.test(line)) kinds.add(kind);
    }
    const url = URL_CREDENTIALS.exec(line);
    if (url && !PLACEHOLDER_PASSWORD.test(url[2]) && url[1] !== url[2]) kinds.add('URL credentials');
    if (kinds.size === 0 && !PERMISSION_RULE.test(line)) {
      const m = GENERIC_SECRET.exec(line);
      const value = m && (m[2] ?? m[3] ?? m[4]);
      if (m && looksLikeSecretValue(value)) kinds.add(`${m[1].toLowerCase()} assignment`);
    }
    for (const kind of kinds) findings.push({ line: i + 1, kind });
  });
  return findings;
}

// Line and column (1-based) of the first JSON syntax error, or null. A small validator is used
// instead of JSON.parse's message, which quotes a snippet of the input on some Node versions.
export function jsonErrorLocation(text) {
  const n = text.length;
  let i = 0;
  const ws = () => {
    while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
  };
  const bad = () => {
    throw i;
  };
  const string = () => {
    i++;
    for (;;) {
      if (i >= n) bad();
      const c = text[i];
      if (c === '"') {
        i++;
        return;
      }
      if (c < ' ') bad();
      if (c === '\\') {
        i++;
        const e = text[i];
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) bad();
          i += 4;
        } else if (e === undefined || !'"\\/bfnrt'.includes(e)) bad();
      }
      i++;
    }
  };
  const value = () => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      ws();
      if (text[i] === '}') {
        i++;
        return;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') bad();
        string();
        ws();
        if (text[i] !== ':') bad();
        i++;
        value();
        ws();
        if (text[i] === ',') i++;
        else if (text[i] === '}') {
          i++;
          return;
        } else bad();
      }
    } else if (c === '[') {
      i++;
      ws();
      if (text[i] === ']') {
        i++;
        return;
      }
      for (;;) {
        value();
        ws();
        if (text[i] === ',') i++;
        else if (text[i] === ']') {
          i++;
          return;
        } else bad();
      }
    } else if (c === '"') string();
    else if (c === '-' || (c >= '0' && c <= '9')) {
      const re = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
      re.lastIndex = i;
      const m = re.exec(text);
      if (!m) bad();
      i += m[0].length;
    } else {
      const lit = ['true', 'false', 'null'].find((l) => text.startsWith(l, i));
      if (!lit) bad();
      i += lit.length;
    }
  };
  try {
    value();
    ws();
    if (i < n) bad();
  } catch (at) {
    if (typeof at !== 'number') throw at;
    const before = text.slice(0, at).split('\n');
    return { line: before.length, column: before[before.length - 1].length + 1 };
  }
  return null;
}

// Repo-relative paths that AGENTS.md / CLAUDE.md link to, from markdown links and backticked
// paths (a token ending in ".md", or with a "/" whose first segment exists in root, so prose
// like `and/or` is not mistaken for a path). Fenced code is skipped. Deduplicated, in order.
function linkedPaths(text, root) {
  const kept = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    else if (!inFence) kept.push(line);
  }
  const body = kept.join('\n');
  const found = [];
  for (const m of body.matchAll(MD_LINK)) {
    const target = m[1].replace(/[#?].*$/, '').replace(/^\.\//, '');
    if (target && !NOT_LOCAL.test(target)) found.push(target);
  }
  for (const m of body.matchAll(CODE_SPAN)) {
    const token = m[1].trim();
    if (!PATH_TOKEN.test(token)) continue;
    const rel = token.replace(/^\.\//, '');
    const first = rel.split('/')[0];
    const pathLike = rel.endsWith('.md') || (rel.includes('/') && (!root || fs.existsSync(path.join(root, first))));
    if (pathLike) found.push(rel);
  }
  return [...new Set(found)];
}

function countLines(text) {
  if (text === '') return 0;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

// `Bash`, `Bash()`, `Bash(*)`, `Bash( * )`, `Bash(:*)`, `Bash(**)` and similar all allow every command.
const UNRESTRICTED_BASH = /^Bash(?:\((?::?\*+|\*+:\*+)?\))?$/;
// Network and shell-escape tools. Only the tool name is ever printed, never the rule.
const RISKY_COMMANDS = [
  ['curl', /^curl$/],
  ['wget', /^wget$/],
  ['ssh', /^ssh$/],
  ['scp', /^scp$/],
  ['nc', /^(?:nc|ncat|netcat)$/],
  ['eval', /^eval$/],
];
const SHELL_C = /^(?:bash|sh|zsh|dash|ksh)$/;

function riskyTools(rule) {
  const m = /^Bash\((.*)\)$/s.exec(rule.trim());
  if (!m) return [];
  const found = new Set();
  for (const part of m[1].split(/&&|\|\||[;|\n]/)) {
    const words = part.trim().split(/[\s:]+/).filter(Boolean);
    while (words[0] === 'sudo' || words[0] === 'env' || words[0] === 'command') words.shift();
    const [cmd, flag] = words;
    if (!cmd) continue;
    for (const [name, re] of RISKY_COMMANDS) if (re.test(cmd)) found.add(name);
    if (SHELL_C.test(cmd) && flag && /^-\w*c\w*$/.test(flag)) found.add(`${cmd} -c`);
  }
  return [...found];
}

function projectHasEnvFiles(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true }).some((e) => e.name.startsWith('.env') && !e.isDirectory());
  } catch {
    return false;
  }
}

// `root` is the project directory that holds .claude/ (used to look for .env* files).
function checkSettings(json, add, root) {
  const permissions = json && typeof json.permissions === 'object' && json.permissions ? json.permissions : {};
  const allow = Array.isArray(permissions.allow) ? permissions.allow : [];
  const deny = Array.isArray(permissions.deny) ? permissions.deny : [];

  for (const entry of allow) {
    if (typeof entry !== 'string') continue;
    const compact = entry.replace(/\s+/g, '');
    if (UNRESTRICTED_BASH.test(compact)) {
      add('error', `permissions.allow contains ${compact}, which allows every shell command`);
      continue;
    }
    for (const tool of riskyTools(entry)) add('warning', `permissions.allow lets the agent run ${tool} (network or shell escape)`);
  }

  for (const mode of [permissions.defaultMode, json && json.defaultMode]) {
    if (mode === 'auto' || mode === 'bypassPermissions') add('error', `defaultMode "${mode}" must not be set by generated settings`);
  }

  if (json && json.enableAllProjectMcpServers === true) {
    add('error', 'enableAllProjectMcpServers is true; it approves every MCP server a repo declares');
  }

  if (json && json.env && typeof json.env === 'object' && !Array.isArray(json.env)) {
    for (const [key, value] of Object.entries(json.env)) {
      if (typeof value !== 'string') continue;
      const kinds = scanForSecrets(`${key}=${value}`).map((f) => f.kind);
      if (kinds.length === 0 && looksLikeSecretValue(value)) kinds.push('literal value');
      if (kinds.length) add('error', `env.${key} looks like a secret (${[...new Set(kinds)].join(', ')}); keep secrets out of settings.json`);
    }
  }

  if (root && projectHasEnvFiles(root)) {
    const denied = deny.some((d) => typeof d === 'string' && /^Read\(/.test(d.trim()) && d.includes('.env'));
    if (!denied) add('warning', 'the project has .env* files but permissions.deny has no Read rule for them (for example "Read(./.env)")');
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
      add('error', err.code === 'ENOENT' ? 'file not found' : `cannot read (${err.code || 'unknown error'})`);
      continue;
    }

    const lines = countLines(text);
    add('info', `${lines} line${lines === 1 ? '' : 's'}`);

    let json = null;
    if (name.endsWith('.json')) {
      try {
        json = JSON.parse(text.replace(/^﻿/, ''));
      } catch {
        // Never echo the parser's message: it can quote the input, which may hold a secret.
        const at = jsonErrorLocation(text.replace(/^\uFEFF/, ''));
        add('error', at ? `invalid JSON at line ${at.line}, column ${at.column}` : 'invalid JSON');
      }
    }

    for (const hit of scanForSecrets(text)) add('error', `line ${hit.line}: possible secret (${hit.kind})`);

    if (name === 'AGENTS.md' && lines > MAX_AGENTS_LINES) add('warning', `${lines} lines, over the ${MAX_AGENTS_LINES} line target`);
    if (name === 'CLAUDE.md') {
      if (lines > MAX_CLAUDE_LINES) add('warning', `${lines} lines, over the ${MAX_CLAUDE_LINES} line target`);
      const first = text.split(/\r?\n/).find((l) => l.trim() !== '');
      if (!first || first.trim() !== '@AGENTS.md') {
        const sibling = fs.existsSync(path.join(path.dirname(abs), 'AGENTS.md'));
        add(sibling ? 'error' : 'warning', 'first non-empty line is not "@AGENTS.md"' + (sibling ? ' (AGENTS.md exists in this directory)' : ''));
      }
    }
    if (name === 'AGENTS.md' || name === 'CLAUDE.md') {
      for (const target of linkedPaths(text, dir)) {
        if (LINK_IGNORED.has(target) || LINK_EXEMPT.some((re) => re.test(target))) continue;
        if (!fs.existsSync(path.resolve(dir, target))) add('error', `links to ${target}, which does not exist`);
      }
    }

    const normalized = file.split(path.sep).join('/');
    if (normalized === '.claude/settings.json' || normalized.endsWith('/.claude/settings.json')) {
      if (json) checkSettings(json, add, path.dirname(path.dirname(abs)));
    }
  }
  return findings;
}

// Each expected path must exist under dir. Findings use the pseudo-file "--expect".
export function checkExpected(dir, expect) {
  return expect
    .filter((p) => !fs.existsSync(path.resolve(dir, p)))
    .map((p) => ({ level: 'error', file: '--expect', message: `expected ${p} from the plan, but it was not written` }));
}

const splitList = (value) => value.split(',').map((s) => s.trim()).filter(Boolean);

export function parseArgs(argv) {
  let dir = '.';
  let expect = [];
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir') dir = argv[++i] ?? '.';
    else if (arg.startsWith('--dir=')) dir = arg.slice('--dir='.length);
    else if (arg === '--expect') expect = splitList(argv[++i] ?? '');
    else if (arg.startsWith('--expect=')) expect = splitList(arg.slice('--expect='.length));
    else files.push(arg);
  }
  return { dir, files, expect };
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
  const { dir, files, expect } = parseArgs(process.argv.slice(2));
  if (files.length === 0 && expect.length === 0) {
    process.stderr.write('usage: node verify.mjs [--dir <project>] [--expect <path,...>] <file>...\n');
    process.exitCode = 2;
    return;
  }
  const findings = [...verifyFiles(dir, files), ...checkExpected(dir, expect)];
  const { text, errors } = formatReport(findings, files.length);
  process.stdout.write(text);
  process.exitCode = errors > 0 ? 1 : 0;
}

if (isEntryPoint()) main();
