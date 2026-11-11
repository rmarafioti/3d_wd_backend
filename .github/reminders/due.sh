#!/usr/bin/env bash
# Decides whether an activity reminder is due (docs/process.md → Reminders): due.sh <kind> <repo>...
# prints "open" or "skip", and logs the merge count behind it to stderr.
set -euo pipefail

# A reminder opens once this many PRs have merged, or once this many weeks have passed with any.
SPRINT_THRESHOLD=5
FLOOR_WEEKS=2
# The code sweep doesn't count merges from docs/ branches, which change no code to sweep.
SWEEP_SKIPS_PREFIX=docs/

kind=$1
shift

# TODAY, CLOSED_AT, MERGED and DOCS_MERGED stand in for the clock and the gh calls, to test the
# rule offline.
today=${TODAY:-$(date -u +%F)}

# The newest close of a reminder of this kind, or "" when none has been closed yet.
if [ -z "${CLOSED_AT+set}" ]; then
  CLOSED_AT=$(gh issue list --label "$kind" --state closed --limit 100 --json closedAt \
    --jq 'map(.closedAt) | max // ""')
fi

if [ -n "$CLOSED_AT" ]; then
  since=$CLOSED_AT
  closed_day=${CLOSED_AT%%T*}
  # Weeks count from the Monday of the close's ISO week, so a reminder closed on any day of a week
  # opens on the same Monday.
  week_start=$(date -u -d "$closed_day -$(($(date -u -d "$closed_day" +%u) - 1)) days" +%F)
  weeks=$((($(date -u -d "$today" +%s) - $(date -u -d "$week_start" +%s)) / 604800))
else
  since=$(date -u -d "$today -14 days" +%F)
  weeks=$FLOOR_WEEKS
fi

# The REST list, not search: search silently drops what the token can't read, where the list
# fails the run. A PR is updated when it merges, so the 100 most recently updated closed PRs hold
# every merge since the close, unless more than 100 were updated since.
# Each repo gives two numbers: its merges since the close, and how many came from docs/ branches.
if [ -z "${MERGED+set}" ]; then
  MERGED=0
  DOCS_MERGED=0
  for repo in "$@"; do
    counts=$(gh api "repos/$repo/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100" \
      --jq "[.[] | select(.merged_at != null and .merged_at > \"$since\")]
        | \"\\(length) \\(map(select(.head.ref | startswith(\"$SWEEP_SKIPS_PREFIX\"))) | length)\"")
    read -r count docs_count <<<"$counts"
    MERGED=$((MERGED + count))
    DOCS_MERGED=$((DOCS_MERGED + docs_count))
  done
fi

counted=$MERGED
summary="$kind: PRs merged to main in $* since $since: $MERGED"
if [ "$kind" = code-sweep ] && [ "${DOCS_MERGED:-0}" -gt 0 ]; then
  counted=$((MERGED - DOCS_MERGED))
  summary="$summary, $DOCS_MERGED from $SWEEP_SKIPS_PREFIX branches not counted: $counted"
fi
summary="$summary, week $weeks"
if [ "$counted" -eq 0 ]; then
  echo "$summary: skipped, nothing to check." >&2
  echo skip
elif [ "$counted" -ge "$SPRINT_THRESHOLD" ]; then
  echo "$summary: due, $SPRINT_THRESHOLD or more merged." >&2
  echo open
elif [ "$weeks" -ge "$FLOOR_WEEKS" ]; then
  echo "$summary: due, $FLOOR_WEEKS weeks have passed." >&2
  echo open
else
  echo "$summary: skipped until $FLOOR_WEEKS weeks have passed or $SPRINT_THRESHOLD PRs merge." >&2
  echo skip
fi
