#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  parseYAML,
  render,
  getSessionState,
  setSessionState,
  buildProgressHeader,
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

  const steps = config.steps || {};
  let current = state.current_step || '';
  const step = steps[current] || null;
  if (!step) {
    process.exit(0);
  }

  if (step.terminal) {
    state.mode = 'free';
    setSessionState(sessionId, state);
    process.exit(0);
  }

  // Check max_visits before marking current agent step done
  const visits = (state.visit_counts || {})[current] || 0;
  if (step.max_visits && visits >= step.max_visits) {
    process.stderr.write(
      `Pipeline error: step '${current}' reached max_visits (${step.max_visits}). Pipeline halted.\n`
    );
    process.exit(2);
  }

  // Mark current agent step done
  state.completed_steps = state.completed_steps || [];
  state.completed_steps.push(current);
  state.visit_counts = state.visit_counts || {};
  state.visit_counts[current] = visits + 1;
  state.shared_state = state.shared_state || {};

  const next = step.next || null;
  if (!next) {
    state.mode = 'free';
    setSessionState(sessionId, state);
    process.exit(0);
  }
  current = next;
  state.current_step = current;

  // Chain through shell steps
  while (true) {
    const s = steps[current];
    if (!s) {
      state.mode = 'free';
      setSessionState(sessionId, state);
      process.exit(0);
    }
    if (s.terminal) {
      state.mode = 'free';
      setSessionState(sessionId, state);
      process.exit(0);
    }
    if (s.type !== 'shell') break;

    const sv = (state.visit_counts[current] || 0);
    if (s.max_visits && sv >= s.max_visits) {
      setSessionState(sessionId, state);
      process.stderr.write(
        `Pipeline error: step '${current}' reached max_visits (${s.max_visits}). Pipeline halted.\n`
      );
      process.exit(2);
    }

    // Run shell commands
    const cmds = s.commands || [];
    let success = true;
    let output = '';
    for (const cmd of cmds) {
      try {
        output += execSync(cmd, {
          cwd: PROJECT_ROOT,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (e) {
        success = false;
        output = (e.stdout || '') + (e.stderr || '');
        break;
      }
    }

    state.completed_steps.push(current);
    state.visit_counts[current] = sv + 1;
    state.shared_state[`${current}_output`] = output.slice(0, 4000);

    const nextStep = success ? (s.next || null) : (s.next_fail || s.next || null);
    if (!nextStep) {
      state.mode = 'free';
      state.current_step = current;
      setSessionState(sessionId, state);
      process.exit(0);
    }
    current = nextStep;
    state.current_step = current;
  }

  // Inject next agent step prompt
  setSessionState(sessionId, state);
  const agentStep = steps[current];
  const prompt = render(agentStep.prompt || '', state.shared_state);
  const header = buildProgressHeader(state.completed_steps, current);
  const injection =
    `${header}\n\n` +
    `Pipeline active — current step: '${current}' (type=agent).\n\n` +
    `Execute the following prompt:\n---\n${prompt.trim()}\n---`;
  process.stderr.write(injection + '\n');
  process.exit(2);
})();
