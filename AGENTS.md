# Mathodology Agent Guide

This repository is skills-only. The current GitHub tree intentionally contains no application source, CI, deployment, generated contracts, datasets, package manifests, lockfiles, or build outputs.

Project skills for AI coding tools live in `.claude/skills/`.

Before non-trivial work, load the relevant skill:

- `mathodology-whole-project` for full skills-repository orientation, backup, transfer, or restore work.
- `mathodology-project-orientation` for the current skills-only layout, retained files, deletion policy, and repository boundary checks.
- `mathodology-agent-pipeline` for archived knowledge about the former Python agent pipeline.
- `mathodology-gateway-api` for archived knowledge about the former Rust gateway and API.
- `mathodology-web-ui` for archived knowledge about the former Vue web UI.
- `mathodology-dev-test-release` for skills-only validation and archived dev, test, deploy, packaging, and release guidance.
- `mathodology-skill-authoring` for adding or updating `SKILL.md` files and `agents/openai.yaml` metadata.

Do not reintroduce non-skills project files unless the user explicitly changes the repository strategy. If historical application code is needed, inspect Git history in a separate branch or worktree instead of adding it back to `main`.
