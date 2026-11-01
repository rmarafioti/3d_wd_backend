The biweekly code sweep: `CLAUDE.md` → Code Review → Checklist over the code changed since the last sweep, plus the whole-repo checks (docs match code, the architecture rules, tooling). Per-step self-reviews only see one diff, so drift between files builds up unseen.

## What to do

1. Open a Claude Code session in this repo, on an up-to-date `main`, with the local Postgres running.
2. Type `{{COMMAND}}`.
3. Decide each finding. Fixes become their own issue or branch; the sweep itself changes nothing.
4. Paste the tracker row the sweep prints into the Code Sweep Tracker sheet.
5. Close this issue once the findings are settled.
