#!/usr/bin/env bash
# Commit data files produced by a workflow and push them back to the same branch.
set -euo pipefail
msg="${1:?commit message}"
shift
if [ "$#" -eq 0 ]; then
  echo "no paths"
  exit 1
fi
git config user.name "kikar-radio-bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add "$@"
if git diff --cached --quiet; then
  echo "no changes"
  exit 0
fi
git commit -m "$msg"
branch="${GITHUB_REF_NAME:?}"
git fetch origin "$branch"
git pull --rebase origin "$branch"
git push origin "HEAD:${branch}"
