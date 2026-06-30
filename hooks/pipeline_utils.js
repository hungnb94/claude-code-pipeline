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


function buildProgressHeader(completedSteps, currentStep) {
  const parts = [
    ...(completedSteps || []).map((s) => `✅ ${s}`),
    `🔄 ${currentStep}`,
  ];
  return parts.join(' → ');
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

function buildStepOutput(stepName, step, sharedState, completedSteps) {
  const header = buildProgressHeader(completedSteps || [], stepName);
  if (step.type === 'shell') {
    const cmds = (step.commands || []).map((c) => `  ${c}`).join('\n');
    return (
      `${header}\n\n` +
      `Pipeline step: '${stepName}' (type=shell)\n\n` +
      `Run these commands in sequence:\n${cmds}`
    );
  }
  const prompt = render(step.prompt || '', sharedState);
  return (
    `${header}\n\n` +
    `Pipeline active — current step: '${stepName}' (type=agent).\n\n` +
    `Execute the following prompt:\n---\n${prompt.trim()}\n---`
  );
}

module.exports = {
  parseYAML,
  render,
  readAllStates,
  writeAllStates,
  getSessionState,
  setSessionState,
  buildProgressHeader,
  buildStepOutput,
  readStdin,
  parseStdinJSON,
  PROJECT_ROOT,
  STATE_PATH,
};
