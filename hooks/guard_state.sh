#!/usr/bin/env bash

input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // ""' 2>/dev/null || true)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""' 2>/dev/null || true)
command=$(echo "$input" | jq -r '.tool_input.command // ""' 2>/dev/null || true)

PROTECTED=(".pipeline/state.json")

for protectedFile in "${PROTECTED[@]}"; do
  if [[ "$tool_name" == "Edit" || "$tool_name" == "MultiEdit" || "$tool_name" == "Write" ]] && [[ "$file_path" == *"$protectedFile"* ]]; then
    echo "{\"decision\": \"block\", \"reason\": \"$protectedFile is protected. Do not edit it directly — it is managed by pipeline hooks.\"}"
    exit 0
  fi
  if [[ "$tool_name" == "Bash" ]] && [[ "$command" == *"$protectedFile"* ]] && \
     [[ "$command" =~ (write_text|writeFile|open\(.*,.*w|>[[:space:]]|>>[[:space:]]|sed[[:space:]]+-i|tee[[:space:]]+) ]]; then
    echo "{\"decision\": \"block\", \"reason\": \"$protectedFile is protected. Do not modify it via shell commands.\"}"
    exit 0
  fi
done
