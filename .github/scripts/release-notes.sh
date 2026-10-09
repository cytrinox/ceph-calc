#!/usr/bin/env bash
# Release notes for a version tag: the merged PRs (GitHub's generated notes) and all commits since
# the previous version tag. Without GITHUB_REPOSITORY (local runs) only the commits are printed.
#
#   usage: release-notes.sh vX.Y.Z
set -euo pipefail

tag="$1"
# Previous version tag before this one; empty for the first release (then: the whole history).
prev=$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' "$tag^" 2>/dev/null || true)

if [ -n "${GITHUB_REPOSITORY:-}" ]; then
  # "What's Changed" (merged PRs), "New Contributors" and the full-changelog link, for the same range.
  gh api "repos/$GITHUB_REPOSITORY/releases/generate-notes" -f tag_name="$tag" \
    ${prev:+-f previous_tag_name="$prev"} --jq .body
  echo
fi

echo "## Commits"
echo
# Newest first; merge commits only repeat the PRs above.
git log --no-merges --format='- %s (%h) by %an' "${prev:+$prev..}$tag"
