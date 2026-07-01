---
description: Run a multi-step pipeline from a YAML file. Use when the user invokes /pipeline:run with an optional path to a pipeline YAML file.
---

# pipeline:run

Runs a pipeline defined in a YAML file. The pipeline executes steps automatically — agent steps run Claude prompts, shell steps run bash commands, and the Stop hook drives step continuation without user intervention.

## Usage

```
/pipeline:run [path/to/pipeline.yaml] [requirements text]
```

- `path/to/pipeline.yaml` — optional; defaults to `.pipeline/pipeline.yaml`
- `requirements text` — optional inline text stored as `{{user_requirements}}` in pipeline shared state

**Examples:**

```
/pipeline:run
/pipeline:run examples/pipeline.yaml
/pipeline:run Add authentication with JWT tokens
/pipeline:run examples/pipeline.yaml Add authentication with JWT tokens
```

## What happens

1. The pipeline is initialized from the YAML file
2. The entry step prompt is injected immediately
3. After each step completes, the Stop hook advances to the next step automatically
4. The pipeline ends when a terminal step is reached or a step has no `next`

## Executing an injected step prompt

Each step's prompt is injected verbatim via hook context — execute it exactly as given, including invoking any skill or command it references (e.g. `/interview-wiki`). Do not substitute your own ad-hoc approach (for example, asking your own improvised questions instead of running a referenced interview skill) even if it seems equivalent — the injected prompt is the step's contract with the rest of the pipeline.

## Pipeline YAML format

```yaml
entry: step_name

steps:
  step_name:
    type: agent # or shell
    prompt: |
      Your prompt here. Use {{previous_step_output}} for shared state.
    next: next_step # omit to end pipeline

  shell_step:
    type: shell
    commands:
      - npm test
    next: on_success
    next_fail: on_failure
    max_visits: 3 # prevent infinite loops
```
