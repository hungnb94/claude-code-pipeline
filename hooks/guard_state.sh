#!/usr/bin/env bash

input=$(cat)

tool_name=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || true)
file_path=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null || true)
command=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null || true)

PROTECTED=(".pipeline/state.json" ".pipeline/pipeline.yaml")

for f in "${PROTECTED[@]}"; do
  if [[ "$tool_name" == "Edit" || "$tool_name" == "Write" ]] && [[ "$file_path" == *"$f"* ]]; then
    echo "{\"decision\": \"block\", \"reason\": \"$f is protected. Do not edit it directly — it is managed by pipeline hooks.\"}"
    exit 0
  fi
  if [[ "$tool_name" == "Bash" ]] && [[ "$command" == *"$f"* ]] && \
     [[ "$command" =~ (write_text|writeFile|open\(.*,.*w|>[[:space:]]|>>[[:space:]]|sed[[:space:]]+-i|tee[[:space:]]+) ]]; then
    echo "{\"decision\": \"block\", \"reason\": \"$f is protected. Do not modify it via shell commands.\"}"
    exit 0
  fi
done
