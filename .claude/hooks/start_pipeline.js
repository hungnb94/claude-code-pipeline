#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const STATE_PATH = path.join(PROJECT_ROOT, '.pipeline/pipeline.state');

function main() {
  if (!fs.existsSync(STATE_PATH)) process.exit(0);

  let state;
  try {
    state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    process.exit(0);
  }

  if (state.mode === 'pipeline') {
    state.mode = 'free';
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }
}

main();
