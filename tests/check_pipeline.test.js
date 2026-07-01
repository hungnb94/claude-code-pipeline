const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const path = require('path');

const {
  PROJECT_ROOT,
  setSessionState,
  cleanupSession,
  createSessionState,
  readSessionState,
} = require('./helpers');

const HOOK = path.join(PROJECT_ROOT, 'hooks/check_pipeline.js');

function runHook(sessionId) {
  const input = JSON.stringify({ session_id: sessionId });
  return spawnSync('node', [HOOK], {
    input,
    encoding: 'utf8',
    cwd: PROJECT_ROOT,
    env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT_ROOT },
  });
}

function runHookAndBlock(sessionId) {
  const result = runHook(sessionId);
  expect(result.status).toBe(0);
  const payload = JSON.parse(result.stdout);
  expect(payload.decision).toBe('block');
  return payload;
}

describe('check_pipeline.js', () => {
  let SESSION_ID;

  beforeEach(() => {
    SESSION_ID = randomUUID();
  });
  afterEach(() => {
    cleanupSession(SESSION_ID);
  });

  it('exits 0 and writes nothing when session has no state', () => {
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('exits 0 when session mode is free', () => {
    setSessionState(SESSION_ID, createSessionState({ mode: 'free' }));
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('blocks stop and injects agent step prompt when pipeline is active', () => {
    setSessionState(SESSION_ID, createSessionState());
    const payload = runHookAndBlock(SESSION_ID);
    expect(payload.reason).toContain("Pipeline step: 'plan' (type=agent)");
    expect(payload.reason).toContain(
      'Writing a step-by-step implementation plan.'
    );
    expect(payload.systemMessage).toContain(
      "Pipeline step: 'plan' (type=agent)"
    );
    expect(payload.systemMessage).toContain(
      'Writing a step-by-step implementation plan.'
    );
  });

  it('blocks stop and shows shell commands when current step is type=shell', () => {
    setSessionState(SESSION_ID, createSessionState({
      current_step: 'verify',
      completed_steps: ['plan', 'review_plan', 'implementation', 'docs'],
      visit_counts: { plan: 1, review_plan: 1, implementation: 1, docs: 1 },
    }));
    const payload = runHookAndBlock(SESSION_ID);
    expect(payload.reason).toContain("Pipeline step: 'verify' (type=shell)");
    expect(payload.reason).toContain('npm test');
    expect(payload.systemMessage).toContain('npm test');
  });

  it('auto-marks step as succeeded and advances to next when max_visits is reached', () => {
    setSessionState(SESSION_ID, createSessionState({
      current_step: 'verify',
      visit_counts: { verify: 9 },
    }));
    const payload = runHookAndBlock(SESSION_ID);
    expect(payload.reason).toContain('max_visits');
    expect(payload.reason).toContain("advancing to 'lint'");
    expect(payload.reason).toContain("Pipeline step: 'lint' (type=shell)");
    expect(payload.systemMessage).toContain("advancing to 'lint'");

    const state = readSessionState(SESSION_ID);
    expect(state.current_step).toBe('lint');
    expect(state.completed_steps).toContain('verify');
  });

  it('ends the pipeline (mode=free) when a maxed-out step has no next', () => {
    setSessionState(SESSION_ID, createSessionState({
      pipeline: 'tests/fixtures/max-visits-no-next.yaml',
      current_step: 'maxed_no_next',
      visit_counts: { maxed_no_next: 5 },
    }));
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');

    const state = readSessionState(SESSION_ID);
    expect(state.mode).toBe('free');
    expect(state.completed_steps).toContain('maxed_no_next');
  });

  it('halts with a cycle error instead of hanging when maxed-out steps point at each other', () => {
    setSessionState(SESSION_ID, createSessionState({
      pipeline: 'tests/fixtures/max-visits-cycle.yaml',
      current_step: 'a',
      visit_counts: { a: 5, b: 5 },
    }));
    const payload = runHookAndBlock(SESSION_ID);
    expect(payload.reason).toContain('cycle detected');
    expect(payload.systemMessage).toContain('cycle detected');

    const state = readSessionState(SESSION_ID);
    expect(state.mode).toBe('free');
  });

  it('exits 0 and sets mode=free when current step has terminal:true', () => {
    setSessionState(SESSION_ID, createSessionState({
      pipeline: 'tests/fixtures/terminal-step.yaml',
      current_step: 'done',
    }));
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  describe('with examples/pipeline.yaml and clarify shared state', () => {
    beforeEach(() => {
      setSessionState(SESSION_ID, createSessionState({
        pipeline: 'examples/pipeline.yaml',
        completed_steps: ['clarify'],
        visit_counts: { clarify: 1 },
        shared_state: { clarify_output: 'use postgres for storage' },
      }));
    });

    it('interpolates {{step_output}} placeholders in agent prompt', () => {
      const payload = runHookAndBlock(SESSION_ID);
      expect(payload.reason).toContain('use postgres for storage');
    });

    it('renders template variables and does not emit raw tokens', () => {
      const payload = runHookAndBlock(SESSION_ID);
      expect(payload.reason).toContain('use postgres for storage');
      expect(payload.reason).not.toContain('{{clarify_output}}');
    });
  });

  it('writes full agent step output to reason', () => {
    setSessionState(SESSION_ID, createSessionState());
    const payload = runHookAndBlock(SESSION_ID);
    expect(payload.reason).toContain('Execute the following prompt:');
    expect(payload.reason).toContain('Writing a step-by-step implementation plan.');
  });

  it('writes full shell step output to reason', () => {
    setSessionState(SESSION_ID, createSessionState({ current_step: 'verify' }));
    const payload = runHookAndBlock(SESSION_ID);
    expect(payload.reason).toContain('Run these commands in sequence:');
    expect(payload.reason).toContain('npm test');
  });

  it('does not leak the state-update python block into systemMessage', () => {
    setSessionState(SESSION_ID, createSessionState());
    const payload = runHookAndBlock(SESSION_ID);
    expect(payload.systemMessage).not.toContain('python3');
  });

  it('exits 0 silently when pipeline file does not exist', () => {
    setSessionState(SESSION_ID, createSessionState({ pipeline: 'nonexistent/pipeline.yaml' }));
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });
});
