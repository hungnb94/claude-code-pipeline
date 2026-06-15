const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(PROJECT_ROOT, 'hooks/trigger_pipeline.js');
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
    env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT_ROOT },
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
  } catch (err) {
    console.error('cleanupSession failed:', err);
  }
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
  it('exits 0 and writes nothing when prompt is not /pipeline:run', () => {
    const result = runHook('hello world', SESSION_ID);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(readSessionState(SESSION_ID)).toBeNull();
  });

  // ── Test 2: missing file ─────────────────────────────────────────────────
  it('exits 1 with error message when pipeline file does not exist', () => {
    const result = runHook('/pipeline:run nonexistent.yaml', SESSION_ID);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Pipeline file not found');
    expect(readSessionState(SESSION_ID)).toBeNull();
  });

  // ── Test 3: path traversal ───────────────────────────────────────────────
  it('exits 1 with error message on path traversal attempt', () => {
    const result = runHook('/pipeline:run ../../../etc/passwd.yaml', SESSION_ID);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Pipeline file must be within the project root');
    expect(readSessionState(SESSION_ID)).toBeNull();
  });

  // ── Test 4: missing entry field ──────────────────────────────────────────
  it('exits 1 when YAML is missing the entry field', () => {
    const result = runHook('/pipeline:run tests/fixtures/missing-entry.yaml', SESSION_ID);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Invalid pipeline: missing 'entry' or 'steps'");
    expect(readSessionState(SESSION_ID)).toBeNull();
  });

  // ── Test 5: missing steps field ──────────────────────────────────────────
  it('exits 1 when YAML is missing the steps field', () => {
    const result = runHook('/pipeline:run tests/fixtures/missing-steps.yaml', SESSION_ID);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Invalid pipeline: missing 'entry' or 'steps'");
    expect(readSessionState(SESSION_ID)).toBeNull();
  });

  // ── Test 6: bad entry reference ──────────────────────────────────────────
  it('exits 1 when entry step name is not defined in steps', () => {
    const result = runHook('/pipeline:run tests/fixtures/bad-entry-ref.yaml', SESSION_ID);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Entry step 'nonexistent' not found in steps");
    expect(readSessionState(SESSION_ID)).toBeNull();
  });

  // ── Test 7: happy path — default YAML ───────────────────────────────────
  it('exits 0, initializes state, and prints step prompt when using default pipeline', () => {
    const result = runHook('/pipeline:run', SESSION_ID);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Pipeline initialized from '.pipeline/pipeline.yaml'");
    expect(result.stdout).toContain("Pipeline step: 'plan'");
    expect(result.stdout).toContain('🔄 plan');

    const state = readSessionState(SESSION_ID);
    expect(state).not.toBeNull();
    expect(state.mode).toBe('pipeline');
    expect(state.pipeline).toBe('.pipeline/pipeline.yaml');
    expect(state.current_step).toBe('plan');
    expect(state.completed_steps).toEqual([]);
    expect(state.shared_state).toEqual({ user_requirements: '' });
    expect(state.visit_counts).toEqual({});
  });

  // ── Test 8: happy path — explicit YAML ──────────────────────────────────
  it('exits 0, initializes state, and prints step prompt when given explicit yaml path', () => {
    const result = runHook('/pipeline:run examples/pipeline.yaml', SESSION_ID);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Pipeline initialized from 'examples/pipeline.yaml'");
    expect(result.stdout).toContain("Pipeline step: 'clarify'");
    expect(result.stdout).toContain('🔄 clarify');

    const state = readSessionState(SESSION_ID);
    expect(state).not.toBeNull();
    expect(state.mode).toBe('pipeline');
    expect(state.pipeline).toBe('examples/pipeline.yaml');
    expect(state.current_step).toBe('clarify');
    expect(state.completed_steps).toEqual([]);
    expect(state.shared_state).toEqual({ user_requirements: '' });
    expect(state.visit_counts).toEqual({});
  });

  // ── Test 9: inline requirements, no explicit path ────────────────────────
  it('stores inline requirements in shared_state when no yaml path given', () => {
    const result = runHook('/pipeline:run Add authentication to the app', SESSION_ID);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Pipeline initialized from '.pipeline/pipeline.yaml'");

    const state = readSessionState(SESSION_ID);
    expect(state.shared_state).toEqual({ user_requirements: 'Add authentication to the app' });
  });

  // ── Test 10: inline requirements with explicit yaml path ─────────────────
  it('stores inline requirements in shared_state when explicit yaml path given', () => {
    const result = runHook('/pipeline:run examples/pipeline.yaml Add authentication to the app', SESSION_ID);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Pipeline initialized from 'examples/pipeline.yaml'");

    const state = readSessionState(SESSION_ID);
    expect(state.pipeline).toBe('examples/pipeline.yaml');
    expect(state.shared_state).toEqual({ user_requirements: 'Add authentication to the app' });
  });
});
