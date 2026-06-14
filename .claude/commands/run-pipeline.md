Start pipeline YAML file step by step, enforcing sequential execution.

## Arguments

`$ARGUMENTS` format: `[pipeline_file] <requirement>`

- If one token: treat as requirement, use `.pipeline/pipeline.yaml` as pipeline.
- If first token ends with `.yaml`: first token = pipeline file, rest = requirement.

## Instructions

### 1. Parse arguments

Parse `$ARGUMENTS` to extract `pipeline_file` and `requirement`.

### 2. Load pipeline

Read the pipeline YAML file. Confirm it's valid (has `entry` and `steps` keys). If not found, tell the user and stop.

### 3. Initialize state

Write `.pipeline/pipeline.state`:

```json
{
  "mode": "pipeline",
  "pipeline": "<pipeline_file>",
  "current_step": "<entry_step>",
  "completed_steps": [],
  "requirement": "<requirement>",
  "shared_state": {
    "requirement": "<requirement>"
  }
}
```

### 4. Execute steps sequentially

For each step, starting from `entry`:

**Check max_visits first** — read `visit_counts` from state. If `max_visits` is set for this step and `visit_counts[step_name] >= max_visits`, stop and report error to user.

**Render the prompt** — replace `{{variable}}` in the step's prompt with values from `shared_state`.

**Execute based on type:**

- `type: agent, agent: claude` — Execute the rendered prompt directly. Your response IS the step output. Check output for `pass_keyword` at the start of a line to determine pass/fail.

- `type: agent, agent: <other>` — Run via Bash:
  ```
  <agent_binary> "<rendered_prompt>"
  ```
  Capture output. Check for `pass_keyword`.

- `type: shell` — Run each command in sequence via Bash. All must exit 0 for pass; any non-zero = fail. Capture combined output.

**Determine routing:**
- If pass and `on_pass` exists → next = `on_pass`
- If fail and `on_fail` exists → next = `on_fail`
- If `next` exists (unconditional) → next = `next`
- If none → pipeline complete

**Update state after each step** using the Bash tool. Replace `<current_step>`, `<next_step>`, and `<output>` with the actual step name, next step name, and the full captured output text:

```bash
python3 -c "
import json
from pathlib import Path
p = Path('.pipeline/pipeline.state')
s = json.loads(p.read_text())
s['completed_steps'].append('<current_step>')
s['current_step'] = '<next_step>'
s.setdefault('visit_counts', {})
s['visit_counts']['<current_step>'] = s['visit_counts'].get('<current_step>', 0) + 1
s['shared_state']['<current_step>_output'] = '''<output>'''
p.write_text(json.dumps(s, indent=2))
"
```

### 5. Terminal node

When a step has `terminal: true`, after executing it:
- Update `completed_steps`
- Set `mode` to `"free"` in state file (keep the file — do not delete it)
- Report pipeline complete to user
