#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  parseYAML,
  render,
  getSessionState,
  setSessionState,
  buildAgentUpdateBlock,
  buildShellUpdateBlock,
  buildProgressHeader,
  PROJECT_ROOT,
} = require('./pipeline_utils.js');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
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
    process.stdout.write(
      `Pipeline error: step '${current}' reached max_visits (${step.max_visits}). Pipeline halted.\n`
    );
    process.exit(2);
  }

  const sharedState = state.shared_state || {};
  const stepType = step.type || 'agent';

  const completedSteps = state.completed_steps || [];
  const header = buildProgressHeader(completedSteps, current);

  let output;
  if (stepType === 'shell') {
    const cmds = (step.commands || []).map((c) => `  ${c}`).join('\n');
    output =
      `${header}\n\n` +
      `Pipeline active — current step: '${current}' (type=shell).\n\n` +
      `Run these commands in sequence:\n${cmds}\n\n` +
      buildShellUpdateBlock(
        sessionId,
        current,
        step.next || '',
        step.next_fail || ''
      );
  } else {
    const prompt = render(step.prompt || '', sharedState);
    output =
      `${header}\n\n` +
      `Pipeline active — current step: '${current}' (type=agent).\n\n` +
      `Execute the following prompt:\n---\n${prompt.trim()}\n---\n\n` +
      buildAgentUpdateBlock(sessionId, current, step.next || '');
  }

  process.stderr.write(header + '\n');
  process.stdout.write(output + '\n');
  process.exit(2);
});
