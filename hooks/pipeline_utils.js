const fs = require('fs');
const path = require('path');

const PROJECT_ROOT =
  process.env.CLAUDE_PROJECT_DIR ||
  (() => {
    process.stderr.write(
      'pipeline: CLAUDE_PROJECT_DIR is not set — cannot locate state file\n'
    );
    process.exit(1);
  })();
const STATE_PATH = path.join(PROJECT_ROOT, '.pipeline/state.json');

function parseScalar(s) {
  if (s === 'true') {
    return true;
  }
  if (s === 'false') {
    return false;
  }
  if (s === 'null' || s === '~') {
    return null;
  }
  const n = Number(s);
  if (!isNaN(n) && s !== '') {
    return n;
  }
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function parseYAML(text) {
  const lines = text.split('\n');
  const root = {};
  const stack = [{ obj: root, indent: -1, key: null }];
  let blockKey = null,
    blockBaseIndent = 0,
    blockDetectedIndent = -1,
    blockLines = [],
    blockTarget = null;

  for (const raw of lines) {
    if (blockKey !== null) {
      const trimmed = raw.trim();
      if (trimmed === '') {
        blockLines.push('');
        continue;
      }
      const lineIndent = raw.match(/^(\s*)/)[1].length;
      if (lineIndent > blockBaseIndent) {
        if (blockDetectedIndent === -1) {
          blockDetectedIndent = lineIndent;
        }
        blockLines.push(raw.slice(blockDetectedIndent));
        continue;
      }
      blockTarget[blockKey] = blockLines.join('\n').replace(/\n*$/, '\n');
      blockKey = null;
      blockLines = [];
      blockTarget = null;
    }
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const indent = raw.match(/^(\s*)/)[1].length;
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    if (trimmed.startsWith('- ')) {
      const value = parseScalar(trimmed.slice(2).trim());
      if (stack.length >= 2) {
        const top = stack[stack.length - 1];
        const grandparent = stack[stack.length - 2].obj;
        const arrKey = top.key;
        if (arrKey !== null && !Array.isArray(grandparent[arrKey])) {
          grandparent[arrKey] = [];
          top.obj = grandparent[arrKey];
        }
        if (arrKey !== null && Array.isArray(grandparent[arrKey])) {
          grandparent[arrKey].push(value);
        }
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trim();
    if (rest === '|' || rest === '|-' || rest === '|+') {
      blockKey = key;
      blockBaseIndent = indent;
      blockDetectedIndent = -1;
      blockLines = [];
      blockTarget = parent;
    } else if (rest === '') {
      const obj = {};
      parent[key] = obj;
      stack.push({ obj, indent, key });
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      parent[key] = rest
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      parent[key] = parseScalar(rest);
    }
  }
  if (blockKey !== null) {
    blockTarget[blockKey] = blockLines.join('\n').replace(/\n*$/, '\n');
  }
  return root;
}

function render(template, sharedState) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(sharedState, key)
      ? String(sharedState[key])
      : `{{${key}}}`
  );
}

function readAllStates() {
  if (!fs.existsSync(STATE_PATH)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeAllStates(states) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(states, null, 2));
}

function getSessionState(sessionId) {
  return readAllStates()[sessionId] || null;
}

function setSessionState(sessionId, sessionState) {
  const all = readAllStates();
  all[sessionId] = sessionState;
  writeAllStates(all);
}

function escapeForPython(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildAgentUpdateBlock(sessionId, stepName, next) {
  const sid = escapeForPython(sessionId);
  const sname = escapeForPython(stepName);
  const nextSafe = next ? escapeForPython(next) : '';
  const advance = next
    ? `sess['current_step'] = '${nextSafe}'`
    : `sess['mode'] = 'free'`;
  const py = [
    `import json; from pathlib import Path`,
    `p = Path('${escapeForPython(STATE_PATH)}')`,
    `s = json.loads(p.read_text())`,
    `sess = s['${sid}']`,
    `sess['completed_steps'].append('${sname}')`,
    `sess.setdefault('visit_counts', {})`,
    `sess['visit_counts']['${sname}'] = sess['visit_counts'].get('${sname}', 0) + 1`,
    `sess['shared_state']['${sname}_output'] = 'REPLACE_WITH_ONE_LINE_SUMMARY'`,
    advance,
    `p.write_text(json.dumps(s, indent=2))`,
  ].join('\n');
  return (
    `After completing your response, advance the pipeline by running:\n\n` +
    `\`\`\`bash\npython3 -c "\n${py}\n"\n\`\`\``
  );
}

function buildInterviewUpdateBlock(sessionId, stepName, next) {
  const sid = escapeForPython(sessionId);
  const sname = escapeForPython(stepName);
  const advance = next
    ? `sess['current_step'] = '${escapeForPython(next)}'`
    : `sess['mode'] = 'free'`;
  const py = [
    `import json; from pathlib import Path`,
    `p = Path('${escapeForPython(STATE_PATH)}')`,
    `s = json.loads(p.read_text())`,
    `sess = s['${sid}']`,
    `sess['completed_steps'].append('${sname}')`,
    `sess.setdefault('visit_counts', {})`,
    `sess['visit_counts']['${sname}'] = sess['visit_counts'].get('${sname}', 0) + 1`,
    `sess['shared_state']['user_requirements'] = 'REPLACE_WITH_GATHERED_REQUIREMENTS'`,
    `sess['shared_state']['requirements_locked'] = 'true'`,
    advance,
    `p.write_text(json.dumps(s, indent=2))`,
  ].join('\n');
  return (
    `When you have gathered all requirements, run the following to lock them and continue:\n\n` +
    `\`\`\`bash\npython3 -c "\n${py}\n"\n\`\`\`\n\n` +
    `Replace REPLACE_WITH_GATHERED_REQUIREMENTS with the complete requirements text you gathered.`
  );
}

function buildShellUpdateBlock(sessionId, stepName, next, nextFail) {
  const sid = escapeForPython(sessionId);
  const sname = escapeForPython(stepName);
  const nextSafe = next ? escapeForPython(next) : '';
  const nextFailSafe = nextFail ? escapeForPython(nextFail) : '';
  const baseLines = [
    `import json; from pathlib import Path`,
    `p = Path('${escapeForPython(STATE_PATH)}')`,
    `s = json.loads(p.read_text())`,
    `sess = s['${sid}']`,
    `sess['completed_steps'].append('${sname}')`,
    `sess.setdefault('visit_counts', {})`,
    `sess['visit_counts']['${sname}'] = sess['visit_counts'].get('${sname}', 0) + 1`,
  ];
  const successLine = next
    ? `sess['current_step'] = '${nextSafe}'`
    : `sess['mode'] = 'free'`;
  const failLine = nextFail
    ? `sess['current_step'] = '${nextFailSafe}'`
    : `sess['mode'] = 'free'`;
  const pySuccess = [
    ...baseLines,
    successLine,
    `p.write_text(json.dumps(s, indent=2))`,
  ].join('\n');
  const pyFail = [
    ...baseLines,
    failLine,
    `p.write_text(json.dumps(s, indent=2))`,
  ].join('\n');
  return (
    `If ALL commands exit 0, run:\n\`\`\`bash\npython3 -c "\n${pySuccess}\n"\n\`\`\`\n\n` +
    `If ANY command fails, run:\n\`\`\`bash\npython3 -c "\n${pyFail}\n"\n\`\`\``
  );
}

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', () => {
      resolve(raw);
    });
  });
}

async function parseStdinJSON() {
  const raw = await readStdin();
  try {
    return JSON.parse(raw);
  } catch {
    process.exit(0);
  }
}

function buildStepDescription(stepName, step, sharedState) {
  if (step.type === 'interview') {
    const prompt = render(step.prompt || '', sharedState);
    return (
      `Pipeline step: '${stepName}' (type=interview)\n\n` + `${prompt.trim()}`
    );
  }
  if (step.type === 'shell') {
    const cmds = (step.commands || []).map((c) => `  ${c}`).join('\n');
    return (
      `Pipeline step: '${stepName}' (type=shell)\n\n` +
      `Run these commands in sequence:\n${cmds}`
    );
  }
  const prompt = render(step.prompt || '', sharedState);
  return (
    `Pipeline step: '${stepName}' (type=agent)\n\n` +
    `Execute the following prompt:\n---\n${prompt.trim()}\n---`
  );
}

function buildStepOutput(sessionId, stepName, step, sharedState) {
  const description = buildStepDescription(stepName, step, sharedState);
  if (step.type === 'interview') {
    return (
      `${description}\n\n` +
      buildInterviewUpdateBlock(sessionId, stepName, step.next || '')
    );
  }
  if (step.type === 'shell') {
    return (
      `${description}\n\n` +
      buildShellUpdateBlock(
        sessionId,
        stepName,
        step.next || '',
        step.next_fail || ''
      )
    );
  }
  return (
    `${description}\n\n` +
    buildAgentUpdateBlock(sessionId, stepName, step.next || '')
  );
}

function loadActivePipelineContext(data) {
  const sessionId = data.session_id || '';
  if (!sessionId) {
    return null;
  }
  const state = getSessionState(sessionId);
  if (!state || state.mode !== 'pipeline') {
    return null;
  }
  const pipelinePath = path.join(PROJECT_ROOT, state.pipeline || '.pipeline/pipeline.yaml');
  if (!fs.existsSync(pipelinePath)) {
    return null;
  }
  let config;
  try {
    config = parseYAML(fs.readFileSync(pipelinePath, 'utf8'));
  } catch {
    return null;
  }
  return { sessionId, state, config };
}

module.exports = {
  parseYAML,
  render,
  readAllStates,
  writeAllStates,
  getSessionState,
  setSessionState,
  loadActivePipelineContext,
  buildAgentUpdateBlock,
  buildInterviewUpdateBlock,
  buildShellUpdateBlock,
  buildStepDescription,
  buildStepOutput,
  readStdin,
  parseStdinJSON,
  PROJECT_ROOT,
  STATE_PATH,
};
