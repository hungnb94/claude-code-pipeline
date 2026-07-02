# ADR 0002: Write progress header to stderr for user visibility

**Status**: Superseded (2026-07-01)  
**Date**: 2026-06-15

## Superseded

The progress header was removed entirely. The `/pipeline:setup-statusline` skill (added after this ADR) reads the per-session state file at `.pipeline/sessions/<session_id>.json` (falling back to the legacy `.pipeline/state.json` for pre-migration sessions — see ADR 0006) and renders a persistent, superset equivalent (`[pipeline-name] ✅ prev-step → 🔄 current-step`, plus retry count) in the status line — making the per-step stderr notification redundant. See `CONTEXT.md` (Setup Statusline Skill) for the replacement.

## Context

Each pipeline step emits a progress header (`🔄 plan`, `✅ plan → 🔄 review`, …) so the user can follow execution. Both hooks wrote this header only to stdout. Claude Code injects hook stdout into Claude's context but does not render it in the user-facing transcript — users never saw the header.

Two options:

1. **stderr only** — write the header to `process.stderr`. Claude Code displays hook stderr as a visible notification in the UI (confirmed for `Stop` exit-2 hooks; also applies to `UserPromptSubmit` exit-0 hooks). The header still appears in Claude's context via stdout (unchanged).
2. **JSON `systemMessage`** — for the `UserPromptSubmit` hook (exit 0), output `{ systemMessage: header, hookSpecificOutput: { ... } }` as JSON on stdout. Claude Code surfaces `systemMessage` as a UI notification without changing what Claude receives.

## Decision

Write the progress header to **stderr** in both hooks, keep stdout unchanged.

## Reasoning

stderr works identically in both hooks and requires one line of code per hook. The JSON `systemMessage` format is only needed if stderr proves invisible for the `UserPromptSubmit` hook — empirical testing showed stderr works there too. Adding JSON output would require changing the stdout format, updating all stdout assertions in the test suite, and coupling the implementation to an undocumented JSON protocol.

## Consequences

- `hooks/check_pipeline.js` and `hooks/trigger_pipeline.js` each add one `process.stderr.write(header + '\n')` call.
- The header is written to both stderr (user-visible notification) and stdout (inside the step prompt Claude receives) — intentional duplication.
- Tests assert `result.stderr` contains the expected header string alongside the existing `result.stdout` assertions.
- If a future Claude Code version changes how stderr is displayed, the fallback is the JSON `systemMessage` format described above.
