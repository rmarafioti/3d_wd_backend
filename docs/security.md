# Security

The security record for the backend: the controls in place and where they live, the audit log, every secret and how to rotate it, who has access to what, what to do in an incident, the risks accepted on purpose, and the checklist before a production deploy. Imported from `CLAUDE.md` via `@docs/security.md`.

The goal is to be ready for a SOC 2 audit if the business grows into needing one, without paying for one now. SOC 2 asks for evidence that a written process is followed: who has access, how changes are reviewed, backups, monitoring and incident handling. This file is that written process. Keep it true: a control listed here that isn't really in place is worse than one that is missing.

## Controls in place

| Area            | Control                                                                                                                                                                                                                                                                                                                                   | Where                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Sign-in         | Google ID token verified (signature, expiry, audience, verified email). One 401 for every failure, so emails can't be probed. No passwords stored.                                                                                                                                                                                        | `api/auth/index.js`                                          |
| Sessions        | JWT in an httpOnly, SameSite=Lax, Secure (production) cookie. HS256 pinned. Fixed 24 hours. Role and active flag reloaded from the database on every request. Logout ends every session of the account (Session revocation).                                                                                                              | `lib/jwt.js`, `middleware/requireAuth.js`                    |
| CSRF            | `X-CSRF-Protection: 1` required on every POST / PATCH / DELETE, plus an exact CORS origin, never a wildcard.                                                                                                                                                                                                                              | `middleware/requireCsrfHeader.js`, `app.js`                  |
| Access          | Role gate per router. Ownership always from the session; "not yours" is the same 404 as "not found".                                                                                                                                                                                                                                      | `middleware/requireRole.js`, `api/siteOwner/index.js`        |
| Input           | zod re-validates every field on the server. Request bodies limited to 256 KB. Paragraph links must be `https://`. Image `src` must be in the website's own upload folder.                                                                                                                                                                 | `validation/`, `app.js`                                      |
| Output          | Post text is never rendered as HTML (`docs/endpoints.md` → Paragraph formatting, rule 6). Unexpected errors return a generic message.                                                                                                                                                                                                     | `errors/index.js`                                            |
| Secrets at rest | API keys stored as SHA-256 hashes. Webhook secrets encrypted with AES-256-GCM. Neither is selected outside the two places that need them.                                                                                                                                                                                                 | `lib/crypto.js`                                              |
| Rate limits     | Login, the public posts endpoint and upload signing (Rate limits).                                                                                                                                                                                                                                                                        | `lib/rateLimit.js`                                           |
| Audit log       | Every sign-in, sign-out and change, written in the change's own transaction (Audit log).                                                                                                                                                                                                                                                  | `lib/audit.js`                                               |
| Config          | The server refuses to start with a missing variable, a `JWT_SECRET` under 32 characters, an encryption key that isn't 32 bytes, or (production) a non-https CORS origin or no cookie domain.                                                                                                                                              | `lib/config.js`                                              |
| Headers         | helmet's defaults on every API response (HSTS, nosniff, frame-ancestors, a restrictive CSP).                                                                                                                                                                                                                                              | `app.js`                                                     |
| Browser         | The frontend's Content Security Policy (a per-request nonce on session pages, a fixed policy on static pages) and security headers on every page (Frontend).                                                                                                                                                                              | frontend `src/proxy.js`                                      |
| Backups         | A nightly `pg_dump` of production, encrypted with a public key whose private key is only in 1Password, in a private R2 bucket. A bucket lock blocks deleting or overwriting a backup for 30 days, then it expires. Restore tested locally (2026-10-26), and against production at deploy step 25 (`docs/deploy.md` → Restoring a backup). | `services/backupDatabase.js`, `lib/crypto.js`, `lib/r2.js`   |
| Change control  | Every change goes through a branch, a plan, a review and a PR. CI runs lint, format, `npm audit` and the tests on every PR and push to `main`. Production deploys only from each repo's `production` branch, released by a push of `main` after staging (`docs/deploy.md` → Every deploy after launch).                                   | `CLAUDE.md` → Workflow Checklist, `.github/workflows/ci.yml` |

## Rate limits

The numbers and routes are in `docs/endpoints.md` → Middleware Stack. They are a few times what real use of each route looks like, not a published standard, and each is one line in `lib/rateLimit.js`. After launch, compare them with the audit log and tune them.

- Counts are in memory, per instance. A shared store is needed before running more than one instance (`docs/scaling.md` §7).
- The client's address comes through two trusted proxies, Cloudflare and then Render's load balancer (`app.set('trust proxy', 2)`, `docs/endpoints.md` → Middleware Stack). Staging showed the count matters: with 1, every request looked like it came from a Cloudflare address, so visitors would have shared one limit and the audit log recorded Cloudflare. Check that the `ip` in a fresh `audit_event` row is your real address after each first deploy and after any change to Render's network (`docs/deploy.md`).

## Session revocation

Each account has a `sessionVersion`, and each session cookie carries the version it was issued with (`sv`). Logout increments the account's version, so every cookie issued before then stops working, on every device. The same lever ends a stolen session:

- **The site owner or admin signs out.** Every session of that account ends.
- **Without the user** (a compromised account): increment `session_version` on the account row, or set `active` to false. Both take effect on the next request. Until an admin endpoint exists, this is a SQL update from the API's Render Shell (the database accepts no outside connections), recorded in the incident notes.
- **Every session of every account:** rotate `JWT_SECRET` (Secrets).

## Audit log

What is recorded is in `docs/endpoints.md` → Audit Log; the table is `audit_event` (`docs/setup.md`).

- **Retention:** kept indefinitely for now. Rows are small, and SOC 2 commonly expects at least a year. Revisit if the table grows large.
- **Integrity:** no route reads, edits or deletes audit rows. Production data is changed only through the API, a reviewed migration or a reviewed script (`docs/scaling.md` §8), never by deleting audit rows.
- **Privacy:** rows hold account ids, the actor's email, and IP addresses. A failed login with no account still records the Google-verified email tried. The privacy policy must say so once it is written.
- **Reading it:** SQL from the API's Render Shell for now (Prisma Studio locally), filtered by `actor_id`, `target_id` or `created_at`. The admin audit log view (Planned Later) is the first feature after launch.

## Secrets

| Secret                  | Lives in                                                                                         | Rotation                                                                                                                                                                             | Backup                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`            | `.env`, Render, 1Password                                                                        | Replace and redeploy. Every session ends and everyone signs in again.                                                                                                                | Not needed: a lost value is just replaced.                                                               |
| `SECRET_ENCRYPTION_KEY` | `.env`, Render, 1Password                                                                        | No re-encryption tool yet: rotating it makes every stored webhook secret unreadable. Planned with key / secret rotation (Out of Scope in `CLAUDE.md`).                               | **Required**, stored apart from the database backups (1Password). If lost, every webhook secret is lost. |
| `CLOUDINARY_API_SECRET` | `.env`, Render, 1Password                                                                        | Generate a new key pair in Cloudinary, update `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`, redeploy, then delete the old pair. Signatures already issued expire within an hour. | Required, like `SECRET_ENCRYPTION_KEY` (1Password).                                                      |
| `DATABASE_URL` password | Render                                                                                           | Rotate the database's credentials in Render, then redeploy the services that read `DATABASE_URL` (linked to the database in `render.yaml`).                                          | Render.                                                                                                  |
| Website API keys        | Hashed in `website.api_key_hash`; plaintext in 1Password (3DWD Clients)                          | No endpoint yet (Out of Scope). A leaked key: set the website inactive, which refuses the key at once.                                                                               | 1Password (3DWD Clients), copied from the one-time reveal. Each client website also holds its own.       |
| Website webhook secrets | Encrypted in `website.webhook_secret_encrypted`; plaintext in 1Password (3DWD Clients)           | No endpoint yet (Out of Scope).                                                                                                                                                      | 1Password (3DWD Clients), plus the database backup with `SECRET_ENCRYPTION_KEY`.                         |
| Backup private key      | 1Password (3DWD Production) only, never Render. Its public half is `BACKUP_PUBLIC_KEY`           | Generate a new pair (`npm run backup:keygen`), put the new public key in Render. Keep the old private key until every dump encrypted with it has expired (30 days).                  | **Required**: if lost, every backup is unreadable. It is the only copy, so it is never deleted early.    |
| R2 API token            | `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` in Render (production) , 1Password (3DWD Production) | Create a new token scoped to the bucket in Cloudflare, update Render, delete the old token.                                                                                          | Not needed: a lost token is just replaced.                                                               |

1Password holds every secret outside the running systems, in three vaults: **3DWD Dev** (both repos' local `.env` values), **3DWD Production** (the production values, added as they are generated at deploy) and **3DWD Clients** (each client website's credentials from the one-time reveal, and the Vercel project that serves it). Every secret, id and password is saved as a hidden password field. A secret is copied from 1Password straight into `.env`, Render or Vercel, never through a chat, an issue or a commit.

Both Cloudinary keys (dev and production) have Cloudinary's Master Admin role, a deliberate choice: of the roles Cloudinary offers a key (Master admin, Media Library user, Reports, User), only Master Admin can upload, list and delete through the API, as signing and the cleanup need. So a leaked `CLOUDINARY_API_SECRET` controls the whole Cloudinary environment, which is why it is kept only in `.env`, Render and 1Password and rotated as above (decided 2026-10-27).

`GOOGLE_CLIENT_ID`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and the backup public key are public identifiers, not secrets. No secret is ever logged, returned outside its one creation response, or pasted into a chat, an issue or a commit.

## Access

Who can reach each system that holds production data or code. Fill in, and review whenever someone joins or leaves:

| System                                                  | Who has access               | 2FA on?                                                         |
| ------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------- |
| Google account (the admin sign-in)                      | Rich                         | Yes: fingerprint passkey; Google Authenticator as the fallback  |
| GitHub (both repos)                                     | Rich                         | Yes: GitHub's own 2FA, also signs in with Google                |
| Render (API, database, cron jobs)                       | Rich                         | Yes: signs in with GitHub; Google Authenticator                 |
| Vercel Pro team (frontend, client websites)             | Rich, the team's only member | Yes: signs in with GitHub; Google Authenticator as the fallback |
| Cloudinary (images, API secret)                         | Rich                         | Yes: signs in with Google, Cloudinary 2FA on                    |
| Cloudflare (R2 database backups)                        | Rich                         | Yes: Google Authenticator                                       |
| Namecheap (domain registrar and DNS for `3dwebdev.com`) | Rich                         | Yes: Google Authenticator                                       |
| 1Password (every secret, Secrets)                       | Rich                         | Yes: Google Authenticator                                       |

The administrator's Google account is the app's highest privilege: whoever controls it controls every account. It must have 2FA, preferably a passkey or security key. Vercel signs in through GitHub, so GitHub's 2FA protects both.

Recovery: the 1Password emergency kit and the recovery codes for Google, GitHub, Vercel, Namecheap, Cloudflare and Render are printed and kept offline, apart from where the work is done. Where the printouts are kept is not written down here.

## Incident response

When something looks wrong (a leaked secret, an unknown sign-in, unexpected changes):

1. **Contain.** End the sessions involved (Session revocation). Set an affected website or account inactive. Rotate any secret that may have leaked (Secrets).
2. **Investigate.** Read the audit log for the accounts, websites and time window involved: sign-ins, failed sign-ins and IPs, changes. Check the Render, Vercel and Cloudinary logs.
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
- **The proxy count depends on Render:** `trust proxy` counts Render's two proxies, which Render doesn't document. If Render added a proxy, `req.ip` would become a proxy's address again: limits shared, but nobody gets round them. If it removed one, a client could set its own address and get round the IP limits. Caught by the `ip` check above. Reading Cloudflare's `CF-Connecting-IP` instead was set aside: Render doesn't guarantee it either (2026-10-27).
- **In-memory rate limits:** they reset when the server restarts, and each instance counts on its own (Rate limits).
- **Backups beyond 3 days are nightly:** Render's point-in-time recovery covers the past 3 days on the Hobby workspace (7 on Pro). Past that, our own nightly dump is the backup: encrypted with a public key, kept 30 days in a private R2 bucket (`docs/deploy.md` → Render services). Restoring from it loses the changes made since the night before. Revisit if the workspace moves to Pro (`docs/deploy.md` → Hosting and plans).
- **Admins can bypass branch protection:** kept on purpose as an escape hatch for an emergency fix (decided 2026-10-24). A bypass is used only in an incident and written in its incident notes (Incident response).
- **Staging shares the session cookie's name and domain with production:** a browser signed into both sends both cookies to both. Staging is tested only in a separate browser profile (`docs/deploy.md` → Environments).

## Frontend

Browser-side protection is the frontend's job, built in frontend PR #23 (`src/proxy.js`, `src/app/_lib/contentSecurityPolicy.js`, `next.config.mjs`):

- **Content Security Policy split by page type.** Pages that handle the session (`/sign-in`, `/dashboard`, `/admin`) render per request with a strict CSP: `script-src 'self' 'nonce-…' 'strict-dynamic'`, the nonce generated in `proxy.js` for each request, and no `'unsafe-inline'` for scripts. The `/dashboard` and `/admin` layouts call `connection()` so they render per request. Static pages (only the landing page today, listed in `STATIC_PATHS`) stay on the CDN with a fixed policy. Next.js can only put a nonce in a page rendered per request, so the static policy allows `'unsafe-inline'` scripts: safe only because those pages show no user content and hold no session. Any page not listed as static gets the nonce policy.
- **Rule:** a page that renders user content or handles the session is never static.
- **A policy belongs to the document,** so a link from a static page to a session page is a full page load ("Sign in" in the Navbar). A client-side route would keep the static page's policy.
- **`style-src` keeps `'unsafe-inline'`.** A nonce covers `<style>` tags, not `style="…"` attributes, which React, `next/image` and the Google sign-in button all use. Injected styles are a much smaller risk than injected scripts.
- The Google sign-in script and frame are allowed explicitly (`accounts.google.com`).
- Every page also gets `Referrer-Policy`, `Permissions-Policy`, HSTS (no `preload`), `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY`, and both policies carry `frame-ancestors 'none'`.
- Rich browser-tested it on a production build with no CSP violations (2026-10-22).
- `Cross-Origin-Opener-Policy: same-origin-allow-popups` (Google's recommended value for the sign-in pop-up) was added on staging, with Google sign-in re-tested (frontend PR #32).
- Checked on production on 2026-10-27 (frontend PR #33): `curl -I` shows the headers on static and dynamic pages, and `www` and `http` redirect to `https://3dwebdev.com` (308). securityheaders.com rates `/` A and `/sign-in` A+; Mozilla HTTP Observatory rates B+. The only flags are the ones decided above: `'unsafe-inline'` scripts on the static landing page, `'unsafe-inline'` styles everywhere, no HSTS `preload`.
- HSTS preload: not now (Rich, 2026-10-27). HSTS is already sent for 2 years with `includeSubDomains`. Preloading is hard to undo and binds every future subdomain to https, so it is revisited once email and any other subdomain services are set up.
- CSP violation reporting is on Planned Later (`CLAUDE.md`).

## Pre-deploy checklist (Rich)

Done by hand before the first production deploy. Tick each one here when done:

- [x] 2FA on the Google admin account, GitHub, Vercel, Cloudinary, the domain registrar and 1Password (2026-10-23)
- [x] 1Password set up with the Dev, Production and Clients vaults, and recovery codes printed and kept offline (2026-10-23)
- [x] Dependabot alerts and secret scanning turned on in both repos (2026-10-23: alerts, security updates and grouped security updates on, self-hosted runners off; secret scanning and push protection on)
- [x] The Access table above filled in (2026-10-23; Render's row added 2026-10-26, deployment checklist step 11)
- [x] Branch protection on `main` in both repos: changes only through a PR, CI's `check` must pass (2026-10-23, checked on GitHub 2026-10-24; admins can bypass it, Accepted risks)

## Deploy steps

The security steps that need Render or production values (the new Cloudinary key pairs, fresh production secrets backed up in 1Password, the backups and a test restore, the proxy hop count) are steps in `docs/deploy.md` → Deployment checklist, in the order they are done.
