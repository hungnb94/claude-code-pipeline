# AGENTS.md — Instructions for Claude

## Project identity

This is a **Claude Code plugin** that enables multi-step automated pipelines defined in YAML.

Key paths:
- `skills/run/` — the `/pipeline:run` skill
- `hooks/trigger_pipeline.js` — `UserPromptSubmit` hook; initializes pipeline state and injects step 1
- `hooks/check_pipeline.js` — `Stop` hook; drives continuation after each step
- `hooks/pipeline_utils.js` — shared utilities for both hooks
- `tests/` — Jest test suite (`npm test`)
- `.claude-plugin/plugin.json` — plugin manifest (name, version)
- `package.json` — also holds the version string

## Conventions

- **Canonical terminology** comes from `CONTEXT.md`. Use those exact terms (Pipeline, Step, Routing, Shared State, etc.) — do not invent synonyms.
- When a new domain term is introduced or resolved, update `CONTEXT.md` immediately. Keep it a pure glossary — no implementation details, no specs.
- Do not create `.md` files (docs, READMEs, plans) unless explicitly requested.

## Development rules

- **Never hand-edit the version string** in `package.json` or `.claude-plugin/plugin.json`. Version bumps go through the `bump_version` pipeline step, which picks the correct semver level and updates both files atomically.
- Both `package.json` and `.claude-plugin/plugin.json` must always hold the same version value — treat a mismatch as a bug.
