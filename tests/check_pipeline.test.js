const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const path = require('path');

const {
  PROJECT_ROOT,
  setSessionState,
  cleanupSession,
  createSessionState,
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

  it('exits 2 and injects next agent step prompt when pipeline is active', () => {
    // current_step='plan' (agent). Hook marks plan done, advances to review_plan, injects review_plan prompt.
    setSessionState(SESSION_ID, createSessionState());
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('✅ plan → 🔄 review_plan');
    expect(result.stderr).toContain('review_plan');
    expect(result.stderr).toContain('Pipeline active');
  });

  it('exits 2 with error when step visit count reaches max_visits', () => {
    // fix_lint is an agent step with max_visits=9
    setSessionState(SESSION_ID, createSessionState({
      current_step: 'fix_lint',
      visit_counts: { fix_lint: 9 },
    }));
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('max_visits');
    expect(result.stderr).toContain('Pipeline error');
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
        current_step: 'clarify',
        completed_steps: [],
        visit_counts: {},
        shared_state: { clarify_output: 'use postgres for storage' },
      }));
    });

    it('interpolates {{step_output}} placeholders in next agent prompt', () => {
      // clarify (agent) -> plan (agent, uses {{clarify_output}})
      const result = runHook(SESSION_ID);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('use postgres for storage');
      expect(result.stderr).toContain('✅ clarify → 🔄 plan');
    });

    it('renders template variables and does not emit raw tokens', () => {
      const result = runHook(SESSION_ID);
      expect(result.stderr).toContain('use postgres for storage');
      expect(result.stderr).not.toContain('{{clarify_output}}');
    });
  });

  it('writes full agent step output to stderr', () => {
    setSessionState(SESSION_ID, createSessionState());
    const result = runHook(SESSION_ID);
    expect(result.stderr).toContain('Execute the following prompt:');
  });

  it('exits 0 silently when pipeline file does not exist', () => {
    setSessionState(SESSION_ID, createSessionState({ pipeline: 'nonexistent/pipeline.yaml' }));
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  describe('shell step chaining', () => {
    it('executes shell step and injects next agent step when shell succeeds', () => {
      // start (agent) -> check (shell, `true`) -> finish (agent)
      setSessionState(SESSION_ID, createSessionState({
        pipeline: 'tests/fixtures/shell-chain.yaml',
        current_step: 'start',
        completed_steps: [],
        visit_counts: {},
        shared_state: {},
      }));
      const result = runHook(SESSION_ID);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('✅ start → ✅ check → 🔄 finish');
      expect(result.stderr).toContain('Finished successfully');
    });

    it('executes shell step and injects fail_step agent prompt when shell fails', () => {
      // start (agent) -> check (shell, `false`) -> fail_step (agent)
      setSessionState(SESSION_ID, createSessionState({
        pipeline: 'tests/fixtures/shell-chain-fail.yaml',
        current_step: 'start',
        completed_steps: [],
        visit_counts: {},
        shared_state: {},
      }));
      const result = runHook(SESSION_ID);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('✅ start → ✅ check → 🔄 fail_step');
      expect(result.stderr).toContain('Shell step failed');
    });

    it('exits 2 with error when shell step reaches max_visits', () => {
      // verify has max_visits=9; if visit_counts.verify=9 when chaining through it, halt
      setSessionState(SESSION_ID, createSessionState({
        current_step: 'docs',
        completed_steps: ['plan', 'review_plan', 'implementation'],
        visit_counts: { plan: 1, review_plan: 1, implementation: 1, verify: 9 },
        shared_state: {},
      }));
      const result = runHook(SESSION_ID);
      // docs (agent) -> verify (shell, max_visits=9, visits=9) -> halt
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('Pipeline error');
      expect(result.stderr).toContain('max_visits');
    });
  });
});
