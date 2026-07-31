import process from 'node:process';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

let input = {};
try {
  input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
} catch {
  process.stdout.write(JSON.stringify({
    continue: false,
    stopReason: 'Claude policy hook received invalid JSON.',
  }));
  process.exit(0);
}

if (input.hook_event_name === 'SessionStart') {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext:
        'Mandatory Crystal Ball policy: read AGENTS.md, CLAUDE.md, ' +
        '.codex/MODEL_POLICY.md, and docs/AGENTIC_ENGINEERING.md. Use ' +
        '$crystal-ball-automated-pipeline for nontrivial work. Deterministic ' +
        'failures return to the owning builder. Publishing, merging, release, ' +
        'deploy, secrets, keychain, and destructive actions require explicit ' +
        'human approval.',
    },
  }));
  process.exit(0);
}

const command = String(input.tool_input?.command ?? '');
const protectedAction = [
  /\bgit\s+push\b/i,
  /\bgh\s+pr\s+(?:merge|ready)\b/i,
  /\bgh\s+release\b/i,
  /\bnpm\s+run\s+(?:release|deploy|backup-keys|restore-keys)\b/i,
  /\b(?:security|keyring)\s+(?:add|delete|find|set|get)/i,
  /\b(?:rm|rmdir)\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)\b/i,
].find((pattern) => pattern.test(command));

if (protectedAction) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        'This action requires explicit approval and must run through the ' +
        'shared Crystal Ball publishing or safety gate.',
    },
  }));
  process.exit(0);
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
  },
}));
