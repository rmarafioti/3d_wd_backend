# CLAUDE.md — Backend

@docs/process.md

## Project Overview

The backend codebase of our Headless CMS project. The frontend is in a separate repository which connects to this one through the API contract in `docs/endpoints.md`. Two roles to account for, an Administrator and a Site Owner, each with their own auth-gated API routes.

- The Administrator sees a summary of all site owner accounts and their websites (with each website's galleries as counts and crop flags), creates new site owner accounts, and links websites to existing accounts.
- The Site Owner views, creates, edits, deletes and sets to draft or published the posts and photo galleries for their own websites, adds Photo Galleries to a website, says where on their site each gallery and their posts should go (and changes it), and turns an ability on or off. The Administrator is emailed each request, sets an ability live once its code is wired, and sets each gallery (and posts) live once placed.
- The Inbox: the Administrator sends site-wide updates (one way; setting an ability or a gallery live sends one too), and either side starts a message thread that both reply to.
- The backend also serves published posts and galleries to each site owner's live website via that website's API key, and triggers on-demand revalidation on that site by calling its webhook endpoint whenever a post or gallery changes. A draft given a go-live date is published by a cron job when that time passes.

Production: this API runs on Render at `https://api.3dwebdev.com`, defined in `render.yaml`. The frontend runs on Vercel at `https://3dwebdev.com`. Both share the parent domain `3dwebdev.com`, which is why the session cookie is `SameSite=Lax` with `Domain=.3dwebdev.com`.

### Read before

Only `docs/process.md` loads every session. The reference docs are read when the work needs them, before planning, and only the sections the work needs: find the heading (`grep -n '^##' docs/endpoints.md`) and read those lines, not the whole file, since whatever is read is carried for the rest of the session.

| Before you…                                                                     | Read                          |
| ------------------------------------------------------------------------------- | ----------------------------- |
| add or change a route, a response, an error message, validation or the contract | `docs/endpoints.md`           |
| change the schema, Prisma, crypto, images, the upload cleanup or the seed       | `docs/setup.md`               |
| make any schema, contract or flow change (classify it first)                    | `docs/scaling.md`             |
| touch secrets, access, sessions, rate limits, the audit log or an incident      | `docs/security.md`            |
| deploy, release, roll back, change `render.yaml` or env vars, onboard a client  | `docs/deploy.md`              |
| test against a client website                                                   | `docs/client-website-test.md` |

## Workflow Checklist

- Read the issue (`docs/process.md` → Issue Workflow)
- Read the relevant spec (Project Overview → Read before), including `docs/scaling.md` for any schema, contract or flow change
- Create a plan — always in plan mode (switch with EnterPlanMode, present with ExitPlanMode), never as a plain chat message
- On approved, build
- Checks after building:
  - `npm test` passes, with new tests wherever Unit Tests says one is justified
  - Postman only for a new kind of route (logic only, with the `X-CSRF-Protection: 1` header). A route that follows an existing, proven pattern skips it: its request tests stand in
  - Always a manual UI test through the real frontend, for every change the frontend reaches (validates the flow, CORS and cookie behaviour)
  - After manual testing (the frontend, and Postman where used), delete every row the tests added (accounts, websites, `account_website` links, posts and their elements and images), so the local database is back to the baseline in Current progress. List the rows first and delete them by id in one transaction. (`npm test` uses its own test database and never touches these rows.)
- Final step, always, once every check above is done: the self-review over the whole diff. Read `.claude/skills/code-sweep/SKILL.md` and follow its `diff` mode (Code Review → Running a review), which checks the role gate and ownership, transactions, CSRF, the contract, secrets, `npm audit` and the rest of the checklist. Report it to Rich as findings in its Output format, with a question for each one that needs his decision on correcting the code. Nothing is committed before he answers. A review that finds nothing is still reported.
- Only commit once code is reviewed, approved and all validation and tests are green, and only commit, push and open the PR once Rich says so (`docs/process.md` → Issue Workflow step 6)

Step rhythm:

- Each issue is its own task, one branch per repo: branch from an up-to-date `main` (`docs/process.md` → Issue Workflow step 3), write a fresh plan in plan mode (replacing any earlier plan), get Rich's approval, build, verify, then commit, push and open the PR when Rich says so. Rich merges the PR on GitHub. When it needs both repos, finish with a cross-repo handoff (`docs/process.md` → Cross-Repo Handoff).
- The docs are the spec. When a plan only touches code already in the repo, reading the docs and the files involved is enough — no broad exploration needed. Library APIs are checked against the installed packages in `node_modules`.
- When Rich says to commit, first update Current progress to describe the state after the PR merges: add an entry at the top of its list (date, branch and issue, such as `fix/x` (issue #42), since the PR number isn't known until after this commit; what was done, in one or two sentences), move the sixth entry to the top of `docs/history.md` → Progress, and update Now, Next, the baseline and Pending notes to match. Commit it on the same branch. Never leave it as a loose edit on `main` after a merge, which would need its own PR.
- After a step is merged, Rich runs `/clear`. The next step starts from `CLAUDE.md` and the docs alone, so anything worth keeping must be written into them before the clear.

## Plan Authoring

When in plan mode, write the plan to be legible cold — understandable by someone who never saw the conversation that produced it. State what's being built, which files will be touched, and why this approach was chosen. Avoid shorthand like "same pattern as before" or "as discussed" without spelling out what that actually means.

## Delegating to Subagents

Use subagents for research/exploration/investigation for a plan and for completing smaller tasks. Any search or read that spans many files goes to a subagent by default, so only its short summary enters this session's context; read a file directly when it is one you're about to edit.

## Role Ownership Check Rule

Every read/write route derives the account from the session (`req.user`), never from client input, and verifies the requested resource belongs to it before proceeding. A website belongs to a site owner through an `account_website` row and must be active; a post or gallery belongs to them through its website and must not be deleted (`deletedAt` null), except that listing and restoring deleted posts read only posts deleted in the last 30 days, and an ability through its website and must not be removed (`removedAt` null). A site owner's update belongs to them through their own `notification_recipient` row and must not be withdrawn (`notification.deletedAt` null), and a thread through `thread.accountId`. Mail a viewer deleted from their own mailbox (`notification_recipient.deletedAt`, `notification.adminDeletedAt`, `thread.ownerDeletedAt` / `adminDeletedAt`) is not found on that viewer's routes, except Recently Deleted and its restore, which read only what they deleted in the last 30 days; the same goes for a gallery's restore. The shared checks are in `lib/ownership.js`; the update and thread checks, used only by their own routes, are in `api/siteOwner/notifications.js` and `api/siteOwner/threads.js`. A failed check returns `404`, identical to "not found".

## Anti-Patterns to Avoid

**Never log the API key, webhook secret, session token, Cloudinary API secret, R2 secret or Resend key:**
The plaintext key/secret must only ever appear in the single creation response body (`credentials`) — never logged, never returned by any other endpoint, never stored anywhere but as the hash / encrypted value. Never log request headers on the revalidation call or the public endpoint. `CLOUDINARY_API_SECRET` lives only in the environment: it is read where uploads are signed and where the cleanup runs, and is never logged or returned. `R2_SECRET_ACCESS_KEY` is read only in `lib/r2.js`, and the database URL never goes into a backup error. The backup private key is never in the environment or the repo: it lives only in 1Password and is used only by `npm run backup:restore`. `RESEND_API_KEY` is read only in `services/requestEmail.js`, and a request email's failure is logged with the website id only, never an email address or the note. Sentry events go through `lib/sentry.js`, whose scrub keeps only the request's method and path and redacts every secret's value and any database URL; never send Sentry headers, cookies, bodies or a secret any other way (`Sentry.setUser`, extra data, breadcrumbs).

**Never trust frontend validation alone:**
Independently re-validate every field on every request with the zod schemas in `validation/`.

**Never send the token in a response body:**
The JWT appears only in the `Set-Cookie` header — never anywhere in a JSON body.

**CORS origin must never be a wildcard when credentials are enabled:**
Cookies silently fail to be accepted. The exact origin comes from `CORS_ORIGIN`.

**Never let revalidation or an email affect the user's request:**
Revalidation and the admin's request email run after the transaction commits, are not awaited before responding, and can never throw into the route. A client website or Resend being down must never stop a site owner saving a post or a request message.

**Never put secrets or content in the audit log:**
An `audit_event` row's `metadata` holds ids and short facts only: never a key, secret, token, Google credential, header or post content. A failed login's reason is logged but never returned; login always answers with the single 401.

**Never select secrets by default:**
`api_key_hash` and `webhook_secret_encrypted` are excluded from every query except the ones that need them (`requireApiKey`, `services/revalidate.js`).

## Out of Scope (do not build)

- Key/secret rotation. `lib/crypto.js` is written so rotation can reuse it later, but there is no rotation endpoint in the MVP.
- Endpoints to deactivate/reactivate accounts or websites.
- Hard deletes of accounts, websites, posts or galleries.

## Patterns and Preferences

**Prisma transforms DB snake_case to camelCase:**
`@map` must be used on every snake_case column in the Prisma schema, so nothing snake_case ever leaks into an API response.

**Crypto/generation all in one place:**
`lib/crypto.js` is reused by Create an Account, Link a Website, `requireApiKey` and the revalidation service. Never duplicated inline.

**Multi-row writes:**
Account + website + its posts ability + account_website, website + its posts ability + account_website, post + elements + images, gallery + gallery images, removing or restoring an ability with its galleries, an update + its recipients, a thread + its first message, and a bulk delete with its audit events always happen inside a single `prisma.$transaction` (a bulk restore is one transaction per item, so one failure leaves the rest restored).

**Audit events in the change's transaction:**
Every sign-in, sign-out and change writes its `audit_event` through `recordAuditEvent` (`lib/audit.js`), with the transaction client `tx`, inside the same `prisma.$transaction` as the change it records (`docs/endpoints.md` → Audit Log). A new route that changes data adds its action to `AUDIT_ACTIONS` and the table in `docs/endpoints.md`.

**Never a hard delete:**
Soft delete via an `active` boolean is the standard for accounts and websites. A website's abilities don't use it either: a removed one has `removedAt` set and is added back on the same row. Posts and galleries don't use it: they are set to draft or published through the API (`status`). A post or gallery the site owner deletes is stamped with `deletedAt`, never removed: every route then treats it as not found (except Recently Deleted and its restore, within those 30 days), and the upload cleanup deletes its images from Cloudinary 30 days later. Mail deleted from a mailbox is stamped for that viewer only, and after 30 days simply can't be restored: no row is purged. Accounts and websites have no API for this in the MVP — they are flipped by hand (Prisma Studio locally, SQL from the Render Shell when deployed) — but the backend always honours the flag (inactive account cannot log in or use a session; inactive website is hidden from its site owners, its API key is refused, and it receives no revalidation calls).

**One error envelope:**
Routes throw; the single error handler in `errors/` turns every error into `{ error: { message, fields? } }` with the status codes in `docs/endpoints.md`. Express 5 forwards rejected async handlers to it automatically.

**Emails lowercase, URLs normalized:**
Lowercase every email and run every website URL through `lib/normalizeUrl.js` before comparing or saving.

**CORS origin in .env:**
The allowed origin lives in `CORS_ORIGIN`, so it can differ between local dev and production without touching code. Same for `COOKIE_DOMAIN`.

**In-line comments:**
Keep all code readable and explicit. Comments should be used to inform other developers of the logic in more abstract code. Make sure all comments have been validated and are truthful. Each file starts with a one- or two-line header comment on what it is for, with no history (issue numbers, dates, who decided): the PR holds decisions, and a reason a reader needs sits as a comment by the code it explains.

**Placeholder folders:**
An empty scaffold folder holds a `.gitkeep` so git tracks it. Delete the `.gitkeep` in the same change that adds the folder's first real file.

**Saving notes:**
When Rich asks to save or remember something, write it into the most fitting project md file (`CLAUDE.md`, `docs/setup.md`, `docs/endpoints.md`, `docs/scaling.md` or `README.md`), not only into private memory, so it survives a context clear and is visible to everyone working on the repo. Write the rule, not its history: the decision and its reasons go in the PR (`docs/process.md` → Issue Workflow).

## Code Style

Formatting is Prettier (`.prettierrc`: `singleQuote`, `semi`, `trailingComma: all`, `printWidth: 100`, `tabWidth: 2`), run before every commit (`npm run format`), plus `npm run lint` clean (ESLint recommended rules, `eslint.config.js`). Prettier settles formatting; the rules below settle what Prettier can't.

- **File shape, top to bottom:** header comment (one or two lines on what the file is for, with no history; `npm run check:rules`) → `require`s (packages such as `express`, `zod`, `google-auth-library` first, then local modules) → module setup (`const router = express.Router()` and its `router.use(...)` guards) → module constants (`UPPER_SNAKE`) → private helpers → routes (or the file's main function) → `module.exports`. Entry points (`index.js`, `prisma/seed.js`) require `dotenv/config` before anything else.
- **Route handler shape:** validate the input (`validate(schema, req.body ?? {})`) → existence / ownership check (`if (!post) throw new ServerError(404, ...)`) → the Prisma call (`prisma.$transaction` for a multi-row write) → `res.json({ data })` or `res.status(201).json({ data })` → `revalidate(...)`, not awaited, where a post or gallery changed. Where `docs/endpoints.md` orders the steps differently (Link a Website checks the account before validating), follow the spec. Each route has a one-line comment above it: `// METHOD /api/path — what it does.`
- **Node built-ins** are required with the `node:` prefix (`require('node:crypto')`), so a built-in can't be mistaken for a package of the same name (checked by `npm run check:rules`).
- **Exports:** CommonJS only. A router file exports its `router`. A middleware or service file exports its single function (`module.exports = requireAuth`). `lib/` and `validation/` files export an object of named functions and schemas (`module.exports = { normalizeUrl, urlVariants }`), required with destructuring.
- **Functions:** function declarations for middleware, helpers and lib functions. Arrows only inline: route handlers passed to `router.get` / `post` / `patch`, callbacks (`.map`, `.filter`) and `$transaction` bodies.
- **Naming:**
  - Middleware is `requireX` (`requireAuth`, `requireRole`, `requireCsrfHeader`, `requireApiKey`).
  - Zod schemas are `xSchema` (`createPostSchema`). Shared field groups are `xShape` (`accountShape`, `websiteChoiceShape`).
  - A helper that throws on failure is `assertX` (`assertOwnImages`, `assertUrlAvailable`). Converters are `toX` / `fromX` (`toPost`, `toDateOnly`, `fromDateOnly`). Lookups are `findX` (`findOwnedPost`).
  - Shared Prisma selects and messages used more than once are `UPPER_SNAKE` constants (`POST_SELECT`, `POST_NOT_FOUND`).
  - The validated body is `input`. A transaction client is `tx`.
  - Booleans read as questions (`hasId`, `hasNewWebsite`).
  - Use the vocabulary of `docs/endpoints.md` and `docs/setup.md` (account, site owner, administrator, website, post, credentials), not synonyms.
- **Input:** all request input goes through a zod schema in `validation/` and `validate()`. Text fields are trimmed by `blankToUndefined` (`validation/validate.js`). Never trim, lowercase or check a field by hand in a route. Login is the one exception: it uses `loginSchema.safeParse` directly, because every login failure is the same 401, not a 400.
- **Errors:** routes and middleware `throw new ServerError(status, message)`. They never send an error response themselves; the handler in `errors/` builds the envelope.
- **Queries:** any read whose result reaches a response or `req.*` uses an explicit `select`. `apiKeyHash` and `webhookSecretEncrypted` are selected only in `requireApiKey` and `services/revalidate.js` (`npm run check:rules` keeps the names out of every other file but the admin router, which writes them).
- **Raw SQL:** only where Prisma can't express the query (`GET /api/admin/auditEvents/months` groups by the month of `created_at`), always as a tagged `prisma.$queryRaw` template so every value is a bound parameter, never `$queryRawUnsafe` (checked by `npm run check:rules`), and with a comment saying why Prisma's own API doesn't fit. The test helpers' `TRUNCATE` (`$executeRawUnsafe` with a fixed string) is test-only.
- **Control flow:** early returns and early throws over nested `if`/`else`. No nested ternaries.
- **User-facing strings:** every message `docs/endpoints.md` states (Error messages the frontend displays, Status codes) is copied word for word (`npm run check:rules` checks every `ServerError` message is in it). Never paraphrase it: the frontend shows `error.message` exactly as it arrives.
- **No em dashes in user-facing text.** Use a comma or a full stop instead, in every `error.message` and its copy in `docs/endpoints.md` (`npm run check:rules` checks the code). A new message follows it from the start; changing an existing one is a contract change in both repos (`docs/scaling.md` §4).

## Unit Tests

`node:test` + Supertest, against a real test Postgres. `npm test` runs the suite once (`pretest` creates and migrates the test database first); `npm run test:watch` while working. Tests are a gate, not decoration: a failing test blocks a commit the same as a failing lint.

### When a test is justified

Write a test when the code carries a rule that someone could break without noticing:

- **A spec or contract rule:** anything `docs/endpoints.md` states — every status code and `error.message` in "Error messages the frontend displays", the `{ data }` / `{ error: { message, fields? } }` envelopes with `fields` keyed by full path (`body.1.image.src`), the CSRF header returning `403` "Request blocked.", blank optional fields stored and returned as `null`, validation limits.
- **Branching logic:** a function, middleware or route handler that behaves differently by input or state (new vs existing website, active vs inactive account / website, draft vs published post, at vs over the image limit).
- **Shared code:** anything in `lib/`, `middleware/`, `validation/`, `services/` or `errors/` gets coverage, directly or through a request test — one bug there breaks every caller.
- **A security or one-time rule:** the account always comes from the session, never from client input; another owner's post, website or account is `404`, not `403`; `apiKeyHash` / `webhookSecretEncrypted` never appear in a response; `credentials` appear only when a new website is created; the session cookie carries the documented flags and the JWT never appears in a body; the public API accepts only a valid Bearer key for an active website, returns only published posts and never `postName`.
- **A bug that was fixed:** write the failing test first, then fix the code, so it can't come back.
- **One layer is enough:** if a request test already proves a behaviour through the real middleware, validation and handler, don't repeat it in a unit test of the piece. Test a zod schema or a `lib/` function directly only for what a request test can't reach easily (every `normalizeUrl` case, every validation boundary, a revalidation failure path).

Don't write a test for: a constant, the Prisma client setup (`prisma/index.js`), `prisma.config.js`, the seed and seed data, a one-line pass-through, or Express or Prisma behaviour itself. A route made only of tested pieces needs a test only for the wiring it adds (e.g. an edit reconciles images in one transaction, and nothing changes if any part fails).

### The pattern every test follows

- **Location and naming:** the test sits next to the file it tests, `name.test.js` (`validation/post.test.js`, `lib/normalizeUrl.test.js`); route tests sit next to their router (`api/siteOwner/index.test.js`). Shared support lives in `testing/` — not `test/`, because Node's test runner treats every file in a `test/` folder as a test. A test file that touches the environment or the database requires `testing/setup` first, the way entry points require `dotenv/config` first. One `describe` per unit; each `it` reads as a behaviour sentence: `it("returns 404 for another site owner's post")`.
- **Arrange → Act → Assert,** separated by a blank line. One behaviour per test.
- **Test behaviour, not implementation:** send a real request with Supertest and assert on the HTTP response (status, body, `Set-Cookie`) and on database state — never on which of our functions were called.
- **Mock only the edges:**
  - The database is **not** mocked: tests run against `TEST_DATABASE_URL` (a database whose name must end in `_test`; `testing/setup.js` refuses anything else), so query, constraint and transaction bugs are caught. The dev database is never touched.
  - Google ID-token verification: `mockGoogle` in `testing/helpers.js` replaces `OAuth2Client.prototype.verifyIdToken`, so login can succeed or fail without a real token.
  - Outbound revalidation: `mockFetch` replaces the global `fetch`; assert the call `services/revalidate.js` sent (URL, `Authorization`, body) and that the site owner's request is unaffected when it fails. Any file whose requests change a post mocks `fetch` for every test. Behind that, `testing/setup.js` replaces the global `fetch` with a stub answering `204`, so a revalidation that runs after its test's mock is restored never leaves the machine either.
  - `console.error` where a test triggers a log, so the output stays clean and the log can be checked for secrets.
  - Time only where logic depends on it (an expired session is a token signed with a past `exp`, not a faked clock). Nothing else in our own code is mocked.
- **Responses come from the contract:** the backend is the source of truth, so request tests assert the response matches `docs/endpoints.md` word for word. If a test and the doc disagree, fix the code — or, if the doc is wrong, that is a contract change: update `docs/endpoints.md` and the frontend's `docs/api.md` together and write a cross-repo handoff.
- **Independent:** each test builds its own rows with the helpers in `testing/helpers.js`, and the database is truncated before every test. Mocks are restored after every test (`t.mock`, or `mock.restoreAll()` in `afterEach` for a file-wide mock). Tests pass in any order and alone, and running the suite twice gives the same result.
- **No snapshots.** They pass by default and nobody reads the diff.
- **Same rules as the rest of the code:** Code Style and Code Review apply to test files too — header comment, CommonJS, no dead tests, true test names.

## Code Review

A review is read-only. It produces findings; it never edits code. Once Rich has decided a sweep's findings, the fixes are folded into one issue that Claude drafts and opens on his yes, with anything big enough for its own plan split into its own issue (`/code-sweep` → After). Fixes are their own task: plan in plan mode, Rich approves, build, verify (a manual UI test through the real frontend wherever the frontend uses the endpoint, plus Postman or curl only for a new kind of route, Workflow Checklist), PR. Every fix must preserve behaviour unless the finding is a bug.

### Checklist

These rules guide writing code as well as reviewing it. The `/code-sweep` skill holds the concrete check behind each item.

1. **Style is consistent.** The code matches Code Style. Two files doing one thing two ways take the documented way; if none is documented, the rule is written down before anything changes.
2. **No dead code.** Every file, export, require, route, selected field, env var and branch has a use. Unused code is sometimes a missing wire-up, not junk. The best code is code that was never written.
3. **Explicit, then DRY.** Readability wins over cleverness. Extract on the **third** copy, or the second where copies could drift (ownership, the error envelope, URL normalization, the zod helpers). Never for a case that doesn't exist yet; a shared piece must read more simply than the copies.
4. **Reads top to bottom as a story.** No helper far from its use without reason, no constant far from where it's used. Names carry the meaning, so comments don't have to.
5. **Comments are necessary and true.** A misleading comment costs more than a missing one. Each says _why_, not _what_, and every file's header matches what it does now.
6. **Docs match code.** `CLAUDE.md`, `docs/`, `README.md` and `.env.example` describe what is in the repo; the API Contract stays identical to the frontend's `docs/api.md`. Where the spec is right and the code differs, it's a bug.
7. **Architecture rules still hold.** The Role Ownership Check Rule, the Anti-Patterns and the Patterns and Preferences are true of the code.
8. **Every endpoint handles every outcome.** Success, `400` with `fields`, `401`, `403`, `404`, `409` where it applies and the generic `500`, each with the status and message `docs/endpoints.md` gives.
9. **Tooling is clean.** `npm run lint`, `npm run check:rules`, `npm run format:check`, `npm audit --omit=dev` (no high or critical) and `npm test` pass, and `npm run dev` starts (`GET /api/health` returns `{ data: { ok: true } }`).

### Running a review

The review's Scope, its Output format and the concrete check behind each Checklist item are the `/code-sweep` skill (`.claude/skills/code-sweep/SKILL.md`), their only copy, so every review runs the same way:

- **`/code-sweep diff`** is the self-review at the end of every piece of work (Workflow Checklist). Claude can't type a skill's command, so it reads the skill file and follows its `diff` mode.
- **`/code-sweep <commit>`** every 2 weeks, from the code sweep reminder (Reminders): the code changed since the last sweep, plus three checks over the whole repo (items 6, 7 and 9), which catch drift between files that a diff can't show.
- **`/code-sweep full`** once a quarter (the first sweep in January, April, July and October), and for the first sweep ever.

Each sweep ends with a row for Rich's Code Sweep Tracker sheet, kept outside the repo: repo, date, commit range, and the issues found. Its end commit is where the next sweep starts. Every few sweeps, an item that keeps producing findings is a sign the checklist needs tuning, and a change to it is proposed through a PR, so sweeps find fewer issues over time.

A change to the Checklist changes the skill in the same PR.

## Documentation Sync

Three repos describe the same system: this one, the frontend (`3d_wd`) and Stevie The Dog (`stevie_the_dog`), the client-side pilot whose `docs/client-website.md` is the client guide every client repo copies and tailors. All three are sibling folders. **The backend docs are the source of truth.** `/doc-sync` (`.claude/skills/doc-sync/SKILL.md`) checks the other two against them, and holds how: sessions open first, this repo's docs checked against its code first, the other repos read-only, the tiers, and the report. A change to this section changes the skill in the same PR.

Not on every branch. Run it:

- every 2 weeks, from the Documentation Sync reminder (Reminders)
- after a feature or step that changes the API contract, the schema or a flow, once it is merged in **both** repos, whatever the date
- before any production deploy
- whenever Rich asks

**The master doc** (Rich's Google Doc, outside the repos) holds only the business: the Proposal, Build vs Buy and a Glossary. No sync reads it, and it copies nothing from the repos, which are the only project docs; a decision that matters at scale goes into `docs/scaling.md` and Features. Read `docs/proposal-notes.md` before changing the Proposal.

## Reminders

This repo's four reminders (`.github/workflows/reminders.yml`). How a reminder works is `docs/process.md` → Reminders.

| Reminder           | When                                      | What to do                                                                                                         |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Restore drill      | the 1st of January, April, July, October  | restore the newest backup locally and record it in `docs/security.md` → Restore drills                             |
| Dependency audit   | the 1st of every month, if anything found | the full `npm audit` (dev included) found a moderate or worse advisory: fix on a branch, or accept it              |
| Documentation Sync | every other Monday (even ISO weeks)       | `/doc-sync`, with sessions open in `3d_wd` and `stevie_the_dog` (Documentation Sync)                               |
| Code sweep         | the same Mondays                          | `/code-sweep <last swept commit>`, or `full` once a quarter, then the tracker row (Code Review → Running a review) |

The frontend has its own dependency audit and code sweep reminders; the restore drill and the Documentation Sync run only here.

## Tech Stack Summary

- Framework - Node.js 24 / Express 5 (current stable) / CORS / helmet
- Auth Verification - Google Auth Library (verifies the Google ID token)
- Session Handling - JWT in an httpOnly cookie named `session`
  - SameSite=Lax, Secure, Domain=.3dwebdev.com in production (shared parent domain)
  - CSRF header check (`X-CSRF-Protection: 1`) on every POST/PATCH/DELETE
  - Timed sessions: 24 hours, fixed, no refresh tokens
- Validation - zod
- Prisma ORM (current stable)
- Database - PostgreSQL / Docker (local)
- Revalidation Calls - native fetch to `{website.url}/api/revalidate`
- Key Generation - crypto.randomBytes
- API Key - hashed (SHA-256)
- Webhook Secret - encrypted (AES-256-GCM)
- Error Alerts - Sentry (`@sentry/node`, production only, scrubbed), Render notifications, an uptime monitor

## Project Architecture

```
root
├── api/                      *route handlers only, organized by auth/role type, mounted under /api
│   ├── auth/
│   │   └── index.js          *POST login, POST logout, GET me
│   ├── admin/
│   │   ├── index.js          *accounts, websites, create account, link a website, set an ability or a gallery live, audit events; mounts notifications.js, threads.js and deleted.js
│   │   ├── notifications.js  *site-wide updates: send, list, edit, withdraw
│   │   ├── threads.js        *message threads with site owners: start, list, unread count, read, reply
│   │   └── deleted.js        *the admin's Recently Deleted: list, bulk delete and bulk restore of their updates and threads
│   ├── siteOwner/
│   │   ├── index.js          *websites, post CRUD, post status and publish date, post delete and restore, upload signing; mounts the routers below
│   │   ├── galleries.js      *gallery CRUD, gallery status and publish date
│   │   ├── abilities.js      *add, request, turn on / off and remove a website's abilities
│   │   ├── notifications.js  *Inbox updates: list, unread count, mark read
│   │   ├── threads.js        *message threads with the admin: start, list, read, reply
│   │   └── deleted.js        *Recently Deleted: list, bulk delete of mail, bulk restore of posts, galleries and mail
│   ├── public/
│   │   └── index.js          *GET /public/posts, GET /public/galleries/:slug (API key auth)
│   └── index.js              *mounts all routers + GET /health
├── services/
│   ├── revalidate.js         *fire-and-forget webhook call to a client website
│   ├── requestEmail.js       *fire-and-forget email to the admin on a request message (Resend)
│   ├── sweepUploads.js       *upload cleanup: unused uploads over 24h old, deleted posts' and galleries' images after 30 days
│   ├── publishScheduled.js   *scheduled publish: drafts whose go-live date has passed become published, then revalidated
│   └── backupDatabase.js     *pg_dump, encrypted with the backup public key, uploaded to R2
├── scripts/
│   ├── sweepUploads.js       *entry point for npm run sweep:uploads (Render cron job once deployed)
│   ├── publishScheduled.js   *entry point for npm run publish:scheduled (Render cron job every 15 minutes)
│   ├── backupDatabase.js     *entry point for npm run backup:database (nightly Render cron job)
│   ├── generateBackupKeys.js *npm run backup:keygen: the backup key pair, written outside the repo
│   ├── restoreBackup.js      *npm run backup:restore: decrypt a backup into an empty database
│   ├── release.js            *npm run release: backend to production, then the frontend, then the release tags
│   ├── checkSync.js          *npm run check:sync: what must be identical in both repos, diffed against ../3d_wd
│   ├── checkRules.js         *npm run check:rules: the Code Style rules a search can prove (CI)
│   └── sentryCheck.js        *npm run sentry:check: one test error to Sentry, from production's Render Shell
├── validation/               *zod schemas, one per resource
│   ├── auth.js               *login body ({ credential })
│   ├── account.js
│   ├── website.js
│   ├── post.js
│   ├── gallery.js            *gallery create / edit / status / request, the admin's placement, the crop rules
│   ├── fields.js             *field builders shared by post, gallery, update and thread (text, formatted text, https URL, image, go-live date, paging)
│   ├── upload.js             *Sign an Upload body ({ websiteId })
│   ├── ability.js            *add an ability, its request form, on / off, the admin's live
│   ├── auditEvent.js         *audit event list query (month, limit, cursor)
│   ├── notification.js       *the admin's update (title, body), the updates list query
│   ├── thread.js             *start a thread (either side), a reply, the threads list query
│   ├── deleted.js            *the Recently Deleted list query, bulk delete and restore items
│   └── validate.js           *validate() → 400 envelope, blankToUndefined
├── middleware/
│   ├── requireAuth.js        *verifies the session cookie, loads req.user
│   ├── requireRole.js        *role gate: admin / site_owner
│   ├── requireCsrfHeader.js  *403 on POST/PATCH/DELETE without X-CSRF-Protection: 1
│   └── requireApiKey.js      *public endpoint: hashes Bearer key, loads req.website
├── lib/                      *shared utilities
│   ├── abilities.js          *Ability shape (status apart from placement), owned-ability lookup, its audit event
│   ├── audit.js              *audit_event writer and action names
│   ├── cloudinary.js         *upload signature, image src folder check, cropped URLs, Admin API list/delete
│   ├── config.js             *startup config check: required env vars, secret strength
│   ├── crypto.js             *key/secret generation, hash, encrypt/decrypt, backup encryption
│   ├── deleted.js            *Recently Deleted: one list across types, newest deletion first, paged; the bulk runner
│   ├── dates.js              *postDate "YYYY-MM-DD" ↔ Date helpers
│   ├── galleryImages.js      *gallery image crop columns ↔ Crop, cropped versions for the public API
│   ├── galleryNames.js       *a gallery's unique name check and the Serializable clash retry
│   ├── jwt.js                *sign/verify session JWT, cookie options
│   ├── mediaFolder.js        *website media_folder name from its URL, -2/-3 on a clash
│   ├── normalizeUrl.js       *https, lowercase host, no trailing slash
│   ├── notifications.js      *update shapes, sending one with its recipients, the automatic updates, deleting and restoring a copy
│   ├── ownership.js          *site owner ownership checks: owned website, restorable posts and galleries, own image ids, image folder
│   ├── postBody.js           *element rows → the post body list in API responses
│   ├── r2.js                 *Cloudflare R2 upload (Signature V4, no AWS SDK) for backups
│   ├── rateLimit.js          *rate limiters: login, the public API, upload signing, thread messages
│   ├── restore.js            *restoring a deleted post or gallery: its check, name rule and audit event
│   ├── retention.js          *how long deleted content stays recoverable (30 days): the cutoff and restorableUntil
│   ├── sentry.js             *Sentry error reporting, production only: init, the event scrub, report, flush
│   ├── slug.js               *gallery slug: 8 random lowercase letters and digits, unique within the website
│   ├── status.js             *a post's or gallery's draft / published change: publishedAt and the go-live date
│   └── threads.js            *thread shapes, unread and deleted state per side, starting one, a reply under the 100-message cap, delete and restore
├── errors/                   *custom error classes + the single error handler (error envelope)
│   ├── serverError.js
│   └── index.js
├── prisma/                   *database schema, seed scripts, and migrations
│   ├── index.js              *shared Prisma client
│   ├── schema.prisma
│   ├── seed.js
│   ├── seedData.js
│   └── migrations/
├── testing/                  *test-only support; the *.test.js files sit next to the code they test
│   ├── setup.js              *test env: TEST_DATABASE_URL (name must end in _test), fixed secrets
│   ├── migrate.js            *pretest: creates and migrates the test database
│   └── helpers.js            *resetState, row builders, session cookie, assertNoSecrets, auditEvents, Google/fetch mocks
├── docs/                     *reference docs, read on demand (Read before); only process.md is imported
│   ├── endpoints.md          *API contract (source of truth) + per-endpoint behavior
│   ├── setup.md              *schema, Prisma conventions, crypto, seeding
│   ├── scaling.md            *rules for changing the schema, API and flows after launch
│   ├── client-website-test.md *end-to-end test against a client website
│   ├── security.md           *controls, audit log, secrets, access, incident response, pre-deploy checklist
│   ├── process.md            *issues, branches, handoffs, version control, releases, reminders (identical in the frontend)
│   ├── deploy.md             *hosting plans, environments, env vars, every deploy, rollback, client onboarding
│   ├── launch-record.md      *the first production deploy's checklist and pre-deploy checklist, the launch record
│   ├── history.md            *older progress entries, the MVP Build Order, Features as recorded
│   └── proposal-notes.md     *notes for the Proposal, a business doc outside the repo
├── .github/
│   ├── workflows/ci.yml      *lint, check:rules, format, npm audit and tests on every PR and push to main or production
│   ├── workflows/reminders.yml *scheduled reminder issues: restore drill, dependency audit, Doc Sync, code sweep (Reminders)
│   └── reminders/            *the reminder issue bodies, and open.sh, which opens one unless one is still open
├── .claude/
│   ├── settings.json         *Claude Code permissions and the guard hook: merging and releasing denied (`docs/process.md` → Version Control)
│   ├── hooks/guard.js        *PreToolUse guard: denies or asks before destructive git, database and storage commands
│   └── skills/               *project skills, run only when Rich types them
│       ├── code-sweep/       */code-sweep: the Code Review procedure, Scope and Output (full, since a commit, or a diff)
│       └── doc-sync/         */doc-sync: the Documentation Sync procedure (backend, frontend, Stevie)
├── docker-compose.yml        *local Postgres
├── render.yaml               *Render Blueprint: API + Postgres per environment, production's cron jobs
├── Dockerfile.backup         *the backup cron job's image: Node 24 + pg_dump 17 (docs/deploy.md)
├── .dockerignore             *keeps .env and node_modules out of the Docker build
├── .nvmrc                    *Node 24, read by nvm, Render and CI
├── prisma.config.js          *Prisma 7 CLI config: datasource URL, migrations path, seed command
├── .env.example
├── .prettierrc
├── eslint.config.js          *ESLint flat config (recommended rules)
├── CLAUDE.md                 *project context, loaded automatically every session
├── README.md                 *human-facing overview and local setup
├── app.js                    *Express app: middleware stack, routers, error handler (no listen)
└── index.js                  *entry point: loads .env, checks config, starts app.js
```

## Current progress (as of 2026-11-09)

- **Now:**
  - **Live since 2026-10-28:** the API at `https://api.3dwebdev.com` (Render: the API, Postgres 17, the nightly encrypted backup to R2 and the daily upload sweep) and the frontend at `https://3dwebdev.com` (Vercel Pro). Stevie The Dog is the first client website. Features 1 to 16 and issue #71 (placement apart from status) are live in both repos, the latest release `release-2026-11-06-3`.
  - **How work runs:** from a GitHub issue Rich writes, one branch per repo (`docs/process.md`); breaking changes through expand → migrate → contract (`docs/scaling.md` §0, §3); production released with `npm run release` from this repo after staging, backend first, each release tagged (`docs/process.md` → Releases).
  - **Staging** (`https://staging.3dwebdev.com`, `https://api-staging.3dwebdev.com`) is kept through onboarding, at $13.30/mo (Next 8).
  - **Issue #73 done:** the session docs trimmed, the legacy fields dropped (released), and the process shared with the frontend in `docs/process.md`; `npm run check:sync` reports all four pairs identical.
  - **Issue #90 done:** every file header is one or two lines on what the file is for, with no history, and `npm run check:rules` enforces it. The frontend's half of the V1 trim (frontend issue #77) is merged.
  - **Issue #69 done:** `build-spec` is its own GitHub template repo, `rmarafioti/build-spec` (local `../build-spec`), outside the 3DWD `gh` token: Rich pushes there himself.
  - **Issue #93 done** (frontend issue #81): new galleries get a random 8-character slug (the Gallery Code, also on `AdminGallerySummary`), and the admin's Audit Events take a `from` / `to` range for one local day. Additive; no migration.
  - **Issue #85 done** (frontend issue #83): the site owner's Recently deleted posts, listed for 30 days and restorable with their images and status; Audit Events show "Page N of M". Additive; one index migration.
  - **Issue #96 done** (frontend issue #85): scheduled publish. A draft post or gallery gets a go-live date (date only, midnight local), set on create, edit or its page, and the `3dwd-publish-scheduled` cron job publishes it every 15 minutes; `publishedAt` records when an item went live, and deleting posts no longer clears or re-asks the posts placement. Additive; two migrations (`add_publish_at`, `add_published_at` with its backfill). Released as `release-2026-11-06-2`; its cron job runs in production, and a restored published post was checked on Stevie's site.
  - **Issue #98 done** (frontend issue #87): the notification inbox. The admin's site-wide updates and automatic ones when an ability or gallery goes live (one way, read counts only), and message threads either side starts (at most 100 messages), with unread counts for the navbar mail icon. Additive; two migrations (`add_notifications`, `add_threads`). Released as `release-2026-11-06-3`.
  - **Issue #100 done** (frontend issue #89): deleting mail and one Recently Deleted. Either side ticks updates and threads to delete from its own mailbox (a reply brings a deleted thread back), and one Recently Deleted per role lists posts, galleries and mail for 30 days, restored in bulk. Nothing is purged: after 30 days an item can't be restored. Additive; two migrations (`add_mail_deleted_at`, `add_gallery_deleted_index`).
  - **Clients:** Estudio Castelo and Good Boys Dog Grooming are onboarded in production; Stevie The Dog stays the pilot.
  - **The master doc** is now the Proposal, Build vs Buy and a Glossary; its Client Portal tabs, Deployment and Client to Website included, are deleted.
- **Next:**
  1. The frontend drops its master doc mentions (frontend issue #65), and Stevie's `CLAUDE.md` and `.prettierignore` stop calling its guide a copy of the master doc (a handoff to its session).
  2. Stevie's galleries: #71 is released, so its posts read live and placed, its galleries ability `added` and its gallery `requested`. Rich wires the gallery component into the site and sets Photo Galleries live, then places the gallery and sets it live.
  3. Stevie The Dog: its `/api/revalidate` route ignores the body, so `{ websiteId, ability }` needs no change; its guide's revalidation section gains the new body (the same Stevie handoff). Rich copies the guide into the client repos by hand.
  4. The first real reminders: the code sweep (`/code-sweep 7a42142`) and Documentation Sync on 2026-11-09, the dependency audit on 2026-12-01 (it will list the four moderate dev advisories), the restore drill on 2027-01-01.
  5. Launch step 31 (Rich, `docs/launch-record.md`): onboard the two client websites still waiting, one at a time, by `docs/deploy.md` → Onboarding a client website.
  6. #98 is released and `/doc-sync` ran on 2026-11-06 (Rich): send a first site-wide update in production and check it reaches each site owner's Inbox.
  7. #100: release backend first, then the frontend (frontend PR #90), and run `/doc-sync`, since the contract changed. Then a later backend PR removes `GET /api/siteOwner/posts/deleted`, `DeletedPostSummary` and `POST /api/siteOwner/posts/:id/restore`, which the new frontend no longer calls.
  8. Launch step 30: reassess staging once onboarding runs smoothly, by writing its replacement flow first (issue #77 item 8).
- **Production database baseline** (2026-10-28):
  - the admin
  - Stevie The Dog's site owner `steviethedogchi@gmail.com`, linked to the active Stevie The Dog website (`media_folder` `steviethedog`)
  - "Test Post 1", written and edited at launch (`docs/launch-record.md` step 28), live on Stevie's site (`status` `published`)
  - the `audit_event` rows since launch, kept (audit rows are never deleted)
  - Estudio Castelo and Good Boys Dog Grooming, active onboarded clients: nothing from either account (its account, website, `account_website` link, abilities, posts, galleries or images) is ever deleted unless Rich says so.

  Production data is real: nothing here is cleared after a test. Read it with SQL from the API's Render Shell (`psql -P pager=off "$DATABASE_URL" -c "…"`).

- **Local database baseline** (test rows cleared on 2026-11-09, after #100's test):
  - the admin
  - the test site owner `steviethedogchi@gmail.com`, linked to the active Stevie The Dog website (`media_folder` `steviethedog`)
  - "First Post!", with one paragraph element
  - Stevie's posts ability (`live`, from the `backfill_website_ability` migration, and placed `live` by #71's `backfill_placement`); no galleries ability, no galleries, updates or threads (#100's test update and thread deleted on 2026-11-09)
  - the `audit_event` rows from local sign-ins and changes, kept: audit rows are not cleared after a test, locally or in production

  Cloudinary `3dwd-dev/steviethedog/` also holds the staging test's uploads, #71's two test gallery images, since staging shares `3dwd-dev`, and the Feature 10 test galleries' images, whose rows were deleted on 2026-10-31, so the next local sweep deletes them, as it does the six Feature 11 shrink-test photos and the Feature 13 and #93 test galleries' images. Staging data is throwaway: a local `npm run sweep:uploads` deletes them 24 hours after upload, because the local database doesn't reference them. Rich's own `stevie_the_dog` folder at the account's top level is outside both environment roots, so the app never touches it. Two client websites are waiting to onboard.

- **Pending notes:**
  - **Backup `pg_dump` version:** solved by `Dockerfile.backup` (Node 24 on Debian trixie, `postgresql-client-17`). Locally, the Homebrew `postgresql@17` client is used for backups (README); the Homebrew Postgres 15 server on the Mac is separate and is left as it is.
  - **R2 test backup:** `backups/test-2026-10-26T14-43-37-513Z.dump.enc` (the local dev database, encrypted with a throwaway key that has been deleted) stays in `3dwd-backups` until the bucket lock and lifecycle rule remove it around 2026-11-25. It is unreadable and harmless.
  - **`gh` token expires 2027-01-27:** renew `claude-code-3dwd` before then (`docs/security.md` → Access).
  - **Render Blueprint is on Manual Sync:** after a merge that changes `render.yaml`, click Manual Sync in Render. Code deploys and migrations don't need it: staging's run on every merge to `main`, production's on every push to `production`.
  - **Staging runs no cron jobs:** a scheduled draft on staging is published by running `npm run publish:scheduled` from the staging API's Render Shell.

One entry per merged piece of work, newest first, in one or two sentences: the PR holds the decisions and why. Only the last five stay here; when one drops out, move it to the top of `docs/history.md` → Progress. Add an entry on every branch, and update Now, Next, the baseline and Pending notes to match (Workflow Checklist → Step rhythm).

- **2026-11-09** `feat/delete-mail` (issue #100; frontend issue #89): per-viewer delete state on mail (`notification_recipient.deleted_at`, `notification.admin_deleted_at`, `thread.owner_deleted_at` / `admin_deleted_at`), a merged Recently Deleted list per role (`GET /api/{siteOwner|admin}/deleted`), and bulk delete and restore (`POST .../deleted`, `.../deleted/restore`) with partial results; a reply clears the other side's delete. Delete all read and the single-item routes were dropped before release. Additive. 730 tests.
- **2026-11-06** `feat/notification-inbox` (issue #98; frontend issue #87): the admin's site-wide updates (`/api/admin/notifications`) and automatic ones written when an ability or gallery goes live, read in the site owner's Inbox with counts only for the admin; message threads either side starts and both reply to (`/api/admin/threads`, `/api/siteOwner/threads`), capped at 100 messages and rate limited for site owners; unread counts for the navbar. The link scanner moves to `validation/fields.js` as `formattedText`, and `testing/setup.js` stubs `fetch` so no test call leaves the machine. Additive. 692 tests.
- **2026-11-06** `feat/scheduled-publish` (issue #96; frontend issue #85): a draft post or gallery takes a go-live date (`publishAt`, on create, edit and the new `PATCH .../:id/publishAt` routes), and `npm run publish:scheduled`, a production cron job every 15 minutes, publishes it with a no-actor audit event and revalidates; `publishedAt` records when an item went live (`lib/status.js`), backfilled from `createdAt`. Deleting posts no longer clears the posts placement, and the request form is sent only once. Additive. 643 tests.
- **2026-11-05** `feat/recently-deleted-posts` (issue #85; frontend issue #83): the site owner lists the posts deleted in the last 30 days (`GET /api/siteOwner/posts/deleted`, paged) and restores one with `POST /api/siteOwner/posts/:id/restore` (`post.restored`), backed by a (`website_id`, `deleted_at`) index; the admin's Audit Events gain `pages` for a "Page N of M" counter, and `pageShape` holds the shared 50-per-page default. Additive. 617 tests.
- **2026-11-05** `feat/ui-adjustments` (issue #93; frontend issue #81, the lead): deleting a website's last post clears a `requested` posts placement (`ability.request_cleared`), and new galleries get 8 random lowercase letters and digits as their slug, created at Serializable isolation so a same-name race still answers 409. `AdminGallerySummary` gains `slug`, and `GET /api/admin/auditEvents` takes an optional `from` / `to` range. Additive. 596 tests.

## Features

New work after the MVP Build Order, one branch → plan → approval → build → verify → PR each (`docs/scaling.md` §9). A breaking or data-changing change goes through expand → migrate → contract (`docs/scaling.md` §3). One line each: the rules in force are in `docs/`, the decisions in each PR, and the Features as first recorded in `docs/history.md`.

1. **Post body as elements** (`feat/post-elements`): a post's body is an ordered list of paragraph and image elements.
2. **Admin Accounts aside** (frontend only).
3. **Post preview v1** (frontend only): the post form shows the post live as it is typed.
4. **Post body formatting** (`feat/post-body-formatting`): bold, italic, bold-italic and links in a paragraph (`docs/endpoints.md` → Paragraph formatting).
5. **Image uploads** (`feat/image-uploads`): signed uploads into 3DWD's Cloudinary, one folder per website, and the daily upload cleanup (`docs/setup.md` → Image Hosting).
6. **Admin audit log view** (`feat/admin-audit-log`, issue #41): the admin's read-only Audit Events page, one UTC month at a time.
7. **Delete a post** (`feat/delete-post`, issue #44): soft delete with `deletedAt`; images swept 30 days later.
8. **Post status** (`feat/post-status`, issue #46): `draft` / `published` replaces `active`, which issue #73 dropped (the contract step).
9. **Streamlined post flow** (frontend only, frontend issue #46): step dialogs and a review view.
10. **Photo galleries** (`feat/photo-gallery`, issue #52): galleries of up to 30 images with optional crops, fetched by slug.
11. **Faster photo submit** (`feat/faster-photo-submit`, frontend issue #55; backend issue #60): photos shrunk in the browser before upload (`docs/endpoints.md` → API Contract, Notes).
12. **Abilities** (`feat/abilities`, issue #64): posts and Photo Galleries as a website's abilities, with request messages, On / Off and remove; status split from placement by issue #71.
13. **Request emails** (`feat/ability-emails`, issue #65): the admin is emailed each request message, and a sent message can be edited.
14. **Recently deleted posts** (`feat/recently-deleted-posts`, issue #85): the site owner lists the posts deleted in the last 30 days and restores one, with its images and status.
15. **Scheduled publish** (`feat/scheduled-publish`, issue #96): a draft post or gallery gets a go-live date, and a cron job every 15 minutes publishes it when it passes; `publishedAt` records when an item went live.
16. **Notification inbox** (`feat/notification-inbox`, issue #98): the admin's site-wide updates and automatic ones when an ability or gallery goes live (one way), and message threads either side starts and both reply to, with unread counts.
17. **Delete mail and one Recently Deleted** (`feat/delete-mail`, issue #100): either side deletes the updates and threads it ticks from its own mailbox (a reply brings a thread back), and one Recently Deleted per role for posts, galleries and mail, restored in bulk for 30 days.

## Planned Later

Ideas Rich has chosen for later are GitHub issues in this repo labelled `later` (`gh issue list --label later`), each holding its backend and frontend detail. Not scheduled and not to be built yet: one becomes a numbered Feature (see Features) when Rich schedules it. The frontend's `CLAUDE.md` points here.
