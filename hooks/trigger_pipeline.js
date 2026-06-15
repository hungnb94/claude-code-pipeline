#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  parseYAML, render, setSessionState,
  buildAgentUpdateBlock, buildShellUpdateBlock,
  PROJECT_ROOT,
} = require('./pipeline_utils.js');

function buildStepOutput(sessionId, stepName, step, sharedState) {
  if (step.type === 'shell') {
    const cmds = (step.commands || []).map(c => `  ${c}`).join('\n');
    return (
      `Pipeline step: '${stepName}' (type=shell)\n\n` +
      `Run these commands in sequence:\n${cmds}\n\n` +
      buildShellUpdateBlock(sessionId, stepName, step.next || '', step.next_fail || '')
    );
  }
  const prompt = render(step.prompt || '', sharedState);
  return (
    `Pipeline step: '${stepName}' (type=agent)\n\n` +
    `Execute the following prompt:\n---\n${prompt.trim()}\n---\n\n` +
    buildAgentUpdateBlock(sessionId, stepName, step.next || '')
  );
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  let data;
  try { data = JSON.parse(raw); } catch { process.exit(0); }

  const prompt = (data.prompt || '').trim();
  if (!prompt.startsWith('/pipeline:run')) process.exit(0);

  const sessionId = data.session_id || 'unknown';
  const args = prompt.slice('/pipeline:run'.length).trim();
  const pipelineFile = args.endsWith('.yaml') ? args : '.pipeline/pipeline.yaml';
  const pipelinePath = path.join(PROJECT_ROOT, pipelineFile);

  if (!pipelinePath.startsWith(PROJECT_ROOT + path.sep) && pipelinePath !== PROJECT_ROOT) {
    process.stdout.write(`Pipeline file must be within the project root.\n`);
    process.exit(1);
  }

  if (!fs.existsSync(pipelinePath)) {
    process.stdout.write(`Pipeline file not found: ${pipelineFile}\n`);
    process.exit(1);
  }

  let config;
  try { config = parseYAML(fs.readFileSync(pipelinePath, 'utf8')); } catch (e) {
    process.stdout.write(`Failed to parse pipeline YAML: ${e.message}\n`);
    process.exit(1);
  }

  if (!config.entry || !config.steps) {
    process.stdout.write(`Invalid pipeline: missing 'entry' or 'steps'.\n`);
    process.exit(1);
  }

  const entryStep = config.steps[config.entry];
  if (!entryStep) {
    process.stdout.write(`Entry step '${config.entry}' not found in steps.\n`);
    process.exit(1);
  }

  if (entryStep.terminal) {
    process.stdout.write(`Pipeline initialized from '${pipelineFile}' but entry step '${config.entry}' is terminal — pipeline complete.\n`);
    process.exit(0);
  }

  setSessionState(sessionId, {
    mode: 'pipeline',
    pipeline: pipelineFile,
    current_step: config.entry,
    completed_steps: [],
    visit_counts: {},
    shared_state: {},
  });

  const stepOutput = buildStepOutput(sessionId, config.entry, entryStep, {});
  process.stdout.write(
    `Pipeline initialized from '${pipelineFile}'. Entry: '${config.entry}'.\n\n` +
    stepOutput + '\n'
  );
  process.exit(0);
});
