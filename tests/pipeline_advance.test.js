const path = require('path');
const { randomUUID } = require('crypto');

const {
  PROJECT_ROOT,
  setSessionState,
  cleanupSession,
  createSessionState,
  readSessionState,
  spawnSync,
} = require('./helpers');

const HOOK = path.join(PROJECT_ROOT, 'hooks/pipeline_advance.js');

function runAdvance(args) {
  return spawnSync('node', [HOOK, ...args], {
    encoding: 'utf8',
    cwd: PROJECT_ROOT,
    env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT_ROOT },
  });
}

describe('pipeline_advance.js', () => {
  let SESSION_ID;

  beforeEach(() => {
    SESSION_ID = randomUUID();
  });
  afterEach(() => {
    cleanupSession(SESSION_ID);
  });

  it('rejects when --step does not match state.current_step, leaving state unchanged', () => {
    const initial = createSessionState({ current_step: 'plan' });
    setSessionState(SESSION_ID, initial);

    const result = runAdvance([
      '--session',
      SESSION_ID,
      '--step',
      'review_plan',
      '--output',
      'done',
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('review_plan');

    const state = readSessionState(SESSION_ID);
    expect(state).toEqual(initial);
  });

  it('rejects when the resolved step type is shell', () => {
    const initial = createSessionState({ current_step: 'verify' });
    setSessionState(SESSION_ID, initial);

    const result = runAdvance([
      '--session',
      SESSION_ID,
      '--step',
      'verify',
      '--output',
      'tests passed',
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('shell steps advance automatically');

    const state = readSessionState(SESSION_ID);
    expect(state).toEqual(initial);
  });

  it('on a matching agent step, sets current_step to exactly step.next from the pipeline YAML', () => {
    setSessionState(SESSION_ID, createSessionState({ current_step: 'plan' }));

    const result = runAdvance([
      '--session',
      SESSION_ID,
      '--step',
      'plan',
      '--output',
      'wrote the plan',
      // Extra/unsupported flags must have no effect on routing — there is no
      // way to pass a custom "next" destination.
      '--next',
      'bump_version',
    ]);

    expect(result.status).toBe(0);
    const state = readSessionState(SESSION_ID);
    expect(state.current_step).toBe('review_plan'); // step.next from .pipeline/pipeline.yaml
    expect(state.completed_steps).toContain('plan');
    expect(state.visit_counts.plan).toBe(1);
    expect(state.shared_state.plan_output).toBe('wrote the plan');
  });

  it('rejects agent step advance when --requirements is passed instead of --output', () => {
    const initial = createSessionState({ current_step: 'plan' });
    setSessionState(SESSION_ID, initial);

    const result = runAdvance([
      '--session',
      SESSION_ID,
      '--step',
      'plan',
      '--requirements',
      'some requirements',
    ]);

    expect(result.status).toBe(1);
    const state = readSessionState(SESSION_ID);
    expect(state).toEqual(initial);
  });

  it('interview step sets user_requirements and requirements_locked, and advances via step.next', () => {
    setSessionState(
      SESSION_ID,
      createSessionState({
        pipeline: 'tests/fixtures/interview-entry.yaml',
        current_step: 'gather_requirements',
      })
    );

    const result = runAdvance([
      '--session',
      SESSION_ID,
      '--step',
      'gather_requirements',
      '--requirements',
      'Build a todo app with postgres',
    ]);

    expect(result.status).toBe(0);
    const state = readSessionState(SESSION_ID);
    expect(state.shared_state.user_requirements).toBe(
      'Build a todo app with postgres'
    );
    expect(state.shared_state.requirements_locked).toBe('true');
    expect(state.current_step).toBe('plan');
    expect(state.completed_steps).toContain('gather_requirements');
  });

  it('rejects interview step advance when --output is passed instead of --requirements', () => {
    const initial = createSessionState({
      pipeline: 'tests/fixtures/interview-entry.yaml',
      current_step: 'gather_requirements',
    });
    setSessionState(SESSION_ID, initial);

    const result = runAdvance([
      '--session',
      SESSION_ID,
      '--step',
      'gather_requirements',
      '--output',
      'some output',
    ]);

    expect(result.status).toBe(1);
    const state = readSessionState(SESSION_ID);
    expect(state).toEqual(initial);
  });

  it('sets mode=free when the completed step has no next', () => {
    setSessionState(
      SESSION_ID,
      createSessionState({
        pipeline: 'tests/fixtures/requirements-entry.yaml',
        current_step: 'start',
      })
    );

    const result = runAdvance([
      '--session',
      SESSION_ID,
      '--step',
      'start',
      '--output',
      'done',
    ]);

    expect(result.status).toBe(0);
    const state = readSessionState(SESSION_ID);
    expect(state.mode).toBe('free');
  });

  it('rejects when no active pipeline session exists for the session id', () => {
    const result = runAdvance([
      '--session',
      SESSION_ID,
      '--step',
      'plan',
      '--output',
      'done',
    ]);

    expect(result.status).toBe(1);
    expect(readSessionState(SESSION_ID)).toBeNull();
  });
});
