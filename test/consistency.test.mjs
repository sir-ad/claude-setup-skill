// Cross-file checks. README, SKILL.md, templates, blueprints and the adapters
// reference describe the same behavior in several places. These tests fail when
// they drift apart. They read wording loosely: they compare sets, not sentences.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(REPO, rel));
const sorted = (iter) => [...new Set(iter)].sort();

const SKILL = read('SKILL.md');
const README = read('README.md');

// The text of a markdown section: from its heading to the next heading of the same or higher level.
function section(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === heading);
  assert.notEqual(start, -1, `heading not found: ${heading}`);
  const level = /^#+/.exec(heading)[0].length;
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = /^(#+)\s/.exec(lines[i]);
    if (m && m[1].length <= level) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

// Names from a sentence such as "The list: a, b and c." (same shape validate.mjs reads).
function namedList(text, sentence) {
  const m = new RegExp(`${sentence} (.+?)\\.(?=\\s|$)`, 'm').exec(text);
  assert.ok(m, `SKILL.md has no "${sentence} ..." sentence`);
  return m[1].split(/,\s*|\s+and\s+/).map((n) => n.trim()).filter(Boolean);
}

test('README flags table matches the SKILL.md argument-hint', () => {
  const hintLine = /^argument-hint:\s*(.+)$/m.exec(SKILL);
  assert.ok(hintLine, 'SKILL.md has no argument-hint');
  const hintFlags = [...hintLine[1].matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0]);

  const table = section(README, '## Flags');
  const readmeFlags = [...table.matchAll(/^\|\s*`(--[a-z][a-z-]*)/gm)].map((m) => m[1]);

  assert.ok(hintFlags.length > 0, 'no flags found in the argument-hint');
  assert.deepEqual(sorted(readmeFlags), sorted(hintFlags));
});

test('every template named in SKILL.md exists, and every template file is named', () => {
  const named = namedList(SKILL, 'The list:');
  for (const name of named) assert.ok(exists(`templates/${name}.md`), `templates/${name}.md is missing`);

  const onDisk = fs.readdirSync(path.join(REPO, 'templates')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  assert.deepEqual(sorted(named), sorted(onDisk));

  const readmeTemplates = [...README.matchAll(/`templates\/([\w-]+)\.md`/g)].map((m) => m[1]);
  assert.deepEqual(sorted(readmeTemplates), sorted(named), 'README stack table differs from the SKILL.md template list');
});

test('every blueprint named in SKILL.md exists, and every blueprint is named', () => {
  const refs = [...SKILL.matchAll(/\bblueprints\/[\w./-]*\w\.md\b/g)].map((m) => m[0]);
  assert.ok(refs.length > 0, 'SKILL.md names no blueprints');
  for (const ref of refs) assert.ok(exists(ref), `${ref} is missing`);

  const onDisk = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(REPO, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.md') && child !== 'blueprints/README.md') onDisk.push(child);
    }
  };
  walk('blueprints');
  const missing = onDisk.filter((f) => !refs.includes(f));
  assert.deepEqual(missing, [], `blueprints not named in SKILL.md: ${missing.join(', ')}`);
});

test('no template settings block allows git add, git commit or unrestricted Bash', () => {
  let blocks = 0;
  for (const file of fs.readdirSync(path.join(REPO, 'templates')).filter((f) => f.endsWith('.md'))) {
    const text = read(`templates/${file}`);
    for (const m of text.matchAll(/```json\n([\s\S]*?)```/g)) {
      blocks += 1;
      const block = m[1];
      assert.doesNotMatch(block, /Bash\(\s*git\s+(add|commit)\b/, `${file}: allows git add or git commit`);
      assert.doesNotMatch(block, /"Bash"/, `${file}: unrestricted "Bash"`);
      assert.doesNotMatch(block, /Bash\(\s*\*{1,2}\s*\)/, `${file}: unrestricted Bash(*)`);
      assert.doesNotMatch(block, /Bash\(\s*:\*\s*\)/, `${file}: unrestricted Bash(:*)`);
    }
  }
  assert.ok(blocks > 0, 'no json blocks found in templates');
});

test('the .gitignore entries in the Phase 3 plan match what Phase 4 appends', () => {
  const planLine = /^\s*\.gitignore\s+\(append:\s*([^)]*)\)/m.exec(SKILL);
  assert.ok(planLine, 'Phase 3 plan has no ".gitignore (append: ...)" line');
  const planned = planLine[1].split(',').map((e) => e.trim()).filter(Boolean);

  const phase4 = section(SKILL, '## Phase 4: Generate');
  const bullet = /^- `\.gitignore`:(.*)$/m.exec(phase4);
  assert.ok(bullet, 'Phase 4 has no "- `.gitignore`:" bullet');
  const written = [...bullet[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);

  assert.ok(planned.length >= 4, 'plan lists fewer than four entries');
  assert.deepEqual(sorted(written), sorted(planned));
});

test('the agents in the README appear in reference/agent-adapters.md and the other way round', () => {
  const adapters = read('reference/agent-adapters.md');
  const rows = [...section(adapters, '## Tools').matchAll(/^\|\s*([^|]+?)\s*\|/gm)]
    .map((m) => m[1])
    .filter((n) => n !== 'Tool' && !/^-+$/.test(n));
  assert.ok(rows.length >= 10, 'could not read the tool table in agent-adapters.md');

  const generic = new Set(['cli', 'code', 'github', 'jetbrains', 'local', 'agent']);
  const key = (name) => {
    const words = name.toLowerCase().split(/\s+/);
    return words.find((w) => !generic.has(w)) || words[0];
  };

  const readmeText = README.toLowerCase();
  for (const name of rows) {
    assert.ok(readmeText.includes(key(name)), `README does not mention ${name}`);
  }

  const agentsTable = section(README, '## Agents');
  const readmeRows = [...agentsTable.matchAll(/^\|\s*([^|]+?)\s*\|/gm)]
    .map((m) => m[1])
    .filter((n) => n !== 'Agent' && !/^-+$/.test(n))
    .flatMap((cell) => cell.split(/,\s*/));
  const adapterText = adapters.toLowerCase();
  for (const name of readmeRows) {
    assert.ok(adapterText.includes(key(name)), `agent-adapters.md does not mention ${name}`);
  }
});

test('the router blueprint hooks UserPromptSubmit and points at a script that exists', () => {
  const blueprint = read('blueprints/hooks/router.md');
  const m = /```json\n([\s\S]*?)```/.exec(blueprint);
  assert.ok(m, 'router blueprint has no json block');
  const settings = JSON.parse(m[1]);
  assert.deepEqual(Object.keys(settings.hooks), ['UserPromptSubmit']);
  const handler = settings.hooks.UserPromptSubmit[0].hooks[0];
  assert.equal(handler.type, 'command');
  assert.match(handler.command, /\.claude\/hooks\/route\.mjs/);

  assert.ok(exists('scripts/router/route.mjs'), 'scripts/router/route.mjs is missing');
  assert.match(SKILL, /UserPromptSubmit/, 'SKILL.md never names the UserPromptSubmit hook');
  assert.match(SKILL, /scripts\/router\/route\.mjs/, 'SKILL.md does not copy the router script');
});

test('SKILL.md names the roster and router commands that exist', () => {
  for (const script of ['roster.mjs', 'sync-agents.mjs', 'context.mjs', 'verify.mjs', 'sync-rules.mjs']) {
    assert.ok(exists(`scripts/${script}`), `scripts/${script} is missing`);
    assert.ok(SKILL.includes(script), `SKILL.md does not mention ${script}`);
  }
  assert.ok(SKILL.includes('claude-setup:begin roster'), 'SKILL.md does not name the roster fence');
  assert.ok(read('blueprints/docs/agents.md').includes('claude-setup:begin roster'), 'docs/agents.md blueprint has no roster fence');
});
