The biweekly Documentation Sync: checks the frontend and the shared client guide (`client-kit`'s `docs/cms/`) against this repo's docs, the source of truth (`CLAUDE.md` → Documentation Sync).

## What to do

1. Open a Claude Code session in `3d_wd_backend` and one in `3d_wd`. The sync stops if the frontend's isn't open, since its fixes are handed to it.
2. In the backend session, on an up-to-date `main`, type `/doc-sync`.
3. Decide each finding. Backend fixes go on a branch here, `client-kit` fixes on a branch in `client-kit` from the backend session (its Sync workflow then updates the client repos), and the frontend's go to its session as a handoff.
4. Close this issue once the repos agree.
