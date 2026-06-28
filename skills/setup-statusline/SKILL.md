---
description: Add pipeline state display to the user's existing ~/.claude/statusline.sh. Shows current step, previous step, and retry count with colors. Idempotent — safe to run multiple times.
---

# pipeline:setup-statusline

Modifies `~/.claude/statusline.sh` to display pipeline state (pipeline name, previous step, current step, retry count) when a pipeline is active.

## What to do

1. Read `~/.claude/statusline.sh`. If the file does not exist, tell the user and stop — this skill requires an existing statusline script.

2. Check if the file already contains the marker `# pipeline-status-block-start`. If it does, tell the user it's already set up and stop.

3. Append the following block verbatim at the end of the file:

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

4. Confirm to the user that the block was added. Tell them the status line will now show a third line whenever a pipeline is active, and nothing when idle.

## Notes

- The block uses `$CYAN`, `$GREEN`, `$YELLOW`, `$RED`, `$RESET` — these must already be defined in the user's statusline.sh. If their script uses different variable names, adjust accordingly before appending.
- All internal variables are prefixed with `_` to avoid colliding with variables already in the user's script.
- The block is silent when no pipeline is active (mode is not "pipeline" or state file is absent).
