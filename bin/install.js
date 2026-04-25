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
// .github/, etc.) is left out of the installed skill — Claude Code only reads
// SKILL.md and the templates/examples/assets it references.
const ITEMS = ['SKILL.md', 'templates', 'examples', 'assets', 'README.md', 'LICENSE'];

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

function main() {
  fs.mkdirSync(path.dirname(TARGET), { recursive: true });

  if (fs.existsSync(TARGET)) {
    const backup = `${TARGET}.bak.${Date.now()}`;
    fs.renameSync(TARGET, backup);
    process.stderr.write(`existing skill backed up to: ${backup}\n`);
  }

  fs.mkdirSync(TARGET, { recursive: true });

  let copied = 0;
  for (const item of ITEMS) {
    const src = path.join(PKG_ROOT, item);
    if (!fs.existsSync(src)) continue;
    copyRecursive(src, path.join(TARGET, item));
    copied += 1;
  }

  process.stdout.write(`installed: ${TARGET} (${copied} items)\n\n`);
  process.stdout.write('Try it:\n');
  process.stdout.write('  cd <some-project>\n');
  process.stdout.write('  claude    # then type:\n');
  process.stdout.write('  /claude-setup\n');
}

try {
  main();
} catch (err) {
  process.stderr.write(`install failed: ${err && err.message ? err.message : err}\n`);
  process.exit(1);
}
