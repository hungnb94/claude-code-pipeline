const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// Must be set before requiring pipeline_utils.js so the CLAUDE_PROJECT_DIR guard doesn't fire.
process.env.CLAUDE_PROJECT_DIR = PROJECT_ROOT;

const {
  getSessionState,
  setSessionState,
  sessionFilePath,
} = require('../hooks/pipeline_utils.js');

function readSessionState(sessionId) {
  return getSessionState(sessionId);
}

function cleanupSession(sessionId) {
  fs.rmSync(sessionFilePath(sessionId), { force: true });
}

function createSessionState(overrides = {}) {
  return {
    mode: 'pipeline',
    pipeline: '.pipeline/pipeline.yaml',
    current_step: 'plan',
    completed_steps: [],
    visit_counts: {},
    shared_state: {},
    ...overrides,
  };
}

module.exports = {
  PROJECT_ROOT,
  readSessionState,
  setSessionState,
  cleanupSession,
  createSessionState,
  spawnSync,
  randomUUID,
};
