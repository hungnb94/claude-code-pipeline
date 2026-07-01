#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  parseYAML,
  getSessionState,
  setSessionState,
  buildStepDescription,
  buildStepOutput,
  parseStdinJSON,
  PROJECT_ROOT,
} = require('./pipeline_utils.js');

(async () => {
  const data = await parseStdinJSON();

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

  let current = state.current_step || '';
  let step = (config.steps || {})[current] || null;
  if (!step) {
    process.exit(0);
  }

  state.completed_steps = state.completed_steps || [];
  state.visit_counts = state.visit_counts || {};

  const skipped = [];
  const seen = new Set();
  while (step.max_visits && (state.visit_counts[current] || 0) >= step.max_visits) {
    if (seen.has(current)) {
      state.mode = 'free';
      setSessionState(sessionId, state);
      const reason = `Pipeline error: cycle detected among max_visits-exhausted steps (${[...seen, current].join(' -> ')}). Pipeline halted.`;
      process.stdout.write(
        JSON.stringify({
          decision: 'block',
          reason,
          systemMessage: `❌ ${reason}`,
        })
      );
      process.exit(0);
    }
    seen.add(current);
    skipped.push(current);
    state.completed_steps.push(current);
    const nextName = step.next || '';
    if (!nextName) {
      state.mode = 'free';
      setSessionState(sessionId, state);
      process.exit(0);
    }
    current = nextName;
    state.current_step = current;
    step = (config.steps || {})[current] || null;
    if (!step) {
      setSessionState(sessionId, state);
      process.exit(0);
    }
  }

  if (step.terminal) {
    state.mode = 'free';
    setSessionState(sessionId, state);
    process.exit(0);
  }

  if (skipped.length > 0) {
    setSessionState(sessionId, state);
  }

  const sharedState = state.shared_state || {};

  const output = buildStepOutput(sessionId, current, step, sharedState);
  const systemMessage = buildStepDescription(current, step, sharedState);
  const prefix =
    skipped.length > 0
      ? `⚠️ Step(s) ${skipped.map((s) => `'${s}'`).join(', ')} reached max_visits — auto-marked as succeeded, advancing to '${current}'.\n\n`
      : '';

  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason: prefix + output,
      systemMessage: prefix + systemMessage,
    })
  );
  process.exit(0);
})();
