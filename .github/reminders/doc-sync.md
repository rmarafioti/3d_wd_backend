The biweekly Documentation Sync: checks the frontend and the Stevie The Dog pilot repo against this repo's docs, the source of truth (`CLAUDE.md` → Documentation Sync).

## What to do

1. Open a Claude Code session in each repo: `3d_wd_backend`, `3d_wd` and `stevie_the_dog`. The sync stops if the other two aren't open, since fixes are handed to them.
2. In the backend session, on an up-to-date `main`, type `/doc-sync` (or `/doc-sync master` to audit the master doc too).
3. Decide each finding. Backend fixes go on a branch here; the frontend and Stevie fixes go to their sessions as handoffs; the report lists which client repo md files to copy from Stevie by hand.
4. Close this issue once the three repos agree (and the master doc, if it was audited).
