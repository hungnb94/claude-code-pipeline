#!/usr/bin/env node

const {
  loadActivePipelineContext,
  setSessionState,
  buildStepDescription,
  buildStepOutput,
  runShellStep,
  parseStdinJSON,
  PROJECT_ROOT,
} = require('./pipeline_utils.js');

(async () => {
  const data = await parseStdinJSON();

  const ctx = loadActivePipelineContext(data);
  if (!ctx) {
    process.exit(0);
  }

  const { sessionId, state, config } = ctx;
  let current = state.current_step || '';
  let step;

  state.completed_steps = state.completed_steps || [];
  state.visit_counts = state.visit_counts || {};
  state.shared_state = state.shared_state || {};

  const skipped = [];
  const seen = new Set(); // max-visits-specific cycle detection (unchanged from before)
  const visitedThisInvocation = new Set(); // catches any same-invocation cycle, even without max_visits

  while (true) {
    step = (config.steps || {})[current] || null;
    if (!step) {
      setSessionState(sessionId, state);
      process.exit(0);
    }

    if (visitedThisInvocation.has(current)) {
      state.mode = 'free';
      setSessionState(sessionId, state);
      const reason = `Pipeline error: cycle detected in step execution (${[...visitedThisInvocation, current].join(' -> ')}). Pipeline halted.`;
      process.stdout.write(
        JSON.stringify({
          decision: 'block',
          reason,
          systemMessage: `❌ ${reason}`,
        })
      );
      process.exit(0);
    }
    visitedThisInvocation.add(current);

    if (step.max_visits && (state.visit_counts[current] || 0) >= step.max_visits) {
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
      continue;
    }

    if (step.terminal) {
      state.mode = 'free';
      setSessionState(sessionId, state);
      process.exit(0);
    }

    if (step.type === 'shell') {
      const { ok, output } = runShellStep(step, PROJECT_ROOT);
      state.completed_steps.push(current);
      state.visit_counts[current] = (state.visit_counts[current] || 0) + 1;
      state.shared_state[`${current}_output`] = output;
      const nextName = ok ? step.next || '' : step.next_fail || '';
      if (!nextName) {
        state.mode = 'free';
        setSessionState(sessionId, state);
        process.exit(0);
      }
      current = nextName;
      state.current_step = current;
      continue;
    }

    if (step.type === 'interview') {
      setSessionState(sessionId, state);
      process.exit(0);
    }

    break;
  }

  setSessionState(sessionId, state);

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
