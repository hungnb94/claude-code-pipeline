const path = require('path');
const { PROJECT_ROOT, setSessionState, cleanupSession, createSessionState, spawnSync, randomUUID } = require('./helpers');

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

  it('exits 2 and injects agent step prompt when pipeline is active', () => {
    setSessionState(SESSION_ID, createSessionState());
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('🔄 plan');
    expect(result.stderr).toContain(
      "Pipeline step: 'plan' (type=agent)"
    );
    expect(result.stderr).toContain(
      'Write a step-by-step implementation plan for the following requirements:'
    );
  });

  it('exits 2 and shows shell commands when current step is type=shell', () => {
    setSessionState(SESSION_ID, createSessionState({
      current_step: 'verify',
      completed_steps: ['plan', 'review_plan', 'implementation', 'docs'],
      visit_counts: { plan: 1, review_plan: 1, implementation: 1, docs: 1 },
    }));
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      '✅ plan → ✅ review_plan → ✅ implementation → ✅ docs → 🔄 verify'
    );
    expect(result.stderr).toContain(
      "Pipeline step: 'verify' (type=shell)"
    );
    expect(result.stderr).toContain('npm test');
  });

  it('exits 2 with error when step visit count reaches max_visits', () => {
    setSessionState(SESSION_ID, createSessionState({
      current_step: 'verify',
      visit_counts: { verify: 9 },
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
        completed_steps: ['clarify'],
        visit_counts: { clarify: 1 },
        shared_state: { clarify_output: 'use postgres for storage' },
      }));
    });

    it('interpolates {{step_output}} placeholders in agent prompt', () => {
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
    expect(result.stderr).toContain('Write a step-by-step implementation plan for the following requirements:');
  });

  it('writes full shell step output to stderr', () => {
    setSessionState(SESSION_ID, createSessionState({ current_step: 'verify' }));
    const result = runHook(SESSION_ID);
    expect(result.stderr).toContain('Run these commands in sequence:');
    expect(result.stderr).toContain('npm test');
  });

  it('exits 0 silently when pipeline file does not exist', () => {
    setSessionState(SESSION_ID, createSessionState({ pipeline: 'nonexistent/pipeline.yaml' }));
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('exits 0 silently when current step is type=interview', () => {
    setSessionState(SESSION_ID, createSessionState({
      pipeline: 'tests/fixtures/interview-entry.yaml',
      current_step: 'gather_requirements',
    }));
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('exits 2 and injects next step after requirements are locked', () => {
    setSessionState(SESSION_ID, createSessionState({
      pipeline: 'tests/fixtures/interview-entry.yaml',
      current_step: 'plan',
      completed_steps: ['gather_requirements'],
      shared_state: { requirements_locked: 'true', user_requirements: 'Build a todo app' },
    }));
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('(type=agent)');
  });
});
