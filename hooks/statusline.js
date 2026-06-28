#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(raw);
    const sessionId = data.session_id || '';
    const projectDir = (data.workspace && data.workspace.project_dir) || '';
    if (!sessionId || !projectDir) {
      process.exit(0);
    }

    const statePath = path.join(projectDir, '.pipeline/state.json');
    const stateRaw = fs.readFileSync(statePath, 'utf8');
    const allStates = JSON.parse(stateRaw);
    const state = allStates[sessionId];
    if (!state || state.mode !== 'pipeline') {
      process.exit(0);
    }

    const yamlName = path.basename(state.pipeline, '.yaml');
    process.stdout.write(`Pipeline: ${yamlName} | Step: ${state.current_step}\n`);
  } catch {
    process.exit(0);
  }
});
