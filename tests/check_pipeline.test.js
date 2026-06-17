const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(PROJECT_ROOT, 'hooks/check_pipeline.js');
const STATE_PATH = path.join(PROJECT_ROOT, '.pipeline/state.json');

function runHook(sessionId) {
  const input = JSON.stringify({ session_id: sessionId });
  return spawnSync('node', [HOOK], {
    input,
    encoding: 'utf8',
    cwd: PROJECT_ROOT,
    env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT_ROOT },
  });
}

function setSessionState(sessionId, state) {
  let all = {};
  if (fs.existsSync(STATE_PATH)) {
    try {
      all = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    } catch {
      // ignore parse errors on corrupt state file
    }
  }
  all[sessionId] = state;
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(all, null, 2));
}

function cleanupSession(sessionId) {
  if (!fs.existsSync(STATE_PATH)) {
    return;
  }
  try {
    const all = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    delete all[sessionId];
    fs.writeFileSync(STATE_PATH, JSON.stringify(all, null, 2));
  } catch {
    // ignore errors during cleanup
  }
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
    setSessionState(SESSION_ID, {
      mode: 'free',
      pipeline: '.pipeline/pipeline.yaml',
      current_step: 'plan',
      completed_steps: [],
      visit_counts: {},
      shared_state: {},
    });
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('exits 2 and injects agent step prompt when pipeline is active', () => {
    setSessionState(SESSION_ID, {
      mode: 'pipeline',
      pipeline: '.pipeline/pipeline.yaml',
      current_step: 'plan',
      completed_steps: [],
      visit_counts: {},
      shared_state: {},
    });
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('🔄 plan');
    expect(result.stderr).toContain('🔄 plan');
    expect(result.stdout).toContain(
      "Pipeline active — current step: 'plan' (type=agent)"
    );
    expect(result.stdout).toContain(
      'Writing a step-by-step implementation plan.'
    );
  });

  it('exits 2 and shows shell commands when current step is type=shell', () => {
    setSessionState(SESSION_ID, {
      mode: 'pipeline',
      pipeline: '.pipeline/pipeline.yaml',
      current_step: 'verify',
      completed_steps: ['plan', 'review_plan', 'implementation', 'docs'],
      visit_counts: { plan: 1, review_plan: 1, implementation: 1, docs: 1 },
      shared_state: {},
    });
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain(
      '✅ plan → ✅ review_plan → ✅ implementation → ✅ docs → 🔄 verify'
    );
    expect(result.stderr).toContain(
      '✅ plan → ✅ review_plan → ✅ implementation → ✅ docs → 🔄 verify'
    );
    expect(result.stdout).toContain(
      "Pipeline active — current step: 'verify' (type=shell)"
    );
    expect(result.stdout).toContain('npm test');
  });

  it('exits 2 with error when step visit count reaches max_visits', () => {
    setSessionState(SESSION_ID, {
      mode: 'pipeline',
      pipeline: '.pipeline/pipeline.yaml',
      current_step: 'verify',
      completed_steps: [],
      visit_counts: { verify: 9 },
      shared_state: {},
    });
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('max_visits');
    expect(result.stdout).toContain('Pipeline error');
  });

  it('exits 0 and sets mode=free when current step has terminal:true', () => {
    setSessionState(SESSION_ID, {
      mode: 'pipeline',
      pipeline: 'tests/fixtures/terminal-step.yaml',
      current_step: 'done',
      completed_steps: [],
      visit_counts: {},
      shared_state: {},
    });
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('interpolates {{step_output}} placeholders in agent prompt', () => {
    setSessionState(SESSION_ID, {
      mode: 'pipeline',
      pipeline: 'examples/pipeline.yaml',
      current_step: 'plan',
      completed_steps: ['clarify'],
      visit_counts: { clarify: 1 },
      shared_state: { clarify_output: 'use postgres for storage' },
    });
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('use postgres for storage');
    expect(result.stderr).toContain('✅ clarify → 🔄 plan');
  });

  it('writes prompt label and text to stderr for agent step', () => {
    setSessionState(SESSION_ID, {
      mode: 'pipeline',
      pipeline: '.pipeline/pipeline.yaml',
      current_step: 'plan',
      completed_steps: [],
      visit_counts: {},
      shared_state: {},
    });
    const result = runHook(SESSION_ID);
    expect(result.stderr).toContain('Prompt:');
    expect(result.stderr).toContain('Writing a step-by-step implementation plan.');
  });

  it('writes commands label and command text to stderr for shell step', () => {
    setSessionState(SESSION_ID, {
      mode: 'pipeline',
      pipeline: '.pipeline/pipeline.yaml',
      current_step: 'verify',
      completed_steps: [],
      visit_counts: {},
      shared_state: {},
    });
    const result = runHook(SESSION_ID);
    expect(result.stderr).toContain('Commands:');
    expect(result.stderr).toContain('npm test');
  });

  it('renders template variables in stderr and does not emit raw tokens', () => {
    setSessionState(SESSION_ID, {
      mode: 'pipeline',
      pipeline: 'examples/pipeline.yaml',
      current_step: 'plan',
      completed_steps: ['clarify'],
      visit_counts: { clarify: 1 },
      shared_state: { clarify_output: 'use postgres for storage' },
    });
    const result = runHook(SESSION_ID);
    expect(result.stderr).toContain('use postgres for storage');
    expect(result.stderr).not.toContain('{{clarify_output}}');
  });

  it('exits 0 silently when pipeline file does not exist', () => {
    setSessionState(SESSION_ID, {
      mode: 'pipeline',
      pipeline: 'nonexistent/pipeline.yaml',
      current_step: 'plan',
      completed_steps: [],
      visit_counts: {},
      shared_state: {},
    });
    const result = runHook(SESSION_ID);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });
});
