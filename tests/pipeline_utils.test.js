const path = require('path');

// Must be set before requiring pipeline_utils.js so the CLAUDE_PROJECT_DIR guard doesn't fire.
process.env.CLAUDE_PROJECT_DIR = path.resolve(__dirname, '..');

const {
  parseYAML,
  render,
  buildAgentUpdateBlock,
  buildShellUpdateBlock,
  buildProgressHeader,
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

describe('buildAgentUpdateBlock', () => {
  it('includes the session ID in the python3 command', () => {
    const block = buildAgentUpdateBlock('my-session-id', 'plan', 'review_plan');
    expect(block).toContain('my-session-id');
    expect(block).toContain('python3');
  });

  it('sets current_step to next when next is provided', () => {
    const block = buildAgentUpdateBlock('sid', 'plan', 'review_plan');
    expect(block).toContain('current_step');
    expect(block).toContain('review_plan');
  });

  it("sets mode to 'free' when next is empty (terminal step)", () => {
    const block = buildAgentUpdateBlock('sid', 'done', '');
    expect(block).toContain('mode');
    expect(block).toContain('free');
  });

  it('escapes single quotes in session ID', () => {
    const block = buildAgentUpdateBlock("it's-a-session", 'plan', 'next');
    expect(block).toContain("\\'s-a-session");
  });
});

describe('buildShellUpdateBlock', () => {
  it('includes success and failure python3 blocks', () => {
    const block = buildShellUpdateBlock('sid', 'verify', 'review', 'fix_code');
    expect(block).toContain('If ALL commands exit 0');
    expect(block).toContain('If ANY command fails');
    expect(block).toContain('review');
    expect(block).toContain('fix_code');
  });

  it("sets mode='free' on success when next is empty", () => {
    const block = buildShellUpdateBlock('sid', 'verify', '', 'fix_code');
    expect(block).toContain('free');
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

  it('lint routes to bump_version on success', () => {
    const yaml = fs.readFileSync(
      path.resolve(__dirname, '../.pipeline/pipeline.yaml'),
      'utf8'
    );
    const pipeline = parseYAML(yaml);
    expect(pipeline.steps.lint.next).toBe('bump_version');
    expect(pipeline.steps.lint.next_fail).toBe('fix_lint');
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

describe('buildProgressHeader', () => {
  it('shows only current step when no steps completed', () => {
    expect(buildProgressHeader([], 'plan')).toBe('🔄 plan');
  });

  it('shows completed steps before current step', () => {
    expect(buildProgressHeader(['plan', 'review'], 'implement')).toBe(
      '✅ plan → ✅ review → 🔄 implement'
    );
  });

  it('shows single completed step before current step', () => {
    expect(buildProgressHeader(['plan'], 'review')).toBe('✅ plan → 🔄 review');
  });

  it('handles repeated step names from cycles', () => {
    expect(buildProgressHeader(['verify', 'fix', 'verify'], 'fix')).toBe(
      '✅ verify → ✅ fix → ✅ verify → 🔄 fix'
    );
  });

  it('treats missing completedSteps as empty', () => {
    expect(buildProgressHeader(undefined, 'plan')).toBe('🔄 plan');
  });
});
