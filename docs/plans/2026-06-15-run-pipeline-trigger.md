# Run-Pipeline Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When user types `/run-pipeline [yaml]`, a `UserPromptSubmit` hook initializes pipeline state and injects step-by-step execution instructions so Claude runs the pipeline automatically, driven turn-by-turn by the `Stop` hook.

**Architecture:** `trigger_pipeline.js` (UserPromptSubmit) detects the command, initializes session state in `.pipeline/state.json`, and outputs the first step's prompt. After each Claude turn, `check_pipeline.js` (Stop) reads the current step, injects the next step's prompt and a Python state-update command, and exits 2 to keep the pipeline running. Claude executes each step and runs the state-update Python before stopping.

**Tech Stack:** Node.js (hooks), Python 3 (atomic state updates), YAML (pipeline config), JSON (state)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `.claude/hooks/pipeline_utils.js` | Create | Shared: `parseYAML`, `render`, state read/write for `state.json` |
| `.claude/hooks/trigger_pipeline.js` | Create | UserPromptSubmit: detect `/run-pipeline`, init state, inject step 1 |
| `.claude/hooks/check_pipeline.js` | Modify | Stop: read session state, inject next step prompt + update command |
| `.claude/hooks/start_pipeline.js` | Delete | No longer needed — superseded by trigger_pipeline.js |
| `.claude/settings.json` | Modify | Wire `trigger_pipeline.js` to UserPromptSubmit; remove SessionStart hook |
| `examples/pipeline.yaml` | Modify | Update routing fields: `on_pass`→`next`, `on_fail`→`next_fail` |

**State file format** — `.pipeline/state.json`:
```json
{
  "<session_id>": {
    "mode": "pipeline",
    "pipeline": ".pipeline/pipeline.yaml",
    "current_step": "plan",
    "completed_steps": [],
    "visit_counts": {},
    "shared_state": {}
  }
}
```

---

### Task 1: Create `pipeline_utils.js`

Extract shared logic from `check_pipeline.js` into a reusable module. Both `trigger_pipeline.js` and the updated `check_pipeline.js` will `require` this.

**Files:**
- Create: `.claude/hooks/pipeline_utils.js`

- [ ] **Step 1: Write the module**

```js
// .claude/hooks/pipeline_utils.js
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const STATE_PATH = path.join(PROJECT_ROOT, '.pipeline/state.json');

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

function parseYAML(text) {
  const lines = text.split('\n');
  const root = {};
  const stack = [{ obj: root, indent: -1 }];
  let blockKey = null, blockBaseIndent = 0, blockDetectedIndent = -1, blockLines = [], blockTarget = null;

  for (const raw of lines) {
    if (blockKey !== null) {
      const trimmed = raw.trim();
      if (trimmed === '') { blockLines.push(''); continue; }
      const lineIndent = raw.match(/^(\s*)/)[1].length;
      if (lineIndent > blockBaseIndent) {
        if (blockDetectedIndent === -1) blockDetectedIndent = lineIndent;
        blockLines.push(raw.slice(blockDetectedIndent));
        continue;
      }
      blockTarget[blockKey] = blockLines.join('\n').replace(/\n*$/, '\n');
      blockKey = null; blockLines = []; blockTarget = null;
    }
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = raw.match(/^(\s*)/)[1].length;
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trim();
    if (rest === '|' || rest === '|-' || rest === '|+') {
      blockKey = key; blockBaseIndent = indent; blockDetectedIndent = -1; blockLines = []; blockTarget = parent;
    } else if (rest === '') {
      const obj = {}; parent[key] = obj; stack.push({ obj, indent });
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      parent[key] = rest.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    } else {
      parent[key] = parseScalar(rest);
    }
  }
  if (blockKey !== null) blockTarget[blockKey] = blockLines.join('\n').replace(/\n*$/, '\n');
  return root;
}

function render(template, sharedState) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(sharedState, key) ? String(sharedState[key]) : `{{${key}}}`
  );
}

function readAllStates() {
  if (!fs.existsSync(STATE_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
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

module.exports = { parseYAML, render, readAllStates, writeAllStates, getSessionState, setSessionState, PROJECT_ROOT, STATE_PATH };
```

- [ ] **Step 2: Verify the module loads without error**

```bash
node -e "const u = require('./.claude/hooks/pipeline_utils.js'); console.log(Object.keys(u).join(', '));"
```

Expected output: `parseYAML, render, readAllStates, writeAllStates, getSessionState, setSessionState, PROJECT_ROOT, STATE_PATH`

- [ ] **Step 3: Commit**

```bash
git add .claude/hooks/pipeline_utils.js
git commit -m "feat: add pipeline_utils shared module"
```

---

### Task 2: Create `trigger_pipeline.js`

New UserPromptSubmit hook. Detects `/run-pipeline [yaml]`, initializes session state, outputs the first step's execution prompt to stdout. Claude receives this as additional context and executes step 1.

**Files:**
- Create: `.claude/hooks/trigger_pipeline.js`

- [ ] **Step 1: Write the hook**

```js
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseYAML, render, setSessionState, PROJECT_ROOT } = require('./pipeline_utils.js');

function buildStepPrompt(stepName, step, sharedState) {
  if (step.type === 'shell') {
    const cmds = (step.commands || []).map(c => `  ${c}`).join('\n');
    const nextOk = step.next || '';
    const nextFail = step.next_fail || '';
    return (
      `Pipeline step: '${stepName}' (type=shell)\n\n` +
      `Run these commands in sequence:\n${cmds}\n\n` +
      buildShellUpdateBlock(stepName, nextOk, nextFail)
    );
  }
  const prompt = render(step.prompt || '', sharedState);
  const next = step.next || '';
  return (
    `Pipeline step: '${stepName}' (type=agent)\n\n` +
    `Execute the following prompt:\n---\n${prompt.trim()}\n---\n\n` +
    buildAgentUpdateBlock(stepName, next)
  );
}

function buildAgentUpdateBlock(stepName, next) {
  return (
    `After completing your response, advance the pipeline by running:\n\n` +
    `\`\`\`bash\n` +
    `python3 -c "\nimport json; from pathlib import Path\n` +
    `p = Path('.pipeline/state.json')\n` +
    `s = json.loads(p.read_text())\n` +
    `sess = s['SESSION_ID']\n` +
    `sess['completed_steps'].append('${stepName}')\n` +
    `sess['current_step'] = '${next}'\n` +
    `sess.setdefault('visit_counts', {})\n` +
    `sess['visit_counts']['${stepName}'] = sess['visit_counts'].get('${stepName}', 0) + 1\n` +
    `sess['shared_state']['${stepName}_output'] = 'REPLACE_WITH_ONE_LINE_SUMMARY'\n` +
    `p.write_text(json.dumps(s, indent=2))\n` +
    `"\n\`\`\``
  );
}

function buildShellUpdateBlock(stepName, next, nextFail) {
  const base =
    `import json; from pathlib import Path\n` +
    `p = Path('.pipeline/state.json')\n` +
    `s = json.loads(p.read_text())\n` +
    `sess = s['SESSION_ID']\n` +
    `sess['completed_steps'].append('${stepName}')\n` +
    `sess.setdefault('visit_counts', {})\n` +
    `sess['visit_counts']['${stepName}'] = sess['visit_counts'].get('${stepName}', 0) + 1\n`;
  const onSuccess = base + `sess['current_step'] = '${next}'\np.write_text(json.dumps(s, indent=2))\n`;
  const onFail = nextFail
    ? base + `sess['current_step'] = '${nextFail}'\np.write_text(json.dumps(s, indent=2))\n`
    : base + `sess['mode'] = 'free'\np.write_text(json.dumps(s, indent=2))\n`;
  return (
    `If ALL commands exit 0, run:\n\`\`\`bash\npython3 -c "${onSuccess}"\`\`\`\n\n` +
    `If ANY command fails, run:\n\`\`\`bash\npython3 -c "${onFail}"\`\`\``
  );
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  let data;
  try { data = JSON.parse(raw); } catch { process.exit(0); }

  const prompt = (data.prompt || '').trim();
  if (!prompt.startsWith('/run-pipeline')) process.exit(0);

  const sessionId = data.session_id || 'unknown';
  const args = prompt.slice('/run-pipeline'.length).trim();
  const pipelineFile = args.endsWith('.yaml') ? args : '.pipeline/pipeline.yaml';
  const pipelinePath = path.join(PROJECT_ROOT, pipelineFile);

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

  const sessionState = {
    mode: 'pipeline',
    pipeline: pipelineFile,
    current_step: config.entry,
    completed_steps: [],
    visit_counts: {},
    shared_state: {},
  };
  setSessionState(sessionId, sessionState);

  const entryStep = config.steps[config.entry];
  const stepPrompt = buildStepPrompt(config.entry, entryStep, {})
    .replace(/SESSION_ID/g, sessionId);

  process.stdout.write(
    `Pipeline initialized from '${pipelineFile}'. Entry: '${config.entry}'.\n\n` +
    stepPrompt + '\n'
  );
  process.exit(0);
});
```

- [ ] **Step 2: Verify syntax**

```bash
node --check .claude/hooks/trigger_pipeline.js && echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Smoke-test with mock input**

```bash
echo '{"hook_event_name":"UserPromptSubmit","session_id":"test123","prompt":"/run-pipeline"}' \
  | node .claude/hooks/trigger_pipeline.js
```

Expected: output containing `Pipeline initialized` and `Pipeline step: 'plan'`

- [ ] **Step 4: Commit**

```bash
git add .claude/hooks/trigger_pipeline.js
git commit -m "feat: add trigger_pipeline UserPromptSubmit hook"
```

---

### Task 3: Update `check_pipeline.js`

Replace the old single-file state with the new `state.json` format (keyed by session ID). Inject both the step prompt and the Python state-update command so Claude knows exactly what to do.

**Files:**
- Modify: `.claude/hooks/check_pipeline.js`

- [ ] **Step 1: Rewrite the file**

```js
#!/usr/bin/env node
'use strict';

const { parseYAML, render, getSessionState, PROJECT_ROOT } = require('./pipeline_utils.js');
const fs = require('fs');
const path = require('path');

function buildAgentUpdateBlock(sessionId, stepName, next) {
  return (
    `After completing your response, advance the pipeline by running:\n\n` +
    `\`\`\`bash\n` +
    `python3 -c "\nimport json; from pathlib import Path\n` +
    `p = Path('.pipeline/state.json')\n` +
    `s = json.loads(p.read_text())\n` +
    `sess = s['${sessionId}']\n` +
    `sess['completed_steps'].append('${stepName}')\n` +
    `sess['current_step'] = '${next}'\n` +
    `sess.setdefault('visit_counts', {})\n` +
    `sess['visit_counts']['${stepName}'] = sess['visit_counts'].get('${stepName}', 0) + 1\n` +
    `sess['shared_state']['${stepName}_output'] = 'REPLACE_WITH_ONE_LINE_SUMMARY'\n` +
    `p.write_text(json.dumps(s, indent=2))\n` +
    `"\n\`\`\``
  );
}

function buildShellUpdateBlock(sessionId, stepName, next, nextFail) {
  const base =
    `import json; from pathlib import Path\n` +
    `p = Path('.pipeline/state.json')\n` +
    `s = json.loads(p.read_text())\n` +
    `sess = s['${sessionId}']\n` +
    `sess['completed_steps'].append('${stepName}')\n` +
    `sess.setdefault('visit_counts', {})\n` +
    `sess['visit_counts']['${stepName}'] = sess['visit_counts'].get('${stepName}', 0) + 1\n`;
  const onSuccess = base + `sess['current_step'] = '${next}'\np.write_text(json.dumps(s, indent=2))\n`;
  const onFail = nextFail
    ? base + `sess['current_step'] = '${nextFail}'\np.write_text(json.dumps(s, indent=2))\n`
    : base + `sess['mode'] = 'free'\np.write_text(json.dumps(s, indent=2))\n`;
  return (
    `If ALL commands exit 0, run:\n\`\`\`bash\npython3 -c "${onSuccess}"\`\`\`\n\n` +
    `If ANY command fails, run:\n\`\`\`bash\npython3 -c "${onFail}"\`\`\``
  );
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  let data;
  try { data = JSON.parse(raw); } catch { process.exit(0); }

  const sessionId = data.session_id || '';
  if (!sessionId) process.exit(0);

  const state = getSessionState(sessionId);
  if (!state || state.mode !== 'pipeline') process.exit(0);

  const pipelinePath = path.join(PROJECT_ROOT, state.pipeline || '.pipeline/pipeline.yaml');
  if (!fs.existsSync(pipelinePath)) process.exit(0);

  let config;
  try { config = parseYAML(fs.readFileSync(pipelinePath, 'utf8')); } catch { process.exit(0); }

  const current = state.current_step || '';
  const step = (config.steps || {})[current] || null;
  if (!step) process.exit(0);

  if (step.terminal) {
    // Mark pipeline complete
    const { setSessionState } = require('./pipeline_utils.js');
    state.mode = 'free';
    setSessionState(sessionId, state);
    process.exit(0);
  }

  // Check max_visits
  const visits = (state.visit_counts || {})[current] || 0;
  if (step.max_visits && visits >= step.max_visits) {
    process.stdout.write(
      `Pipeline error: step '${current}' has reached max_visits (${step.max_visits}). Pipeline halted.\n`
    );
    process.exit(2);
  }

  const sharedState = state.shared_state || {};
  const prompt = render(step.prompt || '', sharedState);
  const stepType = step.type || 'agent';

  let output;
  if (stepType === 'shell') {
    const cmds = (step.commands || []).map(c => `  ${c}`).join('\n');
    output =
      `Pipeline active — current step: '${current}' (type=shell).\n\n` +
      `Run these commands in sequence:\n${cmds}\n\n` +
      buildShellUpdateBlock(sessionId, current, step.next || '', step.next_fail || '');
  } else {
    output =
      `Pipeline active — current step: '${current}' (type=agent).\n\n` +
      `Execute the following prompt:\n---\n${prompt.trim()}\n---\n\n` +
      buildAgentUpdateBlock(sessionId, current, step.next || '');
  }

  process.stdout.write(output + '\n');
  process.exit(2);
});
```

- [ ] **Step 2: Verify syntax**

```bash
node --check .claude/hooks/check_pipeline.js && echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Smoke-test with mock state**

```bash
# Create test state
mkdir -p .pipeline
echo '{"test123":{"mode":"pipeline","pipeline":".pipeline/pipeline.yaml","current_step":"plan","completed_steps":[],"visit_counts":{},"shared_state":{}}}' \
  > .pipeline/state.json

echo '{"hook_event_name":"Stop","session_id":"test123"}' \
  | node .claude/hooks/check_pipeline.js; echo "exit: $?"
```

Expected: output containing `Pipeline active` and `Execute the following prompt`, exit code `2`

- [ ] **Step 4: Commit**

```bash
git add .claude/hooks/check_pipeline.js
git commit -m "refactor: update check_pipeline to use state.json keyed by session"
```

---

### Task 4: Update `settings.json` and remove `start_pipeline.js`

Wire `trigger_pipeline.js` into UserPromptSubmit. Remove the now-obsolete `SessionStart` hook.

**Files:**
- Modify: `.claude/settings.json`
- Delete: `.claude/hooks/start_pipeline.js`

- [ ] **Step 1: Update `settings.json`**

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/check_pipeline.js"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/trigger_pipeline.js"
          },
          {
            "type": "command",
            "command": "node .claude/hooks/logger.js"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Delete `start_pipeline.js`**

```bash
git rm .claude/hooks/start_pipeline.js
```

- [ ] **Step 3: Commit**

```bash
git add .claude/settings.json
git commit -m "chore: wire trigger_pipeline hook, remove obsolete SessionStart hook"
```

---

### Task 5: Update `examples/pipeline.yaml`

Align routing fields with the new convention (`next`/`next_fail`).

**Files:**
- Modify: `examples/pipeline.yaml`

- [ ] **Step 1: Read and update the file**

Replace all `on_pass:` with `next:` and all `on_fail:` with `next_fail:`. Remove any `{{requirement}}` placeholders.

- [ ] **Step 2: Verify the YAML parses correctly**

```bash
node -e "
const {parseYAML} = require('./.claude/hooks/pipeline_utils.js');
const fs = require('fs');
const c = parseYAML(fs.readFileSync('examples/pipeline.yaml','utf8'));
console.log('entry:', c.entry);
console.log('steps:', Object.keys(c.steps).join(', '));
"
```

Expected: prints entry step name and all step names without error.

- [ ] **Step 3: Commit**

```bash
git add examples/pipeline.yaml
git commit -m "chore: update examples/pipeline.yaml to use next/next_fail routing"
```
