# Mathodology Agent Guide

This repository is skills-only. The current GitHub tree intentionally contains no application source, CI, deployment, generated contracts, datasets, package manifests, lockfiles, or build outputs.

Project skills for AI coding tools live in `.claude/skills/`.
Claude Code project subagents live in `.claude/agents/`.
Claude Code workflow templates live in `.claude/workflows/`.

Before non-trivial work, load the relevant skill:

- `mathodology-whole-project` for full skills-repository orientation, backup, transfer, restore, and Codex or Claude Code orchestration.
- `mathodology-project-orientation` for the current skills-only layout, retained files, deletion policy, and repository boundary checks.
- `mathodology-agent-pipeline` for archived knowledge about the former Python agent pipeline and the new award-level phase workflow.
- `mathodology-gateway-api` for archived knowledge about the former Rust gateway and API.
- `mathodology-web-ui` for archived knowledge about the former Vue web UI.
- `mathodology-dev-test-release` for skills-only validation and archived dev, test, deploy, packaging, and release guidance.
- `mathodology-skill-authoring` for adding or updating `SKILL.md` files and `agents/openai.yaml` metadata.

For Claude Code, prefer `.claude/workflows/mathodology-award-submission.md` with the `mathodology-*` project subagents.

For Codex, run the 9-phase workflow in multi-agents mode from `docs/WORKFLOWS.md`: dispatch independent agents per phase, synthesize, then gate with an independent critic before continuing.

Do not reintroduce non-skills project files unless the user explicitly changes the repository strategy. If historical application code is needed, inspect Git history in a separate branch or worktree instead of adding it back to `main`.
