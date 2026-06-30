# Guard State Hook Protects Only state.json

The `guard_state.sh` PreToolUse hook protects `.pipeline/state.json` but not `.pipeline/pipeline.yaml`. State.json is owned exclusively by the hooks (trigger_pipeline.js, check_pipeline.js) — Claude writing it directly would corrupt execution state. Pipeline.yaml is user-owned config that Claude may legitimately edit when instructed. Initially both files were protected, but that blocked legitimate pipeline editing tasks and was reverted.
