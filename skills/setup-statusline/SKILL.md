---
description: Add pipeline state display to the user's configured Claude Code status line script. Reads the actual statusLine command from settings.json, adapts to the script's language and conventions. Idempotent - safe to run multiple times.
---

# pipeline:setup-statusline

Modifies the user's configured status line script to display pipeline state (pipeline name, previous step, current step, retry count) when a pipeline is active.

## What to do

1. Find the configured status line script:
   - Check these settings files in precedence order (first match wins): `.claude/settings.local.json`, `.claude/settings.json`, `~/.claude/settings.local.json`, `~/.claude/settings.json`
   - Look for the exact key `statusLine` (not `statusLine2` or any other variant - only `statusLine` works in Claude Code)
   - Extract the script file path from `statusLine.command` - it may be a plain path (`~/.claude/statusline.sh`) or a command with a runtime (`node ~/.claude/statusline.js`)
   - If no `statusLine` key is found, proceed to step 2 to create one
   - If `statusLine` is found but the script file does not exist, tell the user the configured script is missing and they should restore it manually, then stop

2. If `statusLine` was not found in any settings file, create it:
   - Write the default script to `~/.claude/statusline.sh` (see "Default script" below)
   - Make it executable: `chmod +x ~/.claude/statusline.sh`
   - Add `statusLine` to `~/.claude/settings.json` (global user settings):
     ```json
     {
       "statusLine": {
         "type": "command",
         "command": "~/.claude/statusline.sh"
       }
     }
     ```
   - Tell the user what was created before continuing

3. Check if the script file already contains the marker `# pipeline-status-block-start`. If it does, tell the user it's already set up and stop.

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

## Default script

Full-featured two-line display: model/dir/git on line 1, context bar/cost/duration/rate limits on line 2.

```bash
#!/bin/bash
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name')
DIR=$(echo "$input" | jq -r '.workspace.current_dir')
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
DURATION_MS=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')

CYAN='\033[36m'; GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; RESET='\033[0m'

if [ "$PCT" -ge 90 ]; then BAR_COLOR="$RED"
elif [ "$PCT" -ge 70 ]; then BAR_COLOR="$YELLOW"
else BAR_COLOR="$GREEN"; fi

FILLED=$((PCT / 10)); EMPTY=$((10 - FILLED))
printf -v FILL "%${FILLED}s"; printf -v PAD "%${EMPTY}s"
BAR="${FILL// /█}${PAD// /░}"

MINS=$((DURATION_MS / 60000)); SECS=$(((DURATION_MS % 60000) / 1000))

BRANCH=""
git rev-parse --git-dir > /dev/null 2>&1 && BRANCH=" | 🌿 $(git branch --show-current 2>/dev/null)"

STAGED=$(git diff --cached --numstat 2>/dev/null | wc -l | tr -d ' ')
MODIFIED=$(git diff --numstat 2>/dev/null | wc -l | tr -d ' ')
GIT_COUNTS=""
[ "${STAGED:-0}" -gt 0 ] && GIT_COUNTS=" ${GREEN}+${STAGED}${RESET}"
[ "${MODIFIED:-0}" -gt 0 ] && GIT_COUNTS="${GIT_COUNTS}${YELLOW}~${MODIFIED}${RESET}"

echo -e "${CYAN}[$MODEL]${RESET} 📁 ${DIR##*/}${BRANCH}${GIT_COUNTS}"

COST_FMT=$(printf '$%.2f' "$COST")
FIVE_H=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
WEEK=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
RATE=""
[ -n "$FIVE_H" ] && RATE=" | 5h: $(printf '%.0f' "$FIVE_H")%"
[ -n "$WEEK" ] && RATE="${RATE} 7d: $(printf '%.0f' "$WEEK")%"
echo -e "${BAR_COLOR}${BAR}${RESET} ${PCT}% | ${YELLOW}${COST_FMT}${RESET} | ⏱️ ${MINS}m ${SECS}s${RATE}"
```

## State file structure

Primary source - one file per session at `.pipeline/sessions/<session_id>.json`, holding the session state directly (no outer key):

```json
{
  "mode": "pipeline",
  "pipeline": ".pipeline/pipeline.yaml",
  "current_step": "fix",
  "completed_steps": ["plan", "implement", "verify"],
  "visit_counts": { "fix": 2 },
  "shared_state": {}
}
```

Legacy fallback - if `.pipeline/sessions/<session_id>.json` does not exist, read `.pipeline/state.json`, keyed by session ID, and index into it with the session ID:

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

- `pipeline` - relative path to the YAML file; strip directory and `.yaml` extension for the display name
- `completed_steps[-1]` - the previous step (last completed)
- `visit_counts[current_step]` - number of prior completions of the current step; `> 0` means it's a retry
- Always check the per-session file first; only read the legacy file when the per-session file is absent

## Pipeline block reference implementation (bash)

Guide for bash scripts. Adapt variable names, color vars, and stdin-reading to match the actual script.

Reads the per-session file first (`.pipeline/sessions/<session_id>.json`, current format); falls back to the legacy keyed file (`.pipeline/state.json`) only if the per-session file is absent - mirroring `hooks/pipeline_utils.js`'s `getSessionState()`.

```bash
# pipeline-status-block-start
SESSION_ID=$(echo "$input" | jq -r '.session_id // ""')
PROJECT_DIR=$(echo "$input" | jq -r '.workspace.project_dir // ""')
if [ -n "$SESSION_ID" ] && [ -n "$PROJECT_DIR" ]; then
  _SESSION_STATE="$PROJECT_DIR/.pipeline/sessions/${SESSION_ID}.json"
  _LEGACY_STATE="$PROJECT_DIR/.pipeline/state.json"
  if [ -f "$_SESSION_STATE" ]; then
    _STATE_JSON=$(cat "$_SESSION_STATE" 2>/dev/null)
  elif [ -f "$_LEGACY_STATE" ]; then
    _STATE_JSON=$(jq -c --arg s "$SESSION_ID" '.[$s] // empty' "$_LEGACY_STATE" 2>/dev/null)
  else
    _STATE_JSON=""
  fi
  if [ -n "$_STATE_JSON" ]; then
    _MODE=$(echo "$_STATE_JSON" | jq -r '.mode // ""' 2>/dev/null)
    if [ "$_MODE" = "pipeline" ]; then
      _PL=$(echo "$_STATE_JSON" | jq -r '.pipeline // ""' 2>/dev/null)
      _CUR=$(echo "$_STATE_JSON" | jq -r '.current_step // ""' 2>/dev/null)
      _PREV=$(echo "$_STATE_JSON" | jq -r '.completed_steps[-1] // ""' 2>/dev/null)
      _VISITS=$(echo "$_STATE_JSON" | jq -r --arg c "$_CUR" '.visit_counts[$c] // 0' 2>/dev/null)
      _NAME="${_PL##*/}"; _NAME="${_NAME%.yaml}"
      _RETRY=""
      if [ "${_VISITS:-0}" -gt 0 ]; then _RETRY=" ${RED}(×${_VISITS})${RESET}"; fi
      _PREV_PART=""
      if [ -n "$_PREV" ]; then _PREV_PART="${GREEN}✅ ${_PREV}${RESET} → "; fi
      printf '%b\n' "${CYAN}[${_NAME}]${RESET} ${_PREV_PART}${YELLOW}🔄 ${_CUR}${RESET}${_RETRY}"
    fi
  fi
fi
# pipeline-status-block-end
```

## Reference

Full statusLine documentation (available fields, examples, troubleshooting): https://code.claude.com/docs/en/statusline

## Notes

- Only the exact key `statusLine` is recognized - other keys like `statusLine2` are silently ignored
- Always write `statusLine` to `~/.claude/settings.json` (global), not a project settings file
- Prefix all pipeline block internal variables with `_` to avoid collisions with the host script
- The pipeline block must produce no output when no pipeline is active
- If appending a block is impractical (e.g. a compiled binary), tell the user and stop
