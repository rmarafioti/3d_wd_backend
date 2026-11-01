The monthly dependency audit found advisories. It runs the full `npm audit`, dev dependencies included, and reports moderate, high and critical. CI only fails on high advisories in production dependencies (`npm audit --omit=dev --audit-level=high`), so these would otherwise go unseen.

## What to do

1. Open a session and read this issue (`CLAUDE.md` → Issue Workflow).
2. On a branch: `npm audit fix` (never `--force` without a plan), then the full test suite. A package that needs a major upgrade gets its own plan.
3. An advisory that can't be fixed yet (no fix available, or the fix breaks something) is written in `docs/security.md` → Dependencies as accepted, with the reason.
4. Close this issue once the PR merges or each advisory is accepted.
