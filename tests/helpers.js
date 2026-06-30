const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const STATE_PATH = path.join(PROJECT_ROOT, '.pipeline/state.json');

function readSessionState(sessionId) {
  if (!fs.existsSync(STATE_PATH)) {
    return null;
  }
  try {
    const all = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return all[sessionId] || null;
  } catch {
    return null;
  }
}

function setSessionState(sessionId, state) {
  let all = {};
  if (fs.existsSync(STATE_PATH)) {
    try {
      all = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    } catch {
      // ignore parse errors on corrupt state file
    }
  }
  all[sessionId] = state;
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(all, null, 2));
}

function cleanupSession(sessionId) {
  if (!fs.existsSync(STATE_PATH)) {
    return;
  }
  try {
    const all = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    delete all[sessionId];
    fs.writeFileSync(STATE_PATH, JSON.stringify(all, null, 2));
  } catch {
    // ignore errors during cleanup
  }
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
  STATE_PATH,
  readSessionState,
  setSessionState,
  cleanupSession,
  createSessionState,
};
