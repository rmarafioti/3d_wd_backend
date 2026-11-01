#!/usr/bin/env bash
# Opens one reminder issue for .github/workflows/reminders.yml: open.sh <kind> <title> <body file>.
# Skips it while an earlier reminder of the same kind is still open, so reminders never pile up.
# The labels are created (or updated) first, so a fresh repo needs no setup.
set -euo pipefail

kind=$1
title=$2
body_file=$3

gh label create reminder --color FBCA04 --description 'A scheduled reminder' --force
gh label create "$kind" --color 0E8A16 --description "Reminder: $kind" --force

open=$(gh issue list --label "$kind" --state open --json number --jq 'length')
if [ "$open" -gt 0 ]; then
  echo "A $kind reminder is still open: skipped \"$title\"."
  exit 0
fi

gh issue create --title "$title" --body-file "$body_file" --label reminder --label "$kind"
