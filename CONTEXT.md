# Context

## Glossary

### Pipeline

A YAML file defining a sequence of steps to be executed automatically by Claude. A pipeline has an `entry` step and a graph of steps connected via `next` (or optional `next_fail` for shell steps).

### Step

A single unit of work in a pipeline. Three types:

- **agent step** — Claude executes a prompt and produces output
- **shell step** — one or more shell commands run via Bash; pass/fail determined by exit code
- **interview step** — Claude gathers requirements from the user across multiple turns before the pipeline proceeds

### Pipeline State

A JSON file at `.pipeline/sessions/<session_id>.json` tracking runtime execution for one session: current step, completed steps, visit counts, and shared state (inter-step outputs).

### Shared State

A key-value store within pipeline state used to pass data between steps. Keys follow the pattern `<step_name>_output` for inter-step outputs. The key `user_requirements` is always present — it holds the inline requirements text the user supplied when invoking `/pipeline:run`, or an empty string if none was given. Steps reference values via `{{key}}` placeholders in their `prompt` field.

### Trigger

The `/pipeline:run [yaml]` user input that initiates pipeline execution. Detected by the `UserPromptSubmit` hook, which initializes state and transforms the prompt so Claude begins executing step 1 immediately.

### Plugin

A self-contained directory distributed via a Marketplace. Users add the marketplace once (`/plugin marketplace add <owner>/<repo>`), then install the plugin by name (`/plugin install <plugin>@<marketplace>`). Installed plugins work globally across all projects without per-project setup.

### Plugin Manifest

The file at `.claude-plugin/plugin.json` that defines the plugin's `name`, `description`, and `version`. The `name` field determines the skill namespace prefix (e.g., `name: "pipeline"` → skill `/pipeline:run`).

### Plugin Root

The directory where Claude Code installs a plugin. `${CLAUDE_PLUGIN_ROOT}` appears in `hooks/hooks.json` as the path to the hook executable (e.g. `node ${CLAUDE_PLUGIN_ROOT}/hooks/check_pipeline.js`). Inside hook scripts, project-relative paths are resolved via `CLAUDE_PROJECT_DIR` (the user's project root), not `${CLAUDE_PLUGIN_ROOT}`.

### Continuation

The mechanism by which subsequent steps are driven after step 1. The `Stop` hook detects an active pipeline (`mode === "pipeline"`), reads the current step from state, renders its prompt, and injects it — causing Claude to execute the next step without user intervention.

### Advance Script

`hooks/pipeline_advance.js`, the sole sanctioned way for Claude to mutate pipeline state for agent and interview steps. Claude supplies `--session <id>`, `--step <name>` (rejected unless it equals `state.current_step`), and exactly one of `--output <text>` (agent steps) or `--requirements <text>` (interview entry step). The script computes `next` from `pipeline.yaml` itself — Claude cannot choose a destination step. Shell steps never use the Advance Script; they advance automatically (see Shell Step Execution). See `docs/adr/0007-hook-driven-state-advancement.md`.

### Shell Step Execution

Shell steps run inside the `Stop` hook (`check_pipeline.js`) itself via `child_process`, not as a Bash action Claude takes. The hook captures stdout/stderr into `shared_state[<step_name>_output]` and picks `next` or `next_fail` from the real exit code, chaining through consecutive shell steps in one hook invocation until it reaches a non-shell step, a failure, or a cycle. A per-invocation guard halts the pipeline with a cycle error if any step repeats before that (independent of, and in addition to, the `Max Visits` guard) — this catches shell-step loops that have no `max_visits` set, which would otherwise hang the hook. Claude is never asked to run or self-report these commands. See `docs/adr/0007-hook-driven-state-advancement.md`.

### State Guard

`hooks/guard_state.js`, a `PreToolUse` hook denying `Edit`/`Write`/`MultiEdit` on `.pipeline/sessions/**/*.json` and `.pipeline/state.json` unconditionally, and denying `Bash` commands that reference those paths unless the command also matches a word-boundary invocation of `pipeline_advance.js` (not a bare substring check, to resist trivially mentioning the filename without calling it). The Bash half is best-effort, not a sandbox — it closes direct/low-effort tampering (Edit tool, `cat >`, `jq`, `sed`) but is not airtight against a fully adversarial agent with shell access. See `docs/adr/0007-hook-driven-state-advancement.md`.

### Routing

How a step determines its successor. Two fields only:

- `next` — unconditional next step for agent steps; success path for shell steps
- `next_fail` — failure path for shell steps (non-zero exit). Agent steps have no fail path.

### Max Visits

A per-step guard (`max_visits: N`) that stops a step from being retried more than N times. Prevents infinite loops in cyclic paths (e.g. a fix → verify → fix cycle). When the limit is reached, the step is auto-marked as completed and the pipeline advances to its `next` (the success path — `next_fail` is never used for this) as if it had succeeded; if the step has no `next`, the pipeline ends. If two or more maxed-out steps form a cycle via `next`, the pipeline halts with an error instead of advancing forever.

### Mode

A field in pipeline state. `"pipeline"` means execution is active; `"free"` means the pipeline has completed or has not started.

### Pipeline State File

One file per session at `.pipeline/sessions/<session_id>.json`, containing that session's state directly (`{ "mode": "pipeline", "current_step": "...", ... }`). The session ID is provided to hooks via hook input. Each session reads and writes only its own file, so concurrent sessions never contend on the same file. A legacy single-file format (`.pipeline/state.json`, keyed by session ID) is read as a fallback for sessions that started before the per-file format existed.

### Setup Statusline Skill

A Claude Code skill (`/pipeline:setup-statusline`) that appends a pipeline state block to the user's configured status line script. Reads the `statusLine` key from Claude Code settings, adapts the block to the script's language and conventions, and is idempotent. It superseded the per-step progress header that both hooks used to write to stderr (`✅ prev-step → 🔄 current-step`) — that header was removed since this skill shows the same info persistently, plus pipeline name and retry count. See `docs/adr/0002-stderr-for-progress-header-visibility.md` (Superseded).

### Interview Step

A step with `type: interview` used to gather requirements through multi-turn conversation before the pipeline proceeds.

### Requirements Lock

The action of finalizing gathered requirements in an interview step, making them available to subsequent steps via `{{user_requirements}}`.

### Demo Recording

The `record_demo` step (an ordinary agent step, not a fourth step type) that closes out `.pipeline/pipeline.yaml`. Claude acts as a manual tester, exercising the feature end-to-end in the terminal, capturing the session with `asciinema` and converting it to a GIF with `agg`, then publishing the GIF via a secret gist (`gh gist create`) and embedding its raw URL in the PR description (`gh pr edit --body`). The GIF is never committed to the repository. See `docs/adr/0008-terminal-demo-recording-via-asciinema-agg-gist.md`.

### Version

The semantic version string (`major.minor.patch`) recorded in `package.json`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json` (`plugins[0].version`). All three files must always hold the same value. The `bump_version` pipeline step is responsible for choosing and applying the correct bump level based on the nature of the changes in the current branch. It compares `package.json`'s version against `origin/main`'s: if the value is unchanged, the branch hasn't been bumped yet and the step proceeds; if it already differs, a prior pipeline run on this branch already bumped it and the step skips — ensuring at most one version bump per branch regardless of how many times the pipeline is run.
