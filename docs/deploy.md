# Deploy

How the backend is hosted, the checklist for the first production deploy (staging first), how every later deploy runs, and how a client website is onboarded. Imported from `CLAUDE.md` via `@docs/deploy.md`. The frontend keeps its own `docs/deploy.md`; the master doc's Deployment tab copies both.

The decisions here were made on 2026-10-24. The backend was first planned on Railway; on 2026-10-26 Railway had closed new sign-ups, so it moved to Render, the other host considered. `docs/security.md` holds the controls, secrets and access this file relies on; `docs/scaling.md` holds the rules for changing the system once it is live.

## Hosting and plans

| Service       | Plan                                 | Holds                                                     | Move to a paid plan when                                          |
| ------------- | ------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------- |
| Render        | Hobby workspace, $0/mo, plus compute | The API, Postgres, the cron jobs (staging and production) | A second team member, or a Pro-only feature is needed ($25/mo)    |
| Vercel        | Pro, $20/mo                          | The frontend and every client website                     | Already paid (below)                                              |
| Cloudinary    | Free                                 | Site owners' images                                       | The free tier's 25 credits a month run out (`docs/scaling.md` §6) |
| Cloudflare R2 | Free (10 GB)                         | Encrypted nightly database backups                        | Backups outgrow 10 GB                                             |

- **Vercel is Pro from launch.** Vercel's fair use rules allow Hobby for non-commercial personal use only, and "commercial" includes being paid to host a site. Client websites pay a hosting fee, so the frontend and every client website live in a Vercel Pro team.
- **Render compute, per environment:** a Starter web service (`0.5c-512mb`, about $7/mo) and the smallest paid Postgres (`0.1c-256mb`, about $6/mo plus storage). Production adds two cron jobs, billed by the minute with a $1/mo minimum each. Render's review screen (step 15, 2026-10-26) priced staging at $13.30/mo: the web service $7, Postgres $6 and its 1 GB disk $0.30. Production is the same plus the two cron jobs, about $15.30/mo. About $28.60/mo while staging and production both run, about $15.30/mo once staging is deleted (checklist step 30). Keeping staging after launch is tabled until the business is validated (step 30).
- **No free Postgres:** Render's free databases expire after 30 days and have no backups, so both environments use the smallest paid plan.
- **Database backups:** a paid Render Postgres has point-in-time recovery for the past 3 days on the Hobby workspace (7 on Pro), plus logical exports kept 7 days. The backend also makes its own, kept 30 days outside Render: `backup-database` (Render services). `docs/security.md` → Accepted risks.
- **Hobby includes 2 custom domains:** `api.3dwebdev.com` and `api-staging.3dwebdev.com`.

## Environments

|                     | Local                          | Staging                            | Production                                   |
| ------------------- | ------------------------------ | ---------------------------------- | -------------------------------------------- |
| Frontend            | `http://localhost:3000`        | `https://staging.3dwebdev.com`     | `https://3dwebdev.com`                       |
| API                 | `http://localhost:4000`        | `https://api-staging.3dwebdev.com` | `https://api.3dwebdev.com`                   |
| Database            | docker-compose Postgres 17     | its own Render Postgres 17         | its own Render Postgres 17                   |
| `CLOUDINARY_FOLDER` | `3dwd-dev`                     | `3dwd-dev`                         | `3dwd`                                       |
| Cloudinary key pair | the dev pair                   | the dev pair                       | the production pair                          |
| Cron jobs           | none (`sweep:uploads` by hand) | none                               | `3dwd-sweep-uploads`, `3dwd-backup-database` |

- **Staging is a rehearsal of production,** set up and tested first (the checklist, Phase 2). Production is then added to `render.yaml` beside it, with its own database and secrets (Phase 3).
- **Releases:** staging deploys every merge to `main`; production deploys only from the `production` branch, which receives `main` when it is released (`git push origin main:production`, Every deploy after launch). So a change runs on staging before it reaches production. Once staging is deleted (step 30), the push is still the deliberate release step. The frontend still deploys production from `main` on every merge, with `staging` pushed by hand; whether it gets a `production` branch too is a frontend decision (`docs/security.md` → Change control).
- **Staging shares `3dwd-dev` with local,** so client websites need no extra `remotePatterns` entry to show staging images. Staging runs no sweep. A local `npm run sweep:uploads` deletes staging uploads more than 24 hours old, which is fine: staging data is throwaway.
- **Staging and production share the cookie** (`session`, `Domain=.3dwebdev.com`), so a browser signed into both would send both cookies to both. Staging is always tested in a **separate browser profile**.

## Environment variables

Every variable the backend reads, per deployed environment. The values that aren't secret are written in `render.yaml`. Secrets and ids are `sync: false` there: Render asks for each one once, when its service is created (if it doesn't, it is set on the service by hand), and they are copied straight from 1Password (3DWD Production), never through a chat, an issue or a commit (`docs/security.md` → Secrets). A secret added after creation is set on the service by hand, since later syncs never ask.

Production's three services each read only their own variables (`render.yaml`): the API reads all but the backup ones; `3dwd-sweep-uploads` reads `NODE_ENV`, `DATABASE_URL` and the four `CLOUDINARY_*`; `3dwd-backup-database` reads `DATABASE_URL`, `BACKUP_PUBLIC_KEY` and the four `R2_*`. Render's environment groups can't hold `sync: false` values, so the Cloudinary pair is entered on both the API and the sweep.

| Variable                | Staging                                 | Production                                        |
| ----------------------- | --------------------------------------- | ------------------------------------------------- |
| `PORT`                  | set by Render                           | set by Render                                     |
| `NODE_ENV`              | `production`                            | `production`                                      |
| `DATABASE_URL`          | from staging's Postgres (`render.yaml`) | from production's Postgres (`render.yaml`)        |
| `GOOGLE_CLIENT_ID`      | the OAuth client ID                     | the OAuth client ID                               |
| `JWT_SECRET`            | its own, freshly generated              | its own, freshly generated                        |
| `SECRET_ENCRYPTION_KEY` | its own, freshly generated              | its own, freshly generated, backed up             |
| `CORS_ORIGIN`           | `https://staging.3dwebdev.com`          | `https://3dwebdev.com`                            |
| `COOKIE_DOMAIN`         | `.3dwebdev.com`                         | `.3dwebdev.com`                                   |
| `CLOUDINARY_CLOUD_NAME` | 3DWD's cloud name                       | 3DWD's cloud name                                 |
| `CLOUDINARY_API_KEY`    | the dev pair                            | the production pair                               |
| `CLOUDINARY_API_SECRET` | the dev pair                            | the production pair, backed up                    |
| `CLOUDINARY_FOLDER`     | `3dwd-dev`                              | `3dwd`                                            |
| `SEED_ADMIN_EMAIL`      | the admin's Google email                | the admin's Google email                          |
| `BACKUP_PUBLIC_KEY`     | not set                                 | the backup public key from step 10 (not a secret) |
| `R2_ACCOUNT_ID`         | not set                                 | the Cloudflare account id                         |
| `R2_ACCESS_KEY_ID`      | not set                                 | the R2 token's access key id                      |
| `R2_SECRET_ACCESS_KEY`  | not set                                 | the R2 token's secret                             |
| `R2_BUCKET`             | not set                                 | `3dwd-backups`                                    |

`NODE_ENV=production` on staging makes `lib/config.js` check it like production: https `CORS_ORIGIN` and a cookie domain. Each environment's `JWT_SECRET` and `SECRET_ENCRYPTION_KEY` is its own; none is reused from local or the other environment.

## Render services

One Render project, `3dwd`, in the 3D Web Dev workspace, with a `staging` and a `production` environment. Everything in it is defined in `render.yaml` at the repo root (a Render Blueprint): Render creates the services from it, so the configuration is reviewed in PRs like code. The Blueprint uses **Manual Sync**: after a merge that changes `render.yaml`, click Manual Sync in Render to apply it. Code deploys and the pre-deploy migration don't wait for it: staging's run on every merge to `main`, production's on every push to `production`. Every service runs in the `virginia` region, next to Vercel's default functions region. The Node version comes from `.nvmrc` (24), the same file CI reads.

- **API** (`3dwd-api-staging` and `3dwd-api-production`): a Starter web service. Staging deploys from `main`, production from `production`, each once CI's check has passed on the commit (`autoDeployTrigger: checksPass`; a commit pushed to `production` already passed on `main`). Besides its custom domain, staging's is also served at `https://threedwd-api-staging.onrender.com` (Render prefixes `threedwd-`, since a hostname can't start with a digit).
  - Build: `npm ci --include=dev`. `NODE_ENV=production` is set at build time too, which makes npm omit devDependencies, and the Prisma CLI is one.
  - Pre-deploy: `npx prisma migrate deploy`, run once per deploy before the new version takes traffic (`docs/scaling.md` §7). If it fails, the deploy fails and the previous version keeps running.
  - Start: `npm start`. Health check: `GET /api/health`, which gates the switch to the new version (zero-downtime deploys).
- **Postgres** (`3dwd-db-staging` and `3dwd-db-production`): Postgres 17, the smallest paid plan, reachable only from inside Render (`ipAllowList: []`). The API and the Render Shell reach it on the private network; nothing on the internet can, so Prisma Studio from a laptop can't either.
- **`3dwd-sweep-uploads`** (production only): a Node cron job running `npm run sweep:uploads` daily at 09:00 UTC (`docs/setup.md` → Upload cleanup). Built like the API (`npm ci --include=dev`), since the sweep reads image rows through the Prisma client.
- **`3dwd-backup-database`** (production only): a cron job running `npm run backup:database` nightly at 08:00 UTC, an hour before the sweep (`services/backupDatabase.js`). It dumps the production database with `pg_dump` (custom format, no owner or privileges), encrypts the dump with the backup public key (`docs/setup.md` → Crypto Module), and uploads it to the private R2 bucket `3dwd-backups` as `backups/<timestamp>.dump.enc`. A bucket lock keeps each dump from being deleted or overwritten for 30 days, then a lifecycle rule deletes it. Only the public key is in Render, so a leak there can't read a backup. The private key lives only in 1Password (3DWD Production). It needs a `pg_dump` of the database's major version (17), and Render's native Node runtime only has `postgresql-client` 12 to 14, so this cron job runs in Docker: `Dockerfile.backup`, Node 24 on Debian 13 (trixie), which ships `postgresql-client-17`. The image holds `lib/`, `services/`, `scripts/` and the runtime packages from a plain `npm ci --omit=dev` (checked against `package-lock.json`); `.dockerignore` keeps `.env` and the local `node_modules` out of the build. A failed run exits 1, so Render shows it.

Cron schedules are in UTC.

## Deployment checklist

The first deploy, start to finish, in order. **[Rich]** is done outside the codebase, **[Claude]** is a branch in this repo, **[Frontend]** is a branch in the frontend repo (`3d_wd`). Tick each step when done. After launch this list stays as the record.

### Phase 0: Docs

1. [x] **[Claude]** `docs/deploy`: this file and the decisions behind it.
2. [x] **[Frontend]** The frontend's `docs/deploy.md` (handoff): the Vercel Pro team, domains and env vars, preview protection, the staging branch, the header checks.
3. [x] **[Claude]** The master doc's Deployment tab: a Frontend and a Backend section, each copied from that repo's `docs/deploy.md`.
4. [x] **[Claude]** The Documentation Sync (`CLAUDE.md`), which runs before any production deploy.

### Phase 1: Before anything is hosted

5. [x] **[Rich]** Vercel: upgrade to a Pro team and move every client website project (Stevie The Dog today) into it. Update Vercel's row in the Access table (`docs/security.md`). The frontend wasn't on Vercel yet; it was imported into the Pro team at step 16.
6. [x] **[Rich]** Branch protection on `main` in both repos: changes only through a PR, CI's `check` must pass (2026-10-23).
7. [x] **[Rich]** Cloudinary: generate two new key pairs, one for production and one for local dev and staging. Put the dev pair in the local `.env` and 1Password (3DWD Dev), keep the production pair for step 22, then delete the pair that was shared in a Claude session. Each key needs Cloudinary's **Master Admin** role: the other roles (Media Library user, Reports, User) can't upload, list and delete through the API, and a Media Library user key fails uploads with "Request forbidden due to missing permissions" (found at step 18, `docs/security.md` → Secrets).
8. [x] **[Rich]** Cloudflare: an account with 2FA (add it to the Access table), a private R2 bucket `3dwd-backups`, a lifecycle rule deleting objects after 30 days, and an R2 API token scoped to that bucket (object read and write), saved in 1Password (3DWD Production). Cloudflare may ask for a card even on the free tier. Then a bucket lock rule on the whole bucket, retaining objects 30 days, so a leaked token can't delete or overwrite a backup (added on `feat/database-backup`).
9. [x] **[Claude]** `feat/database-backup`, with its own plan: the backup and restore scripts, the Backups row in `docs/security.md` → Controls in place, the encryption in `lib/crypto.js` (a random AES-256-GCM key per dump, wrapped with the RSA public key), a key pair generator, the new env vars (`docs/scaling.md` §8) and tests. Tested against a local dump and the real bucket.
10. [x] **[Rich]** Generate the backup key pair. The private key goes into 1Password (3DWD Production) only; the public key goes to Render in step 22.

### Phase 2: Staging

11. [x] **[Rich]** Render: an account that signs in with GitHub, 2FA with Google Authenticator, recovery codes printed and kept offline, a 3D Web Dev workspace on Hobby, and Render's row in the Access table (2026-10-26; Railway had closed sign-ups).
12. [x] **[Claude]** `deploy/staging`: `render.yaml` with the staging environment (the API and its Postgres 17), `.nvmrc` (Node 24, also used by CI), and the docs moved from Railway to Render. The build installs the Prisma CLI for the pre-deploy migration (`npm ci --include=dev`), and `docs/scaling.md` §7's migration rule is confirmed as Render's pre-deploy command.
13. [x] **[Rich]** Staging's `JWT_SECRET` and `SECRET_ENCRYPTION_KEY`, freshly generated with the commands in `.env.example` and saved in 1Password (3DWD Production).
14. [x] **[Rich]** Create the Blueprint once `deploy/staging` is merged: Render → New → Blueprint, connect GitHub with access to **only `3d_wd_backend`**, pick the repo and `render.yaml`, and enter staging's secret values when asked (Environment variables).
15. [x] **[Rich + Claude]** On the Blueprint's review screen, check the services, plans and monthly price against Hosting and plans before applying, and correct Hosting and plans if they differ. Then update the server costs in `docs/proposal-notes.md` (Pricing → Fixed costs, and the server-cost line held back from v1), which still show Railway's $300 a year. Once the database exists, check its Recovery page shows point-in-time recovery. (2026-10-26: $13.30/mo, Hosting and plans; 3 days of point-in-time recovery shown; the Blueprint is `3DWD-Backend`, on Manual Sync.)
16. [x] **[Rich]** Staging's domains:
    - Render custom domain `api-staging.3dwebdev.com` on `3dwd-api-staging`, with its CNAME at Namecheap
    - Vercel: `staging.3dwebdev.com` on the frontend's `staging` branch, with that branch's env vars pointing at `https://api-staging.3dwebdev.com`, and preview deployment protection on
    - Google Cloud: `https://staging.3dwebdev.com` added to the OAuth client's authorized JavaScript origins

    Done 2026-10-27. The frontend was imported into the Vercel Pro team first. Its staging env vars are Preview, scoped to the `staging` branch, and set before the first build (the `NEXT_PUBLIC_*` values are built in). Vercel skipped the first push of `staging`, which was the same commit as `main`, so its first deployment was created by hand (Deployments → Create Deployment). With Standard Protection on, `staging.3dwebdev.com` also asks for a Vercel sign-in.

17. [x] **[Rich]** The first staging deploy of both repos. `GET https://api-staging.3dwebdev.com/api/health` returns `{ "data": { "ok": true } }`. Seed the admin: `npm run seed -- --confirm-production`, run from the API service's Render Shell. (2026-10-27: the admin signed in on staging.)
18. [x] **[Rich + Claude]** The staging test, in a separate browser profile:
    - admin sign-in, create the site owner account with the Stevie The Dog website
    - site owner sign-in, a post with an uploaded image, an edit, archive and make active
    - sign-out ends the session, and a sixth sign-in attempt within 15 minutes gets the 429
    - client-website Tests A–C (`docs/client-website-test.md`), with Stevie's Vercel env pointed at staging for the test, then restored

    2026-10-27: everything passed; the 429 was checked after step 19's fix (it showed in the dashboard on the sixth attempt). Found on the way: staging's `CLOUDINARY_API_SECRET` was mistyped, and both Cloudinary keys needed the Master Admin role (step 7). Stevie's Tests A–C passed against staging: posts and the uploaded image render, a wrong webhook secret gets 401, and create, edit, archive and make active each show after one refresh. Stevie's `HEADLESS_CMS_*` variables were unset on Vercel before the test and are unset again.

19. [x] **[Rich + Claude]** The proxy hop count: the `ip` in a staging `audit_event` row is your real address, not Render's. On 2026-10-27 it was a Cloudflare address (Render runs Cloudflare in front of its load balancer), so `fix/trust-proxy` set `app.set('trust proxy', 2)`. To tick this step, check on staging after that deploy:
    - sign in; the newest `audit_event` row's `ip` is your real address (`psql "$DATABASE_URL" -c "SELECT action, ip, created_at FROM audit_event ORDER BY created_at DESC LIMIT 3;"` in the Render Shell)
    - a failed login with a faked `X-Forwarded-For: 203.0.113.9` still records your real address
    - then step 18's six sign-in attempts, the sixth getting the 429
    - if the `ip` is still Cloudflare's, there is a third proxy: the count goes to 3 on a branch

    Checked 2026-10-27 after PR #36: sign-in and sign-out recorded Rich's real address, and a failed login sent with `X-Forwarded-For: 203.0.113.9` was counted against the real address too (its rate limit header showed one attempt fewer left for that address).

20. [x] **[Frontend]** The header checks on staging (`docs/security.md` → Frontend), and `Cross-Origin-Opener-Policy: same-origin-allow-popups` added and Google sign-in re-tested. Done 2026-10-27 (frontend PR #32): the headers checked in DevTools while signed in to Vercel (the Content Security Policy from the Console, since the Network tab didn't list it), Google sign-in working as admin and site owner. The online scanners can't reach staging through Vercel's protection, so they moved to step 26.

### Phase 3: Production

21. [x] **[Claude]** `deploy/production`, with its own plan: the production environment in `render.yaml` (the API, its own Postgres 17, the `sweep-uploads` cron job daily and the `backup-database` cron job nightly) and the backup cron job's Dockerfile (Render services). Production deploys from a `production` branch, so staging is checked first (Environments → Releases). Done on `deploy/production`: `Dockerfile.backup` built locally with `pg_dump` 17.11 and dumped the local database inside the image, and `render.yaml` validated against Render's schema.
22. [ ] **[Rich]** Once it is merged:
    - create the `production` branch: `git push origin main:production`, and protect it on GitHub (no deletion, no force push), so it only ever moves forward to `main`
    - generate production's `JWT_SECRET` and `SECRET_ENCRYPTION_KEY` (commands in `.env.example`) into 1Password (3DWD Production) first
    - click Manual Sync on the Blueprint to create production's services, and enter the secrets per service (Environment variables): the API's seven, the sweep's three Cloudinary values, and the backup's four (`BACKUP_PUBLIC_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). Any the sync doesn't ask for are set on the service by hand.
    - check the review screen's price against Hosting and plans
    - watch that the push to `production` starts the deploys. Production uses `autoDeployTrigger: checksPass`, and CI runs only on `main`; GitHub keeps a commit's check results, so Render should see them. If nothing deploys, switch production's services to `autoDeployTrigger: commit` on a branch.
23. [ ] **[Rich]** Production's domains:
    - Render custom domain `api.3dwebdev.com` at Namecheap
    - Vercel: `3dwebdev.com`, with `www.3dwebdev.com` redirecting to it (the frontend must always be served from the one origin in `CORS_ORIGIN`), and the Production env vars pointing at `https://api.3dwebdev.com`
    - Google Cloud: `https://3dwebdev.com` in the OAuth client's authorized JavaScript origins
24. [ ] **[Rich]** The first production deploy. Check the health route, seed the admin, sign in, and check the `ip` in that sign-in's `audit_event` row is your real address (step 19).
25. [ ] **[Rich + Claude]** Backups: run `3dwd-backup-database` once by hand (Trigger Run in Render), confirm the encrypted dump is in R2, restore it into a throwaway local database with the private key and check the rows. `SECRET_ENCRYPTION_KEY`, `CLOUDINARY_API_SECRET` and the backup private key are in 1Password (3DWD Production).
26. [ ] **[Frontend]** The production header checks, including the securityheaders.com and Mozilla Observatory scans moved from step 20, and the HSTS preload decision (`docs/security.md` → Frontend).

### Phase 4: Stevie The Dog, the first onboarding

27. [ ] **[Rich]** Onboard Stevie The Dog by the flow in Onboarding a client website. The production database starts empty, so this is a new account and website: a new API key and webhook secret, and the folder `3dwd/steviethedog`. Its `remotePatterns` already allow that folder.
28. [ ] **[Rich]** Write "First Post!" again, with an uploaded image. Run client-website Tests A–C against production and check the audit log rows.

### Phase 5: After launch

29. [ ] **[Claude]** `docs/launch`: retire `docs/scaling.md` §0 (breaking changes now go through expand → migrate → contract) and the "until the first production deploy" lines in `CLAUDE.md`, add a production baseline beside the local one, and hand off so the frontend retires its own §0. In the master doc, mark the one-time sections as the record of the launch (the Runbook's build order, this checklist) and retire what no longer applies.
30. [ ] **[Rich + Claude]** Delete staging to save its cost: remove its environment from `render.yaml` on a branch, then delete its services and database in Render. Production stays on the `production` branch. Keeping staging (+$13.30/mo) was tabled on 2026-10-27, to be revisited once go-to-market is finished and more clients sign on, or existing clients sign on to the pricing tiers. Until then it is added back before the first breaking change (`docs/scaling.md` §8).
31. [ ] **[Rich]** Onboard the VIP clients one at a time.

## Restoring a backup

Used for the test restore (step 25) and in an incident (`docs/security.md` → Incident response). Needs `pg_restore` of the database's major version.

1. Download the dump from the R2 dashboard (`3dwd-backups` → `backups/`).
2. Save the private key from 1Password (3DWD Production) to a file outside the repo.
3. Create a new, empty database to restore into.
4. `npm run backup:restore -- --file <dump.enc> --key <private key .pem> --target <its URL>`. It refuses this environment's own `DATABASE_URL` and any database that already has tables. It decrypts to a temp file, checks it, runs `pg_restore`, then deletes the temp file.
5. Check the rows, then delete the private key file and the downloaded dump.

Restoring over production is never done by this script. If it is ever needed, it is a deliberate step written in the incident notes: restore into a new database, check it, then point `DATABASE_URL` at it.

## Every deploy after launch

1. A change merges to `main` through a PR with CI green (branch protection). Render deploys it to staging, running `npx prisma migrate deploy` before the new version takes traffic.
2. Check it on staging (while staging exists).
3. Before a migration that drops or rewrites data, take a backup by hand (run `3dwd-backup-database` in Render) and confirm it is in R2 (`docs/scaling.md` §8).
4. Release: `git push origin main:production`. Render deploys the API (migrations first) and rebuilds both cron jobs from the same commit. Vercel deploys the frontend.
5. A contract change releases the backend first, accepting both the old and the new shape, then the frontend (`docs/scaling.md` §4).
6. Before the first breaking change after launch, staging exists again and the change is deployed there first.
7. After Render announces a change to its network or load balancers, sign in and check the `ip` in the newest `audit_event` row is still your real address (step 19, `docs/security.md` → Rate limits).

## Onboarding a client website

The repeatable flow for each new client website. Stevie The Dog runs it first (checklist step 27).

1. In the production admin dashboard, create the site owner account with a new website (or link a new website to an existing account). Enter the URL the website is actually served on, with no redirect (`https://www.steviethedog.com` for Stevie): revalidation calls that exact URL, and a redirect drops its Authorization header. Copy the API key and webhook secret from the one-time reveal straight into 1Password (3DWD Clients), with the Vercel project that serves the website.
2. On the client website's Vercel project, set `HEADLESS_CMS_API_URL=https://api.3dwebdev.com`, `HEADLESS_CMS_API_KEY` and `HEADLESS_CMS_WEBHOOK_SECRET`, for Production only.
3. In the client website's `next.config`, the `remotePatterns` entries allow its own folder, `3dwd/<media_folder>` (`docs/setup.md` → Client websites). `media_folder` follows the rule in `docs/setup.md` → media_folder; confirm it with a query from the API's Render Shell (`psql "$DATABASE_URL" -c "SELECT media_folder FROM website"`), since a clash adds `-2`.
4. Redeploy the client website, then run Tests A–C (`docs/client-website-test.md`) against production.
5. The site owner signs in with their Google account and writes their first post.
