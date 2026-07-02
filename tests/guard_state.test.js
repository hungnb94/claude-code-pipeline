const {
  spawnSync,
  randomUUID,
  PROJECT_ROOT,
  cleanupSession,
} = require('./helpers');
const path = require('path');

const HOOK = path.join(PROJECT_ROOT, 'hooks/guard_state.js');

function runGuard(sessionId, toolName, toolInput) {
  const input = JSON.stringify({
    session_id: sessionId,
    tool_name: toolName,
    tool_input: toolInput,
  });
  return spawnSync('node', [HOOK], {
    input,
    encoding: 'utf8',
    cwd: PROJECT_ROOT,
    env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT_ROOT },
  });
}

function expectBlocked(sessionId, toolName, toolInput) {
  const result = runGuard(sessionId, toolName, toolInput);
  expect(result.status).toBe(0);
  const out = JSON.parse(result.stdout);
  expect(out.decision).toBe('block');
}

describe('guard_state.js', () => {
  let SESSION_ID;

  beforeEach(() => {
    SESSION_ID = randomUUID();
  });
  afterEach(() => {
    cleanupSession(SESSION_ID);
  });

  it('blocks Edit targeting .pipeline/sessions/<id>.json even when no pipeline is active', () => {
    expectBlocked(SESSION_ID, 'Edit', {
      file_path: `.pipeline/sessions/${SESSION_ID}.json`,
    });
  });

  it('blocks Write targeting .pipeline/sessions/<id>.json', () => {
    expectBlocked(SESSION_ID, 'Write', {
      file_path: `.pipeline/sessions/${SESSION_ID}.json`,
    });
  });

  it('blocks Edit targeting .pipeline/state.json', () => {
    expectBlocked(SESSION_ID, 'Edit', { file_path: '.pipeline/state.json' });
  });

  it('allows Edit/Write targeting an unrelated file', () => {
    const editResult = runGuard(SESSION_ID, 'Edit', {
      file_path: 'src/foo.js',
    });
    expect(editResult.status).toBe(0);
    expect(editResult.stdout).toBe('');

    const writeResult = runGuard(SESSION_ID, 'Write', {
      file_path: 'src/foo.js',
    });
    expect(writeResult.status).toBe(0);
    expect(writeResult.stdout).toBe('');
  });

  it('blocks Bash referencing .pipeline/sessions/ without invoking pipeline_advance.js', () => {
    expectBlocked(SESSION_ID, 'Bash', {
      command: `cat .pipeline/sessions/${SESSION_ID}.json`,
    });
  });

  it('allows Bash referencing the protected path when it properly invokes pipeline_advance.js', () => {
    const result = runGuard(SESSION_ID, 'Bash', {
      command:
        'node /some/path/hooks/pipeline_advance.js --session abc --step plan --output "done"',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('allows Bash commands unrelated to the protected paths', () => {
    const result = runGuard(SESSION_ID, 'Bash', { command: 'ls -la' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });
});
