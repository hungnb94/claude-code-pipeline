const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');

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

function expectCycleHalt(sessionId, overrides) {
  setSessionState(sessionId, createSessionState(overrides));
  const payload = runHookAndBlock(sessionId);
  expect(payload.reason).toContain('cycle detected');
  expect(payload.systemMessage).toContain('cycle detected');

  const state = readSessionState(sessionId);
  expect(state.mode).toBe('free');
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
      'Write a step-by-step implementation plan for the following requirements:'
    );
    expect(payload.systemMessage).toContain(
      "Pipeline step: 'plan' (type=agent)"
    );
    expect(payload.systemMessage).toContain(
      'Write a step-by-step implementation plan for the following requirements:'
    );
  });

  it('executes a shell step via the hook and advances via the real exit code, without instructing Claude to run it', () => {
    setSessionState(
      SESSION_ID,
      createSessionState({
        pipeline: 'tests/fixtures/shell-steps.yaml',
        current_step: 'shell_fail',
      })
    );
    const payload = runHookAndBlock(SESSION_ID);
    // Landed on the failure path's agent step because the shell command exited non-zero.
    expect(payload.reason).toContain(
      "Pipeline step: 'agent_after_fail' (type=agent)"
    );
    // Claude is never shown the shell commands or asked to run/self-report them.
    expect(payload.reason).not.toContain('Run these commands in sequence');
    expect(payload.systemMessage).not.toContain(
      'Run these commands in sequence'
    );

    const state = readSessionState(SESSION_ID);
    expect(state.current_step).toBe('agent_after_fail');
    expect(state.completed_steps).toContain('shell_fail');
  });

  it('chains two consecutive shell steps in one invocation and lands on the agent step prompt', () => {
    setSessionState(
      SESSION_ID,
      createSessionState({
        pipeline: 'tests/fixtures/shell-steps.yaml',
        current_step: 'shell_a',
      })
    );
    const payload = runHookAndBlock(SESSION_ID);
    expect(payload.reason).toContain(
      "Pipeline step: 'agent_after' (type=agent)"
    );

    const state = readSessionState(SESSION_ID);
    expect(state.current_step).toBe('agent_after');
    expect(state.completed_steps).toEqual(
      expect.arrayContaining(['shell_a', 'shell_b'])
    );
  });

  it('captures shell step output into shared_state[<step>_output]', () => {
    setSessionState(
      SESSION_ID,
      createSessionState({
        pipeline: 'tests/fixtures/shell-steps.yaml',
        current_step: 'shell_fail',
      })
    );
    runHookAndBlock(SESSION_ID);

    const state = readSessionState(SESSION_ID);
    expect(state.shared_state.shell_fail_output).toContain('boom');
  });

  it('halts with a cycle error when shell steps loop with no max_visits set', () => {
    expectCycleHalt(SESSION_ID, {
      pipeline: 'tests/fixtures/shell-cycle-no-max-visits.yaml',
      current_step: 'x',
    });
  });

  it('auto-marks step as succeeded and advances to next when max_visits is reached', () => {
    setSessionState(
      SESSION_ID,
      createSessionState({
        pipeline: 'tests/fixtures/max-visits-skip-to-agent.yaml',
        current_step: 'verify_shell',
        visit_counts: { verify_shell: 9 },
      })
    );
    const payload = runHookAndBlock(SESSION_ID);
    expect(payload.reason).toContain('max_visits');
    expect(payload.reason).toContain("advancing to 'lint_step'");
    expect(payload.reason).toContain("Pipeline step: 'lint_step' (type=agent)");
    expect(payload.systemMessage).toContain("advancing to 'lint_step'");

    const state = readSessionState(SESSION_ID);
    expect(state.current_step).toBe('lint_step');
    expect(state.completed_steps).toContain('verify_shell');
  });

  it('ends the pipeline (mode=free) when a maxed-out step has no next', () => {
    setSessionState(
      SESSION_ID,
      createSessionState({
        pipeline: 'tests/fixtures/max-visits-no-next.yaml',
        current_step: 'maxed_no_next',
        visit_counts: { maxed_no_next: 5 },
      })
    );
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');

    const state = readSessionState(SESSION_ID);
    expect(state.mode).toBe('free');
    expect(state.completed_steps).toContain('maxed_no_next');
  });

  it('halts with a cycle error instead of hanging when maxed-out steps point at each other', () => {
    expectCycleHalt(SESSION_ID, {
      pipeline: 'tests/fixtures/max-visits-cycle.yaml',
      current_step: 'a',
      visit_counts: { a: 5, b: 5 },
    });
  });

  it('exits 0 and sets mode=free when current step has terminal:true', () => {
    setSessionState(
      SESSION_ID,
      createSessionState({
        pipeline: 'tests/fixtures/terminal-step.yaml',
        current_step: 'done',
      })
    );
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  describe('with examples/pipeline.yaml and clarify shared state', () => {
    beforeEach(() => {
      setSessionState(
        SESSION_ID,
        createSessionState({
          pipeline: 'examples/pipeline.yaml',
          completed_steps: ['clarify'],
          visit_counts: { clarify: 1 },
          shared_state: { clarify_output: 'use postgres for storage' },
        })
      );
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
    expect(payload.reason).toContain(
      'Write a step-by-step implementation plan for the following requirements:'
    );
  });

  it('shows the advance-script instruction (not a python block) for agent steps, and nothing at all for shell steps', () => {
    setSessionState(SESSION_ID, createSessionState());
    const payload = runHookAndBlock(SESSION_ID);
    expect(payload.reason).not.toContain('python3');
    expect(payload.reason).toContain('pipeline_advance.js');
    expect(payload.reason).toContain('--step plan');
    expect(payload.reason).toContain('--output');

    setSessionState(
      SESSION_ID,
      createSessionState({
        pipeline: 'tests/fixtures/shell-steps.yaml',
        current_step: 'shell_a',
      })
    );
    const shellPayload = runHookAndBlock(SESSION_ID);
    // Shell steps chain straight through to the next agent step — nothing
    // copy-paste-and-tamperable is ever shown for the shell steps themselves,
    // even though the agent step reached afterward still shows its own
    // advance instruction.
    expect(shellPayload.reason).not.toContain('Run these commands in sequence');
    expect(shellPayload.reason).not.toContain('exit 0');
    expect(shellPayload.reason).not.toContain('python3');
  });

  it('does not leak the state-update python block into systemMessage', () => {
    setSessionState(SESSION_ID, createSessionState());
    const payload = runHookAndBlock(SESSION_ID);
    expect(payload.systemMessage).not.toContain('python3');
  });

  it('blocks with a visible error and halts the pipeline when the pipeline file does not exist', () => {
    setSessionState(
      SESSION_ID,
      createSessionState({ pipeline: 'nonexistent/pipeline.yaml' })
    );
    const payload = runHookAndBlock(SESSION_ID);
    expect(payload.reason).toContain('nonexistent/pipeline.yaml');
    expect(payload.reason).toContain('/pipeline:run');
    expect(payload.systemMessage).toContain('❌');
    expect(payload.systemMessage).toContain('nonexistent/pipeline.yaml');

    const state = readSessionState(SESSION_ID);
    expect(state.mode).toBe('free');
  });

  it('blocks with a visible error and halts the pipeline when the pipeline file cannot be read (e.g. path is a directory)', () => {
    const dirRef = 'tests/fixtures/unreadable-pipeline-dir';
    const dirPath = path.join(PROJECT_ROOT, dirRef);
    fs.mkdirSync(dirPath, { recursive: true });
    try {
      setSessionState(SESSION_ID, createSessionState({ pipeline: dirRef }));
      const payload = runHookAndBlock(SESSION_ID);
      expect(payload.reason).toContain(dirRef);
      expect(payload.reason).toContain('/pipeline:run');
      expect(payload.systemMessage).toContain('❌');

      const state = readSessionState(SESSION_ID);
      expect(state.mode).toBe('free');
    } finally {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  });

  it('exits 0 silently when current step is type=interview', () => {
    setSessionState(
      SESSION_ID,
      createSessionState({
        pipeline: 'tests/fixtures/interview-entry.yaml',
        current_step: 'gather_requirements',
      })
    );
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('injects next step after requirements are locked', () => {
    setSessionState(
      SESSION_ID,
      createSessionState({
        pipeline: 'tests/fixtures/interview-entry.yaml',
        current_step: 'plan',
        completed_steps: ['gather_requirements'],
        shared_state: {
          requirements_locked: 'true',
          user_requirements: 'Build a todo app',
        },
      })
    );
    const payload = runHookAndBlock(SESSION_ID);
    expect(payload.reason).toContain('(type=agent)');
  });
});
