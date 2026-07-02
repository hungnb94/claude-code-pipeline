#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  parseYAML,
  getSessionState,
  setSessionState,
  PROJECT_ROOT,
} = require('./pipeline_utils.js');

function parseArgs(argv) {
  const args = { session: null, step: null, output: null, requirements: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--session') {
      args.session = argv[++i];
    } else if (arg === '--step') {
      args.step = argv[++i];
    } else if (arg === '--output') {
      args.output = argv[++i];
    } else if (arg === '--requirements') {
      args.requirements = argv[++i];
    }
  }
  return args;
}

function fail(message) {
  process.stderr.write(`pipeline_advance: ${message}\n`);
  process.exit(1);
}

function main() {
  const { session, step: stepArg, output, requirements } = parseArgs(
    process.argv.slice(2)
  );

  if (!session || !stepArg) {
    fail('--session and --step are required');
  }
  if (
    (output === null && requirements === null) ||
    (output !== null && requirements !== null)
  ) {
    fail('exactly one of --output or --requirements is required');
  }

  const state = getSessionState(session);
  if (!state || state.mode !== 'pipeline') {
    fail(`no active pipeline session found for session '${session}'`);
  }

  if (stepArg !== state.current_step) {
    fail(
      `--step '${stepArg}' does not match the active step '${state.current_step}'`
    );
  }

  const pipelinePath = path.join(
    PROJECT_ROOT,
    state.pipeline || '.pipeline/pipeline.yaml'
  );
  if (!fs.existsSync(pipelinePath)) {
    fail(`pipeline file not found: ${state.pipeline}`);
  }
  let config;
  try {
    config = parseYAML(fs.readFileSync(pipelinePath, 'utf8'));
  } catch (e) {
    fail(`failed to parse pipeline YAML: ${e.message}`);
  }

  const step = (config.steps || {})[stepArg];
  if (!step) {
    fail(`step '${stepArg}' not found in pipeline`);
  }

  if (step.type === 'shell') {
    fail(
      'shell steps advance automatically; do not call pipeline_advance.js for them'
    );
  }

  if (step.type === 'interview' && (requirements === null || output !== null)) {
    fail("step '" + stepArg + "' is type=interview; pass --requirements, not --output");
  }
  if (step.type === 'agent' && (output === null || requirements !== null)) {
    fail("step '" + stepArg + "' is type=agent; pass --output, not --requirements");
  }

  state.completed_steps = state.completed_steps || [];
  state.visit_counts = state.visit_counts || {};
  state.shared_state = state.shared_state || {};

  state.completed_steps.push(stepArg);
  state.visit_counts[stepArg] = (state.visit_counts[stepArg] || 0) + 1;

  if (step.type === 'interview') {
    state.shared_state.user_requirements = requirements;
    state.shared_state.requirements_locked = 'true';
  } else {
    state.shared_state[`${stepArg}_output`] = output;
  }

  const next = step.next || '';
  if (!next) {
    state.mode = 'free';
  } else {
    state.current_step = next;
  }

  setSessionState(session, state);
  process.stdout.write(
    `pipeline_advance: step '${stepArg}' completed, advanced to '${next || '(none — pipeline complete)'}'\n`
  );
  process.exit(0);
}

main();
