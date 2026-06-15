# ADR 0001: Native Claude Code plugin format over npm or MCP

**Status**: Accepted  
**Date**: 2026-06-15

## Context

We want to distribute `claude-code-pipeline` so users can install it globally — once, works in any project — without manually copying hook scripts or editing `~/.claude/settings.json`.

Three realistic options existed:

1. **npm package with postinstall** — `npm install -g claude-code-pipeline` runs a script that copies hooks to `~/.claude/hooks/` and merges entries into `~/.claude/settings.json`.
2. **MCP server** — wrap the pipeline engine as an MCP server exposing tools (`run_pipeline`, `advance_step`, etc.). Users configure via `claude mcp add`.
3. **Native Claude Code plugin** — a git repo with `.claude-plugin/plugin.json`, `hooks/hooks.json`, and `skills/`. Distributed via a marketplace catalog (`marketplace.json`); installed with `/plugin marketplace add` + `/plugin install`.

## Decision

Use the **native Claude Code plugin format**.

## Reasoning

**Against MCP**: The pipeline's core value is autonomous step-chaining — the `Stop` hook fires after Claude responds and injects the next step prompt without user intervention. MCP tools are called _by Claude_, not by the harness, so the Stop hook's auto-continuation behavior cannot be replicated via MCP. Switching to MCP would gut the self-driving mechanic.

**Against npm postinstall**: Silently editing `~/.claude/settings.json` during `npm install -g` is surprising and hard to reverse cleanly. It also creates fragile absolute paths that break when users switch Node versions via `nvm` or `volta`.

**For native plugin**: Claude Code's plugin system handles hook registration natively via `hooks/hooks.json` using `${CLAUDE_PLUGIN_ROOT}` — no path management, no settings.json editing by the installer. Install is one command, uninstall is one command. Distribution is a git repo with no build step.

## Consequences

- `hooks/hooks.json` uses `${CLAUDE_PLUGIN_ROOT}` to locate the hook executable (e.g. `node ${CLAUDE_PLUGIN_ROOT}/hooks/check_pipeline.js`). Inside the hook scripts, project-relative paths are resolved using `CLAUDE_PROJECT_DIR`, which Claude Code sets to the user's project root when invoking hooks.
- Skills are namespaced: `/pipeline:run` instead of `/run-pipeline`. This is a breaking change for existing users of the standalone configuration.
- Distribution is git-first via a self-contained marketplace: the repo itself serves as both the marketplace catalog (`.claude-plugin/marketplace.json`) and the plugin source. Install is two commands: `/plugin marketplace add hungnb94/claude-code-pipeline` then `/plugin install pipeline@claude-code-pipeline`.
