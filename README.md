# pipeline — Claude Code Plugin

A Claude Code plugin that lets you define multi-step automated pipelines in YAML and run them with a single command. Claude executes each step in sequence — agent steps run prompts, shell steps run bash commands — and the pipeline advances automatically after each step without user intervention.

![Claude Code Pipeline — automate your code quality workflow with Claude Code](imgs/illustration.png)

## Requirements

- Claude Code v2.1+ (with plugin support)

## Install

Claude Code uses a marketplace catalog for discovery — you add the marketplace once, then install individual plugins from it.

```
/plugin marketplace add hungnb94/claude-code-pipeline
/plugin install pipeline@claude-code-pipeline
```

## Quick start

1. Create a pipeline YAML file in your project:

```yaml
# .pipeline/pipeline.yaml
entry: plan

steps:
  plan:
    type: agent
    prompt: |
      Analyze the codebase and write a step-by-step implementation plan.
    next: implement

  implement:
    type: agent
    prompt: |
      Implement the plan: {{plan_output}}
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

Or point to a specific file, optionally with inline requirements:

```
/pipeline:run path/to/my-pipeline.yaml
/pipeline:run Add authentication with JWT tokens
/pipeline:run path/to/my-pipeline.yaml Add authentication with JWT tokens
```

Inline requirements are stored as `{{user_requirements}}` in shared state and can be referenced in any step's `prompt` field.

Claude will execute each step automatically, without you needing to prompt it between steps.

## Pipeline YAML reference

### Top-level fields

| Field   | Required | Description                           |
| ------- | -------- | ------------------------------------- |
| `entry` | yes      | Name of the first step to execute     |
| `steps` | yes      | Map of step names to step definitions |

### Agent step

Claude executes the `prompt` and produces output.

```yaml
step_name:
  type: agent
  prompt: |
    Your instructions here.
    Use {{other_step_output}} to reference previous step results.
  next: next_step_name # omit to end the pipeline
```

### Shell step

One or more shell commands, run directly by the `Stop` hook (not by Claude). Pass/fail is determined by the real exit code — Claude never runs or self-reports these commands.

```yaml
step_name:
  type: shell
  commands:
    - npm test
    - npm run lint
  next: on_success # step to run if all commands exit 0
  next_fail: on_failure # step to run if any command fails (omit to end pipeline)
  max_visits: 5 # optional: halt pipeline if step is visited N or more times
```

### Interview step

Gathers requirements from the user through multi-turn conversation before the pipeline proceeds. Must be the `entry` step — a validation error is raised if placed anywhere else.

```yaml
entry: gather_requirements

steps:
  gather_requirements:
    type: interview
    prompt: |
      Ask the user what they want to build. Gather scope and acceptance criteria.
    next: plan # required — where to go after requirements are locked
```

While an interview step is active:

- The pipeline pauses and Claude converses naturally with the user (no auto-continuation between turns).
- `Edit`, `Write`, and `MultiEdit` tools are blocked until requirements are confirmed.

When Claude has gathered enough information, it runs `hooks/pipeline_advance.js --session <id> --step gather_requirements --requirements "<text>"` (the command is provided in the step output) to lock the requirements and advance the pipeline. Locked requirements are stored as `{{user_requirements}}` in shared state.

### Shared state

Agent and shell steps can pass output to later steps using `{{step_name_output}}` in prompts. For agent steps, Claude supplies a one-line summary via `pipeline_advance.js --output`, stored under `<step_name>_output`. For shell steps, the `Stop` hook captures the commands' real stdout/stderr into the same key automatically.

### Terminating a pipeline

A step with no `next` field ends the pipeline when it completes. Alternatively, set `terminal: true` on a step to end the pipeline immediately when it is reached (before executing its prompt).

### Loop guard

Use `max_visits: N` on any step to halt the pipeline with an error if the step is visited N or more times. Useful for fix→verify→fix cycles where you want a safety ceiling.

## How it works

- **Trigger**: typing `/pipeline:run` fires a `UserPromptSubmit` hook that reads the YAML, initializes pipeline state at `.pipeline/sessions/<session_id>.json`, and injects the first step's instructions into the conversation. The step description is also shown to the user directly (via `systemMessage`), so — for example — an interview step's actual question is visible, not just injected as hidden context (see `docs/adr/0005-json-systemmessage-for-userpromptsubmit-visibility.md`).
- **Continuation**: after each Claude response, a `Stop` hook reads the current step from state and injects the next step's instructions — no user input required between steps. Shell steps are run by this hook directly (via `child_process`), with `next`/`next_fail` chosen from the real exit code; Claude never runs or self-reports them.
- **Advancing agent/interview steps**: Claude advances a completed agent or interview step by running `hooks/pipeline_advance.js --session <id> --step <name> --output "<summary>"` (or `--requirements "<text>"` for the interview entry step). The script rejects the call unless `--step` matches the actually-active step, and computes the next step from `pipeline.yaml` itself — Claude cannot redirect the pipeline to an arbitrary step (see `docs/adr/0007-hook-driven-state-advancement.md`).
- **Interview steps**: when the current step is `type: interview`, the `Stop` hook exits silently so natural multi-turn conversation can continue. A `PreToolUse` hook blocks file-editing tools until requirements are locked.
- **State**: pipeline state is stored one file per session at `.pipeline/sessions/<session_id>.json`, so concurrent sessions never contend on the same file (see `docs/adr/0006-per-session-state-files.md`). A `PreToolUse` guard (`hooks/guard_state.js`) blocks `Edit`/`Write`/`MultiEdit` and matching `Bash` commands from touching these files directly, keeping `pipeline_advance.js` as the only sanctioned way to mutate state (best-effort for `Bash` — see ADR 0007).

> **Note:** Both hooks require the `CLAUDE_PROJECT_DIR` environment variable to be set to the project root. Claude Code sets this automatically when running hooks — if you run hooks manually for debugging, set the variable explicitly: `CLAUDE_PROJECT_DIR=$(pwd) node hooks/check_pipeline.js`.

## Status line integration

Run this skill once to add pipeline state display to your status line:

```
/pipeline:setup-statusline
```

If no `statusLine` is configured, the skill creates one — a full-featured default script at `~/.claude/statusline.sh` and a `statusLine` entry in `~/.claude/settings.json`. If you already have a script, it appends a pipeline state block adapted to that script's language and conventions.

While a pipeline is active, your status line will show an extra line:

```
[pipeline-name] ✅ prev-step → 🔄 current-step
[pipeline-name] ✅ verify → 🔄 fix (×3)   ← red retry count when looping
```

The block is silent when no pipeline is running. Safe to run multiple times - idempotent.

## Examples

See [`examples/pipeline.yaml`](examples/pipeline.yaml) for a full plan → execute → verify → review pipeline.

## Uninstall

```
/plugin uninstall pipeline@claude-code-pipeline
```

## Development

To test local changes to this plugin without publishing, load it directly from the repo root:

```
claude --plugin-dir .
```

This loads the plugin from your working directory. Any changes to hook scripts or skill files take effect on the next Claude Code session.
