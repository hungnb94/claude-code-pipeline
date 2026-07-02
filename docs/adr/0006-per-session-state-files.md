# ADR 0006: Per-session state files instead of a shared state.json

**Status**: Accepted
**Date**: 2026-07-02

## Context

Pipeline state for all sessions was stored in a single file, `.pipeline/state.json`, keyed by session ID. Both `hooks/pipeline_utils.js` and `tests/helpers.js` read the whole file, mutated one session's entry, and wrote the whole file back — a non-atomic read-modify-write. Jest runs test files in parallel worker processes by default, and three test suites all exercised this same file concurrently: one worker's write could silently drop another worker's session entry written moments earlier, causing an intermittent `null`-state test failure in CI that did not reproduce under `--runInBand`.

An alternative fix — keeping the single shared file but making the read-modify-write atomic via a temp-file-plus-rename and an advisory lock — was considered as a smaller diff. It was rejected here because it still leaves one shared mutable file as the point of contention (relying on lock correctness rather than removing the possibility of contention), whereas per-session files remove the shared-file race by construction with no locking code to get wrong.

## Decision

Each session's state now lives in its own file at `.pipeline/sessions/<session_id>.json`, containing that session's state object directly (not wrapped in a session-ID-keyed map). `getSessionState`/`setSessionState` in `hooks/pipeline_utils.js` read/write only that file. The three step-advance script generators (`buildAgentUpdateBlock`, `buildInterviewUpdateBlock`, `buildShellUpdateBlock`) — which emit the `python3 -c "..."` snippets Claude runs directly between pipeline steps — were updated to the same per-file scheme.

Sessions that existed in the old `.pipeline/state.json` before this change are read via a one-time fallback: if a session's per-file doesn't exist yet, its state is read from the legacy file instead. Every write always goes to the new per-session file, so each pre-existing session self-migrates the first time it advances after this change ships.

## Consequences

- Test suites no longer share any file across parallel Jest workers — `tests/helpers.js` now delegates to `hooks/pipeline_utils.js` directly instead of re-implementing the read-modify-write logic, removing the duplicate implementation that had independently carried the same race.
- `.pipeline/state.json` is kept indefinitely as a read-only fallback source; it is never written to going forward and is not actively cleaned up. This is acceptable since it only ever shrinks in relevance as old sessions migrate, but a stale copy of long-dead sessions could in principle linger there forever.
- `.pipeline/sessions/` has the same unbounded-growth characteristic the old single file had (nothing garbage-collects finished sessions) — just spread across many small files instead of one growing blob. Session cleanup remains out of scope for this change.
- `CONTEXT.md`'s "Pipeline State" and "Pipeline State File" entries are updated to describe the per-session-file format and the legacy fallback.
