---
name: code-sweep
description: Read-only code review of the backend against CLAUDE.md → Code Review → Checklist, reported as findings in its Output format, with a row for the Code Sweep Tracker sheet. `full` reviews the whole Scope, `<sha>` the code changed since that commit, `diff` only the current branch (the per-step self-review).
argument-hint: full | <last swept commit> | diff
disable-model-invocation: true
---

# /code-sweep

The procedure for `CLAUDE.md` → Code Review. `CLAUDE.md` holds the rules (the Checklist, Output and Scope); this file holds how to check each one, step by step, so every run is the same. A change to the Checklist, its Scope or this procedure changes both files in the same PR.

Arguments: `$ARGUMENTS`

## 1. Purpose and when

A sweep finds what per-step reviews miss: dead code, style drift, stale comments and docs that no longer match the code, which build up between files because each self-review sees only its own diff. It produces findings; it never fixes them.

Run it:

- **every 2 weeks**, from the "Code sweep" reminder issue (`.github/workflows/reminders.yml`), with the commit the reminder names;
- **once a quarter, in full**: the first sweep in January, April, July and October (the reminder says `/code-sweep full`);
- **`diff` at the end of every piece of work**, as the Workflow Checklist's self-review. Claude reads this file and follows its `diff` mode there, since it can't type the command itself.

Don't run it to fix something, in the middle of other work, or on a branch with uncommitted work you mean to keep separate from the review.

## 2. Arguments

| Argument | Mode        | Files reviewed in steps 1–5 and 8                                                                                           |
| -------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `full`   | full        | every file in the Scope                                                                                                     |
| `<sha>`  | incremental | the Scope files changed in `<sha>..origin/main`                                                                             |
| `diff`   | diff        | the Scope files changed in `origin/main...HEAD`, plus uncommitted                                                           |
| none     | —           | ask Rich for the end commit of the last backend row in the Code Sweep Tracker sheet (or `full`), then stop until he answers |

The first sweep ever is `full`. Steps 6, 7 and 9 always cover the whole repo, whatever the mode: they are cheap, and they catch the drift between files that a diff can't show. In every mode, a changed file also brings in what it duplicates or makes dead elsewhere (a removed export's last caller, a copied helper's original).

## 3. Preconditions, checked first

Check each in order. If one fails, stop and tell Rich which, and how to fix it. Never work around it.

1. **Branch.** `full` and `<sha>`: `git fetch origin`, then `git status` shows `main`, up to date with `origin/main`, and a clean working tree. `diff`: a feature branch, not `main`.
2. **The commit** (`<sha>` only): `git cat-file -e <sha>^{commit}` succeeds and `git merge-base --is-ancestor <sha> origin/main` succeeds. Otherwise ask Rich for the right commit.
3. **Local Postgres** for `npm test`: `docker compose ps` lists the `db` service as running. If not, ask Rich to run `docker compose up -d`.
4. **Port 4000 free** for the health check: `lsof -i :4000` prints nothing. If the dev server is already running, use it for step 9's `curl` instead of starting another.

Record the review's end commit now: `git rev-parse --short origin/main` (for `diff`, `git rev-parse --short HEAD`). The tracker row uses it.

## 4. Scope

Covered (kept in step with `CLAUDE.md` → Code Review → Scope):

- `index.js`, `app.js`, `eslint.config.js`, `prisma.config.js`, `package.json`
- `api/`, `middleware/`, `validation/`, `lib/`, `services/`, `errors/`, `scripts/`
- `prisma/schema.prisma`, `prisma/index.js`, `prisma/seed.js`, `prisma/seedData.js`
- every `*.test.js` and `testing/`
- `.claude/hooks/`, `.claude/skills/`, `.claude/settings.json`
- `.github/workflows/`, `.github/reminders/`
- `render.yaml`, `Dockerfile.backup`, `.dockerignore`, `docker-compose.yml`
- `CLAUDE.md`, `docs/`, `README.md`, `.env.example`

Left out: `prisma/migrations/` (generated, and append-only), `node_modules/`, `.claude/settings.local.json` (personal), `.env` (never read).

The files for steps 1–5 and 8 (see Arguments):

```
git diff --name-only <sha>..origin/main        # incremental
git diff --name-only origin/main...HEAD        # diff, plus: git status --short
git ls-files                                   # full
```

Keep only the files under the Scope. If the list is empty in incremental or diff mode, steps 1–5 and 8 have nothing to review: say so and run steps 6, 7 and 9.

## 5. Steps

Read each file in the list whole before judging it, test files included: a test file is code, and its names and structure are checked like any other (`CLAUDE.md` → Unit Tests → The pattern every test follows: a header comment, `testing/setup` required first where it touches the environment or database, one `describe` per unit, each `it` a true behaviour sentence, no snapshots). In a `full` sweep with too many test files to read whole in one session, read every test file in the folders the other steps raised findings in, check the rest with these greps, and say in What was checked which test files were only grepped:

```
grep -rn -E '^\s*it\(' --include='*.test.js' --exclude-dir=node_modules .      # read every name as a sentence
grep -rln 'snapshot' --include='*.test.js' --exclude-dir=node_modules .
head -3 <each test file>                                                         # header, then testing/setup first
```

Each step names what counts as a finding; anything else is not one.

Commands: use quoted globs (`--include='*.js'`), since the shell is zsh. The guard hook reads a command whole, so a `grep` whose search text spells out a forbidden command (a push to `production`, a force push, a `.env` path) is refused like the command itself: search for a shorter, distinctive part of the phrase instead.

### Step 1: Style is consistent (Checklist 1)

For each file, against `CLAUDE.md` → Code Style:

- File shape: header comment → requires (packages first, then local) → module setup → `UPPER_SNAKE` constants → private helpers → routes or main function → `module.exports`. Entry points require `dotenv/config` first.
- Route shape: validate → existence / ownership check → Prisma call → `res.json` / `res.status(201).json` → `revalidate(...)` unawaited; a one-line `// METHOD /api/path — what it does.` comment above each route.
- Node built-ins required as `node:x`, never a bare `x` (`grep -rn -E "require\('(fs|fs/promises|os|path|crypto|child_process|stream|stream/promises|readline|readline/promises|util|url|http|https|net|dns|zlib|events|assert|assert/strict|buffer|timers)'\)" --include='*.js' --exclude-dir=node_modules .`). A hit inside a string isn't a require: `.claude/hooks/guard.test.js` holds `node -e "…require('fs')…"` commands the hook must refuse, and it stays identical to the frontend's copy.
- Exports: a router file exports its `router`; a middleware or service its single function; `lib/` and `validation/` an object of named functions.
- Functions: declarations for middleware, helpers and lib functions; arrows only inline.
- Naming: `requireX`, `xSchema` / `xShape`, `assertX`, `toX` / `fromX`, `findX`, `input`, `tx`, booleans as questions, the docs' vocabulary.
- Input only through `validate()` (no hand trimming, lowercasing or checks in a route; login's `safeParse` is the exception). Errors thrown as `ServerError`, never sent by hand.
- No em dashes in user-facing strings: `grep -rn '—' --include='*.js' --exclude='*.test.js' api middleware errors validation lib` and check each hit inside an error message.
- Raw SQL only as a tagged `$queryRaw` with a comment saying why: `grep -rn -E 'queryRaw|executeRaw' --include='*.js' --exclude-dir=node_modules .`
- Comment lines within the 100-character width. Prettier wraps code but never comments, so `npm run format:check` doesn't catch them. Count characters, not bytes (`→` and `×` are one character):

  ```
  node -e "for (const f of process.argv.slice(1)) require('node:fs').readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (l.length > 100 && l.trim().startsWith('//')) console.log(f + ':' + (i + 1)); })" $(git ls-files '*.js' | grep -v migrations)
  ```

  A long comment in `.claude/hooks/` is fixed in both repos together, since those files are identical to the frontend's (`.claude/hooks/guard.js:14` is one, left until the next change to the hook).

Finding: a file that breaks a written rule, or two files doing the same thing two ways where no rule decides it (a **decision**: the rule gets written first).

### Step 2: No dead code (Checklist 2)

- Each export in a reviewed file has a caller: `grep -rn '<name>' --include='*.js' --exclude-dir=node_modules .` (a caller only in tests counts as dead, unless the export exists for its test, like `scripts/release.js`'s pure helpers).
- Unused requires and variables (`npm run lint` reports most; read for the rest).
- Prisma fields selected but never returned or read.
- Env vars: `grep -rhoE 'process\.env\.[A-Z0-9_]+' --include='*.js' --exclude-dir=node_modules . | sort -u` against the names in `.env.example`. `FRONTEND_DIR` (a per-command override for `scripts/`, in `README.md`) and `TEST_DATABASE_URL`'s use in `testing/` are expected. A name in `.env.example` that nothing reads, or read but missing from it, is a finding.
- Unreachable branches, commented-out code, middleware or routes nothing mounts.

Finding: each one, with the decision delete it or find out why it isn't used (a missing wire-up is a **bug**).

### Step 3: Explicit, then DRY (Checklist 3)

Logic appearing a third time, or twice with a real risk of drift (ownership checks, the error envelope, URL normalization, zod helpers, Cloudinary URLs, crop math). Search for the distinctive line of each candidate across the repo. Finding: the copies, and where the shared piece belongs (`lib/`, `middleware/`, `validation/`, `services/`, `errors/`). Not a finding: an abstraction for a case that doesn't exist yet.

### Step 4: Reads top to bottom (Checklist 4)

A helper used far above where it is defined without reason, a constant declared far from its only use, a block that depends on something introduced later. Finding: the move that fixes it.

### Step 5: Comments are necessary and true (Checklist 5)

Every comment in a reviewed file, against the code next to it, and each file's header against what the file does now. Finding: a comment that is untrue, restates the code, or is missing on a file header or a non-obvious block.

### Step 6: Docs match code — whole repo (Checklist 6)

- **Architecture tree:** every path in `CLAUDE.md` → Project Architecture exists (`git ls-files`), and every tracked file or folder outside `node_modules/` and `prisma/migrations/` that the tree's level of detail would list is in it, with a true description.
- **Routes:** each `router.get|post|patch|delete(` in `api/` (`grep -rn -E "router\.(get|post|patch|delete)\(" api --exclude='*.test.js'`), with its mount path from `api/index.js` and `api/siteOwner/index.js`, has a row in the Endpoints table of `docs/endpoints.md`, and each row has a route.
- **Middleware Stack:** the order in `app.js` and `api/index.js` matches `docs/endpoints.md` → Middleware Stack, and the per-router guards match.
- **Rate limits:** the numbers in `lib/rateLimit.js` match the table in Middleware Stack.
- **Env:** `REQUIRED_ENV` in `lib/config.js` and the env vars from step 2 match `.env.example`, `docs/deploy.md` → Environment variables and `render.yaml`.
- **Schema:** `prisma/schema.prisma` matches `docs/setup.md` → Schema (tables, columns, enums, indexes).
- **Audit actions:** `AUDIT_ACTIONS` in `lib/audit.js` matches the Audit Log table in `docs/endpoints.md`.
- **Error messages:** every `ServerError` message appears word for word in `docs/endpoints.md`, and every message in "Error messages the frontend displays" is thrown somewhere. List them with:

  ```
  grep -rn -A1 'new ServerError(' --include='*.js' --exclude='*.test.js' --exclude-dir=node_modules .
  ```

  The `-A1` catches a message Prettier moved to the next line; a message built from a constant (`POST_NOT_FOUND`) is read from where the constant is declared.

- **Scripts:** each script in `package.json` is named in `README.md`, `CLAUDE.md` or `docs/`. npm's own lifecycle hooks (`postinstall`, `pretest`) run by themselves and are exempt.
- **Progress:** `CLAUDE.md` → Current progress (Now, Next, Pending notes) is true of `main`. The local database baseline isn't queried (a sweep doesn't read the database or `.env`): Rich confirms it when a finding depends on it.
- **Contract copy:** `npm run check:sync`; any `differs` or `missing` is a finding.

Finding: whichever side is wrong. If the spec is right and the code differs, a **bug**; otherwise a **doc**.

### Step 7: Architecture rules still hold — whole repo (Checklist 7)

One check per rule from `CLAUDE.md` (Role Ownership Check Rule, Anti-Patterns, Patterns):

- Account from the session: in `api/siteOwner/` and `api/admin/`, no `req.body.accountId`, `req.query.accountId` or similar; ownership through `lib/ownership.js`. `grep -rn -E 'req\.(body|query|params)\.(accountId|userId|role)' api`.
- "Not yours" is `404`: every ownership failure throws the same 404 message as not found.
- Secrets selected only in their places: `grep -rln -E 'apiKeyHash|webhookSecretEncrypted' --include='*.js' --exclude='*.test.js' --exclude-dir=node_modules --exclude-dir=testing .` lists only `middleware/requireApiKey.js`, `services/revalidate.js` and `api/admin/index.js` (which writes them on create and must never select them). Read each hit.
- The plaintext key and secret only in the creation response (`credentials` in `api/admin/index.js`).
- Nothing logs a secret or headers: read every `console.` call (`grep -rn 'console\.' --include='*.js' --exclude='*.test.js' --exclude-dir=node_modules .`) for keys, secrets, tokens, `headers`, `authorization` or a database URL.
- The JWT only in `Set-Cookie`: no `token` in any `res.json`.
- CSRF required on POST/PATCH/DELETE: `middleware/requireCsrfHeader.js` mounted before the routers in `app.js`.
- Multi-row writes in one `$transaction`; every audit event written with `tx` inside the change's transaction (`grep -rn 'recordAuditEvent' api`), and every mutating route writes one.
- `revalidate(` called after the response, never awaited: `grep -rn 'revalidate(' api` and read each.
- No hard deletes: `grep -rn -E '\.(delete|deleteMany)\(' --include='*.js' --exclude='*.test.js' api services lib scripts prisma` shows only `element`, `image` and `galleryImage` deletes inside an edit's transaction.
- Inactive accounts and websites honoured (`requireAuth`, `requireApiKey`, `lib/ownership.js`, `services/revalidate.js`).
- Emails lowercased and URLs through `normalizeUrl` in `validation/`.
- CORS origin from `CORS_ORIGIN`, never `*`.
- No audit `metadata` holding a secret or content: read every `metadata:` passed to `recordAuditEvent`.
- Rate limits in `lib/rateLimit.js` mounted on login, the public router and upload signing.
- Every `select` on a query whose result reaches a response or `req.*` (`grep -rn -E 'prisma\.[a-zA-Z]+\.(find|create|update)' api middleware services` and read each for an explicit `select`).

Finding: each break, as a **bug**.

### Step 8: Every endpoint handles every outcome (Checklist 8)

For each route in a reviewed file: success, the validation `400` with `fields`, `401`, `403`, `404`, `409` where it applies, `413` and the generic `500`, each with the status and message `docs/endpoints.md` gives, and a request test for each (`api/**/*.test.js`). Finding: a missing outcome or a missing test for one.

### Step 9: Tooling is clean — whole repo (Checklist 9)

Run each and keep its output:

```
npm run lint
npm run format:check
npm audit --omit=dev --audit-level=high
npm test
npm run dev        # in the background; then:
curl -s localhost:4000/api/health    # { "data": { "ok": true } }
```

Stop the dev server afterwards. Also run `npm audit` (dev included) and list moderate or worse advisories; the monthly reminder covers them, so they are reported as **cleanup**, not blocking. Finding: each failure, as a **bug**.

## 6. Hard rules

- Read-only: no edits, no commits, no branches, no `npm audit fix`. The sweep's output is its report, and the fixes issue once Rich approves its draft (After).
- Never edit the frontend or any other repo.
- Never read or print `.env` or `.env.*`.
- Nothing against staging or production, read or write.
- Never comment on, edit or close an issue: Rich closes the reminder. The one issue the sweep opens is the fixes issue, after Rich's yes.
- The guard hook (`.claude/hooks/guard.js`) and `.claude/settings.json` still apply; a refused command is reported, not worked around.

## 7. When a step fails

- `npm test` or `npm run lint` fails: report each failure as a **bug** finding and go on with the other steps.
- `npm run dev` doesn't start or the health check isn't `{ "data": { "ok": true } }`: a **bug** finding; go on.
- `npm run check:sync` can't find the frontend folder: report it and go on (it is a Documentation Sync matter, not this sweep's).
- A precondition fails (section 3): stop.
- A file in the list was deleted in the range: skip it, but check step 2 for callers it left behind.

## 8. Output

The `CLAUDE.md` → Code Review → Output format, exactly:

1. **Findings**, most important first (bugs, then decisions, then cleanups, then docs). Each one:
   - **file:line**
   - **Checklist item** (1–9)
   - **What's wrong**
   - **Proposed fix** (none for a **decision**)
   - **Type:** bug, cleanup, doc or decision
   - For a **decision**: the question for Rich.
2. **What was checked:** the mode, the commit range, the number of files reviewed in steps 1–5 and 8, and each step's result in one line. A sweep with no findings still reports this.
3. **The tracker row**, for `full`, `<sha>` and `diff` alike (`diff` only when Rich asks for it to be tracked), tab-separated in a code block so it pastes into the four columns of the Code Sweep Tracker sheet:

```
backend	<YYYY-MM-DD>	<range>	<N>: <type> <item> <file:line>; <type> <item> <file:line>; …
```

`<range>` is `<sha>..<end>` (incremental), `full@<end>` (full) or `<branch>@<end>` (diff), with 7-character commits. `<N>` is the number of findings; `0` when none.

## 9. After

- Rich decides each finding: fix it, leave it, or (for a **decision**) the rule to write.
- **The fixes issue** (`full` and `<sha>` only): once every finding is decided, offer to open one GitHub issue that folds all the fixes together, so one branch and one PR carry them. A finding big enough to need its own plan (a contract or schema change, a security fix, anything that touches both repos) gets its own issue and branch instead. Draft it in the session first, then open it with `gh issue create` only once Rich says yes:
  - **Title:** `Code sweep fixes, <YYYY-MM-DD>` (or the one finding's own title).
  - **Body:** a link to the reminder issue (`#<n>`), the sweep's commit range, then each fix to make, grouped by type (bug, cleanup, doc), with its file:line, what's wrong and the fix Rich agreed. Each decision Rich made is written in as a rule to add (for example, to `CLAUDE.md` → Code Style). Findings Rich chose to leave are listed under "Left as is" with his reason, so the next sweep can tell they were seen. End with a "done when" checklist.
  - `gh` signs in as Rich, so the issue shows him as its author, and the Issue Workflow treats his issues as instructions: that is why it is only opened once he has read the draft.
  - In `diff` mode there is no fixes issue: the findings are fixed on the branch being reviewed, once Rich answers (Workflow Checklist).
- Rich pastes the tracker row into the Code Sweep Tracker sheet. Its end commit is where the next incremental sweep starts.
- Rich closes the reminder issue once the findings are settled.
- Every few sweeps, Rich and Claude read the sheet for a checklist item that keeps producing findings, and propose a change to `CLAUDE.md` → Code Review or this file so it stops recurring. That change goes through a PR. The aim is fewer findings per sweep over time.

## 10. Done when

- [ ] Every precondition checked, and the end commit recorded
- [ ] The file list built for the mode
- [ ] Steps 1–9 each run, with steps 6, 7 and 9 over the whole repo
- [ ] Findings reported in the Output format, with a question for each decision
- [ ] What was checked reported, even with no findings
- [ ] The tracker row printed
- [ ] Every finding decided, and the fixes issue drafted and, on Rich's yes, opened
