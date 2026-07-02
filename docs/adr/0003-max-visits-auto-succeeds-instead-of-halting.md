# ADR 0003: max_visits auto-succeeds and advances instead of halting

**Status**: Accepted
**Date**: 2026-07-01

## Context

Previously, when a step's `visit_counts` reached its `max_visits`, `hooks/check_pipeline.js` halted the pipeline with an error and never advanced `current_step` — the session stayed stuck on that step until someone manually edited `.pipeline/state.json`. In practice, a step that keeps failing after many retries (e.g. a lint-fix cycle that can't converge) is more useful to skip than to block the whole pipeline on indefinitely.

## Decision

When `visits >= max_visits`, the step is treated as if it succeeded: it's appended to `completed_steps` and the pipeline advances to `step.next` (the same field used for the success path — `next_fail` is never consulted here, since this isn't a failure route). If the step has no `next`, the pipeline ends (`mode: 'free'`), matching how any other step with no `next` ends the pipeline. Both `reason` (to Claude) and the visible message are prefixed with a warning naming which step(s) were auto-skipped.

If advancing lands on another step that is _also_ already maxed out, the same logic repeats (a loop in the hook). A `seen` set guards against two or more maxed-out steps forming a cycle via `next` — if a step recurs within the same hook invocation, the pipeline halts with a clear cycle error instead of looping forever inside the Node process.

## Consequences

- `CONTEXT.md`'s "Max Visits" entry is updated to describe auto-advance instead of halting.
- A cyclic pipeline graph where every step in the cycle is simultaneously maxed out is the one case that still halts — this is intentionally treated as an unrecoverable configuration error, not something to silently loop past.
- Silent forward progress trades a hard, visible stop for a pipeline that always finishes (or explicitly errors on a genuine cycle) — appropriate for this pipeline's own dogfooding use, where a stuck retry step is more costly than skipping it. Pipeline authors who need a hard stop instead should ensure `max_visits` is high enough that it's never expected to trigger, since it is no longer a failure/halt path.
