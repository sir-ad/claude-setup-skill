#!/usr/bin/env node
'use strict';

// One-shot installer for the /claude-setup Claude Code skill.
// Copies the package contents into ~/.claude/skills/claude-setup/.
// Backs up an existing install rather than clobbering it.

const fs = require('fs');
const path = require('path');
const os = require('os');

const SKILL_NAME = 'claude-setup';
const PKG_ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(os.homedir(), '.claude', 'skills', SKILL_NAME);

// Whitelist of items the runtime needs. Anything else (bin/, package.json,
// .github/, etc.) is left out of the installed skill. Claude Code only reads
// SKILL.md and the templates/knowledge/scripts/examples/assets it references.
const ITEMS = [
  'SKILL.md',
  'templates',
  'knowledge',
  'scripts',
  'examples',
  'assets',
  'README.md',
  'LICENSE',
];

const USAGE = `Usage: claude-setup-install [--dry-run] [--uninstall] [--help]

  (no flag)     copy the skill into ${TARGET}
                (an existing install is renamed to .bak.<timestamp> first)
  --dry-run     print what would change, touch nothing
  --uninstall   remove ${TARGET}
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
  const backup = existing ? `${TARGET}.bak.${Date.now()}` : null;

  if (dryRun) {
    if (backup) out(`would back up existing install: ${TARGET} -> ${backup}\n`);
    out(`would install ${sources.length} items into ${TARGET}:\n`);
    for (const item of sources) out(`  ${item}\n`);
    out('\nno changes made (--dry-run)\n');
    return;
  }

  fs.mkdirSync(path.dirname(TARGET), { recursive: true });

  if (backup) {
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

  const backups = fs
    .readdirSync(path.dirname(TARGET))
    .filter((name) => name.startsWith(`${SKILL_NAME}.bak.`));

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
    out(`\nleft in place: ${backups.length} backup(s) in ${path.dirname(TARGET)}\n`);
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
