#!/usr/bin/env node

const {
  loadActivePipelineContext,
  parseStdinJSON,
} = require('./pipeline_utils.js');

(async () => {
  const data = await parseStdinJSON();

  const ctx = loadActivePipelineContext(data);
  if (!ctx) {
    process.exit(0);
  }

  const { state, config } = ctx;
  if (state.shared_state && state.shared_state.requirements_locked === 'true') {
    process.exit(0);
  }

  const entryStep = (config.steps || {})[config.entry || ''];
  if (!entryStep || entryStep.type !== 'interview') {
    process.exit(0);
  }

  const toolName = data.tool_name || '';
  if (['Edit', 'Write', 'MultiEdit'].includes(toolName)) {
    process.stdout.write(
      JSON.stringify({
        decision: 'block',
        reason:
          'Requirements have not been locked yet. Complete the requirements gathering step before editing files.',
      })
    );
  }

  process.exit(0);
})();
