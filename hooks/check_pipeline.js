#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  parseYAML,
  getSessionState,
  setSessionState,
  buildStepOutput,
  readStdin,
  PROJECT_ROOT,
} = require('./pipeline_utils.js');

(async () => {
  const raw = await readStdin();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const sessionId = data.session_id || '';
  if (!sessionId) {
    process.exit(0);
  }

  const state = getSessionState(sessionId);
  if (!state || state.mode !== 'pipeline') {
    process.exit(0);
  }

  const pipelinePath = path.join(
    PROJECT_ROOT,
    state.pipeline || '.pipeline/pipeline.yaml'
  );
  if (!fs.existsSync(pipelinePath)) {
    process.exit(0);
  }

  let config;
  try {
    config = parseYAML(fs.readFileSync(pipelinePath, 'utf8'));
  } catch {
    process.exit(0);
  }

  const current = state.current_step || '';
  const step = (config.steps || {})[current] || null;
  if (!step) {
    process.exit(0);
  }

  if (step.terminal) {
    state.mode = 'free';
    setSessionState(sessionId, state);
    process.exit(0);
  }

  const visits = (state.visit_counts || {})[current] || 0;
  if (step.max_visits && visits >= step.max_visits) {
    process.stderr.write(
      `Pipeline error: step '${current}' reached max_visits (${step.max_visits}). Pipeline halted.\n`
    );
    process.exit(2);
  }

  const sharedState = state.shared_state || {};
  const completedSteps = state.completed_steps || [];

  const output = buildStepOutput(
    sessionId,
    current,
    step,
    sharedState,
    completedSteps
  );

  process.stderr.write(output + '\n');
  process.exit(2);
})();
