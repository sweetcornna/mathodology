#!/usr/bin/env bash
set -euo pipefail

repo_root="${1:-}"
if [[ -z "$repo_root" ]]; then
  repo_root="$(git rev-parse --show-toplevel)"
fi
repo_root="$(cd "$repo_root" && pwd)"

out_root="${2:-"$repo_root/../mathodology_skills_backups"}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$out_root/$timestamp"
archive_name="mathodology-skills-$timestamp.tar.gz"
archive_path="$backup_dir/$archive_name"

mkdir -p "$backup_dir"

git -C "$repo_root" status --short --branch > "$backup_dir/git-status.txt"
git -C "$repo_root" diff --binary > "$backup_dir/uncommitted-diff.patch"
git -C "$repo_root" ls-files --others --exclude-standard > "$backup_dir/untracked-files.txt"

(
  cd "$repo_root"
  git ls-files -z --cached --others --exclude-standard |
    while IFS= read -r -d '' path; do
      case "$path" in
        .claude/skills/*|.claude/agents/*|.claude/workflows/*|docs/*|AGENTS.md|README.md|README_en.md|LICENSE|.gitignore)
          if [[ -e "$path" ]]; then
            printf '%s\0' "$path"
          fi
          ;;
      esac
    done
) > "$backup_dir/source-files.nul"

(
  cd "$repo_root"
  tar -czf "$archive_path" --null -T "$backup_dir/source-files.nul"
)

tar -tzf "$archive_path" > "$backup_dir/archive-files.txt"

if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$archive_path" > "$backup_dir/SHA256SUMS"
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$archive_path" > "$backup_dir/SHA256SUMS"
else
  printf 'No sha256 tool found; archive checksum not generated.\n' > "$backup_dir/SHA256SUMS"
fi

printf 'backup_dir=%s\n' "$backup_dir"
printf 'archive=%s\n' "$archive_path"
printf 'files=%s\n' "$(wc -l < "$backup_dir/archive-files.txt" | tr -d ' ')"
printf 'bytes=%s\n' "$(wc -c < "$archive_path" | tr -d ' ')"
