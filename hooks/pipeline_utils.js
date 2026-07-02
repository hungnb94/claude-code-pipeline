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
const SESSIONS_DIR = path.join(PROJECT_ROOT, '.pipeline/sessions');
// hooks/pipeline_utils.js always lives at <plugin_root>/hooks/, so this is a
// reliable way to get an absolute, directly-runnable plugin root regardless
// of whether CLAUDE_PLUGIN_ROOT is set in this process's environment.
const PLUGIN_ROOT = path.resolve(__dirname, '..');

function sessionFilePath(sessionId) {
  return path.join(SESSIONS_DIR, `${path.basename(sessionId)}.json`);
}

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

function getSessionState(sessionId) {
  const ownPath = sessionFilePath(sessionId);
  if (fs.existsSync(ownPath)) {
    try {
      return JSON.parse(fs.readFileSync(ownPath, 'utf8'));
    } catch {
      return null;
    }
  }
  if (!fs.existsSync(STATE_PATH)) {
    return null;
  }
  try {
    const legacy = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return legacy[sessionId] || null;
  } catch {
    return null;
  }
}

function setSessionState(sessionId, sessionState) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.writeFileSync(
    sessionFilePath(sessionId),
    JSON.stringify(sessionState, null, 2)
  );
}

function buildAdvanceInstruction(sessionId, stepName, step) {
  const script = path.join(PLUGIN_ROOT, 'hooks/pipeline_advance.js');
  if (step.type === 'interview') {
    return (
      `When you have gathered all requirements, advance the pipeline by running:\n\n` +
      `\`\`\`bash\nnode ${script} --session ${sessionId} --step ${stepName} --requirements "<complete gathered requirements text>"\n\`\`\`\n\n` +
      `Replace <complete gathered requirements text> with the complete requirements text you gathered.`
    );
  }
  return (
    `When you have completed this step, advance the pipeline by running:\n\n` +
    `\`\`\`bash\nnode ${script} --session ${sessionId} --step ${stepName} --output "<one-line summary of what you did>"\n\`\`\`\n\n` +
    `Replace <one-line summary of what you did> with a one-line summary of what you did.`
  );
}

function runShellStep(step, cwd) {
  const { spawnSync } = require('child_process');
  let output = '';
  for (const cmd of step.commands || []) {
    const result = spawnSync(cmd, {
      shell: true,
      cwd,
      encoding: 'utf8',
    });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    output += `$ ${cmd}\n${stdout}${stderr}`;
    const failed = result.status !== 0;
    if (failed) {
      return { ok: false, output };
    }
  }
  return { ok: true, output };
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
  if (step.type === 'shell') {
    // Shell steps are executed by the hook itself and never advanced via
    // pipeline_advance.js, so there is no Claude-facing advance instruction.
    return description;
  }
  return `${description}\n\n${buildAdvanceInstruction(sessionId, stepName, step)}`;
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
  const pipelinePath = path.join(
    PROJECT_ROOT,
    state.pipeline || '.pipeline/pipeline.yaml'
  );
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
  getSessionState,
  setSessionState,
  sessionFilePath,
  loadActivePipelineContext,
  buildAdvanceInstruction,
  runShellStep,
  buildStepDescription,
  buildStepOutput,
  readStdin,
  parseStdinJSON,
  PROJECT_ROOT,
  PLUGIN_ROOT,
  STATE_PATH,
};
