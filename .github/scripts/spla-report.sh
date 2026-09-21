#!/usr/bin/env bash
# SPLA WHITE-LABEL: report something a person has to act on.
#
# Prefers a GitHub issue, deduplicated by title so a weekly job does not open
# the same one every Monday. Forks have Issues disabled by default, so when
# that channel is unavailable the report goes to the job summary and the run is
# failed instead — a red run still sends the usual "Run failed" notification,
# and losing the report entirely is not an option.
#
# Usage: spla-report.sh <title> <body-file>
set -euo pipefail

title=$1
body=$2

{
  echo "## ${title}"
  echo
  cat "$body"
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

# `gh issue list` fails outright when Issues are disabled, which is how we tell
# the two cases apart without querying the repository settings.
if open_titles=$(gh issue list --state open --limit 200 --json title --jq '.[].title' 2>/dev/null); then
  if grep -qxF "$title" <<<"$open_titles"; then
    echo "Already open as an issue; nothing to do."
    exit 0
  fi
  if gh issue create --title "$title" --body-file "$body"; then
    exit 0
  fi
fi

echo "::error::${title} — could not open an issue, so this run is failed to notify you. \
The full report is in the job summary. Enable Issues on this repository to get one instead."
exit 1
