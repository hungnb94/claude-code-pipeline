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
A key-value store within pipeline state used to pass data between steps. Keys follow the pattern `<step_name>_output` for inter-step outputs. The key `user_requirements` is always present — it holds the inline requirements text the user supplied when invoking `/pipeline:run`, or an empty string if none was given. Steps reference values via `{{key}}` placeholders in their `prompt` field.

### Trigger
The `/pipeline:run [yaml]` user input that initiates pipeline execution. Detected by the `UserPromptSubmit` hook, which initializes state and transforms the prompt so Claude begins executing step 1 immediately.

### Plugin
A self-contained directory distributed via git that extends Claude Code with skills, hooks, and agents. Installed globally via `/plugin install github:<owner>/<repo>` — works across all projects without per-project setup.

### Plugin Manifest
The file at `.claude-plugin/plugin.json` that defines the plugin's `name`, `description`, and `version`. The `name` field determines the skill namespace prefix (e.g., `name: "pipeline"` → skill `/pipeline:run`).

### Plugin Root
The directory where Claude Code installs a plugin. `${CLAUDE_PLUGIN_ROOT}` appears in `hooks/hooks.json` as the path to the hook executable (e.g. `node ${CLAUDE_PLUGIN_ROOT}/hooks/check_pipeline.js`). Inside hook scripts, project-relative paths are resolved via `CLAUDE_PROJECT_DIR` (the user's project root), not `${CLAUDE_PLUGIN_ROOT}`.

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

### Version

The semantic version string (`major.minor.patch`) recorded in `package.json` and `.claude-plugin/plugin.json`. Both files must always hold the same value. The `bump_version` pipeline step is responsible for choosing and applying the correct bump level based on the nature of the changes in the current branch. If the version already differs from `origin/main`, the step skips the bump — ensuring at most one version bump per branch regardless of how many times the pipeline is run.
