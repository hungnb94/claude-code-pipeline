#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOG_PATH = path.join(PROJECT_ROOT, '.pipeline/hooks.log');

function truncate(value, maxLen = 300) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

function buildEntry(data) {
  const entry = {
    t: new Date().toISOString(),
    event: data.hook_event_name,
    session: data.session_id ? data.session_id.slice(0, 8) : undefined,
  };

  switch (data.hook_event_name) {
    case 'SessionStart':
      entry.source = data.source;
      break;
    case 'PreToolUse':
      entry.tool = data.tool_name;
      entry.input = data.tool_input ? truncate(data.tool_input) : undefined;
      break;
    case 'PostToolUse':
      entry.tool = data.tool_name;
      entry.exit_code = data.tool_output?.exit_code;
      if (data.tool_output?.stderr) entry.stderr = truncate(data.tool_output.stderr, 200);
      break;
    case 'UserPromptSubmit':
      entry.prompt = data.prompt ? truncate(data.prompt) : undefined;
      break;
    default:
      entry.data = truncate(data);
      break;
  }

  return entry;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(raw);
    const entry = buildEntry(data);
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
  } catch {
    // never block Claude on log failure
  }
  process.exit(0);
});
