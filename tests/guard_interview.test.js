const {
  spawnSync,
  randomUUID,
  PROJECT_ROOT,
  setSessionState,
  cleanupSession,
  createSessionState,
} = require('./helpers');
const path = require('path');

const HOOK = path.join(PROJECT_ROOT, 'hooks/guard_interview.js');

function runGuard(sessionId, toolName) {
  const input = JSON.stringify({ session_id: sessionId, tool_name: toolName });
  return spawnSync('node', [HOOK], {
    input,
    encoding: 'utf8',
    cwd: PROJECT_ROOT,
    env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT_ROOT },
  });
}

describe('guard_interview.js', () => {
  let SESSION_ID;

  beforeEach(() => {
    SESSION_ID = randomUUID();
  });
  afterEach(() => {
    cleanupSession(SESSION_ID);
  });

  it('exits 0 when no pipeline is active', () => {
    const result = runGuard(SESSION_ID, 'Edit');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('exits 0 when entry step is not type=interview', () => {
    setSessionState(
      SESSION_ID,
      createSessionState({ pipeline: 'examples/pipeline.yaml' })
    );
    const result = runGuard(SESSION_ID, 'Edit');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('exits 0 when requirements are already locked', () => {
    setSessionState(
      SESSION_ID,
      createSessionState({
        pipeline: 'tests/fixtures/interview-entry.yaml',
        current_step: 'plan',
        shared_state: { requirements_locked: 'true' },
      })
    );
    const result = runGuard(SESSION_ID, 'Edit');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('blocks Edit when requirements are not locked', () => {
    setSessionState(
      SESSION_ID,
      createSessionState({
        pipeline: 'tests/fixtures/interview-entry.yaml',
        current_step: 'gather_requirements',
        shared_state: {},
      })
    );
    const result = runGuard(SESSION_ID, 'Edit');
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out.decision).toBe('block');
    expect(result.stderr).toContain('blocked');
  });

  it('blocks Write when requirements are not locked', () => {
    setSessionState(
      SESSION_ID,
      createSessionState({
        pipeline: 'tests/fixtures/interview-entry.yaml',
        current_step: 'gather_requirements',
        shared_state: {},
      })
    );
    const result = runGuard(SESSION_ID, 'Write');
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out.decision).toBe('block');
  });

  it('exits 0 silently (does not crash) when the pipeline file is missing', () => {
    setSessionState(
      SESSION_ID,
      createSessionState({ pipeline: 'nonexistent/pipeline.yaml' })
    );
    const result = runGuard(SESSION_ID, 'Edit');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('allows Bash when requirements are not locked', () => {
    setSessionState(
      SESSION_ID,
      createSessionState({
        pipeline: 'tests/fixtures/interview-entry.yaml',
        current_step: 'gather_requirements',
        shared_state: {},
      })
    );
    const result = runGuard(SESSION_ID, 'Bash');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });
});
