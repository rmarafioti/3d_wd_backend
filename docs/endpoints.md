# Endpoints

Full behavioral spec for each backend endpoint. `CLAUDE.md` holds the short, always-loaded rules (ownership checks, anti-patterns, patterns); this file holds the API contract and the per-endpoint detail those rules apply to. Imported from `CLAUDE.md` via `@docs/endpoints.md`.

The API Contract section below is the **source of truth** for both repos. The frontend repo keeps an identical copy in its `docs/api.md`. Any change to the contract is made in both repos in the same piece of work.

## API Contract

The single agreement between the frontend and backend repos. The backend copy (`backend/docs/endpoints.md`) is the source of truth; the frontend keeps an identical copy in `docs/api.md`. Any change to the contract is made in **both** repos in the same piece of work.

### Conventions

- Every route lives under `/api`.
- All request and response fields are camelCase. snake_case exists only inside the database (Prisma `@map`).
- Dates and times are ISO 8601 strings. `postDate` is a date only: `YYYY-MM-DD`.
- Success response: `{ "data": ... }`
- Error response: `{ "error": { "message": "...", "fields": { "fieldName": "message" } } }` — `fields` is only present on validation errors (400) so the form can show a message next to each field.
- Every `POST`, `PATCH` and `DELETE` must carry the header `X-CSRF-Protection: 1`, or the backend returns `403`. `GET` requests do not need it.
- Every request from the app frontend is sent with `credentials: 'include'` (the session cookie). This is handled once, in the frontend's `apiFetch()`.
- `api_key_hash` and `webhook_secret_encrypted` never appear in any response.

### Status codes

| Code | Meaning                                                                                      |
| ---- | -------------------------------------------------------------------------------------------- |
| 200  | OK                                                                                           |
| 201  | Created                                                                                      |
| 204  | OK, no body (logout)                                                                         |
| 400  | Invalid input (validation failed, or an image/link id that doesn't belong to the post)       |
| 401  | Not signed in / session expired or invalid / not authorized to log in / bad API key          |
| 403  | Signed in but wrong role, or missing CSRF header                                             |
| 404  | Not found **or not yours** — the same answer either way, so ids can't be probed              |
| 409  | Conflict — duplicate email, duplicate website URL, or account already linked to that website |
| 500  | Server error — message is always the generic "Something went wrong, please try again."       |

### Shapes

```
Account        { id, name, email, role, active, createdAt }
WebsiteSummary { id, websiteName, url, active }
Credentials    { apiKey, webhookSecret }            // plaintext, one-time only
Image          { id, src, width, height, altText }
Link           { id, name, url }
PostSummary    { id, postName, postDate, active, createdAt }
Post           { id, websiteId, websiteName, postName, header, subHeader, body,
                 postDate, active, createdAt, updatedAt, images: Image[], links: Link[] }
```

Optional post fields (`header`, `subHeader`, `postDate`) are `null` when empty. Images and links are always returned ordered by `id` ascending (UUIDv7 is time-ordered, so this is the order they were added).

### Endpoints

| Method & path                           | Who                                               | Request body                                                                                                                                | Success                                             |
| --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `POST /api/auth/login`                  | anyone                                            | `{ credential }` (Google ID token)                                                                                                          | `200 { role }` + sets session cookie                |
| `POST /api/auth/logout`                 | anyone                                            | —                                                                                                                                           | `204`, clears session cookie                        |
| `GET /api/auth/me`                      | signed in                                         | —                                                                                                                                           | `200 { id, name, email, role }`                     |
| `GET /api/admin/accounts`               | admin                                             | —                                                                                                                                           | `200 [ Account + { websites: WebsiteSummary[] } ]`  |
| `GET /api/admin/websites`               | admin                                             | —                                                                                                                                           | `200 WebsiteSummary[]` (active only)                |
| `POST /api/admin/accounts`              | admin                                             | `{ name, email, websiteId }` **or** `{ name, email, websiteName, websiteUrl }`                                                              | `201 { account, website, credentials? }`            |
| `POST /api/admin/accounts/:id/websites` | admin                                             | `{ websiteId }` **or** `{ websiteName, websiteUrl }`                                                                                        | `201 { website, credentials? }`                     |
| `GET /api/siteOwner/websites`           | site owner                                        | —                                                                                                                                           | `200 [ WebsiteSummary + { posts: PostSummary[] } ]` |
| `POST /api/siteOwner/posts`             | site owner                                        | `{ websiteId, postName, body, header?, subHeader?, postDate?, active?, images: [{ src, width, height, altText }], links: [{ name, url }] }` | `201 Post`                                          |
| `GET /api/siteOwner/posts/:id`          | site owner                                        | —                                                                                                                                           | `200 Post`                                          |
| `PATCH /api/siteOwner/posts/:id`        | site owner                                        | `{ postName, body, header, subHeader, postDate, images: [{ id?, src, width, height, altText }], links: [{ id?, name, url }] }`              | `200 Post`                                          |
| `PATCH /api/siteOwner/posts/:id/status` | site owner                                        | `{ active }`                                                                                                                                | `200 Post`                                          |
| `GET /api/public/posts`                 | client website (`Authorization: Bearer <apiKey>`) | —                                                                                                                                           | `200 PublicPost[]`                                  |
| `GET /api/health`                       | anyone                                            | —                                                                                                                                           | `200 { ok: true }`                                  |

Notes:

- `credentials` is only present when a **new** website was created. Its presence is what tells the frontend to open the one-time reveal dialog. When an existing website was linked, it is absent.
- On `POST /api/admin/accounts` and `POST /api/admin/accounts/:id/websites` the body must contain **either** `websiteId` **or** both `websiteName` and `websiteUrl` — never both, never neither (400).
- `PATCH /api/siteOwner/posts/:id` is a full submission of the edit form: all fields are sent every time. Send `null` to clear an optional field. `images` / `links` are the complete current lists — existing items carry their `id`, new items have none, and anything stored but missing from the list is deleted. `websiteId` and `active` cannot be changed here.
- `PublicPost` is `{ id, header, subHeader, body, postDate, createdAt, updatedAt, images: [{ src, width, height, altText }], links: [{ name, url }] }` — `postName` is internal and is **never** returned publicly. Only active posts, newest `createdAt` first.

### Error messages the frontend displays

| Situation                                                               | Code | `error.message`                                                       |
| ----------------------------------------------------------------------- | ---- | --------------------------------------------------------------------- |
| Login: no account, inactive account, unverified or invalid Google token | 401  | You are not authorized to log in.                                     |
| Any session route with no / expired / invalid cookie                    | 401  | Your session expired, please sign in again.                           |
| Wrong role                                                              | 403  | You do not have access to this page.                                  |
| Missing CSRF header                                                     | 403  | Request blocked.                                                      |
| Validation failed                                                       | 400  | Please fix the highlighted fields. (+ `fields`)                       |
| Create account: email already exists                                    | 409  | An account with this email already exists.                            |
| New website: URL already exists                                         | 409  | A website with this URL already exists — select it from the dropdown. |
| Link: account already linked to that website                            | 409  | This account is already linked to [Website Name].                     |
| Website / account / post not found or not yours                         | 404  | [Website / Account / Post] not found.                                 |
| Edit: an image or link id that isn't on this post                       | 400  | Invalid image or link.                                                |
| Public: missing / unknown key, or inactive website                      | 401  | Invalid API key.                                                      |

### Validation rules (identical on frontend and backend)

- Every text field is trimmed first; a field that is blank after trimming counts as empty.
- `name` (account): required, max 100.
- `email`: required, valid email format, stored lowercase.
- `websiteName`: required, max 100.
- `websiteUrl`, link `url`, image `src`: valid URL starting with `https://`. Website URLs are normalized by the backend (lowercase host, no trailing slash) before the uniqueness check and before saving.
- `postName`: required, max 100. `body`: required, max 5000. `header`: optional, max 150. `subHeader`: optional, max 200.
- `postDate`: optional, valid date `YYYY-MM-DD`.
- `images`: max 5 per post. Each image: `src`, `width`, `height`, `altText` all required; `width`/`height` whole numbers 1–10000; `altText` max 200.
- `links`: max 10 per post. Each link: `name` (max 100) and `url` both required.
- `active` (create / status): boolean.

---

## Middleware Stack

Applied in `index.js` / `api/index.js`, in this order:

1. `helmet()` — standard security headers.
2. `cors({ origin: process.env.CORS_ORIGIN, credentials: true, allowedHeaders: ['Content-Type', 'X-CSRF-Protection', 'Authorization'] })` — exact origin, never a wildcard.
3. `express.json()` and `cookie-parser`.
4. `requireCsrfHeader` — every `POST` / `PATCH` / `DELETE` without `X-CSRF-Protection: 1` returns `403`. `GET` passes through.
5. Routers mounted at `/api/auth`, `/api/admin`, `/api/siteOwner`, `/api/public`, plus `GET /api/health`.
6. The single error handler from `errors/` — every error leaves the server as the `{ error: { message, fields? } }` envelope. Unexpected errors are logged and returned as a generic 500.

Per-router guards:

- `/api/admin/*` → `requireAuth` then `requireRole('admin')`.
- `/api/siteOwner/*` → `requireAuth` then `requireRole('site_owner')`.
- `/api/public/*` → `requireApiKey` (no cookie, no CSRF header — this is a server-to-server `GET`).

`requireAuth`: reads the `session` cookie, verifies the JWT (`lib/jwt.js`), then loads the account by `sub`. If the cookie is missing, the JWT is invalid/expired, or the account no longer exists or is inactive → clear the cookie and return `401` "Your session expired, please sign in again." Otherwise sets `req.user = { id, name, email, role }`. Clearing the cookie on a bad token matters: the frontend `proxy.js` redirects on cookie _presence_, so a dead cookie must not be left behind.

`requireRole(role)`: `req.user.role !== role` → `403` "You do not have access to this page."

`requireApiKey`: reads `Authorization: Bearer <apiKey>`, hashes it with SHA-256 (`lib/crypto.js`), looks up `website` by `api_key_hash`. Missing header, no match, or `website.active === false` → `401` "Invalid API key." Otherwise sets `req.website`.

---

## Session Cookie

- Name: `session`. Value: a JWT signed with `JWT_SECRET`, payload `{ sub: account.id, role }`, expires in **24 hours** (fixed — no refresh tokens, no sliding expiry).
- Production: `httpOnly: true, secure: true, sameSite: 'lax', domain: COOKIE_DOMAIN (.3dwebdev.com), path: '/', maxAge: 24h`.
- Local: `httpOnly: true, secure: false, sameSite: 'lax'`, no domain (the frontend dev proxy makes the backend same-origin).
- The token is **only** ever in the `Set-Cookie` header — never in a JSON body.

---

## Auth

### Login — `POST /api/auth/login`

1. Body `{ credential }` — the Google ID token from the frontend's Google sign-in button.
2. Verify it with `google-auth-library` (`OAuth2Client.verifyIdToken`, `audience: GOOGLE_CLIENT_ID`) — this checks signature, expiry and that it was issued for our app.
3. Require `payload.email_verified === true`.
4. Look up the account by `payload.email` lowercased. Email only — the Google display name is never compared.
5. No account, or `account.active === false`, or any failure in steps 2–3 → `401` "You are not authorized to log in." (one message for every case, so nobody can probe which emails have accounts).
6. Success → set the session cookie and return `200 { data: { role } }`. The frontend uses `role` once, to route to `/admin` or `/dashboard`.

### Logout — `POST /api/auth/logout`

Clears the `session` cookie (same options it was set with) and returns `204`. Works whether or not the cookie is valid.

### Me — `GET /api/auth/me`

Behind `requireAuth`. Returns `200 { data: req.user }` → `{ id, name, email, role }`. The frontend's `/dashboard` and `/admin` layouts call this on load to know who is signed in after a page refresh.

---

## Admin

All admin routes: `requireAuth` + `requireRole('admin')`. `api_key_hash` and `webhook_secret_encrypted` are always excluded from every `select`.

### Get All Accounts — `GET /api/admin/accounts`

Every account where `role = site_owner` (active and inactive), sorted by `name`, each with its linked websites (via `account_website`): `[{ id, name, email, role, active, createdAt, websites: [{ id, websiteName, url, active }] }]`. No posts — the administrator does not view post content. Powers the account list on `/admin`.

### Get All Websites — `GET /api/admin/websites`

Every **active** website, sorted by `websiteName`: `[{ id, websiteName, url, active }]`. Powers the website picker in Create an Account and Link a Website.

### Create an Account — `POST /api/admin/accounts`

Body: `{ name, email, websiteId }` (link an existing website) **or** `{ name, email, websiteName, websiteUrl }` (create a new website).

1. Validate with `validation/account.js` + `validation/website.js` (zod). Exactly one of `websiteId` or (`websiteName` + `websiteUrl`) → otherwise `400`.
2. Lowercase the email. If an account with that email exists → `409` "An account with this email already exists."
3. **Existing website path** (`websiteId`): the website must exist and be active → otherwise `404` "Website not found." In one transaction: insert `account` (role `site_owner`), insert the `account_website` row. No key or secret is generated.
4. **New website path** (`websiteName` + `websiteUrl`): normalize the URL (`lib/normalizeUrl.js`). If a website with that URL exists → `409` "A website with this URL already exists — select it from the dropdown." Generate the API key and webhook secret with `lib/crypto.js`, hash the key, encrypt the secret. In one transaction: insert `account`, insert `website` (with `api_key_hash`, `webhook_secret_encrypted`), insert the `account_website` row — three inserts, if any fails nothing is saved.
5. Return `201 { data: { account, website, credentials? } }`. `credentials: { apiKey, webhookSecret }` (plaintext) is included **only** on the new-website path, and only in this one response.

### Link a Website — `POST /api/admin/accounts/:id/websites`

Gives an existing site owner another website. Body: `{ websiteId }` **or** `{ websiteName, websiteUrl }`.

1. `:id` must be an existing `site_owner` account → otherwise `404` "Account not found."
2. Validate the body exactly as in Create an Account (minus `name` / `email`).
3. **Existing website path**: website must exist and be active (`404` "Website not found."). If this account is already linked to it → `409` "This account is already linked to [Website Name]." Insert the `account_website` row only.
4. **New website path**: identical to Create an Account step 4, minus the account insert — website + `account_website` in one transaction, generate key and secret.
5. Return `201 { data: { website, credentials? } }` — `credentials` only on the new-website path.

---

## Site Owner

All site-owner routes: `requireAuth` + `requireRole('site_owner')`.

**Ownership check (every route below):** the account comes from `req.user` (the session), never from anything the client sends. A website belongs to the site owner when an `account_website` row links `req.user.id` to it **and** `website.active = true`. A post belongs to the site owner when its website does. Anything that fails the check returns `404` — identical to "doesn't exist".

### Get All Websites Tied To the Account — `GET /api/siteOwner/websites`

The site owner's active websites (via `account_website`), sorted by `websiteName`, each with **post summaries** (active and inactive), newest `createdAt` first: `[{ id, websiteName, url, active, posts: [{ id, postName, postDate, active, createdAt }] }]`. No body, images or links — those load with the single post. Powers the `/dashboard` list and the website dropdown in Create a Post.

### Create a Post — `POST /api/siteOwner/posts`

1. Validate with `validation/post.js` — the backend re-validates everything regardless of what the frontend checked.
2. Ownership check on `websiteId` → `404` "Website not found." if it fails.
3. One transaction: insert the post (`active` defaults to `true` if not sent), then insert each image, then each link. If any insert fails the whole create rolls back — no orphaned post.
4. Return `201 { data: Post }`.
5. After the transaction has committed, call `revalidate(website)` (see Revalidation). Do not await it before responding.

### Get a Post by ID — `GET /api/siteOwner/posts/:id`

Ownership check → `404` "Post not found." Returns `200 { data: Post }` including `websiteName`, images and links (each ordered by `id`). Powers `/dashboard/post/[id]` and pre-fills the Edit form.

### Edit a Post — `PATCH /api/siteOwner/posts/:id`

Body: the full edit form — `{ postName, body, header, subHeader, postDate, images, links }`. `websiteId` and `active` are not accepted here (a post never moves websites; status changes only through the status route).

1. Validate with `validation/post.js`.
2. Ownership check → `404` "Post not found."
3. Every image/link `id` in the body must belong to this post → otherwise `400` "Invalid image or link." (stops editing another post's items by guessing ids).
4. One transaction:
   - Update the post's own fields.
   - Images: items with an `id` → update; items without → insert; stored images whose `id` is missing from the list → delete.
   - Links: same three-way reconcile.
   - `updated_at` refreshes automatically (`@updatedAt`).
   - If any part fails, nothing is changed.
5. Return `200 { data: Post }`, then call `revalidate(website)` after commit.

### Archive / Make Active — `PATCH /api/siteOwner/posts/:id/status`

Body `{ active: boolean }`. Ownership check → `404`. Set `post.active`. This is the soft delete — a post is never removed from the database, so it can be reactivated and its history kept. Return `200 { data: Post }`, then call `revalidate(website)` after commit.

---

## Public

### Website Fetches Posts — `GET /api/public/posts`

Called **server-side** by a client's website (at build/regeneration time) with `Authorization: Bearer <apiKey>`. The key must never be exposed in the client website's browser code.

`requireApiKey` resolves `req.website`. Return that website's **active** posts, newest `createdAt` first, with images and links (ordered by `id`): `[{ id, header, subHeader, body, postDate, createdAt, updatedAt, images: [{ src, width, height, altText }], links: [{ name, url }] }]`. `postName` is never included. No cookie, no CSRF header, no CORS needed (server-to-server).

How the client website uses this is specced later in the master doc's "Data Fetch From Website" section.

### Health — `GET /api/health`

Returns `200 { data: { ok: true } }`. No auth. Used by Railway to check the server is up.

---

## Revalidation

`services/revalidate.js` exports `revalidate(website)`. It tells a client's website to regenerate its page after a post changes, so the change appears live within moments.

- Called after a **successful, committed** create, edit, archive or make-active. Never inside the transaction.
- Fire-and-forget: the route responds to the site owner without waiting for it. Wrap the call so a failure can never throw into the request (`revalidate(website).catch(logError)`).
- Skip entirely if `website.active === false`.
- Decrypt `webhook_secret_encrypted` with `lib/crypto.js`, then:
  `POST {website.url}/api/revalidate` with headers `Authorization: Bearer <webhookSecret>` and `Content-Type: application/json`, body `{ "websiteId": "...", "postId": "..." }`, timeout 5 seconds (`AbortSignal.timeout(5000)`).
- Non-2xx response, timeout or network error → log the website id and status. **Never** log the secret, the Authorization header or the request headers.
- The client-website side of this call (the `/api/revalidate` route that receives it) is specced in the master doc's "Data Fetch From Website" section.
