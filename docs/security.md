# Security

The security record for the backend: the controls in place and where they live, the audit log, every secret and how to rotate it, who has access to what, what to do in an incident, the risks accepted on purpose, and the checklist before a production deploy. Imported from `CLAUDE.md` via `@docs/security.md`.

The goal is to be ready for a SOC 2 audit if the business grows into needing one, without paying for one now. SOC 2 asks for evidence that a written process is followed: who has access, how changes are reviewed, backups, monitoring and incident handling. This file is that written process. Keep it true: a control listed here that isn't really in place is worse than one that is missing.

## Controls in place

| Area            | Control                                                                                                                                                                                                                      | Where                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Sign-in         | Google ID token verified (signature, expiry, audience, verified email). One 401 for every failure, so emails can't be probed. No passwords stored.                                                                           | `api/auth/index.js`                                          |
| Sessions        | JWT in an httpOnly, SameSite=Lax, Secure (production) cookie. HS256 pinned. Fixed 24 hours. Role and active flag reloaded from the database on every request. Logout ends every session of the account (Session revocation). | `lib/jwt.js`, `middleware/requireAuth.js`                    |
| CSRF            | `X-CSRF-Protection: 1` required on every POST / PATCH / DELETE, plus an exact CORS origin, never a wildcard.                                                                                                                 | `middleware/requireCsrfHeader.js`, `app.js`                  |
| Access          | Role gate per router. Ownership always from the session; "not yours" is the same 404 as "not found".                                                                                                                         | `middleware/requireRole.js`, `api/siteOwner/index.js`        |
| Input           | zod re-validates every field on the server. Request bodies limited to 256 KB. Paragraph links must be `https://`. Image `src` must be in the website's own upload folder.                                                    | `validation/`, `app.js`                                      |
| Output          | Post text is never rendered as HTML (`docs/endpoints.md` → Paragraph formatting, rule 6). Unexpected errors return a generic message.                                                                                        | `errors/index.js`                                            |
| Secrets at rest | API keys stored as SHA-256 hashes. Webhook secrets encrypted with AES-256-GCM. Neither is selected outside the two places that need them.                                                                                    | `lib/crypto.js`                                              |
| Rate limits     | Login, the public posts endpoint and upload signing (Rate limits).                                                                                                                                                           | `lib/rateLimit.js`                                           |
| Audit log       | Every sign-in, sign-out and change, written in the change's own transaction (Audit log).                                                                                                                                     | `lib/audit.js`                                               |
| Config          | The server refuses to start with a missing variable, a `JWT_SECRET` under 32 characters, an encryption key that isn't 32 bytes, or (production) a non-https CORS origin or no cookie domain.                                 | `lib/config.js`                                              |
| Headers         | helmet's defaults on every API response (HSTS, nosniff, frame-ancestors, a restrictive CSP).                                                                                                                                 | `app.js`                                                     |
| Change control  | Every change goes through a branch, a plan, a review and a PR. CI runs lint, format, `npm audit` and the tests on every PR and push to `main`.                                                                               | `CLAUDE.md` → Workflow Checklist, `.github/workflows/ci.yml` |

## Rate limits

The numbers and routes are in `docs/endpoints.md` → Middleware Stack. They are a few times what real use of each route looks like, not a published standard, and each is one line in `lib/rateLimit.js`. After launch, compare them with the audit log and tune them.

- Counts are in memory, per instance. A shared store is needed before running more than one instance (`docs/scaling.md` §7).
- The client's address comes through one trusted proxy (`app.set('trust proxy', 1)`). If Railway puts more than one proxy in front of the API, every client would look like the proxy and share one limit, so confirm the hop count when the deploy is set up.

## Session revocation

Each account has a `sessionVersion`, and each session cookie carries the version it was issued with (`sv`). Logout increments the account's version, so every cookie issued before then stops working, on every device. The same lever ends a stolen session:

- **The site owner or admin signs out.** Every session of that account ends.
- **Without the user** (a compromised account): increment `session_version` on the account row, or set `active` to false. Both take effect on the next request. Until an admin endpoint exists, this is done in Prisma Studio and recorded in the incident notes.
- **Every session of every account:** rotate `JWT_SECRET` (Secrets).

## Audit log

What is recorded is in `docs/endpoints.md` → Audit Log; the table is `audit_event` (`docs/setup.md`).

- **Retention:** kept indefinitely for now. Rows are small, and SOC 2 commonly expects at least a year. Revisit if the table grows large.
- **Integrity:** no route reads, edits or deletes audit rows. Production data is changed only through the API, a reviewed migration or a reviewed script (`docs/scaling.md` §8), never by deleting audit rows.
- **Privacy:** rows hold account ids, the actor's email, and IP addresses. A failed login with no account still records the Google-verified email tried. The privacy policy must say so once it is written.
- **Reading it:** Prisma Studio or SQL for now, filtered by `actor_id`, `target_id` or `created_at`. An admin screen is on Planned Later.

## Secrets

| Secret                  | Lives in                                        | Rotation                                                                                                                                                                             | Backup                                                                                       |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `JWT_SECRET`            | `.env`, Railway                                 | Replace and redeploy. Every session ends and everyone signs in again.                                                                                                                | Not needed: a lost value is just replaced.                                                   |
| `SECRET_ENCRYPTION_KEY` | `.env`, Railway                                 | No re-encryption tool yet: rotating it makes every stored webhook secret unreadable. Planned with key / secret rotation (Out of Scope in `CLAUDE.md`).                               | **Required**, stored apart from the database backups. If lost, every webhook secret is lost. |
| `CLOUDINARY_API_SECRET` | `.env`, Railway                                 | Generate a new key pair in Cloudinary, update `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`, redeploy, then delete the old pair. Signatures already issued expire within an hour. | Required, like `SECRET_ENCRYPTION_KEY`.                                                      |
| `DATABASE_URL` password | Railway                                         | Rotate in Railway, which updates the variable.                                                                                                                                       | Railway.                                                                                     |
| Website API keys        | Hashed in `website.api_key_hash`                | No endpoint yet (Out of Scope). A leaked key: set the website inactive, which refuses the key at once.                                                                               | Not stored in plaintext anywhere; each client website holds its own.                         |
| Website webhook secrets | Encrypted in `website.webhook_secret_encrypted` | No endpoint yet (Out of Scope).                                                                                                                                                      | Covered by the database backup plus `SECRET_ENCRYPTION_KEY`.                                 |

`GOOGLE_CLIENT_ID`, `CLOUDINARY_CLOUD_NAME` and `CLOUDINARY_API_KEY` are public identifiers, not secrets. No secret is ever logged, returned outside its one creation response, or pasted into a chat, an issue or a commit.

## Access

Who can reach each system that holds production data or code. Fill in, and review whenever someone joins or leaves:

| System                                      | Who has access | 2FA on? |
| ------------------------------------------- | -------------- | ------- |
| Google account (the admin sign-in)          | Rich           |         |
| GitHub (both repos)                         | Rich           |         |
| Railway (API, database, cron)               | Rich           |         |
| Vercel (frontend)                           | Rich           |         |
| Cloudinary (images, API secret)             | Rich           |         |
| Domain registrar and DNS for `3dwebdev.com` | Rich           |         |

The administrator's Google account is the app's highest privilege: whoever controls it controls every account. It must have 2FA, preferably a passkey or security key.

## Incident response

When something looks wrong (a leaked secret, an unknown sign-in, unexpected changes):

1. **Contain.** End the sessions involved (Session revocation). Set an affected website or account inactive. Rotate any secret that may have leaked (Secrets).
2. **Investigate.** Read the audit log for the accounts, websites and time window involved: sign-ins, failed sign-ins and IPs, changes. Check the Railway, Vercel and Cloudinary logs.
3. **Fix.** The cause is fixed on a branch like any other change, with a test that proves it can't come back.
4. **Notify.** Tell the affected site owners what happened, what was exposed and what they should do. If personal data was exposed, check the notification duties that apply.
5. **Record.** Write a short note: date, what happened, what was done, what changes. Keep these notes together; they are SOC 2 evidence.

## Dependencies

- `npm audit --omit=dev --audit-level=high` runs in CI and on every Code Review. A high or critical advisory blocks a merge until it is fixed or written below as accepted, with the reason.
- Dependabot and GitHub secret scanning are on for both repos (pre-deploy checklist).
- Packages are updated on a branch, with the full test suite, never on `main`.

## Accepted risks

- **Revalidation URL:** the backend sends a request to whatever URL a website has stored, which could in principle be aimed at an internal address (server-side request forgery, SSRF). Only the administrator enters it, and it must be `https://`. Accepted while the administrator is the only one who can set it.
- **Upload signatures:** one signature allows any number of uploads into the website's folder for an hour, a window Cloudinary fixes. The sign limit (10 per 15 minutes) limits signatures, not uploads. Abusing it needs a signed-in site owner, and the daily cleanup deletes every upload no post uses.
- **In-memory rate limits:** they reset when the server restarts, and each instance counts on its own (Rate limits).

## Frontend (next branch)

Browser-side protection is the frontend's job, planned as its own branch after this one:

- **Content Security Policy split by page type.** Pages that handle the session (`/sign-in`, `/dashboard`, `/admin`) render per request with a strict CSP: `script-src 'nonce-…' 'strict-dynamic'`, the nonce generated in `proxy.js` for each request, and no `'unsafe-inline'` for scripts. Static pages (landing, and the privacy and terms pages once they exist) stay on the CDN with a fixed policy. Next.js can only put a nonce in a page rendered per request, so a static page can't have one.
- **Rule:** a page that renders user content is never static.
- **`style-src` keeps `'unsafe-inline'`.** A nonce covers `<style>` tags, not `style="…"` attributes, which React, `next/image` and the Google sign-in button all use. Injected styles are a much smaller risk than injected scripts.
- The Google sign-in script and frame are allowed explicitly (`accounts.google.com`).
- Also: `frame-ancestors 'none'`, `Referrer-Policy`, `Permissions-Policy`, and HSTS. After the deploy, check with `curl -I` that Vercel serves them on both static and dynamic pages.

## Pre-deploy checklist (Rich)

Done by hand before the first production deploy. Tick each one here when done:

- [ ] 2FA on the Google admin account, GitHub, Railway, Vercel, Cloudinary and the domain registrar
- [ ] A new Cloudinary key pair for production, kept only in Railway; the pair shared in a Claude session deleted
- [ ] Production `JWT_SECRET` and `SECRET_ENCRYPTION_KEY` freshly generated, never reused from local
- [ ] `SECRET_ENCRYPTION_KEY` and `CLOUDINARY_API_SECRET` backed up apart from the database backups
- [ ] Branch protection on `main` in both repos: changes only through a PR, CI must pass
- [ ] Dependabot alerts and secret scanning turned on in both repos
- [ ] Railway Postgres backups confirmed, and one test restore done
- [ ] Railway's proxy hop count checked against `app.set('trust proxy', 1)`: `req.ip` in an audit row should be a real client address, not Railway's
- [ ] The Access table above filled in
