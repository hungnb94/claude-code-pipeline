# ADR 0005: Use JSON `systemMessage`/`hookSpecificOutput.additionalContext` for UserPromptSubmit visibility

**Status**: Accepted
**Date**: 2026-07-01

## Context

ADR 0004's closing consequences claimed `hooks/trigger_pipeline.js` (`UserPromptSubmit`) had "no separate human-visibility gap to fix" because "it already puts full step content on stdout, which Claude Code adds to context directly." That claim is wrong: per the official hooks reference (code.claude.com/docs/en/hooks.md), plain stdout on `UserPromptSubmit` (along with `UserPromptExpansion` and `SessionStart`) is added as context for Claude to see and act on, but it is **not rendered as a visible chat message to the user**. This meant the entry step's output — including an interview step's actual question — was invisible to the user, even though Claude received it as hidden context. A user reported this directly: they never saw what the `gather_requirements` interview step was asking them.

The hooks reference documents a universal top-level `systemMessage` field ("Warning message shown to the user") that applies to any hook type, including `UserPromptSubmit`, and is rendered visibly. Separately, `UserPromptSubmit` supports a nested `hookSpecificOutput.additionalContext` field for injecting Claude-facing context — distinct from, and not rendered as, a user-visible message.

## Decision

`hooks/trigger_pipeline.js` now writes a single JSON object to stdout and exits 0:

```json
{
  "systemMessage": "<init line + human-facing step description, via buildStepDescription()>",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "<init line + full step output, same content Claude received before, via buildStepOutput()>"
  }
}
```

The entire stdout is one JSON document — no plain text is written before or after it. This matters because the hook's stdout is either treated wholesale as JSON or wholesale as plain text; mixing the two would silently fall back to raw-text handling and reintroduce the invisibility bug.

This mirrors ADR 0004's split of `buildStepDescription()` (human-facing) from `buildStepOutput()` (Claude-facing, includes the Python state-update snippet), but the two channels live in different JSON locations because `UserPromptSubmit`'s decision-control shape differs from `Stop`'s (`reason` vs `hookSpecificOutput.additionalContext`).

Error/early-exit paths (invalid pipeline file, bad entry reference, etc.) are unchanged — they remain plain-text stdout with a non-zero exit code, since that behavior was not reported as broken and is out of scope for this fix.

## Consequences

- ADR 0004's claim that `trigger_pipeline.js` had no visibility gap is superseded by this ADR.
- `tests/trigger_pipeline.test.js` asserts against `JSON.parse(result.stdout)` (`.systemMessage`, `.hookSpecificOutput.additionalContext`) for all success-path cases; error-path tests are unchanged.
- If a future need arises to make the error paths visible to the user too, treat that as a new decision, not an extension of this one.
