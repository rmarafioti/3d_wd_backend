# CLAUDE.md — Backend

@docs/endpoints.md
@docs/setup.md
@docs/scaling.md
@docs/client-website-test.md

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
│   ├── post.js
│   └── validate.js           *validate() → 400 envelope, blankToUndefined
├── middleware/
│   ├── requireAuth.js        *verifies the session cookie, loads req.user
│   ├── requireRole.js        *role gate: admin / site_owner
│   ├── requireCsrfHeader.js  *403 on POST/PATCH/DELETE without X-CSRF-Protection: 1
│   └── requireApiKey.js      *public endpoint: hashes Bearer key, loads req.website
├── lib/                      *shared utilities
│   ├── crypto.js             *key/secret generation, hash, encrypt/decrypt
│   ├── dates.js              *postDate "YYYY-MM-DD" ↔ Date helpers
│   ├── jwt.js                *sign/verify session JWT, cookie options
│   ├── normalizeUrl.js       *https, lowercase host, no trailing slash
│   └── postBody.js           *element rows → the post body list in API responses
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
│   └── helpers.js            *row builders, session cookie, assertNoSecrets, Google/fetch mocks
├── docs/                     *reference docs, imported from CLAUDE.md
│   ├── endpoints.md          *API contract (source of truth) + per-endpoint behavior
│   ├── setup.md              *schema, Prisma conventions, crypto, seeding
│   ├── scaling.md            *rules for changing the schema, API and flows after launch
│   └── client-website-test.md *end-to-end test against a client website (local, deployed, tunnel)
├── docker-compose.yml        *local Postgres
├── prisma.config.js          *Prisma 7 CLI config: datasource URL, migrations path, seed command
├── .env.example
├── .prettierrc
├── eslint.config.js          *ESLint flat config (recommended rules)
├── CLAUDE.md                 *project context, loaded automatically every session
├── README.md                 *human-facing overview and local setup
├── app.js                    *Express app: middleware stack, routers, error handler (no listen)
└── index.js                  *entry point: loads .env, checks config, starts app.js
```

## Build Order

The app is built in this order across both repos. Each step is built, tested and committed before the next starts. Check which repo a step touches — the other repo's side may need to exist first.

### Current progress (as of 2026-10-21)

- **Now:** the MVP Build Order is complete in both repos. Features 1, 2 and 4 are merged. Feature 3 Post preview is built on the frontend (branch `feat/post-preview`, PR pending).
- **Next:**
  1. The Stevie The Dog website renders Feature 4 formatting (in its own repo): Rich drops in the updated `docs/client-website.md` and tests the formatting and links.
  2. Feature 5 Image uploads, the last feature. The contract is on `docs/image-uploads`. Next is the backend step: Rich provides the Cloudinary values for `.env` (3DWD's account, `3dwd-dev` folder). Then the frontend copies the contract and builds the upload.
  3. After Feature 5, a full Documentation Sync across the frontend, the backend, the master doc and the client website docs, with the em dash decision. Before security hardening.
  4. Security hardening, in its own session, with backend suggestions.
  5. The production deploy.
- **Local database baseline** (test rows cleared on 2026-10-19):
  - the admin
  - the test site owner `steviethedogchi@gmail.com`, linked to the active Stevie The Dog website
  - "First Post!", with one paragraph element

  Rich has recorded Stevie's API key. Four client websites are waiting to onboard once the app is live.

- **Pending notes:**
  - **Em dashes (next Documentation Sync):** Rich prefers no em dashes in user-facing messages, and the frontend already follows this for its own strings. Contract messages with em dashes ("A website with this URL already exists — select it from the dropdown.") stay unchanged until Rich decides, because rewording them is a contract change in both repos.
  - **Cloudinary on client websites (next Documentation Sync):** the master doc's "Client to Website" tab needs a `next.config` `remotePatterns` entry for `res.cloudinary.com/<3DWD cloud>/image/upload/**` before a client website can show uploaded images.
  - **Railway:** the rule that migrations run as a Railway pre-deploy step (`docs/scaling.md` §7) is unconfirmed until the Railway deploy is set up.

One row per merged piece of work, newest first. Add a row on every branch, and update Now, Next, the baseline and Pending notes to match (Workflow Checklist → Step rhythm).

| Date       | What was done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-21 | `docs/image-library` (docs only): Planned Later gains "Image library (reuse stored images)", a site owner `GET` of a website's stored images read from the database, so a photo used again is not uploaded twice. Confirmed from the code that image rows may share a `src` and that neither post saves nor the cleanup delete a file another row still uses; the test for that is written with the feature.                                                                                                                                                                                                                                                                                        |
| 2026-10-20 | `docs/image-uploads` (docs only): Feature 5 contract. `POST /api/siteOwner/uploads/sign` returns `UploadSignature { uploadUrl, fields }` (Cloudinary's keys, posted unchanged). Image `src` must be a `secure_url` in the website's folder, else 400 "Invalid image.". `website.media_folder` with its naming rule, the Image Hosting and Upload cleanup sections in `docs/setup.md`, the R2 fallback and the cleanup cron in `docs/scaling.md`. Uploads are jpg, png or webp, at most 10 MB, scaled down to fit 2500 × 2500.                                                                                                                                                                       |
| 2026-10-20 | `docs/post-preview` (docs only): Feature 3 entry matches the live preview the frontend built; Planned Later gains "Streamlined post editor"; Feature 5 Image uploads planned; Current progress becomes this table. The master doc's "Client to Website" tab is brought up to Feature 4: `links` removed, a Paragraph formatting section with a `parseParagraph` / `FormattedText` renderer (checked against every contract example and against the dashboard's parser) and the examples table, post date shown first. Its "Client - Claude.md" template tab follows: paragraph text renders through `FormattedText`, the formatting is tested against the examples, and links keep their underline. |
| 2026-10-20 | Frontend: Feature 4 merged (PRs #16, #17). Feature 3 Post preview built and pushed on `feat/post-preview`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-10-19 | `feat/post-body-formatting` (PR #20): Feature 4 backend. Paragraph link validation (a one-pass scan, so unmatched `[` can't stall the server), `links` removed from routes and responses, the `drop_link` migration, "Invalid image.", `assertOwnImages`, 177 tests. The contract adds a clarification (a link's text is checked before its URL), plus bold-italic, links inside formats, the `**a*` example and https-only rendered links. The Workflow Checklist ends with the review reported to Rich as findings with questions.                                                                                                                                                                |
| 2026-10-19 | `docs/post-body-formatting` (PR #19): Feature 4 contract (`docs/endpoints.md` → Paragraph formatting, `links` removed everywhere) and the pre-launch rule (`docs/scaling.md` §0). Post body formatting and Post preview moved into the MVP.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-10-19 | Frontend `12-styling` (PR #15): Rich's general styling and Feature 2 Admin Accounts aside. No contract change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-10-16 | `docs/market-position` (PR #18): 3D Web Dev is the business and the Client Portal is the tool. The master doc's Market Position tab holds the market comparison, its Business Pitch tab the landing page directions. Site owner collaboration marked feature creep.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-10-14 | `docs/planned-later` (PR #17): the Planned Later list (kept identical in the frontend), and Features 2–3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-10-12 | Stevie The Dog integration complete in its own repo; client-website Tests A–C passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-10-11 | `docs/client-pages-static` (PR #16): Test A checks that every page that renders posts builds as static. The master doc gains the "Client - Claude.md" template tab; template and guide fetch through `cmsFetch()` plus a `getX()` per kind of content, tagged `cms`, revised from the Stevie The Dog build.                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-10-09 | `docs/client-website` (PR #15): the master doc's "Client to Website" tab (each client website's `docs/client-website.md`) and the `docs/client-website-test.md` runbook.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-10-09 | `docs/doc-sync` (PR #14): the Documentation Sync section and the first audit. Four stale comments fixed, the API Contract identical in both repos, six frontend findings fixed on its own branch. Both scaling docs put staging before the first breaking change after launch. The master doc audited.                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-10-09 | `feat/post-elements` (PR #13): Feature 1. `post.body` becomes ordered paragraph and image elements (`element` table, two migrations), the 256kb body limit with a 413, 163 tests. Contract: `body` is `Element[]`, `images` leaves `Post` / `PublicPost`. Merged in both repos.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-10-07 | `docs/scaling-rules` (PR #12): `docs/scaling.md`, the rules for changing the schema, API and flows after launch. The frontend wrote its own short version.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-10-07 | `test/unit-tests` (PR #11): `node:test` + Supertest, 152 tests against `headless_cms_test`, `npm test` added to Code Review and the Workflow Checklist. The Express app split into `app.js`. No bugs, no contract change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-10-07 | `docs/test-data-cleanup` (PR #10): delete test rows after every manual test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-10-07 | `chore/code-review` (PR #9): Code Style and Code Review sections, ESLint, fixes from the first full review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-10-06 | MVP Build Order steps 1–6 merged in both repos (PRs #1–#5). Follow-ups #6 and #7: the inactive-website 409 names the website and reads "…Reactivate and then try again." PR #8 marks the MVP complete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Steps

1. **Seed the administrator** — backend. Schema, migration, admin-only seed (`docs/setup.md`). Confirm the row in Prisma Studio.
2. **Login** — both. Backend: login, logout, me, session cookie, CSRF and auth middleware. Frontend: sign-in page, `apiFetch`, AuthContext, layouts, proxy. Test by signing in as the admin and landing on `/admin`.
3. **Create an Account** — both. Admin list of accounts, website picker, create account, one-time reveal. Test by creating the test site owner and the Stevie The Dog website through the UI (`docs/setup.md`, Seed Users). Confirm rows in Prisma Studio.
4. **Site owner login** — both (no new code expected). Sign in as the test site owner with the second Google account and confirm routing to `/dashboard`.
5. **Post CRUD** — both. Websites with post summaries, create, get by id, edit, archive / make active, revalidation service, public posts endpoint.
6. **Link a Website** — both. Link a new and an existing website to an account.

## Features

New work after the MVP Build Order, one branch → plan → approval → build → verify → PR each (`docs/scaling.md` §9). Until the first production deploy, breaking changes are made in place (`docs/scaling.md` §0).

1. **Post body as elements** — both. Branch `feat/post-elements`. `post.body` changes from one text field to an ordered list of elements, each a paragraph or an image, so a client website can interleave text and photos. A new `element` table (with `position`) references the unchanged `image` table, and `images` leaves `Post` / `PublicPost`. Limits: at least 1 paragraph, at most 5 paragraphs of 10,000 characters and 5 images. Also sets `express.json({ limit: '256kb' })` with a `413` "Request body is too large." This is a breaking + data-changing contract change, shipped in one swap because nothing consumed `/api/public/posts` yet. Merged in both repos: the frontend built the element editor and copied the new contract.
2. **Admin Accounts aside** — frontend only, no backend change.
3. **Post preview (v1)** — frontend only. Built and pushed on frontend branch `feat/post-preview` (PR pending).
   - **What it is:** the Create / Edit Post form shows the post live as it is typed, as it will read on the client website without that site's own styling.
   - **Order:** the post date first, so a reader sees how recent the post is, then the header, sub header, and the body in order with its formatting.
   - **Images:** an image shows once its fields are complete. It uses Next.js `<Image>` at its stored `width` and `height`, unoptimized, so no Cloudinary host entry is needed in `next.config`.
   - **Desktop:** the preview sits beside the form, open by default, with a hide / reveal toggle.
   - **Phone:** a Preview button swaps the form for the preview, which has Back to edit and Publish.
   - **Saving:** one save button, Publish, for both creating and editing. Nothing is saved before Publish, so no draft state is needed.
   - **Editor only:** paragraph links are managed from a collapsible "Links in this paragraph" list and are bold by default (written `**[text](url)**`). The toolbar's Bold / Italic never format a link. The stored markup still follows the contract unchanged.
   - No backend, contract or schema change.
4. **Post body formatting** — both. Branch `feat/post-body-formatting`. Built before Feature 3. A paragraph's text can hold bold (`**text**`), italic (`*text*`), bold-italic (`***text***`) and links (`[text](https://…)`), which may sit inside a format, specced in `docs/endpoints.md` → Paragraph formatting. The links list leaves `Post`, the create and edit request bodies and `PublicPost`, and the `link` table is dropped. Breaking, made in place under the pre-launch rule (`docs/scaling.md` §0); the test link rows are dropped, not migrated. "Invalid image or link." becomes "Invalid image." The Stevie The Dog client template renders the markup. Merged in both repos (backend PRs #19 and #20, frontend PRs #16 and #17). The Stevie The Dog website's update is next.
5. **Image uploads** — both. Contract on branch `docs/image-uploads` (step 1); the backend is next, then the frontend upload. The last feature before launch. Site owners upload images from the post form into **3DWD's** Cloudinary account, so they no longer need their own Cloudinary account. Decisions (2026-10-20):
   - **Vendor:** Cloudinary, under 3DWD's account. Cloudflare R2 is the fallback if the free tier (25 credits a month) is outgrown; 10–15 clients are expected in the next year. If it comes to that, new uploads switch to R2, old images stay, and an optional one-off script copies them and rewrites `image.src`.
   - **The browser holds the image until Publish.** The form and Preview show a picked image from memory. On Publish, the frontend asks for one signed upload (`POST /api/siteOwner/uploads/sign`, ownership-checked, with every signed parameter built by the backend), uploads each new image straight to Cloudinary, then saves the post with the returned `secure_url`, `width` and `height`. An abandoned form uploads nothing. No widget, no temp folder.
   - **Folders:** one root per environment (`3dwd/` in production, `3dwd-dev/` locally, from `CLOUDINARY_FOLDER`), and one subfolder per website. Its name is a new `website.media_folder` column, set from the URL when the website is created (`https://www.steviethedog.com` → `steviethedog`) and backfilled for Stevie.
   - **The database is the record of which images are kept.** A daily cleanup (`npm run sweep:uploads`, a Railway cron service once deployed) deletes uploads under the environment root older than 24 hours that no `image` row references. That covers images removed in an edit, and an upload whose save then failed. Post saves never call Cloudinary. Archived posts keep their images.
   - **Upload only:** pasting a URL is removed. The backend accepts only an image `src` in that website's folder; another website's folder is 400 "Invalid image."
   - **Form timeout (frontend):** an open Create / Edit Post form times out 20 hours after opening, or at session expiry if that comes first, and clears with a timed-out message.
   - **Folder names (`media_folder`):** strip `www.`, drop the top-level domain, dots → hyphens (`steviethedog`, `shop-example-co`); `-2`, `-3`… on a clash. Set once and never changed (`docs/setup.md` → Image Hosting).
   - **Upload rules:** jpg, png and webp, at most 10 MB (checked by the frontend; the formats are also signed). A signed `c_limit,w_2500,h_2500` scales large photos down as Cloudinary stores them.
   - **Sign response:** `{ uploadUrl, fields }`; `fields` is posted to Cloudinary unchanged, so its keys are Cloudinary's (the one exception to camelCase).
   - **Testing:** `npm test` needs no Cloudinary account (the signature is checked against a fixed secret; the cleanup mocks Cloudinary's Admin API). The backend's manual test uses curl or Postman against 3DWD's `3dwd-dev` folder: sign, upload, then save a post with the returned `secure_url`. No frontend is needed until step 3.
   - **Order:** the contract on a docs branch first, then the backend, then the frontend upload. Breaking (tighter `src` rule) and data-changing (`media_folder` backfill), made in place under `docs/scaling.md` §0.

## Planned Later

Ideas Rich has chosen for later. Not scheduled and not to be built yet. Each becomes a numbered Feature (see Features) when it starts. The frontend's `CLAUDE.md` keeps the same list; this one is the source of truth.

- **Admin action hub.** While Create an Account is the only admin action, `/admin` is that form. Once there are more admin actions, `/admin` becomes a main page asking "What would you like to do?", with a choice of actions, each opening its own page: Create an Account, Deactivate an Account, Roll a Secret, Roll a Key. Build it together with the first new admin action (the last three are currently Out of Scope).
- **Post preview v2 (true preview on the client website).** The client website renders an unsaved post with its own styling, through Next.js draft mode unlocked by a short-lived signed token. Needs a new public endpoint that returns one draft post, and an update to the client template. It brings a draft / published state. Rule: two separate flags, never one flag with two meanings — draft vs published, and hidden vs live. Today `active` means hidden vs live (archive / make active), and the public API and the status route depend on it. The new flag's name is decided when this starts; reusing or renaming `active` for drafts is a breaking change (`docs/scaling.md` §1, §3).
- **Add-on catalog.** Site owners get an "Add to your website" list, each add-on with a one-line description. Photo Gallery and Business Hours come first. Which add-ons a website has lives in a `website_feature` table (website, feature, on/off, timestamps), not a boolean column per feature on `website`. The table is built together with the first add-on, not before. An add-on moves through **available → requested → live**: the site owner turns it on and fills it in, the administrator sees it as requested, and Rich wires it into the client website and marks it live. An add-on's optional fields sit behind "More options", so the basic form stays short. Each add-on follows `docs/scaling.md` §5.
- **Administrator notifications.** An alert when a site owner requests an add-on, or has filled one in and it is ready to wire. A job row is written in the same transaction as the site owner's change, and a worker sends the email or message (the same outbox `docs/scaling.md` §7 plans for revalidation). Ships separately from the request flow; until then the admin dashboard shows "requested".
- **Site owner collaboration.** Site owners suggest new add-ons, or optional fields for existing ones. Approved suggestions are built once and offered to every site owner. Rich curates: a suggestion is built when at least two businesses want it, or it clearly helps several. Sharing between site owners is opt-in or anonymized. It starts outside the software (a shared suggestion board) and moves into the app once there are roughly 10–20 site owners. Feature creep until live use with the early adopters shows owners want it. Not built before then.
- **Streamlined post editor.** After the MVP, the Create / Edit Post editor cuts its clutter: each paragraph and image section collapses (open one to edit it), and "Add a paragraph" / "Add an image" move into a toolbar at the side of the dialog. Frontend only, no contract change. The current editor stays for the V1 MVP.
- **Image library (reuse stored images).** Picking the same photo for a new post today uploads a second copy to 3DWD's Cloudinary account. Instead, the image field offers "Choose from your images". A new site owner `GET` (ownership-checked like every site owner route) returns a website's distinct stored images (`src`, `width`, `height`, latest `altText`) from the `image` table, including images on archived posts. It reads the database, not Cloudinary's Admin API: the database is the record of which images are kept, the Admin API is rate-limited, and its listing includes abandoned uploads the cleanup hasn't deleted yet. A reused image is sent in the create or edit body like a new one, without an id; its `src` is already in the website's folder, so the `src` rule accepts it. Image rows may share a `src` (no unique constraint), and neither post saves nor the cleanup delete a file while any row refers to it; a test proving the shared-src case is written with the feature. The only contract change is the new `GET`, in both repos. Automatic dedupe by content hash was set aside: it needs a signature per file and the site owner never sees it.

## Role Ownership Check Rule

Every read/write route derives the account from the session (`req.user`), never from client input, and verifies the requested resource belongs to it before proceeding. A website belongs to a site owner through an `account_website` row and must be active; a post belongs to them through its website. A failed check returns `404`, identical to "not found".

## Anti-Patterns to Avoid

**Never log the API key, webhook secret, session token or Cloudinary API secret:**
The plaintext key/secret must only ever appear in the single creation response body (`credentials`) — never logged, never returned by any other endpoint, never stored anywhere but as the hash / encrypted value. Never log request headers on the revalidation call or the public endpoint. `CLOUDINARY_API_SECRET` lives only in the environment: it is read where uploads are signed and where the cleanup runs, and is never logged or returned.

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
Account + website + account_website, website + account_website, and post + elements + images always happen inside a single `prisma.$transaction`.

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
When Rich asks to save or remember something, write it into the most fitting project md file (`CLAUDE.md`, `docs/setup.md`, `docs/endpoints.md`, `docs/scaling.md` or `README.md`), not only into private memory, so it survives a context clear and is visible to everyone working on the repo.

## Out of Scope (do not build)

- Key/secret rotation. `lib/crypto.js` is written so rotation can reuse it later, but there is no rotation endpoint in the MVP.
- Endpoints to deactivate/reactivate accounts or websites.
- Hard deletes of accounts, websites or posts.

## Ask Rich at Build Time

- `SEED_ADMIN_EMAIL` (the admin's Google account email).
- The second Google account email used for the test site owner in Build Order step 3.

## Code Style

Formatting is Prettier (`.prettierrc`: `singleQuote`, `semi`, `trailingComma: all`, `printWidth: 100`, `tabWidth: 2`), run before every commit (`npm run format`), plus `npm run lint` clean (ESLint recommended rules, `eslint.config.js`). Prettier settles formatting; the rules below settle what Prettier can't.

- **File shape, top to bottom:** header comment (what the file is for) → `require`s (packages such as `express`, `zod`, `google-auth-library` first, then local modules) → module setup (`const router = express.Router()` and its `router.use(...)` guards) → module constants (`UPPER_SNAKE`) → private helpers → routes (or the file's main function) → `module.exports`. Entry points (`index.js`, `prisma/seed.js`) require `dotenv/config` before anything else.
- **Route handler shape:** validate the input (`validate(schema, req.body ?? {})`) → existence / ownership check (`if (!post) throw new ServerError(404, ...)`) → the Prisma call (`prisma.$transaction` for a multi-row write) → `res.json({ data })` or `res.status(201).json({ data })` → `revalidate(...)`, not awaited, where a post changed. Where `docs/endpoints.md` orders the steps differently (Link a Website checks the account before validating), follow the spec. Each route has a one-line comment above it: `// METHOD /api/path — what it does.`
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
- **Queries:** any read whose result reaches a response or `req.*` uses an explicit `select`. `apiKeyHash` and `webhookSecretEncrypted` are selected only in `requireApiKey` and `services/revalidate.js`.
- **Control flow:** early returns and early throws over nested `if`/`else`. No nested ternaries.
- **User-facing strings:** every message `docs/endpoints.md` states (Error messages the frontend displays, Status codes) is copied word for word. Never paraphrase it: the frontend shows `error.message` exactly as it arrives.

## Code Review

A review is read-only. It produces findings; it never edits code. Fixes are their own task: plan in plan mode, Rich approves, build, verify (Postman or curl against the local server, plus a real frontend request wherever the frontend uses the endpoint), PR. Every fix must preserve behaviour unless the finding is a bug.

### Checklist

1. **Style is consistent.** The code matches Code Style above. If two files do the same thing two ways, pick the documented way. If no way is documented, raise it so the rule gets written down before anything is changed.
2. **No dead code.** Unused requires, variables, exports, files, middleware, routes, Prisma fields selected but never returned or read, env vars nothing reads, unreachable branches and commented-out code. For each one, decide: delete it, or find out why it isn't used. Unused code is sometimes a sign of a missing wire-up, not junk. The best code is code that was never written.
3. **Explicit, then DRY.** Readability wins over cleverness. But when the same logic appears a **third** time, or twice with a real risk of the copies drifting (the ownership check, the error envelope, URL normalization, the zod helpers), extract it into `lib/`, `middleware/`, `validation/`, `services/` or `errors/`. Don't abstract for a case that doesn't exist yet. A shared piece must be simpler to read than the copies it replaces.
4. **Reads top to bottom as a story.** Each block builds on what came before it: no forward references to helpers defined far below without reason, and no constant declared far from where it's used. A reader new to the file should be able to follow it in one pass. Names carry the meaning, so comments don't have to.
5. **Comments are necessary and true.** A misleading comment costs more than a missing one: it sends the next developer, or agent, chasing behaviour that isn't there. For every comment: is it still true of the code next to it? Does it explain _why_ rather than restate _what_? Delete it if not. Every file keeps its header comment, and the header must match what the file does now.
6. **Docs match code.** CLAUDE.md (architecture tree, Build Order Current progress), `docs/endpoints.md` (including the Middleware Stack), `docs/setup.md`, `docs/scaling.md`, `docs/client-website-test.md`, `README.md` and `.env.example` describe what is actually in the repo. Fix whichever side is wrong; if the spec is right and the code differs, that's a bug finding. The API Contract section of `docs/endpoints.md` must still be identical to the frontend's `docs/api.md`.
7. **Architecture rules still hold.** Re-run the Role Ownership Check Rule, the Anti-Patterns list and the Workflow Checklist "Checks after building" against the code:
   - the account always comes from `req.user`, never from client input
   - "not yours" is the same `404` as "not found"
   - `apiKeyHash` / `webhookSecretEncrypted` are never selected outside their two places and never returned
   - the plaintext key and secret appear only in the creation response
   - nothing logs a key, secret, token or request headers
   - the JWT appears only in `Set-Cookie`
   - the CSRF header is required on POST/PATCH/DELETE
   - multi-row writes happen in one `$transaction`
   - `revalidate` runs after commit and is not awaited
   - no hard deletes of accounts, websites or posts, and inactive accounts and websites are honoured
   - emails are lowercased and URLs go through `normalizeUrl`
   - the CORS origin comes from `CORS_ORIGIN`
8. **Every endpoint handles every outcome.** Success, validation `400` with `fields`, `401`, `403`, `404`, `409` where it applies, and the generic `500`. Each uses the status code and message `docs/endpoints.md` documents for it.
9. **Tooling is clean.** `npm run lint`, `npm run format:check` and `npm test` pass, and `npm run dev` starts without errors (`GET /api/health` returns `{ data: { ok: true } }`).

### Output

Return the findings as a list, most important first. Each finding has: the file and line, which checklist item it breaks, what's wrong, the proposed fix, and its type: **bug** (behaviour is wrong), **cleanup** (behaviour-neutral), or **doc** (docs or comments only). When a finding needs Rich to make a style or spec decision, mark it **decision** and don't propose a fix until he does.

### Scope

A full review covers `index.js`, `app.js`, `eslint.config.js`, `prisma.config.js`, `api/`, `middleware/`, `validation/`, `lib/`, `services/`, `errors/` and `prisma/` (schema, seed and client; not the generated `migrations/`), the `*.test.js` files and `testing/`, plus CLAUDE.md, `docs/`, `README.md` and `.env.example`. A per-step review (the self-review in Workflow Checklist) covers only that step's diff, plus anything the diff duplicates or makes dead elsewhere.

## Documentation Sync

The frontend repo (`3d_wd`, a sibling folder of this repo) keeps its own docs. A sync audit checks them against this repo's docs so the two don't drift. **The backend docs are the source of truth.**

### When

Not on every branch. Run it:

- after a feature or step that changes the API contract, the schema or a flow, once it is merged in **both** repos
- before any production deploy
- whenever Rich asks

### How

1. **Confirm the truth first.** Check that this repo's docs match this repo's code (Code Review checklist item 6). Fix any drift here before comparing, or the audit copies it into the frontend.
2. **Read the frontend docs in place.** Make sure the frontend folder is on an up-to-date `main`, or read `origin/main` with `git show`. Then read its `CLAUDE.md`, `AGENTS.md`, `README.md` and `docs/`. This is read-only: Claude never edits the frontend repo from this one.
3. **Compare by tier:**
   - **Identical:** the API Contract section of `docs/endpoints.md` against the frontend's `docs/api.md`. Diff them word for word.
   - **Must agree:** anything both repos describe, such as roles, the session cookie and CSRF, validation rules and error messages, the Features and Planned Later lists, and the scaling rules. The frontend may summarize, but it must never contradict the backend or leave out a rule it depends on.
   - **Frontend-only:** UI, components, routing and the frontend's own progress line. Don't audit the content; check only that any backend fact it states is still true.
4. **Report** findings in the Code Review output format: file and line, tier, what differs, the proposed fix and its type. Where the frontend doc is right and the backend doc is wrong or missing something, mark it **decision** for Rich instead of proposing to overwrite the frontend.
5. **Hand off.** Rich pastes the findings into the frontend session, which fixes its own docs on its own branch. Backend-side fixes are made here, on a branch, as usual.

Rich's master document, which lives outside both repos, is audited the same way, with one difference: it is allowed to hold extra notes. Only contradictions and outdated facts are findings. Its "Client to Website" tab is the guide each client website copies as its `docs/client-website.md`: it must agree with the API Contract (`PublicPost`, the public endpoint's errors), the Revalidation section of `docs/endpoints.md` and `docs/client-website-test.md`.

The master doc's Market Position tab is the maintained comparison with the headless CMS market, and its Business Pitch tab holds the landing page directions. 3D Web Dev is the business; the Client Portal is the tool. When a feature resolves an item on Market Position's "Where we're behind" list, move it into the table and delete it from the list in the same piece of work.

## Unit Tests

`node:test` + Supertest, against a real test Postgres. `npm test` runs the suite once (`pretest` creates and migrates the test database first); `npm run test:watch` while working. Tests are a gate, not decoration: a failing test blocks a commit the same as a failing lint.

### When a test is justified

Write a test when the code carries a rule that someone could break without noticing:

- **A spec or contract rule:** anything `docs/endpoints.md` states — every status code and `error.message` in "Error messages the frontend displays", the `{ data }` / `{ error: { message, fields? } }` envelopes with `fields` keyed by full path (`body.1.image.src`), the CSRF header returning `403` "Request blocked.", blank optional fields stored and returned as `null`, validation limits.
- **Branching logic:** a function, middleware or route handler that behaves differently by input or state (new vs existing website, active vs inactive account / website / post, at vs over the image limit).
- **Shared code:** anything in `lib/`, `middleware/`, `validation/`, `services/` or `errors/` gets coverage, directly or through a request test — one bug there breaks every caller.
- **A security or one-time rule:** the account always comes from the session, never from client input; another owner's post, website or account is `404`, not `403`; `apiKeyHash` / `webhookSecretEncrypted` never appear in a response; `credentials` appear only when a new website is created; the session cookie carries the documented flags and the JWT never appears in a body; the public API accepts only a valid Bearer key for an active website, returns only active posts and never `postName`.
- **A bug that was fixed:** write the failing test first, then fix the code, so it can't come back.
- **One layer is enough:** if a request test already proves a behaviour through the real middleware, validation and handler, don't repeat it in a unit test of the piece. Test a zod schema or a `lib/` function directly only for what a request test can't reach easily (every `normalizeUrl` case, every validation boundary, a revalidation failure path).

Don't write a test for: a constant, the Prisma client setup (`prisma/index.js`), `prisma.config.js`, the seed and seed data, a one-line pass-through, or Express or Prisma behaviour itself. A route made only of tested pieces needs a test only for the wiring it adds (e.g. an edit reconciles images in one transaction, and nothing changes if any part fails).

### The pattern every test follows

- **Location and naming:** the test sits next to the file it tests, `name.test.js` (`validation/post.test.js`, `lib/normalizeUrl.test.js`); route tests sit next to their router (`api/siteOwner/index.test.js`). Shared support lives in `testing/` — not `test/`, because Node 20's runner treats every file in a `test/` folder as a test. A test file that touches the environment or the database requires `testing/setup` first, the way entry points require `dotenv/config` first. One `describe` per unit; each `it` reads as a behaviour sentence: `it("returns 404 for another site owner's post")`.
- **Arrange → Act → Assert,** separated by a blank line. One behaviour per test.
- **Test behaviour, not implementation:** send a real request with Supertest and assert on the HTTP response (status, body, `Set-Cookie`) and on database state — never on which of our functions were called.
- **Mock only the edges:**
  - The database is **not** mocked: tests run against `TEST_DATABASE_URL` (a database whose name must end in `_test`; `testing/setup.js` refuses anything else), so query, constraint and transaction bugs are caught. The dev database is never touched.
  - Google ID-token verification: `mockGoogle` in `testing/helpers.js` replaces `OAuth2Client.prototype.verifyIdToken`, so login can succeed or fail without a real token.
  - Outbound revalidation: `mockFetch` replaces the global `fetch`; assert the call `services/revalidate.js` sent (URL, `Authorization`, body) and that the site owner's request is unaffected when it fails. Any file whose requests change a post mocks `fetch` for every test, so no call ever leaves the machine.
  - `console.error` where a test triggers a log, so the output stays clean and the log can be checked for secrets.
  - Time only where logic depends on it (an expired session is a token signed with a past `exp`, not a faked clock). Nothing else in our own code is mocked.
- **Responses come from the contract:** the backend is the source of truth, so request tests assert the response matches `docs/endpoints.md` word for word. If a test and the doc disagree, fix the code — or, if the doc is wrong, that is a contract change: update `docs/endpoints.md` and the frontend's `docs/api.md` together and write a cross-repo handoff.
- **Independent:** each test builds its own rows with the helpers in `testing/helpers.js`, and the database is truncated before every test. Mocks are restored after every test (`t.mock`, or `mock.restoreAll()` in `afterEach` for a file-wide mock). Tests pass in any order and alone, and running the suite twice gives the same result.
- **No snapshots.** They pass by default and nobody reads the diff.
- **Same rules as the rest of the code:** Code Style and Code Review apply to test files too — header comment, CommonJS, no dead tests, true test names.

## Workflow Checklist

- Check relevant spec — including `docs/scaling.md` for any schema, contract or flow change
- Create a plan — always in plan mode (switch with EnterPlanMode, present with ExitPlanMode), never as a plain chat message
- On approved, build
- Checks after building:
  - Self-review the diff against Code Review → Checklist
  - `npm test` passes, with new tests wherever Unit Tests says one is justified
  - Role-gating and ownership check on every route
  - Transaction wrapped (if multi-row write)
  - CSRF header required on every POST/PATCH/DELETE
  - Response matches the API contract (shape, status codes, error messages)
  - No secrets selected, returned or logged
  - Test in Postman (logic only — send the `X-CSRF-Protection: 1` header)
  - Test via a real frontend request (validates CORS/cookie behavior)
  - After manual testing (Postman, frontend), delete every row the tests added (accounts, websites, `account_website` links, posts and their elements and images), so the local database is back to the baseline in Current progress. List the rows first and delete them by id in one transaction. (`npm test` uses its own test database and never touches these rows.)
- Final step, always, once every check above is done: run the self-review (Code Review → Checklist) over the whole diff, and report it to Rich as findings in the Code Review → Output format, with a question for each one that needs his decision on correcting the code. Nothing is committed before he answers. A review that finds nothing is still reported.
- Only commit once code is reviewed, approved and all validation and tests are green

Step rhythm:

- Each Build Order step is its own task: branch from an up-to-date `main`, write a fresh plan in plan mode (replacing any earlier plan), get Rich's approval, build, verify, commit and push. Rich merges the PR on GitHub.
- The docs are the spec. When a plan only touches code already in the repo, reading the docs and the files involved is enough — no broad exploration needed. Library APIs are checked against the installed packages in `node_modules`.
- When a step needs the frontend and backend to work in tandem, finish by writing a handoff message for Claude in the other repo, which Rich pastes there. Write it for a reader with no context: what was completed (and on which branch), anything the other side must follow (contract details, headers, local wiring), what's next for them, and a "done when" checklist. Check it against the other repo's docs where they overlap (for example, sign-out routes to `/`, the landing page).
- When Rich says to commit, first update "Current progress" under Build Order to describe the state after the PR merges: add a row at the top of its table (date, branch and PR, what was done, in a few short sentences), and update Now, Next, the baseline and Pending notes to match. Commit it on the same branch. Never leave it as a loose edit on `main` after a merge, which would need its own PR.
- After a step is merged, Rich runs `/clear`. The next step starts from `CLAUDE.md` and the docs alone, so anything worth keeping must be written into them before the clear.

## Plan Authoring

When in plan mode, write the plan to be legible cold — understandable by someone who never saw the conversation that produced it. State what's being built, which files will be touched, and why this approach was chosen. Avoid shorthand like "same pattern as before" or "as discussed" without spelling out what that actually means.

## Delegating to Subagents

Use subagents for research/exploration/investigation for a plan and for completing smaller tasks.
