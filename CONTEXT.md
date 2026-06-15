# Context

## Glossary

### Pipeline
A YAML file defining a sequence of steps to be executed automatically by Claude. A pipeline has an `entry` step and a graph of steps connected via `next` (or optional `next_fail` for shell steps).

### Step
A single unit of work in a pipeline. Two types:
- **agent step** — Claude executes a prompt and produces output
- **shell step** — one or more shell commands run via Bash; pass/fail determined by exit code

### Pipeline State
A JSON file at `.pipeline/state.json` tracking runtime execution: current step, completed steps, visit counts, and shared state (inter-step outputs).

### Shared State
A key-value store within pipeline state used to pass output from one step to the next. Keys follow the pattern `<step_name>_output`. Only inter-step outputs are stored here — the requirement is not stored; Claude uses conversation context directly.

### Trigger
The `/run-pipeline [yaml]` user input that initiates pipeline execution. Detected by the `UserPromptSubmit` hook, which initializes state and transforms the prompt so Claude begins executing step 1 immediately.

### Continuation
The mechanism by which subsequent steps are driven after step 1. The `Stop` hook detects an active pipeline (`mode === "pipeline"`), reads the current step from state, renders its prompt, and injects it — causing Claude to execute the next step without user intervention.

### Routing
How a step determines its successor. Two fields only:
- `next` — unconditional next step for agent steps; success path for shell steps
- `next_fail` — failure path for shell steps (non-zero exit). Agent steps have no fail path.

### Max Visits
A per-step guard (`max_visits: N`) that halts the pipeline with an error if a step is executed N or more times. Prevents infinite loops in cyclic paths (e.g. a fix → verify → fix cycle). When the limit is reached, the pipeline stops and outputs an error — it does not advance to the next step.

### Mode
A field in pipeline state. `"pipeline"` means execution is active; `"free"` means the pipeline has completed or has not started.

### Pipeline State File
A single file at `.pipeline/state.json` containing states for all sessions, keyed by session ID:
```json
{
  "<session_id>": { "mode": "pipeline", "current_step": "...", ... }
}
```
The session ID is provided to hooks via hook input. Each session reads and writes only its own key.
