const path = require('path');

// Must be set before requiring pipeline_utils.js so the CLAUDE_PROJECT_DIR guard doesn't fire.
process.env.CLAUDE_PROJECT_DIR = path.resolve(__dirname, '..');

const {
  parseYAML,
  render,
  buildAdvanceInstruction,
  runShellStep,
  buildStepOutput,
} = require('../hooks/pipeline_utils.js');

describe('parseYAML', () => {
  it('parses a minimal pipeline with entry and steps', () => {
    const yaml = `
entry: first
steps:
  first:
    type: agent
    prompt: |
      Hello world.
    next: second
  second:
    type: shell
    commands:
      - npm test
`;
    const result = parseYAML(yaml);
    expect(result.entry).toBe('first');
    expect(result.steps.first.type).toBe('agent');
    expect(result.steps.first.prompt).toContain('Hello world');
    expect(result.steps.first.next).toBe('second');
    expect(result.steps.second.type).toBe('shell');
    expect(result.steps.second.commands).toEqual(['npm test']);
  });

  it('parses boolean and numeric scalar values', () => {
    const yaml = `
terminal: true
max_visits: 5
nullable: null
`;
    const result = parseYAML(yaml);
    expect(result.terminal).toBe(true);
    expect(result.max_visits).toBe(5);
    expect(result.nullable).toBeNull();
  });

  it('handles comments and empty lines without error', () => {
    const yaml = `
# this is a comment
entry: step1

steps:
  # another comment
  step1:
    type: agent
    prompt: |
      Do the thing.
`;
    const result = parseYAML(yaml);
    expect(result.entry).toBe('step1');
    expect(result.steps.step1.type).toBe('agent');
  });

  it('returns empty object for empty input', () => {
    const result = parseYAML('');
    expect(result).toEqual({});
  });

  it('handles multi-command arrays', () => {
    const yaml = `
steps:
  verify:
    type: shell
    commands:
      - yarn test
      - yarn lint
      - yarn typecheck
`;
    const result = parseYAML(yaml);
    expect(result.steps.verify.commands).toEqual([
      'yarn test',
      'yarn lint',
      'yarn typecheck',
    ]);
  });
});

describe('render', () => {
  it('replaces known placeholders with shared state values', () => {
    const result = render('Context: {{clarify_output}}', {
      clarify_output: 'use postgres',
    });
    expect(result).toBe('Context: use postgres');
  });

  it('leaves unknown placeholders intact', () => {
    const result = render('Context: {{unknown_key}}', {});
    expect(result).toBe('Context: {{unknown_key}}');
  });

  it('replaces multiple placeholders in one template', () => {
    const result = render('{{a}} and {{b}}', { a: 'foo', b: 'bar' });
    expect(result).toBe('foo and bar');
  });
});

describe('buildAdvanceInstruction', () => {
  it('renders a runnable pipeline_advance.js command with session and step for agent steps', () => {
    const instruction = buildAdvanceInstruction('my-session-id', 'plan', {
      type: 'agent',
      next: 'review_plan',
    });
    expect(instruction).toContain('pipeline_advance.js');
    expect(instruction).toContain('--session my-session-id');
    expect(instruction).toContain('--step plan');
    expect(instruction).toContain('--output');
    expect(instruction).not.toContain('--requirements');
    expect(instruction).not.toContain('python3');
  });

  it('renders a --requirements flag (not --output) for interview steps', () => {
    const instruction = buildAdvanceInstruction('sid', 'gather', {
      type: 'interview',
      next: 'plan',
    });
    expect(instruction).toContain('--requirements');
    expect(instruction).not.toContain('--output');
  });

  it('renders an absolute, directly-runnable path to pipeline_advance.js', () => {
    const instruction = buildAdvanceInstruction('sid', 'plan', {
      type: 'agent',
      next: 'review_plan',
    });
    const path = require('path');
    expect(instruction).toContain(
      path.join(path.resolve(__dirname, '..'), 'hooks/pipeline_advance.js')
    );
  });
});

describe('runShellStep', () => {
  it('returns ok=true and captures stdout when all commands succeed', () => {
    const result = runShellStep({ commands: ['echo hello'] }, process.cwd());
    expect(result.ok).toBe(true);
    expect(result.output).toContain('hello');
  });

  it('returns ok=false and stops at the first failing command', () => {
    const result = runShellStep(
      { commands: ['echo first', 'exit 1', 'echo never'] },
      process.cwd()
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain('first');
    expect(result.output).not.toContain('never');
  });
});

describe('default pipeline routing', () => {
  const fs = require('fs');
  const path = require('path');

  it('verify routes to lint on success', () => {
    const yaml = fs.readFileSync(
      path.resolve(__dirname, '../.pipeline/pipeline.yaml'),
      'utf8'
    );
    const pipeline = parseYAML(yaml);
    expect(pipeline.steps.verify.next).toBe('lint');
  });

  it('bump_version routes to pr', () => {
    const yaml = fs.readFileSync(
      path.resolve(__dirname, '../.pipeline/pipeline.yaml'),
      'utf8'
    );
    const pipeline = parseYAML(yaml);
    expect(pipeline.steps.bump_version.next).toBe('pr');
  });

  it('fix_code routes back to verify (re-runs tests after code fix)', () => {
    const yaml = fs.readFileSync(
      path.resolve(__dirname, '../.pipeline/pipeline.yaml'),
      'utf8'
    );
    const pipeline = parseYAML(yaml);
    expect(pipeline.steps.fix_code.next).toBe('verify');
  });

  it('lint routes to jscpd_check on success', () => {
    const yaml = fs.readFileSync(
      path.resolve(__dirname, '../.pipeline/pipeline.yaml'),
      'utf8'
    );
    const pipeline = parseYAML(yaml);
    expect(pipeline.steps.lint.next).toBe('jscpd_check');
    expect(pipeline.steps.lint.next_fail).toBe('fix_lint');
  });

  it('validate_plugin routes to bump_version on success and fix_plugin on failure', () => {
    const yaml = fs.readFileSync(
      path.resolve(__dirname, '../.pipeline/pipeline.yaml'),
      'utf8'
    );
    const pipeline = parseYAML(yaml);
    expect(pipeline.steps.validate_plugin.next).toBe('bump_version');
    expect(pipeline.steps.validate_plugin.next_fail).toBe('fix_plugin');
  });

  it('fix_plugin routes back to validate_plugin', () => {
    const yaml = fs.readFileSync(
      path.resolve(__dirname, '../.pipeline/pipeline.yaml'),
      'utf8'
    );
    const pipeline = parseYAML(yaml);
    expect(pipeline.steps.fix_plugin.next).toBe('validate_plugin');
  });

  it('fix_lint routes back to verify (re-runs tests after lint fix)', () => {
    const yaml = fs.readFileSync(
      path.resolve(__dirname, '../.pipeline/pipeline.yaml'),
      'utf8'
    );
    const pipeline = parseYAML(yaml);
    expect(pipeline.steps.fix_lint.next).toBe('verify');
  });
});

describe('buildStepOutput', () => {
  it('dispatches type=interview without Execute the following prompt framing', () => {
    const result = buildStepOutput(
      'sess1',
      'gather',
      { type: 'interview', prompt: 'Hello', next: 'plan' },
      {}
    );
    expect(result).toContain('(type=interview)');
    expect(result).not.toContain('Execute the following prompt');
    expect(result).toContain('--requirements');
  });

  it('dispatches type=shell with only the description — no advance instruction', () => {
    const result = buildStepOutput(
      'sess1',
      'verify',
      { type: 'shell', commands: ['npm test'], next: 'lint' },
      {}
    );
    expect(result).toContain('(type=shell)');
    expect(result).not.toContain('pipeline_advance.js');
  });
});
