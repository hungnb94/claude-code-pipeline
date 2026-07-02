#!/usr/bin/env node

const { parseStdinJSON } = require('./pipeline_utils.js');

const PROTECTED_PATTERNS = ['.pipeline/sessions/', '.pipeline/state.json'];
const ALLOWED_INVOCATION = /\bnode\s+\S*pipeline_advance\.js\b/;

function block(reason) {
  process.stderr.write(`🔒 blocked — ${reason}\n`);
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

(async () => {
  const data = await parseStdinJSON();

  // Unconditional: these files must never be hand-edited, regardless of
  // whether a pipeline happens to be active right now.
  const toolName = data.tool_name || '';
  const toolInput = data.tool_input || {};

  if (['Edit', 'Write', 'MultiEdit'].includes(toolName)) {
    const filePath = toolInput.file_path || '';
    if (PROTECTED_PATTERNS.some((p) => filePath.includes(p))) {
      block(
        'Direct edits to pipeline state files are not allowed. Use hooks/pipeline_advance.js to advance the pipeline.'
      );
    }
  } else if (toolName === 'Bash') {
    const command = toolInput.command || '';
    if (PROTECTED_PATTERNS.some((p) => command.includes(p)) && !ALLOWED_INVOCATION.test(command)) {
      block(
        'This is a best-effort check, not a sandbox, but direct manipulation of pipeline state files via Bash is not allowed. Use hooks/pipeline_advance.js instead.'
      );
    }
  }

  process.exit(0);
})();
