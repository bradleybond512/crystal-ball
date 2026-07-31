#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const agents = read('AGENTS.md');
const claude = read('CLAUDE.md');
const settings = JSON.parse(read('.claude/settings.json'));
const hook = read('.claude/hooks/agentic-policy.mjs');
const claudeSkill = read(
  '.claude/skills/crystal-ball-automated-pipeline/SKILL.md',
);

if (!claude.includes('@AGENTS.md')) {
  errors.push('CLAUDE.md must import the canonical AGENTS.md policy');
}
for (const marker of [
  '$crystal-ball-automated-pipeline',
  '.codex/MODEL_POLICY.md',
  'docs/AGENTIC_ENGINEERING.md',
]) {
  if (!claude.includes(marker)) errors.push(`CLAUDE.md is missing ${marker}`);
}
if (/must go through PRs and GitHub auto-merge/.test(agents)) {
  errors.push('AGENTS.md must not mandate unapproved auto-merge');
}
for (const event of ['SessionStart', 'PreToolUse']) {
  if (!settings.hooks?.[event]) {
    errors.push(`Claude project settings are missing ${event}`);
  }
}
if (!hook.includes('permissionDecision') || !hook.includes('explicit approval')) {
  errors.push('Claude policy hook does not enforce protected actions');
}
if (
  !claudeSkill.includes('tools.agentic_pipeline')
  || !claudeSkill.includes(
    '.agents/skills/crystal-ball-automated-pipeline/SKILL.md',
  )
) {
  errors.push('Claude skill does not delegate to the canonical runtime');
}

if (errors.length) {
  console.error('Shared agent policy errors:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Shared Codex/Claude agent policy is consistent.');
