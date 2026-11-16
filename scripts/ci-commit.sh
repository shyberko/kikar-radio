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
for attempt in 1 2 3 4 5 6; do
  git fetch origin "$branch"
  if ! git rebase "origin/$branch"; then
    echo "rebase conflict on attempt ${attempt}; aborting and retrying"
    git rebase --abort || true
    sleep $((attempt * 2))
    continue
  fi
  if git push origin "HEAD:${branch}"; then
    exit 0
  fi
  echo "push rejected on attempt ${attempt}"
  sleep $((attempt * 2))
done
echo "could not publish commit after 6 attempts"
exit 1
