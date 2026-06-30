#!/usr/bin/env node

const {
  loadActivePipelineContext,
  setSessionState,
  buildStepOutput,
  parseStdinJSON,
} = require('./pipeline_utils.js');

(async () => {
  const data = await parseStdinJSON();

  const ctx = loadActivePipelineContext(data);
  if (!ctx) {
    process.exit(0);
  }

  const { sessionId, state, config } = ctx;
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

  if (step.type === 'interview') {
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
