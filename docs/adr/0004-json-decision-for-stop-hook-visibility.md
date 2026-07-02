# ADR 0004: Use JSON `decision`/`systemMessage` instead of stderr for Stop hook visibility

**Status**: Accepted
**Date**: 2026-07-01

## Context

ADR 0002 assumed that `Stop` hook `stderr` + `exit(2)` is rendered as a visible notification in the normal Claude Code chat transcript. That assumption was wrong: per the official hooks reference (code.claude.com/docs/en/hooks.md), `stderr` on a blocked `Stop` hook is only fed back to Claude internally — it is not shown to the human user in the normal transcript, only in Ctrl+R transcript mode. This meant users had no visibility into which pipeline step was executing or why the assistant kept going after appearing to finish.

The Stop-hook-specific JSON output protocol supports combining `decision: "block"` + `reason` (equivalent to `exit(2)` + stderr, for Claude only) with a `systemMessage` field, which Claude Code renders directly in the normal chat transcript.

## Decision

`hooks/check_pipeline.js` now writes a single JSON object to stdout and exits 0:

```json
{ "decision": "block", "reason": "<full step output, same content Claude received before>", "systemMessage": "<step header + prompt/commands, no state-update code>" }
```

`reason` is unchanged from the old stderr payload (`buildStepOutput`), so Claude's behavior is unaffected. `systemMessage` is a new, human-facing rendering built by `buildStepDescription()` in `hooks/pipeline_utils.js` — it omits the Python state-update snippet (`buildAgentUpdateBlock`/`buildShellUpdateBlock`), which is plumbing for Claude, not something a human needs to read. `buildStepOutput` now composes `buildStepDescription()` + the update block, so the two channels share formatting code instead of duplicating it.

The `max_visits` halt path uses the same `decision`/`reason`/`systemMessage` shape, since a stuck pipeline is exactly the case where the user most needs visibility.

## Consequences

- ADR 0002 remains Superseded (progress header removed); this ADR does not revive it — `systemMessage` here carries per-step content, not a progress header.
- `hooks/check_pipeline.js` exits 0 in all cases (JSON `decision` controls blocking, not the process exit code).
- `tests/check_pipeline.test.js` asserts against parsed `JSON.parse(result.stdout)` (`decision`, `reason`, `systemMessage`) instead of `result.stderr` + exit code 2.
- **Correction (see ADR 0005):** this ADR originally claimed `hooks/trigger_pipeline.js` (`UserPromptSubmit`) had no separate human-visibility gap because its stdout was added to Claude's context directly. That assumption was wrong — `UserPromptSubmit` stdout is context-only and is not shown to the user either. ADR 0005 fixes this with the same `systemMessage` mechanism, applied via `hookSpecificOutput.additionalContext` for the Claude-facing channel.
