# trigger_pipeline Unit Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Jest test suite that verifies `trigger_pipeline.js` correctly initializes pipeline state, produces the right stdout, and exits with the right code for all 8 scenarios.

**Architecture:** Black-box subprocess testing — each test pipes a JSON payload to `node .claude/hooks/trigger_pipeline.js` via stdin and asserts on stdout, exit code, and `.pipeline/state.json`. No production code is modified. Fixtures are static YAML files in `tests/fixtures/`. State written during tests is keyed by `crypto.randomUUID()` session IDs and cleaned up in `afterEach`.

**Tech Stack:** Jest 29, Node.js 22 built-ins (`child_process.spawnSync`, `crypto`, `fs`, `path`)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `package.json` | Jest dependency + test script |
| Modify | `.gitignore` | Exclude `node_modules/` and `package-lock.json` |
| Create | `tests/fixtures/missing-entry.yaml` | YAML with `steps` but no `entry` |
| Create | `tests/fixtures/missing-steps.yaml` | YAML with `entry` but no `steps` |
| Create | `tests/fixtures/bad-entry-ref.yaml` | YAML where `entry` names a step not in `steps` |
| Create | `tests/trigger_pipeline.test.js` | All 8 test cases + helpers |

---

## Task 1: Initialize Jest

**Files:**
- Create: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "claude-code-pipeline",
  "version": "1.0.0",
  "scripts": {
    "test": "jest"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  },
  "jest": {
    "testEnvironment": "node",
    "testMatch": ["**/tests/**/*.test.js"]
  }
}
```

- [ ] **Step 2: Add node_modules to .gitignore**

Append to `.gitignore` (create if it doesn't exist):

```
node_modules/
package-lock.json
```

- [ ] **Step 3: Install Jest**

```bash
npm install
```

Expected: `node_modules/` created, `package-lock.json` written, no errors.

- [ ] **Step 4: Verify Jest runs**

```bash
npx jest --listTests
```

Expected: empty list (no test files yet) with exit code 0.

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: add Jest for unit testing"
```

---

## Task 2: Create YAML Fixtures

**Files:**
- Create: `tests/fixtures/missing-entry.yaml`
- Create: `tests/fixtures/missing-steps.yaml`
- Create: `tests/fixtures/bad-entry-ref.yaml`

- [ ] **Step 1: Create tests/fixtures/missing-entry.yaml**

```yaml
steps:
  foo:
    type: agent
    prompt: |
      Hello world.
```

- [ ] **Step 2: Create tests/fixtures/missing-steps.yaml**

```yaml
entry: foo
```

- [ ] **Step 3: Create tests/fixtures/bad-entry-ref.yaml**

```yaml
entry: nonexistent

steps:
  foo:
    type: agent
    prompt: |
      Hello world.
```

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/
git commit -m "test: add YAML fixture files for trigger_pipeline tests"
```

---

## Task 3: Write all tests

**Files:**
- Create: `tests/trigger_pipeline.test.js`

- [ ] **Step 1: Create tests/trigger_pipeline.test.js with all 8 tests**

```js
'use strict';

const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(PROJECT_ROOT, '.claude/hooks/trigger_pipeline.js');
const STATE_PATH = path.join(PROJECT_ROOT, '.pipeline/state.json');

function runHook(prompt, sessionId) {
  const input = JSON.stringify({
    hook_event_name: 'UserPromptSubmit',
    session_id: sessionId,
    prompt,
  });
  return spawnSync('node', [HOOK], {
    input,
    encoding: 'utf8',
    cwd: PROJECT_ROOT,
  });
}

function readSessionState(sessionId) {
  if (!fs.existsSync(STATE_PATH)) return null;
  try {
    const all = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return all[sessionId] || null;
  } catch {
    return null;
  }
}

function cleanupSession(sessionId) {
  if (!fs.existsSync(STATE_PATH)) return;
  try {
    const all = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    delete all[sessionId];
    fs.writeFileSync(STATE_PATH, JSON.stringify(all, null, 2));
  } catch {}
}

describe('trigger_pipeline.js', () => {
  let SESSION_ID;

  beforeEach(() => {
    SESSION_ID = randomUUID();
  });

  afterEach(() => {
    cleanupSession(SESSION_ID);
  });

  // ── Test 1: exit-early ───────────────────────────────────────────────────
  it('exits 0 and writes nothing when prompt is not /run-pipeline', () => {
    const result = runHook('hello world', SESSION_ID);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(readSessionState(SESSION_ID)).toBeNull();
  });

  // ── Test 2: missing file ─────────────────────────────────────────────────
  it('exits 1 with error message when pipeline file does not exist', () => {
    const result = runHook('/run-pipeline nonexistent.yaml', SESSION_ID);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Pipeline file not found');
    expect(readSessionState(SESSION_ID)).toBeNull();
  });

  // ── Test 3: path traversal ───────────────────────────────────────────────
  it('exits 1 with error message on path traversal attempt', () => {
    const result = runHook('/run-pipeline ../../../etc/passwd.yaml', SESSION_ID);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Pipeline file must be within the project root');
    expect(readSessionState(SESSION_ID)).toBeNull();
  });

  // ── Test 4: missing entry field ──────────────────────────────────────────
  it('exits 1 when YAML is missing the entry field', () => {
    const result = runHook('/run-pipeline tests/fixtures/missing-entry.yaml', SESSION_ID);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Invalid pipeline: missing 'entry' or 'steps'");
    expect(readSessionState(SESSION_ID)).toBeNull();
  });

  // ── Test 5: missing steps field ──────────────────────────────────────────
  it('exits 1 when YAML is missing the steps field', () => {
    const result = runHook('/run-pipeline tests/fixtures/missing-steps.yaml', SESSION_ID);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Invalid pipeline: missing 'entry' or 'steps'");
    expect(readSessionState(SESSION_ID)).toBeNull();
  });

  // ── Test 6: bad entry reference ──────────────────────────────────────────
  it('exits 1 when entry step name is not defined in steps', () => {
    const result = runHook('/run-pipeline tests/fixtures/bad-entry-ref.yaml', SESSION_ID);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Entry step 'nonexistent' not found in steps");
    expect(readSessionState(SESSION_ID)).toBeNull();
  });

  // ── Test 7: happy path — default YAML ───────────────────────────────────
  it('exits 0, initializes state, and prints step prompt when using default pipeline', () => {
    const result = runHook('/run-pipeline', SESSION_ID);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Pipeline initialized from '.pipeline/pipeline.yaml'");
    expect(result.stdout).toContain("Pipeline step: 'plan'");

    const state = readSessionState(SESSION_ID);
    expect(state).not.toBeNull();
    expect(state.mode).toBe('pipeline');
    expect(state.pipeline).toBe('.pipeline/pipeline.yaml');
    expect(state.current_step).toBe('plan');
    expect(state.completed_steps).toEqual([]);
    expect(state.shared_state).toEqual({});
  });

  // ── Test 8: happy path — explicit YAML ──────────────────────────────────
  it('exits 0, initializes state, and prints step prompt when given explicit yaml path', () => {
    const result = runHook('/run-pipeline examples/pipeline.yaml', SESSION_ID);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Pipeline initialized from 'examples/pipeline.yaml'");
    expect(result.stdout).toContain("Pipeline step: 'clarify'");

    const state = readSessionState(SESSION_ID);
    expect(state).not.toBeNull();
    expect(state.mode).toBe('pipeline');
    expect(state.pipeline).toBe('examples/pipeline.yaml');
    expect(state.current_step).toBe('clarify');
    expect(state.completed_steps).toEqual([]);
    expect(state.shared_state).toEqual({});
  });
});
```

- [ ] **Step 2: Run the full test suite**

```bash
npx jest tests/trigger_pipeline.test.js --verbose
```

Expected output:
```
✓ exits 0 and writes nothing when prompt is not /run-pipeline
✓ exits 1 with error message when pipeline file does not exist
✓ exits 1 with error message on path traversal attempt
✓ exits 1 when YAML is missing the entry field
✓ exits 1 when YAML is missing the steps field
✓ exits 1 when entry step name is not defined in steps
✓ exits 0, initializes state, and prints step prompt when using default pipeline
✓ exits 0, initializes state, and prints step prompt when given explicit yaml path

Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
```

**If a test fails:**
- Tests 1–6 fail → check the exact error/exit strings in `trigger_pipeline.js:37–68`
- Test 7 fails on stdout → `trigger_pipeline.js:81` has the "Pipeline initialized" message; verify entry step name matches `.pipeline/pipeline.yaml`
- Test 8 fails on stdout → verify entry step name matches `examples/pipeline.yaml` (`clarify`)
- Either happy path fails on state → `pipeline_utils.js:105–108` is `setSessionState`; check write path

- [ ] **Step 3: Commit**

```bash
git add tests/trigger_pipeline.test.js
git commit -m "test: add 8 unit tests for trigger_pipeline — all passing"
```
