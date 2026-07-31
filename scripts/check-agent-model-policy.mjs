#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const policyPath = path.join(root, '.codex/model-policy.json');
const agentsDir = path.join(root, '.codex/agents');

const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
const files = fs.readdirSync(agentsDir).filter((file) => file.endsWith('.toml')).sort();
const errors = [];
const rows = [];

for (const file of files) {
  const text = fs.readFileSync(path.join(agentsDir, file), 'utf8');
  const name = text.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
  const declaredModel = text.match(/^model\s*=\s*"([^"]+)"/m)?.[1];
  const declaredEffort = text.match(/^model_reasoning_effort\s*=\s*"([^"]+)"/m)?.[1];

  if (!name) {
    errors.push(`${file}: missing agent name`);
    continue;
  }

  const assigned = policy.agents[name];
  if (!assigned) {
    errors.push(`${file}: no model-policy assignment for ${name}`);
    continue;
  }

  if (declaredModel && declaredModel !== assigned.model) {
    errors.push(`${file}: declares ${declaredModel}, policy requires ${assigned.model}`);
  }
  if (declaredEffort && declaredEffort !== assigned.effort) {
    errors.push(`${file}: effort ${declaredEffort}, policy requires ${assigned.effort}`);
  }

  rows.push({ agent: name, model: assigned.model, effort: assigned.effort, pinned: Boolean(declaredModel) });
}

const policyAgents = Object.keys(policy.agents);
const discovered = new Set(rows.map((row) => row.agent));
for (const agent of policyAgents) {
  if (!discovered.has(agent)) errors.push(`policy references missing agent: ${agent}`);
}

console.table(rows);
if (errors.length) {
  console.error('\nAgent model policy errors:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`\nAgent model policy valid for ${rows.length} agents.`);
