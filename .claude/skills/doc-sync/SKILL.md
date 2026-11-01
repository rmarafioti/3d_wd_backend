---
name: doc-sync
description: The Documentation Sync from CLAUDE.md, step by step. Checks this repo's docs against its code, then the frontend (3d_wd) and the Stevie The Dog pilot repo against the backend, the source of truth, and reports findings with a handoff for each repo. `master` also audits the master doc.
argument-hint: '[master]'
disable-model-invocation: true
---

# /doc-sync

The procedure for `CLAUDE.md` → Documentation Sync. `CLAUDE.md` holds the rules (when to sync, the tiers, the master doc's copy-tab rules); this file holds the steps, so every run is the same. A change to Documentation Sync, or to the Code Review checks step 2 reuses, changes both files in the same PR.

Arguments: `$ARGUMENTS`

## 1. Purpose and when

Three repos describe the same system: this backend (the source of truth), the frontend `3d_wd`, and Stevie The Dog (`stevie_the_dog`), the client-side pilot whose `docs/client-website.md` every client repo copies and tailors. The sync keeps them from drifting. It finds differences; fixes are made in each repo by its own session.

Run it:

- every 2 weeks, from the "Documentation Sync" reminder issue (`.github/workflows/reminders.yml`);
- after a change to the API contract, the schema or a flow, once it is merged in both repos, whatever the date;
- before a production deploy;
- whenever Rich asks.

Not in the middle of other work, and not on a branch with changes not yet on `main` (the sync compares `main`s).

## 2. Arguments

- none: the three repos (steps 1–7).
- `master`: the three repos, then the master doc (step 8), only once the three repos agree.

## 3. Preconditions, checked first

Check each in order. If one fails, stop and tell Rich which, and how to fix it. Never work around it.

1. **Sessions open.** `ListAgents` lists a Claude Code session in `3d_wd` and one in `stevie_the_dog`. Fixes are handed to them, so if either is missing, ask Rich to open it and stop.
2. **This repo:** `git fetch origin`, then `git status` shows `main`, up to date with `origin/main`, and a clean tree.
3. **The sibling folders:** `../3d_wd` (or `FRONTEND_DIR`) has origin `rmarafioti/3d_wd`, and `../stevie_the_dog` has origin `rmarafioti/stevie_the_dog` (`git -C <dir> remote get-url origin`). Then `git -C <dir> fetch origin` in each. Both are read only at `origin/main` with `git show origin/main:<path>`, so their working trees and branches don't matter.
4. **`master` only:** the master doc's link. Ask Rich for it if it isn't in this session; it isn't kept in the repo.

## 4. Scope

- **Backend (the truth):** `CLAUDE.md`, every file in `docs/` (`docs/proposal-notes.md` only for the master doc's Proposal tab), `README.md`, `.env.example`.
- **Frontend:** `CLAUDE.md`, `AGENTS.md`, `README.md`, every file in `docs/` (`git -C ../3d_wd ls-tree --name-only origin/main docs/`).
- **Stevie The Dog:** `CLAUDE.md` and `docs/client-website.md`.
- **The other client repos** (`good_boys_website`, `legacy_tattoo` and the rest): not read. Rich copies Stevie's revised md files into them by hand; the sync only lists which ones changed (step 7).
- **`master`:** the master doc's tabs, as `CLAUDE.md` → Documentation Sync describes them.

## 5. Steps

Each step names what counts as a finding. A difference in wording that changes no fact is not one, except in the identical tier.

### Step 1: Sessions

Done in Preconditions. Note the two sessions' names for the handoffs.

### Step 2: The truth first

This repo's docs must match this repo's code before anything is compared, or the sync copies drift into the other repos. Run `/code-sweep`'s step 6 (Docs match code) as written in `.claude/skills/code-sweep/SKILL.md`, over the whole repo, fresh on every run: never reuse an earlier sweep's or sync's results, even from the same session, since the files may have changed since. Each mismatch is a finding (**doc**, or **bug** where the code is wrong). Go on with the docs as they are, and say in the handoffs which backend facts are about to change.

### Step 3: Identical tier

`npm run check:sync`. It compares the API Contract section of `docs/endpoints.md` with the frontend's `docs/api.md`, and the guard hook and its tests with the frontend's copies. Each `differs` or `missing` is a finding, with the diff it printed.

### Step 4: Frontend, must-agree tier

Read each backend section and its frontend counterpart side by side. The frontend may summarize; it may not contradict or leave out a rule it depends on.

| Backend                                                                       | Frontend                                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `CLAUDE.md` → Project Overview, roles                                         | `CLAUDE.md` → Project Overview                                                        |
| `docs/endpoints.md` → Session Cookie, CSRF, Middleware Stack (429)            | `CLAUDE.md`, `docs/flows.md`                                                          |
| `docs/endpoints.md` → Validation rules, Error messages                        | `docs/flows.md`, `CLAUDE.md` → Patterns                                               |
| `CLAUDE.md` → Features, Planned Later                                         | `CLAUDE.md` → Features, Planned Later (same list)                                     |
| `docs/scaling.md`                                                             | `docs/scaling.md`                                                                     |
| `docs/deploy.md` → Environments, Every deploy after launch, Rolling back      | `docs/deploy.md`                                                                      |
| `CLAUDE.md` → Issue Workflow, Version Control, Releases, Code Review → Output | `CLAUDE.md` → the same sections                                                       |
| `CLAUDE.md` → Current progress (Now, Next)                                    | `CLAUDE.md` → Current progress (its own state, but no contradiction of the backend's) |

Finding: a contradiction, or a rule the frontend depends on that it leaves out.

### Step 5: Frontend-only tier

The rest of the frontend's docs (UI, components, routing, its own progress line). Don't audit their content: check only that each backend fact they state (a route, a status code, a message, a limit, a field) is still true. Finding: a stale backend fact.

### Step 6: Stevie The Dog, must-agree tier

`docs/client-website.md` and `CLAUDE.md` against:

- `docs/endpoints.md` → API Contract: `PublicPost`, `PublicGallery`, the public routes and their errors (`401` "Invalid API key.", `404` "Gallery not found.", `429`), the rate limit;
- `docs/endpoints.md` → Revalidation: the method, path, `Authorization: Bearer` header, body (`{ websiteId, postId }` or `{ websiteId, galleryId }`), the 5-second timeout, and that the route mustn't require `postId`;
- `docs/endpoints.md` → Paragraph formatting: the rules and every example row;
- `docs/setup.md` → Client websites: the `remotePatterns` rows, the gallery crop rows included;
- `docs/client-website-test.md`: the env vars and the steps Tests A–C rely on.

Finding: a contradiction, or a public feature the backend serves that the client guide doesn't describe yet (galleries, until the guide gains `getGallery(slug)`).

### Step 7: Client repos

List each of Stevie's md files that this sync's findings will change. Rich copies them, then tailors them, into the other client repos by hand. This may change if a better workflow is found.

### Step 8: The master doc (`master` only)

Only once steps 3–6 have no open findings, or Rich says to go on.

- **The first `/doc-sync master` (still pending, `CLAUDE.md` → Current progress → Pending notes):** stop before reading or editing any tab and hold the scope conversation with Rich. Master doc updates are long and use a lot of tokens; not every tab needs an update, and since the launch some tabs (the deploy-era ones) can be removed. Agree which tabs stay, which go, and which are checked on each sync, then write the outcome into `CLAUDE.md` → Documentation Sync and remove the Pending note, on a branch.
- **Later runs:** the method in `CLAUDE.md` → Documentation Sync. Only contradictions and outdated facts are findings; the doc may hold extra notes. A copy tab is refreshed by staging its repo file as Markdown, converting it to HTML on the clipboard, and Rich pastes it over the tab. A handwritten tab is fixed with `replaceAllText`, its find text long enough to match only the sentence meant. The "Client to Website" tab must agree with Stevie's `docs/client-website.md` and step 6's sources. Read `docs/proposal-notes.md` before touching the Proposal tab.

## 6. Hard rules

- Read-only in every repo until Rich decides the findings. Backend fixes then go on a branch here, as usual.
- Never edit the frontend, Stevie or any client repo. Their fixes go to their sessions as handoffs, sent with `SendMessage` only once Rich agrees to the findings.
- Never read or print `.env` or `.env.*` in any repo.
- Nothing against staging or production.
- Never comment on, edit or close an issue: Rich closes the reminder.
- No master doc edit before Rich agrees to it.
- The guard hook (`.claude/hooks/guard.js`) and `.claude/settings.json` still apply; a refused command is reported, not worked around.

## 7. When a step fails

- A session isn't open, a sibling folder is missing or isn't the right repo, or `git fetch` fails: stop (Preconditions).
- `npm run check:sync` exits 1: each difference is a finding; go on.
- A file listed in Scope is missing in a repo: a finding (**decision**: is it gone on purpose?); go on.
- The master doc is too large for the connector's full read: work tab by tab and report which tabs weren't read.

## 8. Output

1. **Findings** in the `CLAUDE.md` → Code Review → Output format, most important first: **file:line** (with the repo), the **tier** (identical, must agree, frontend-only, Stevie, master) in place of the checklist item, **what differs**, the **proposed fix**, and its **type** (bug, cleanup, doc or decision). Where the other repo is right and the backend is wrong or missing something, the finding is a **decision** for Rich, never a plan to overwrite the other repo.
2. **A handoff for each repo with findings**, in the Workflow Checklist → Step rhythm's form, for a reader with no context: what changed in the backend and on which branch, each fix to make with the backend text to match, and a "done when" checklist. Shown to Rich first; sent with `SendMessage` once he agrees.
3. **Client repo md files** to copy from Stevie (step 7), or "none".
4. **What was checked:** each step and its result in one line, with the commits read (`origin/main` of each repo). A sync with no findings still reports this.

## 9. After

- Rich decides each finding.
- Backend fixes: a branch here (a docs fix rides on the next real branch where one is open).
- The handoffs go to the frontend and Stevie sessions; each fixes its own docs on its own branch.
- Rich copies the listed md files into the other client repos.
- With `master`, the master doc is updated last, once the three repos agree.
- Rich closes the reminder issue once all of that is done.

## 10. Done when

- [ ] Both sessions open, and every precondition checked
- [ ] Step 2 run, with this repo's drift reported
- [ ] `npm run check:sync` run
- [ ] Every must-agree row of step 4, step 5, and every source of step 6 compared
- [ ] Client repo md files listed
- [ ] Findings, handoffs and what was checked reported
- [ ] With `master`: the scope conversation held (first run) or the tabs audited (later runs)
