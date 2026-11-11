---
name: doc-sync
description: The Documentation Sync from CLAUDE.md, step by step. Checks this repo's docs against its code, then the frontend (3d_wd) and the shared client guide (client-kit's docs/cms/) against the backend, the source of truth, and reports findings with a handoff for the frontend.
disable-model-invocation: true
---

# /doc-sync

The procedure for `CLAUDE.md` → Documentation Sync. `CLAUDE.md` holds when to sync; this file is the only copy of how (the tiers, the client guide rule and the steps), so every run is the same. A change to Documentation Sync, or to the Code Review checks step 2 reuses, changes both files in the same PR.

## 1. Purpose and when

Three repos describe the same system: this backend (the source of truth), the frontend `3d_wd`, and `client-kit`, whose `docs/cms/` is the client guide. `client-kit`'s Sync workflow copies `docs/cms/` unchanged into every client repo, and each client repo's CI fails when its copy differs, so the guide is checked once, in `client-kit`, and no client repo is read. `client-kit` is maintained from this backend session (`CLAUDE.md` → Documentation Sync). The sync keeps the three from drifting. It finds differences; the frontend's fixes are made by its own session.

Run it:

- from the "Documentation Sync" reminder issue, which opens after merges in either repo (`docs/process.md` → Reminders);
- after a change to the API contract, the schema or a flow, once it is merged in both repos, whatever the date;
- before a production deploy;
- whenever Rich asks.

Not in the middle of other work, and not on a branch with changes not yet on `main` (the sync compares `main`s).

## 2. Arguments

None. The master doc isn't synced: it holds only the business (`CLAUDE.md` → Documentation Sync).

## 3. Preconditions, checked first

Check each in order. If one fails, stop and tell Rich which, and how to fix it. Never work around it.

1. **Session open.** `ListAgents` lists a Claude Code session in `3d_wd`. Its fixes are handed to it, so if it is missing, ask Rich to open it and stop.
2. **This repo:** `git fetch origin`, then `git status` shows `main`, up to date with `origin/main`, and a clean tree.
3. **The sibling folders:** `../3d_wd` (or `FRONTEND_DIR`) has origin `rmarafioti/3d_wd`, and `../client-kit` has origin `rmarafioti/client-kit` (`git -C <dir> remote get-url origin`). Then `git -C <dir> fetch origin` in each. Both are read only at `origin/main` with `git show origin/main:<path>`, so their working trees and branches don't matter.

## 4. Scope

- **Backend (the truth):** `CLAUDE.md`, every file in `docs/` but `docs/proposal-notes.md` (the business Proposal's notes, not synced), `README.md`, `.env.example`.
- **Frontend:** `CLAUDE.md`, `AGENTS.md`, `README.md`, every file in `docs/` (`git -C ../3d_wd ls-tree --name-only origin/main docs/`).
- **client-kit:** `README.md` and every file in `docs/cms/` (`git -C ../client-kit ls-tree --name-only origin/main docs/cms/`).
- **Client repos:** not read. Their `docs/cms/` is `client-kit`'s, enforced by their CI, and their `docs/site.md` is site-specific.

## 5. Steps

Each step names what counts as a finding. A difference in wording that changes no fact is not one, except in the identical tier.

### Step 1: Sessions

Done in Preconditions. Note the frontend session's name for the handoff.

### Step 2: The truth first

This repo's docs must match this repo's code before anything is compared, or the sync copies drift into the other repos. Run `/code-sweep`'s step 6 (Docs match code) as written in `.claude/skills/code-sweep/SKILL.md`, over the whole repo, fresh on every run: never reuse an earlier sweep's or sync's results, even from the same session, since the files may have changed since. Each mismatch is a finding (**doc**, or **bug** where the code is wrong). Go on with the docs as they are, and say in the handoffs which backend facts are about to change.

### Step 3: Identical tier

`npm run check:sync`. It compares the API Contract section of `docs/endpoints.md` with the frontend's `docs/api.md`, the guard hook and its tests, and `docs/process.md` (the shared process) with the frontend's copies. Each `differs` or `missing` is a finding, with the diff it printed.

### Step 4: Frontend docs

The frontend's other docs point to the backend's rules rather than restating them (the shared process is `docs/process.md`, checked in step 3). Check:

- **Backend facts:** each backend fact the frontend's docs state (a route, a status code, a message, a limit, a field, a cookie or CSRF rule, an environment or release step) is still true. Don't audit their UI content.
- **Features:** its Features list matches `CLAUDE.md` → Features, one line per Feature, the frontend-only Features included.
- **Planned Later:** it points to the backend's `later` issues (`CLAUDE.md` → Planned Later) rather than keeping its own list.
- **Current progress:** its own state, with no contradiction of the backend's Now and Next.

Finding: a stale backend fact, a Feature missing or different, or a restated rule that belongs in a pointer.

### Step 5: client-kit

`docs/cms/` (the base `client-website.md` and each ability doc) and `README.md` against:

- `docs/endpoints.md` → API Contract: `PublicPost`, `PublicGallery`, the public routes and their errors (`401` "Invalid API key.", `404` "Gallery not found.", `429`), the rate limit;
- `docs/endpoints.md` → Revalidation: the method, path, `Authorization: Bearer` header, body (`{ websiteId, postId }`, `{ websiteId, galleryId }` or `{ websiteId, ability }`), the 5-second timeout, and that the route mustn't require `postId`;
- `docs/endpoints.md` → Paragraph formatting: the rules and every example row;
- `docs/setup.md` → Client websites: the `remotePatterns` rows, the gallery crop rows included;
- `docs/client-website-test.md`: the env vars and the steps Tests A–C rely on.

Finding: a contradiction, something site-specific in `docs/cms/`, an ability doc that copies the base's code instead of linking to it, or a public feature the backend serves that no ability doc describes yet.

## 6. Hard rules

- Read-only in every repo until Rich decides the findings. Backend fixes then go on a branch here, as usual.
- Never edit the frontend or any client repo. The frontend's fixes go to its session as a handoff, sent with `SendMessage` only once Rich agrees to the findings. `client-kit`'s fixes are made from this session, on a branch in `client-kit`, once Rich decides them.
- Never read or print `.env` or `.env.*` in any repo.
- Nothing against staging or production.
- Never comment on, edit or close an issue: Rich closes the reminder.
- The guard hook (`.claude/hooks/guard.js`) and `.claude/settings.json` still apply; a refused command is reported, not worked around.

## 7. When a step fails

- The frontend session isn't open, a sibling folder is missing or isn't the right repo, or `git fetch` fails: stop (Preconditions).
- `npm run check:sync` exits 1: each difference is a finding; go on.
- A file listed in Scope is missing in a repo: a finding (**decision**: is it gone on purpose?); go on.

## 8. Output

1. **Findings** in the `/code-sweep` Output format, most important first: **file:line** (with the repo), the **tier** (identical, frontend docs, client-kit) in place of the checklist item, **what differs**, the **proposed fix**, and its **type** (bug, cleanup, doc or decision). Where the other repo is right and the backend is wrong or missing something, the finding is a **decision** for Rich, never a plan to overwrite the other repo.
2. **A handoff for the frontend** when it has findings, in `docs/process.md` → Cross-Repo Handoff's form, for a reader with no context: what changed in the backend and on which branch, each fix to make with the backend text to match, and a "done when" checklist. Shown to Rich first; sent with `SendMessage` once he agrees.
3. **What was checked:** each step and its result in one line, with the commits read (`origin/main` of each repo). A sync with no findings still reports this.

## 9. After

- Rich decides each finding.
- Backend fixes: a branch here (a docs fix rides on the next real branch where one is open).
- `client-kit` fixes: a branch in `client-kit` from this session. Once merged, its Sync workflow opens the client repos' pull requests.
- The handoff goes to the frontend session, which fixes its own docs on its own branch.
- Rich closes the reminder issue once all of that is done.

## 10. Done when

- [ ] The frontend session open, and every precondition checked
- [ ] Step 2 run, with this repo's drift reported
- [ ] `npm run check:sync` run
- [ ] Every check of step 4 and every source of step 5 compared
- [ ] Findings, handoffs and what was checked reported
