#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const STATE_PATH = path.join(PROJECT_ROOT, '.pipeline/pipeline.state');

function render(template, state) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(state, key) ? String(state[key]) : `{{${key}}}`
  );
}

function parseScalar(s) {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  const n = Number(s);
  if (!isNaN(n) && s !== '') return n;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// Minimal YAML parser — handles the pipeline.yaml subset:
// nested objects, block scalars (|), inline arrays, scalars.
function parseYAML(text) {
  const lines = text.split('\n');
  const root = {};
  const stack = [{ obj: root, indent: -1 }];

  let blockKey = null;
  let blockBaseIndent = 0;
  let blockDetectedIndent = -1;
  let blockLines = [];
  let blockTarget = null;

  for (const raw of lines) {
    if (blockKey !== null) {
      const trimmed = raw.trim();
      if (trimmed === '') {
        blockLines.push('');
        continue;
      }
      const lineIndent = raw.match(/^(\s*)/)[1].length;
      if (lineIndent > blockBaseIndent) {
        if (blockDetectedIndent === -1) blockDetectedIndent = lineIndent;
        blockLines.push(raw.slice(blockDetectedIndent));
        continue;
      }
      // Block ended — flush
      blockTarget[blockKey] = blockLines.join('\n').replace(/\n*$/, '\n');
      blockKey = null;
      blockLines = [];
      blockTarget = null;
    }

    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const indent = raw.match(/^(\s*)/)[1].length;

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

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
      stack.push({ obj, indent });
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      parent[key] = rest.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    } else {
      parent[key] = parseScalar(rest);
    }
  }

  if (blockKey !== null) {
    blockTarget[blockKey] = blockLines.join('\n').replace(/\n*$/, '\n');
  }

  return root;
}

function main() {
  if (!fs.existsSync(STATE_PATH)) process.exit(0);

  let state;
  try {
    state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    process.exit(0);
  }

  if (state.mode !== 'pipeline') process.exit(0);

  const pipelinePath = path.join(PROJECT_ROOT, state.pipeline || '.pipeline/pipeline.yaml');
  if (!fs.existsSync(pipelinePath)) process.exit(0);

  let config;
  try {
    config = parseYAML(fs.readFileSync(pipelinePath, 'utf8'));
  } catch {
    process.exit(0);
  }

  const current = state.current_step || '';
  const step = (config.steps || {})[current] || null;

  if (!step) process.exit(0);
  if (step.terminal) process.exit(0);

  const shared = Object.assign({}, state.shared_state || {});
  shared.requirement = state.requirement || '';

  const prompt = render(step.prompt || '', shared);
  const stepType = step.type || 'agent';
  const agent = step.agent || 'claude';

  process.stdout.write(
    `Pipeline active — current step: '${current}' (type=${stepType}, agent=${agent}).\n` +
    `Complete this step before stopping.\n\n` +
    `Step prompt:\n${prompt.trim()}\n`
  );
  process.exit(2);
}

main();
