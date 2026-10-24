# Deploy

How the backend is hosted, the checklist for the first production deploy (staging first), how every later deploy runs, and how a client website is onboarded. Imported from `CLAUDE.md` via `@docs/deploy.md`. The frontend keeps its own `docs/deploy.md`; the master doc's Deployment tab copies both.

The decisions here were made on 2026-10-24. `docs/security.md` holds the controls, secrets and access this file relies on; `docs/scaling.md` holds the rules for changing the system once it is live.

## Hosting and plans

| Service       | Plan         | Holds                                                         | Move to a paid plan when                                                   |
| ------------- | ------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Railway       | Hobby, $5/mo | The API, Postgres, the cron services (staging and production) | Hosting revenue covers Pro ($20/mo), or after one year, whichever is first |
| Vercel        | Pro, $20/mo  | The frontend and every client website                         | Already paid (below)                                                       |
| Cloudinary    | Free         | Site owners' images                                           | The free tier's 25 credits a month run out (`docs/scaling.md` §6)          |
| Cloudflare R2 | Free (10 GB) | Encrypted nightly database backups                            | Backups outgrow 10 GB                                                      |

- **Vercel is Pro from launch.** Vercel's fair use rules allow Hobby for non-commercial personal use only, and "commercial" includes being paid to host a site. Client websites pay a hosting fee, so the frontend and every client website live in a Vercel Pro team.
- **Railway Hobby appears to have no database backups:** Railway's support replies say volume backups need Pro, though its backups docs name no plan. Confirm it in the dashboard at checklist step 12. Either way the backend makes its own: `backup-database` (Railway services). That gap is written in `docs/security.md` → Accepted risks.
- **Staging can cost a few dollars over Hobby's $5 credit.** That is accepted.

## Environments

|                     | Local                          | Staging                            | Production                         |
| ------------------- | ------------------------------ | ---------------------------------- | ---------------------------------- |
| Frontend            | `http://localhost:3000`        | `https://staging.3dwebdev.com`     | `https://3dwebdev.com`             |
| API                 | `http://localhost:4000`        | `https://api-staging.3dwebdev.com` | `https://api.3dwebdev.com`         |
| Database            | docker-compose Postgres        | its own Railway Postgres           | its own Railway Postgres           |
| `CLOUDINARY_FOLDER` | `3dwd-dev`                     | `3dwd-dev`                         | `3dwd`                             |
| Cloudinary key pair | the dev pair                   | the dev pair                       | the production pair                |
| Cron services       | none (`sweep:uploads` by hand) | none                               | `sweep-uploads`, `backup-database` |

- **Staging is a rehearsal of production,** set up and tested first (the checklist, Phase 2). Production is then made by duplicating it and swapping in production values.
- **Staging shares `3dwd-dev` with local,** so client websites need no extra `remotePatterns` entry to show staging images. Staging runs no sweep. A local `npm run sweep:uploads` deletes staging uploads more than 24 hours old, which is fine: staging data is throwaway.
- **Staging and production share the cookie** (`session`, `Domain=.3dwebdev.com`), so a browser signed into both would send both cookies to both. Staging is always tested in a **separate browser profile**.
- Railway Hobby allows 2 custom domains: `api.3dwebdev.com` and `api-staging.3dwebdev.com`.

## Environment variables

Every variable the backend reads, per deployed environment. Secrets are generated straight into 1Password (3DWD Production) and copied from there into Railway, never through a chat, an issue or a commit (`docs/security.md` → Secrets).

| Variable                | Staging                                 | Production                                                                   |
| ----------------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| `PORT`                  | set by Railway                          | set by Railway                                                               |
| `NODE_ENV`              | `production`                            | `production`                                                                 |
| `DATABASE_URL`          | Railway reference to staging's Postgres | Railway reference to production's Postgres                                   |
| `GOOGLE_CLIENT_ID`      | the OAuth client ID                     | the OAuth client ID                                                          |
| `JWT_SECRET`            | its own, freshly generated              | its own, freshly generated                                                   |
| `SECRET_ENCRYPTION_KEY` | its own, freshly generated              | its own, freshly generated, backed up                                        |
| `CORS_ORIGIN`           | `https://staging.3dwebdev.com`          | `https://3dwebdev.com`                                                       |
| `COOKIE_DOMAIN`         | `.3dwebdev.com`                         | `.3dwebdev.com`                                                              |
| `CLOUDINARY_CLOUD_NAME` | 3DWD's cloud name                       | 3DWD's cloud name                                                            |
| `CLOUDINARY_API_KEY`    | the dev pair                            | the production pair                                                          |
| `CLOUDINARY_API_SECRET` | the dev pair                            | the production pair, backed up                                               |
| `CLOUDINARY_FOLDER`     | `3dwd-dev`                              | `3dwd`                                                                       |
| `SEED_ADMIN_EMAIL`      | the admin's Google email                | the admin's Google email                                                     |
| Backup variables        | not set                                 | the R2 bucket, token and backup public key (named by `feat/database-backup`) |

`NODE_ENV=production` on staging makes `lib/config.js` check it like production: https `CORS_ORIGIN` and a cookie domain. Each environment's `JWT_SECRET` and `SECRET_ENCRYPTION_KEY` is its own; none is reused from local or the other environment.

## Railway services

One Railway project, built from this repo, with a `staging` and a `production` environment.

- **API:** start `npm start`; pre-deploy `npx prisma migrate deploy`, so migrations run once per deploy, not per instance (`docs/scaling.md` §7); health check `GET /api/health`. Its configuration is kept in the repo as Railway config-as-code, written on the staging branch (checklist step 13).
- **`sweep-uploads`** (production only): a cron service running `npm run sweep:uploads` daily (`docs/setup.md` → Upload cleanup).
- **`backup-database`** (production only): a cron service running nightly. It dumps the production database with `pg_dump`, encrypts the dump with the backup public key, and uploads it to the private R2 bucket `3dwd-backups`, where a lifecycle rule deletes dumps after 30 days. Only the public key is in Railway, so a leak there can't read a backup. The private key lives only in 1Password (3DWD Production). Built on `feat/database-backup`.

Cron schedules are in UTC.

## Deployment checklist

The first deploy, start to finish, in order. **[Rich]** is done outside the codebase, **[Claude]** is a branch in this repo, **[Frontend]** is a branch in the frontend repo (`3d_wd`). Tick each step when done. After launch this list stays as the record.

### Phase 0: Docs

1. [x] **[Claude]** `docs/deploy`: this file and the decisions behind it.
2. [x] **[Frontend]** The frontend's `docs/deploy.md` (handoff): the Vercel Pro team, domains and env vars, preview protection, the staging branch, the header checks.
3. [x] **[Claude]** The master doc's Deployment tab: a Frontend and a Backend section, each copied from that repo's `docs/deploy.md`.
4. [x] **[Claude]** The Documentation Sync (`CLAUDE.md`), which runs before any production deploy.

### Phase 1: Before anything is hosted

5. [ ] **[Rich]** Vercel: upgrade to a Pro team and move the frontend and every client website project (Stevie The Dog today) into it. Update Vercel's row in the Access table (`docs/security.md`).
6. [x] **[Rich]** Branch protection on `main` in both repos: changes only through a PR, CI's `check` must pass (2026-10-23).
7. [ ] **[Rich]** Cloudinary: generate two new key pairs, one for production and one for local dev and staging. Put the dev pair in the local `.env` and 1Password (3DWD Dev), keep the production pair for step 21, then delete the pair that was shared in a Claude session.
8. [ ] **[Rich]** Cloudflare: an account with 2FA (add it to the Access table), a private R2 bucket `3dwd-backups`, a lifecycle rule deleting objects after 30 days, and an R2 API token scoped to that bucket (object read and write), saved in 1Password (3DWD Production). Cloudflare may ask for a card even on the free tier.
9. [ ] **[Claude]** `feat/database-backup`, with its own plan: the backup and restore scripts, the Backups row in `docs/security.md` → Controls in place, the encryption in `lib/crypto.js` (a random AES-256-GCM key per dump, wrapped with the RSA public key), a key pair generator, the new env vars (`docs/scaling.md` §8) and tests. Tested against a local dump and the real bucket.
10. [ ] **[Rich]** Generate the backup key pair. The private key goes into 1Password (3DWD Production) only; the public key goes to Railway in step 21.

### Phase 2: Staging

11. [ ] **[Rich]** Railway: an account on Hobby, 2FA on, recovery codes in 1Password, and Railway's row in the Access table.
12. [ ] **[Rich]** A Railway project from this repo, with an environment named `staging` and its Postgres. Note the Postgres major version: the backup's `pg_dump` must match it.
13. [ ] **[Claude]** `deploy/staging`: the API's Railway config-as-code (build, start, the pre-deploy migration, the health check). Confirm the Prisma CLI is installed when the pre-deploy step runs (`prisma` is a devDependency), and confirm or update the migration rule in `docs/scaling.md` §7.
14. [ ] **[Rich]** Staging's `JWT_SECRET` and `SECRET_ENCRYPTION_KEY`, freshly generated with the commands in `.env.example`.
15. [ ] **[Rich]** Staging's variables (Environment variables).
16. [ ] **[Rich]** Staging's domains:
    - Railway custom domain `api-staging.3dwebdev.com`, with its CNAME and verification record at Namecheap
    - Vercel: `staging.3dwebdev.com` on the frontend's `staging` branch, with that branch's env vars pointing at `https://api-staging.3dwebdev.com`, and preview deployment protection on
    - Google Cloud: `https://staging.3dwebdev.com` added to the OAuth client's authorized JavaScript origins
17. [ ] **[Rich]** The first staging deploy of both repos. `GET https://api-staging.3dwebdev.com/api/health` returns `{ "data": { "ok": true } }`. Seed the admin: `npm run seed -- --confirm-production`, run through the Railway CLI or a Railway shell.
18. [ ] **[Rich + Claude]** The staging test, in a separate browser profile:
    - admin sign-in, create the site owner account with the Stevie The Dog website
    - site owner sign-in, a post with an uploaded image, an edit, archive and make active
    - sign-out ends the session, and a sixth sign-in attempt within 15 minutes gets the 429
    - client-website Tests A–C (`docs/client-website-test.md`), with Stevie's Vercel env pointed at staging for the test, then restored
19. [ ] **[Rich + Claude]** The proxy hop count: the `ip` in a staging `audit_event` row is your real address, not Railway's. If it isn't, `app.set('trust proxy', 1)` is fixed on a branch.
20. [ ] **[Frontend]** The header checks on staging (`docs/security.md` → Frontend), and `Cross-Origin-Opener-Policy: same-origin-allow-popups` added and Google sign-in re-tested.

### Phase 3: Production

21. [ ] **[Rich]** Railway: duplicate the `staging` environment as `production`, with its own Postgres, then replace every value that differs (Environment variables): new `JWT_SECRET` and `SECRET_ENCRYPTION_KEY` (into 1Password first), the production Cloudinary pair, `CLOUDINARY_FOLDER=3dwd`, `CORS_ORIGIN`, the backup variables.
22. [ ] **[Rich]** Production's two cron services: `sweep-uploads` daily and `backup-database` nightly.
23. [ ] **[Rich]** Production's domains:
    - Railway custom domain `api.3dwebdev.com` at Namecheap
    - Vercel: `3dwebdev.com`, with `www.3dwebdev.com` redirecting to it (the frontend must always be served from the one origin in `CORS_ORIGIN`), and the Production env vars pointing at `https://api.3dwebdev.com`
    - Google Cloud: `https://3dwebdev.com` in the OAuth client's authorized JavaScript origins
24. [ ] **[Rich]** The first production deploy. Check the health route, seed the admin, sign in.
25. [ ] **[Rich + Claude]** Backups: run `backup-database` once by hand, confirm the encrypted dump is in R2, restore it into a throwaway local database with the private key and check the rows. `SECRET_ENCRYPTION_KEY`, `CLOUDINARY_API_SECRET` and the backup private key are in 1Password (3DWD Production).
26. [ ] **[Frontend]** The production header checks and the HSTS preload decision (`docs/security.md` → Frontend).

### Phase 4: Stevie The Dog, the first onboarding

27. [ ] **[Rich]** Onboard Stevie The Dog by the flow in Onboarding a client website. The production database starts empty, so this is a new account and website: a new API key and webhook secret, and the folder `3dwd/steviethedog`. Its `remotePatterns` already allow that folder.
28. [ ] **[Rich]** Write "First Post!" again, with an uploaded image. Run client-website Tests A–C against production and check the audit log rows.

### Phase 5: After launch

29. [ ] **[Claude]** `docs/launch`: retire `docs/scaling.md` §0 (breaking changes now go through expand → migrate → contract) and the "until the first production deploy" lines in `CLAUDE.md`, add a production baseline beside the local one, and hand off so the frontend retires its own §0. In the master doc, mark the one-time sections as the record of the launch (the Runbook's build order, this checklist) and retire what no longer applies.
30. [ ] **[Rich]** Delete the staging environment to save credit, or keep it. It is duplicated again from production before the first breaking change (`docs/scaling.md` §8).
31. [ ] **[Rich]** Onboard the VIP clients one at a time.

## Every deploy after launch

1. A change merges to `main` through a PR with CI green (branch protection).
2. Railway builds it and runs `npx prisma migrate deploy` before the new version takes traffic. Vercel deploys the frontend.
3. A contract change deploys the backend first, accepting both the old and the new shape, then the frontend (`docs/scaling.md` §4).
4. Before a migration that drops or rewrites data, take a backup by hand (`backup-database`) and confirm it is in R2 (`docs/scaling.md` §8).
5. Before the first breaking change after launch, staging exists again and the change is deployed there first.

## Onboarding a client website

The repeatable flow for each new client website. Stevie The Dog runs it first (checklist step 27).

1. In the production admin dashboard, create the site owner account with a new website (or link a new website to an existing account). Enter the URL the website is actually served on, with no redirect (`https://www.steviethedog.com` for Stevie): revalidation calls that exact URL, and a redirect drops its Authorization header. Copy the API key and webhook secret from the one-time reveal straight into 1Password (3DWD Clients), with the Vercel project that serves the website.
2. On the client website's Vercel project, set `HEADLESS_CMS_API_URL=https://api.3dwebdev.com`, `HEADLESS_CMS_API_KEY` and `HEADLESS_CMS_WEBHOOK_SECRET`, for Production only.
3. In the client website's `next.config`, the `remotePatterns` entries allow its own folder, `3dwd/<media_folder>` (`docs/setup.md` → Client websites). `media_folder` follows the rule in `docs/setup.md` → media_folder; confirm it on the `website` row in Railway's database view, since a clash adds `-2`.
4. Redeploy the client website, then run Tests A–C (`docs/client-website-test.md`) against production.
5. The site owner signs in with their Google account and writes their first post.
