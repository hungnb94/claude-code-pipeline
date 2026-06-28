---
description: Add pipeline state display to the user's configured Claude Code status line script. Reads the actual statusLine command from settings.json, adapts to the script's language and conventions. Idempotent — safe to run multiple times.
---

# pipeline:setup-statusline

Modifies the user's configured status line script to display pipeline state (pipeline name, previous step, current step, retry count) when a pipeline is active.

## What to do

1. Find the configured status line script:
   - Check these settings files in precedence order (first match wins): `.claude/settings.local.json`, `.claude/settings.json`, `~/.claude/settings.local.json`, `~/.claude/settings.json`
   - Find the first file that contains a `statusLine.command` value
   - Extract the script file path from the command — it may be a plain path (`~/.claude/statusline.sh`) or a command with a runtime (`node ~/.claude/statusline.js`)
   - If no `statusLine` is configured in any settings file, tell the user and stop

2. Read the script file. If it does not exist, tell the user and stop.

3. Check if the file already contains the marker `# pipeline-status-block-start`. If it does, tell the user it's already set up and stop.

4. Read the script carefully to understand its conventions:
   - How it reads stdin (e.g. `input=$(cat)`, `RAW=$(cat)`, direct `jq` from process substitution)
   - What language it uses (bash, node, python, etc.)
   - What color or formatting variables it defines

5. Append a pipeline state block at the end of the file, adapted to the script's language and conventions. The block must:
   - Be wrapped in `# pipeline-status-block-start` / `# pipeline-status-block-end` markers
   - Read `session_id` and `workspace.project_dir` from the stdin JSON the statusLine command receives
   - Read `.pipeline/state.json` at `<project_dir>/.pipeline/state.json`, keyed by `session_id`
   - When `mode` is `"pipeline"`, output: `[pipeline-name] ✅ prev-step → 🔄 current-step`
   - Append a retry count `(×N)` in a distinct color when `visit_counts[current_step] > 0`
   - Be completely silent when no pipeline is active

6. Confirm to the user that the block was added and what file was modified.

## State file structure

```json
{
  "<session_id>": {
    "mode": "pipeline",
    "pipeline": ".pipeline/pipeline.yaml",
    "current_step": "fix",
    "completed_steps": ["plan", "implement", "verify"],
    "visit_counts": { "fix": 2 },
    "shared_state": {}
  }
}
```

- `pipeline` — relative path to the YAML file; strip directory and `.yaml` extension for the display name
- `completed_steps[-1]` — the previous step (last completed)
- `visit_counts[current_step]` — number of prior completions of the current step; `> 0` means it's a retry

## Reference implementation (bash)

Use this as a guide when the script is a bash shell script. Adapt variable names, color vars, and stdin-reading to match what you find in the actual script.

```bash
# pipeline-status-block-start
SESSION_ID=$(echo "$input" | jq -r '.session_id // ""')
PROJECT_DIR=$(echo "$input" | jq -r '.workspace.project_dir // ""')
if [ -n "$SESSION_ID" ] && [ -n "$PROJECT_DIR" ]; then
  _PIPELINE_STATE="$PROJECT_DIR/.pipeline/state.json"
  if [ -f "$_PIPELINE_STATE" ]; then
    _MODE=$(jq -r --arg s "$SESSION_ID" '.[$s].mode // ""' "$_PIPELINE_STATE" 2>/dev/null)
    if [ "$_MODE" = "pipeline" ]; then
      _PL=$(jq -r --arg s "$SESSION_ID" '.[$s].pipeline // ""' "$_PIPELINE_STATE" 2>/dev/null)
      _CUR=$(jq -r --arg s "$SESSION_ID" '.[$s].current_step // ""' "$_PIPELINE_STATE" 2>/dev/null)
      _PREV=$(jq -r --arg s "$SESSION_ID" '.[$s].completed_steps[-1] // ""' "$_PIPELINE_STATE" 2>/dev/null)
      _VISITS=$(jq -r --arg s "$SESSION_ID" --arg c "$_CUR" '.[$s].visit_counts[$c] // 0' "$_PIPELINE_STATE" 2>/dev/null)
      _NAME="${_PL##*/}"; _NAME="${_NAME%.yaml}"
      _RETRY=""
      if [ "${_VISITS:-0}" -gt 0 ] 2>/dev/null; then _RETRY=" ${RED}(×${_VISITS})${RESET}"; fi
      _PREV_PART=""
      if [ -n "$_PREV" ]; then _PREV_PART="${GREEN}✅ ${_PREV}${RESET} → "; fi
      echo -e "${CYAN}[${_NAME}]${RESET} ${_PREV_PART}${YELLOW}🔄 ${_CUR}${RESET}${_RETRY}"
    fi
  fi
fi
# pipeline-status-block-end
```

## Notes

- All internal variables should be prefixed or namespaced to avoid collisions with the host script
- The block must be silent when no pipeline is active — no output, no errors
- If the script's language makes it impractical to append a block (e.g. a compiled binary), tell the user and stop
