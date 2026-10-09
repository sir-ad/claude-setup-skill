#!/usr/bin/env node
'use strict';

// One-shot installer for the /claude-setup Claude Code skill.
// Copies the package contents into ~/.claude/skills/claude-setup/.
// Backs up an existing install rather than clobbering it. Backups go to
// ~/.claude/backups/claude-setup/, outside the skills folder, because Claude
// Code loads every directory under ~/.claude/skills/ as a skill.

const fs = require('fs');
const path = require('path');
const os = require('os');

const SKILL_NAME = 'claude-setup';
const PKG_ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(os.homedir(), '.claude', 'skills', SKILL_NAME);
const BACKUP_ROOT = path.join(os.homedir(), '.claude', 'backups', SKILL_NAME);
// Older versions renamed backups to claude-setup.bak.<timestamp> in the skills folder.
const LEGACY_PREFIX = `${SKILL_NAME}.bak.`;

// Whitelist of items the runtime needs. Anything else (bin/, package.json,
// .github/, etc.) is left out of the installed skill. Claude Code only reads
// SKILL.md and the templates/knowledge/reference/scripts/examples/assets it references.
const ITEMS = [
  'SKILL.md',
  'templates',
  'knowledge',
  'reference',
  'scripts',
  'examples',
  'assets',
  'README.md',
  'LICENSE',
];

const USAGE = `Usage: claude-setup-install [--dry-run] [--uninstall] [--help]

  (no flag)     copy the skill into ${TARGET}
                (an existing install is moved to ${BACKUP_ROOT}/<timestamp> first;
                 old ${LEGACY_PREFIX}* folders in the skills folder are moved there too)
  --dry-run     print what would change, touch nothing
  --uninstall   remove ${TARGET} (backups are kept)
  --help        show this message
`;

const out = (s) => process.stdout.write(s);
const err = (s) => process.stderr.write(s);

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function countFiles(p) {
  const st = fs.lstatSync(p);
  if (!st.isDirectory()) return 1;
  return fs.readdirSync(p).reduce((n, child) => n + countFiles(path.join(p, child)), 0);
}

function listDir(p) {
  try {
    return fs.readdirSync(p);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

// Returns base, or base-2, base-3, ... so an existing backup is never overwritten.
function uniquePath(base) {
  let candidate = base;
  for (let n = 2; lstatOrNull(candidate); n += 1) candidate = `${base}-${n}`;
  return candidate;
}

// Old-style backups (claude-setup.bak.<timestamp>) sitting in the skills folder.
// Returns [{ from, to }] where `to` is the matching path under BACKUP_ROOT.
function legacyBackups() {
  const skillsDir = path.dirname(TARGET);
  const moves = [];
  for (const name of listDir(skillsDir)) {
    if (!name.startsWith(LEGACY_PREFIX)) continue;
    const stamp = name.slice(LEGACY_PREFIX.length);
    const from = path.join(skillsDir, name);
    const st = lstatOrNull(from);
    if (!stamp || !st || !st.isDirectory()) continue;
    moves.push({ from, to: uniquePath(path.join(BACKUP_ROOT, stamp)) });
  }
  return moves;
}

function moveLegacyBackups(dryRun) {
  for (const { from, to } of legacyBackups()) {
    if (dryRun) {
      out(`would move old backup: ${from} -> ${to}\n`);
      continue;
    }
    fs.mkdirSync(BACKUP_ROOT, { recursive: true });
    fs.renameSync(from, to);
    out(`moved old backup: ${from} -> ${to}\n`);
  }
}

function parseArgs(argv) {
  const opts = { dryRun: false, uninstall: false, help: false };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--uninstall') opts.uninstall = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else return { error: `unknown option: ${arg}` };
  }
  return opts;
}

function install(dryRun) {
  const sources = ITEMS.filter((item) => fs.existsSync(path.join(PKG_ROOT, item)));
  const existing = lstatOrNull(TARGET);

  if (dryRun) {
    moveLegacyBackups(true);
    if (existing) {
      const backup = uniquePath(path.join(BACKUP_ROOT, String(Date.now())));
      out(`would back up existing install: ${TARGET} -> ${backup}\n`);
    }
    out(`would install ${sources.length} items into ${TARGET}:\n`);
    for (const item of sources) out(`  ${item}\n`);
    out('\nno changes made (--dry-run)\n');
    return;
  }

  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  moveLegacyBackups(false);

  if (existing) {
    fs.mkdirSync(BACKUP_ROOT, { recursive: true });
    const backup = uniquePath(path.join(BACKUP_ROOT, String(Date.now())));
    fs.renameSync(TARGET, backup);
    err(`existing skill backed up to: ${backup}\n`);
  }

  fs.mkdirSync(TARGET, { recursive: true });

  for (const item of sources) {
    copyRecursive(path.join(PKG_ROOT, item), path.join(TARGET, item));
  }

  out(`installed: ${TARGET} (${sources.length} items)\n\n`);
  out('Try it:\n');
  out('  cd <some-project>\n');
  out('  claude    # then type:\n');
  out('  /claude-setup\n');
}

function uninstall(dryRun) {
  const st = lstatOrNull(TARGET);
  if (!st) {
    out(`nothing to remove: ${TARGET} does not exist\n`);
    return;
  }

  const backups = listDir(BACKUP_ROOT);

  if (st.isSymbolicLink()) {
    const link = fs.readlinkSync(TARGET);
    if (dryRun) {
      out(`would remove symlink: ${TARGET} -> ${link}\n`);
    } else {
      fs.unlinkSync(TARGET);
      out(`removed symlink: ${TARGET} -> ${link}\n`);
      out('the linked directory was not touched\n');
    }
  } else {
    const files = countFiles(TARGET);
    const verb = dryRun ? 'would remove' : 'removed';
    out(`${verb} ${st.isDirectory() ? 'directory' : 'file'}: ${TARGET} (${files} files)\n`);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(TARGET)) {
        out(`  ${name}\n`);
      }
    }
    if (!dryRun) fs.rmSync(TARGET, { recursive: true, force: true });
  }

  if (backups.length > 0) {
    out(`\nleft in place: ${backups.length} backup(s) in ${BACKUP_ROOT}\n`);
  }
  if (dryRun) out('\nno changes made (--dry-run)\n');
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.error) {
    err(`${opts.error}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (opts.help) {
    out(USAGE);
    return;
  }
  if (opts.uninstall) {
    uninstall(opts.dryRun);
    return;
  }
  install(opts.dryRun);
}

try {
  main(process.argv.slice(2));
} catch (e) {
  err(`install failed: ${e && e.message ? e.message : e}\n`);
  process.exit(1);
}
