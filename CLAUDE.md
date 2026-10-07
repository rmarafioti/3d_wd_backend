# CLAUDE.md — Backend

@docs/endpoints.md
@docs/setup.md

## Project Overview

The backend codebase of our Headless CMS project. The frontend is in a separate repository which connects to this one through the API contract in `docs/endpoints.md`. Two roles to account for, an Administrator and a Site Owner, each with their own auth-gated API routes.

- The Administrator sees a summary of all site owner accounts and their websites, creates new site owner accounts, and links websites to existing accounts.
- The Site Owner views, creates, edits, archives and reactivates posts for their own websites.
- The backend also serves published post content to each site owner's live website via that website's API key, and triggers on-demand revalidation on that site by calling its webhook endpoint whenever a post changes.

Production: this API runs on Railway at `https://api.3dwebdev.com`. The frontend runs on Vercel at `https://3dwebdev.com`. Both share the parent domain `3dwebdev.com`, which is why the session cookie is `SameSite=Lax` with `Domain=.3dwebdev.com`.

## Tech Stack Summary

- Framework - Node.js / Express 5 (current stable) / CORS / helmet
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

## Project Architecture

```
root
├── api/                      *route handlers only, organized by auth/role type, mounted under /api
│   ├── auth/
│   │   └── index.js          *POST login, POST logout, GET me
│   ├── admin/
│   │   └── index.js          *accounts, websites, create account, link a website
│   ├── siteOwner/
│   │   └── index.js          *websites, post CRUD, post status
│   ├── public/
│   │   └── index.js          *GET /public/posts (API key auth)
│   └── index.js              *mounts all routers + GET /health
├── services/
│   └── revalidate.js         *fire-and-forget webhook call to a client website
├── validation/               *zod schemas, one per resource
│   ├── auth.js               *login body ({ credential })
│   ├── account.js
│   ├── website.js
│   └── post.js
├── middleware/
│   ├── requireAuth.js        *verifies the session cookie, loads req.user
│   ├── requireRole.js        *role gate: admin / site_owner
│   ├── requireCsrfHeader.js  *403 on POST/PATCH/DELETE without X-CSRF-Protection: 1
│   └── requireApiKey.js      *public endpoint: hashes Bearer key, loads req.website
├── lib/                      *shared utilities
│   ├── crypto.js             *key/secret generation, hash, encrypt/decrypt
│   ├── jwt.js                *sign/verify session JWT, cookie options
│   └── normalizeUrl.js       *https, lowercase host, no trailing slash
├── errors/                   *custom error classes + the single error handler (error envelope)
│   ├── serverError.js
│   └── index.js
├── prisma/                   *database schema, seed scripts, and migrations
│   ├── index.js              *shared Prisma client
│   ├── schema.prisma
│   ├── seed.js
│   ├── seedData.js
│   └── migrations/
├── docs/                     *reference docs, imported from CLAUDE.md
│   ├── endpoints.md          *API contract (source of truth) + per-endpoint behavior
│   └── setup.md              *schema, Prisma conventions, crypto, seeding
├── docker-compose.yml        *local Postgres
├── prisma.config.js          *Prisma 7 CLI config: datasource URL, migrations path, seed command
├── .env.example
├── .prettierrc
├── CLAUDE.md                 *project context, loaded automatically every session
├── README.md                 *human-facing overview and local setup
└── index.js                  *Express app entry point
```

## Build Order

The app is built in this order across both repos. Each step is built, tested and committed before the next starts. Check which repo a step touches — the other repo's side may need to exist first.

**Current progress (as of 2026-10-06):** The MVP Build Order is complete: steps 1–6 are merged in both repos (step 6 was PR #5, with follow-ups PR #6 and #7 adding the inactive-website 409 message). Local database: the admin, the test site owner `steviethedogchi@gmail.com` linked to the active Stevie The Dog website, and one post. Rich has recorded Stevie's API key. Anything further is new work beyond this Build Order; update this line when it starts.

1. **Seed the administrator** — backend. Schema, migration, admin-only seed (`docs/setup.md`). Confirm the row in Prisma Studio.
2. **Login** — both. Backend: login, logout, me, session cookie, CSRF and auth middleware. Frontend: sign-in page, `apiFetch`, AuthContext, layouts, proxy. Test by signing in as the admin and landing on `/admin`.
3. **Create an Account** — both. Admin list of accounts, website picker, create account, one-time reveal. Test by creating the test site owner and the Stevie The Dog website through the UI (`docs/setup.md`, Seed Users). Confirm rows in Prisma Studio.
4. **Site owner login** — both (no new code expected). Sign in as the test site owner with the second Google account and confirm routing to `/dashboard`.
5. **Post CRUD** — both. Websites with post summaries, create, get by id, edit, archive / make active, revalidation service, public posts endpoint.
6. **Link a Website** — both. Link a new and an existing website to an account.

## Role Ownership Check Rule

Every read/write route derives the account from the session (`req.user`), never from client input, and verifies the requested resource belongs to it before proceeding. A website belongs to a site owner through an `account_website` row and must be active; a post belongs to them through its website. A failed check returns `404`, identical to "not found".

## Anti-Patterns to Avoid

**Never log the API key, webhook secret or session token:**
The plaintext key/secret must only ever appear in the single creation response body (`credentials`) — never logged, never returned by any other endpoint, never stored anywhere but as the hash / encrypted value. Never log request headers on the revalidation call or the public endpoint.

**Never trust frontend validation alone:**
Independently re-validate every field on every request with the zod schemas in `validation/`.

**Never send the token in a response body:**
The JWT appears only in the `Set-Cookie` header — never anywhere in a JSON body.

**CORS origin must never be a wildcard when credentials are enabled:**
Cookies silently fail to be accepted. The exact origin comes from `CORS_ORIGIN`.

**Never let revalidation affect the user's request:**
Revalidation runs after the transaction commits, is not awaited before responding, and can never throw into the route. A client website being down must never stop a site owner saving a post.

**Never select secrets by default:**
`api_key_hash` and `webhook_secret_encrypted` are excluded from every query except the ones that need them (`requireApiKey`, `services/revalidate.js`).

## Patterns and Preferences

**Prisma transforms DB snake_case to camelCase:**
`@map` must be used on every snake_case column in the Prisma schema, so nothing snake_case ever leaks into an API response.

**Crypto/generation all in one place:**
`lib/crypto.js` is reused by Create an Account, Link a Website, `requireApiKey` and the revalidation service. Never duplicated inline.

**Multi-row writes:**
Account + website + account_website, website + account_website, and post + images + links always happen inside a single `prisma.$transaction`.

**Never a hard delete:**
Soft delete via an `active` boolean is the standard for every client-facing resource (account, website, post). Posts are archived / reactivated through the API. Accounts and websites have no API for this in the MVP — they are flipped in Prisma Studio — but the backend always honours the flag (inactive account cannot log in or use a session; inactive website is hidden from its site owners, its API key is refused, and it receives no revalidation calls).

**One error envelope:**
Routes throw; the single error handler in `errors/` turns every error into `{ error: { message, fields? } }` with the status codes in `docs/endpoints.md`. Express 5 forwards rejected async handlers to it automatically.

**Emails lowercase, URLs normalized:**
Lowercase every email and run every website URL through `lib/normalizeUrl.js` before comparing or saving.

**CORS origin in .env:**
The allowed origin lives in `CORS_ORIGIN`, so it can differ between local dev and production without touching code. Same for `COOKIE_DOMAIN`.

**In-line comments:**
Keep all code readable and explicit. Comments should be used to inform other developers of the logic in more abstract code. Make sure all comments have been validated and are truthful. High level comments should be added at the top of each file to explain its purpose.

**Placeholder folders:**
An empty scaffold folder holds a `.gitkeep` so git tracks it. Delete the `.gitkeep` in the same change that adds the folder's first real file.

**Saving notes:**
When Rich asks to save or remember something, write it into the most fitting project md file (`CLAUDE.md`, `docs/setup.md`, `docs/endpoints.md` or `README.md`), not only into private memory, so it survives a context clear and is visible to everyone working on the repo.

## Out of Scope (do not build)

- Key/secret rotation. `lib/crypto.js` is written so rotation can reuse it later, but there is no rotation endpoint in the MVP.
- Endpoints to deactivate/reactivate accounts or websites.
- Hard deletes of any kind.

## Ask Rich at Build Time

- `SEED_ADMIN_EMAIL` (the admin's Google account email).
- The second Google account email used for the test site owner in Build Order step 3.

## Style Guidelines

Formatting via `.prettierrc`, run before commit.

## Workflow Checklist

- Check relevant spec
- Create a plan — always in plan mode (switch with EnterPlanMode, present with ExitPlanMode), never as a plain chat message
- On approved, build
- Checks after building:
  - Role-gating and ownership check on every route
  - Transaction wrapped (if multi-row write)
  - CSRF header required on every POST/PATCH/DELETE
  - Response matches the API contract (shape, status codes, error messages)
  - No secrets selected, returned or logged
  - Test in Postman (logic only — send the `X-CSRF-Protection: 1` header)
  - Test via a real frontend request (validates CORS/cookie behavior)
- Only commit once code is reviewed, approved and all validation and tests are green

Step rhythm:

- Each Build Order step is its own task: branch from an up-to-date `main`, write a fresh plan in plan mode (replacing any earlier plan), get Rich's approval, build, verify, commit and push. Rich merges the PR on GitHub.
- The docs are the spec. When a plan only touches code already in the repo, reading the docs and the files involved is enough — no broad exploration needed. Library APIs are checked against the installed packages in `node_modules`.
- When a step needs the frontend and backend to work in tandem, finish by writing a handoff message for Claude in the other repo, which Rich pastes there. Write it for a reader with no context: what was completed (and on which branch), anything the other side must follow (contract details, headers, local wiring), what's next for them, and a "done when" checklist. Check it against the other repo's docs where they overlap (for example, sign-out routes to `/`, the landing page).
- When Rich says to commit, first update the "Current progress" line under Build Order to describe the state after the PR merges, and commit it on the same branch. Never leave it as a loose edit on `main` after a merge, which would need its own PR.
- After a step is merged, Rich runs `/clear`. The next step starts from `CLAUDE.md` and the docs alone, so anything worth keeping must be written into them before the clear.

## Plan Authoring

When in plan mode, write the plan to be legible cold — understandable by someone who never saw the conversation that produced it. State what's being built, which files will be touched, and why this approach was chosen. Avoid shorthand like "same pattern as before" or "as discussed" without spelling out what that actually means.

## Delegating to Subagents

Use subagents for research/exploration/investigation for a plan and for completing smaller tasks.
