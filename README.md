# pipeline — Claude Code Plugin

A Claude Code plugin that lets you define multi-step automated pipelines in YAML and run them with a single command. Claude executes each step in sequence — agent steps run prompts, shell steps run bash commands — and the pipeline advances automatically after each step without user intervention.

## Requirements

- Claude Code v2.1+ (with plugin support)

## Install

```
/plugin install github:hungnb94/claude-code-pipeline
```

## Quick start

1. Create a pipeline YAML file in your project:

```yaml
# .pipeline/pipeline.yaml
entry: analyze

steps:
  analyze:
    type: agent
    prompt: |
      Analyze the codebase and summarize what needs to change.
    next: implement

  implement:
    type: agent
    prompt: |
      Implement the changes. Context: {{analyze_output}}
    next: test

  test:
    type: shell
    commands:
      - npm test
    next: done
    next_fail: fix

  fix:
    type: agent
    prompt: |
      Fix the test failures: {{test_output}}
    next: test
    max_visits: 3

  done:
    type: agent
    prompt: |
      Summarize what was implemented.
```

2. Run the pipeline:

```
/pipeline:run
```

Or point to a specific file:

```
/pipeline:run path/to/my-pipeline.yaml
```

Claude will execute each step automatically, without you needing to prompt it between steps.

## Pipeline YAML reference

### Top-level fields

| Field | Required | Description |
|---|---|---|
| `entry` | yes | Name of the first step to execute |
| `steps` | yes | Map of step names to step definitions |

### Agent step

Claude executes the `prompt` and produces output.

```yaml
step_name:
  type: agent
  prompt: |
    Your instructions here.
    Use {{other_step_output}} to reference previous step results.
  next: next_step_name   # omit to end the pipeline
```

### Shell step

One or more shell commands run via Bash. Pass/fail determined by exit code.

```yaml
step_name:
  type: shell
  commands:
    - npm test
    - npm run lint
  next: on_success         # step to run if all commands exit 0
  next_fail: on_failure    # step to run if any command fails (omit to end pipeline)
  max_visits: 5            # optional: halt pipeline if step is visited N or more times
```

### Shared state

Agent steps can pass output to later steps using `{{step_name_output}}` in prompts. After completing a step, Claude writes a one-line summary to the shared state under the key `<step_name>_output`.

### Terminating a pipeline

A step with no `next` field ends the pipeline when it completes. Alternatively, set `terminal: true` on a step to end the pipeline immediately when it is reached (before executing its prompt).

### Loop guard

Use `max_visits: N` on any step to halt the pipeline with an error if the step is visited N or more times. Useful for fix→verify→fix cycles where you want a safety ceiling.

## How it works

- **Trigger**: typing `/pipeline:run` fires a `UserPromptSubmit` hook that reads the YAML, initializes pipeline state at `.pipeline/state.json`, and injects the first step's instructions into the conversation.
- **Continuation**: after each Claude response, a `Stop` hook reads the current step from state and injects the next step's instructions — no user input required between steps.
- **State**: pipeline state is stored per-session in `.pipeline/state.json`. Multiple concurrent sessions in the same project are isolated by session ID.

> **Note:** Both hooks require the `CLAUDE_PROJECT_DIR` environment variable to be set to the project root. Claude Code sets this automatically when running hooks — if you run hooks manually for debugging, set the variable explicitly: `CLAUDE_PROJECT_DIR=$(pwd) node hooks/check_pipeline.js`.

## Examples

See [`examples/pipeline.yaml`](examples/pipeline.yaml) for a full clarify → plan → execute → verify → review pipeline.

## Uninstall

```
/plugin uninstall pipeline
```
