#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  parseYAML,
  setSessionState,
  buildStepDescription,
  buildStepOutput,
  parseStdinJSON,
  PROJECT_ROOT,
} = require('./pipeline_utils.js');

(async () => {
  const data = await parseStdinJSON();

  const prompt = (data.prompt || '').trim();
  if (!prompt.startsWith('/pipeline:run')) {
    process.exit(0);
  }

  const sessionId = data.session_id || 'unknown';
  const args = prompt.slice('/pipeline:run'.length).trim();
  const tokens = args.split(/\s+/);
  const pipelineFile =
    tokens[0] && tokens[0].endsWith('.yaml')
      ? tokens[0]
      : '.pipeline/pipeline.yaml';
  const userRequirements =
    tokens[0] && tokens[0].endsWith('.yaml') ? tokens.slice(1).join(' ') : args;
  const pipelinePath = path.join(PROJECT_ROOT, pipelineFile);

  if (
    !pipelinePath.startsWith(PROJECT_ROOT + path.sep) &&
    pipelinePath !== PROJECT_ROOT
  ) {
    process.stdout.write(`Pipeline file must be within the project root.\n`);
    process.exit(1);
  }

  if (!fs.existsSync(pipelinePath)) {
    process.stdout.write(`Pipeline file not found: ${pipelineFile}\n`);
    process.exit(1);
  }

  let config;
  try {
    config = parseYAML(fs.readFileSync(pipelinePath, 'utf8'));
  } catch (e) {
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

  const interviewNonEntry = Object.entries(config.steps).filter(
    ([name, s]) => s.type === 'interview' && name !== config.entry
  );
  if (interviewNonEntry.length > 0) {
    const names = interviewNonEntry.map(([n]) => n).join(', ');
    process.stdout.write(
      `Invalid pipeline: interview step(s) '${names}' must be the entry step.\n`
    );
    process.exit(1);
  }

  if (entryStep.type === 'interview' && !entryStep.next) {
    process.stdout.write(
      `Invalid pipeline: interview step '${config.entry}' must have a 'next' step.\n`
    );
    process.exit(1);
  }

  if (entryStep.terminal) {
    process.stdout.write(
      `Pipeline initialized from '${pipelineFile}' but entry step '${config.entry}' is terminal — pipeline complete.\n`
    );
    process.exit(0);
  }

  setSessionState(sessionId, {
    mode: 'pipeline',
    pipeline: pipelineFile,
    current_step: config.entry,
    completed_steps: [],
    visit_counts: {},
    shared_state: { user_requirements: userRequirements },
  });

  const initLine = `Pipeline initialized from '${pipelineFile}'. Entry: '${config.entry}'.`;
  const sharedState = { user_requirements: userRequirements };
  const stepOutput = buildStepOutput(
    sessionId,
    config.entry,
    entryStep,
    sharedState
  );
  const stepDescription = buildStepDescription(
    config.entry,
    entryStep,
    sharedState
  );

  process.stdout.write(
    JSON.stringify({
      systemMessage: `${initLine}\n\n${stepDescription}`,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `${initLine}\n\n${stepOutput}`,
      },
    })
  );
  process.exit(0);
})();
