# Deploy

How the backend is hosted, how every deploy since launch runs, and how a client website is onboarded. The checklist the first production deploy followed is the record in `docs/launch-record.md`. Read on demand (`CLAUDE.md` → Read before). The frontend keeps its own `docs/deploy.md`.

`docs/security.md` holds the controls, secrets and access this file relies on; `docs/scaling.md` holds the rules for changing the system once it is live.

## Hosting and plans

| Service       | Plan                                 | Holds                                                     | Move to a paid plan when                                          |
| ------------- | ------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------- |
| Render        | Hobby workspace, $0/mo, plus compute | The API, Postgres, the cron jobs (staging and production) | A second team member, or a Pro-only feature is needed ($25/mo)    |
| Vercel        | Pro, $20/mo                          | The frontend and every client website                     | Already paid (below)                                              |
| Cloudinary    | Free                                 | Site owners' images                                       | The free tier's 25 credits a month run out (`docs/scaling.md` §6) |
| Cloudflare R2 | Free (10 GB)                         | Encrypted nightly database backups                        | Backups outgrow 10 GB                                             |

- **Vercel is Pro from launch.** Vercel's fair use rules allow Hobby for non-commercial personal use only, and "commercial" includes being paid to host a site. Client websites pay a hosting fee, so the frontend and every client website live in a Vercel Pro team.
- **Render compute, per environment:** a Starter web service (`0.5c-512mb`, about $7/mo) and the smallest paid Postgres (`0.1c-256mb`, about $6/mo plus storage). Production adds three cron jobs, billed by the minute with a $1/mo minimum each; the scheduled publish job runs about 2,900 times a month, each run a few seconds, so check its bill against the minimum after its first month. Render prices staging at $13.30/mo: the web service $7, Postgres $6 and its 1 GB disk $0.30. Production is the same plus the three cron jobs, about $16.30/mo. About $29.60/mo while staging and production both run, and about $16.30/mo if staging is deleted. Staging is kept for now and reassessed once its cost can be justified (`CLAUDE.md` → Current progress → Next).
- **No free Postgres:** Render's free databases expire after 30 days and have no backups, so both environments use the smallest paid plan.
- **Database backups:** a paid Render Postgres has point-in-time recovery for the past 3 days on the Hobby workspace (7 on Pro), plus logical exports kept 7 days. The backend also makes its own, kept 30 days outside Render: `backup-database` (Render services). `docs/security.md` → Accepted risks.
- **Hobby includes 2 custom domains:** `api.3dwebdev.com` and `api-staging.3dwebdev.com`.

## Environments

|                     | Local                                               | Staging                                                   | Production                                                             |
| ------------------- | --------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| Frontend            | `http://localhost:3000`                             | `https://staging.3dwebdev.com`                            | `https://3dwebdev.com`                                                 |
| API                 | `http://localhost:4000`                             | `https://api-staging.3dwebdev.com`                        | `https://api.3dwebdev.com`                                             |
| Database            | docker-compose Postgres 17                          | its own Render Postgres 17                                | its own Render Postgres 17                                             |
| `CLOUDINARY_FOLDER` | `3dwd-dev`                                          | `3dwd-dev`                                                | `3dwd`                                                                 |
| Cloudinary key pair | the dev pair                                        | the dev pair                                              | the production pair                                                    |
| Cron jobs           | none (`sweep:uploads`, `publish:scheduled` by hand) | none (`publish:scheduled` by hand, from the Render Shell) | `3dwd-sweep-uploads`, `3dwd-backup-database`, `3dwd-publish-scheduled` |

- **Staging is a rehearsal of production,** set up and tested first (`docs/launch-record.md`, Phase 2). Production is then added to `render.yaml` beside it, with its own database and secrets (Phase 3).
- **Releases:** staging deploys every merge to `main`, in both repos (the frontend's `staging.3dwebdev.com` follows its `main` branch). Production deploys only from each repo's `production` branch, which receives `main` when `npm run release` runs (`scripts/release.js`, Every deploy after launch): the backend first, then the frontend once Render reports the backend live. So a change runs on staging before it reaches production. If staging is ever deleted, the release is still the deliberate step.
- **The `production` branches** are protected in both repos, refusing force pushes and deletions, so each only moves forward to `main`. They have no pull request or status check rule: a release is a push and CI runs after it, so such a rule would make every release an admin bypass (`docs/security.md` → Accepted risks).
- **One frontend origin per environment:** the frontend is served only from the origin in `CORS_ORIGIN` (`www.3dwebdev.com` redirects to `3dwebdev.com`), and each frontend origin is in the Google OAuth client's authorized JavaScript origins, or Google sign-in fails there.
- **Staging shares `3dwd-dev` with local,** so client websites need no extra `remotePatterns` entry to show staging images. Staging runs no cron jobs: no sweep, and no scheduled publish, so a scheduled draft on staging is published by running `npm run publish:scheduled` from the staging API's Render Shell. A local `npm run sweep:uploads` deletes staging uploads more than 24 hours old, which is fine: staging data is throwaway.
- **Staging and production share the cookie** (`session`, `Domain=.3dwebdev.com`), so a browser signed into both would send both cookies to both. Staging is always tested in a **separate browser profile**.

## Environment variables

Every variable the backend reads, per deployed environment. The values that aren't secret are written in `render.yaml`. Secrets and ids are `sync: false` there: Render asks for each one once, when its service is created (if it doesn't, it is set on the service by hand), and they are copied straight from 1Password (3DWD Production), never through a chat, an issue or a commit (`docs/security.md` → Secrets). A secret added after creation is set on the service by hand, since later syncs never ask.

Production's four services each read only their own variables (`render.yaml`): the API reads all but the backup ones; `3dwd-sweep-uploads` reads `NODE_ENV`, `DATABASE_URL` and the four `CLOUDINARY_*`; `3dwd-backup-database` reads `DATABASE_URL`, `BACKUP_PUBLIC_KEY` and the four `R2_*`; `3dwd-publish-scheduled` reads `NODE_ENV`, `DATABASE_URL` and `SECRET_ENCRYPTION_KEY` (the API's value, to decrypt webhook secrets for revalidation). All four also read `SENTRY_DSN`, entered on each; only the API reads `RESEND_API_KEY`. Render's environment groups can't hold `sync: false` values, so the Cloudinary pair is entered on both the API and the sweep.

| Variable                | Staging                                 | Production                                                    |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------- |
| `PORT`                  | set by Render                           | set by Render                                                 |
| `NODE_ENV`              | `production`                            | `production`                                                  |
| `DATABASE_URL`          | from staging's Postgres (`render.yaml`) | from production's Postgres (`render.yaml`)                    |
| `GOOGLE_CLIENT_ID`      | the OAuth client ID                     | the OAuth client ID                                           |
| `JWT_SECRET`            | its own, freshly generated              | its own, freshly generated                                    |
| `SECRET_ENCRYPTION_KEY` | its own, freshly generated              | its own, freshly generated, backed up                         |
| `CORS_ORIGIN`           | `https://staging.3dwebdev.com`          | `https://3dwebdev.com`                                        |
| `COOKIE_DOMAIN`         | `.3dwebdev.com`                         | `.3dwebdev.com`                                               |
| `CLOUDINARY_CLOUD_NAME` | 3DWD's cloud name                       | 3DWD's cloud name                                             |
| `CLOUDINARY_API_KEY`    | the dev pair                            | the production pair                                           |
| `CLOUDINARY_API_SECRET` | the dev pair                            | the production pair, backed up                                |
| `CLOUDINARY_FOLDER`     | `3dwd-dev`                              | `3dwd`                                                        |
| `SEED_ADMIN_EMAIL`      | the admin's Google email                | the admin's Google email                                      |
| `BACKUP_PUBLIC_KEY`     | not set                                 | the backup public key (`npm run backup:keygen`, not a secret) |
| `R2_ACCOUNT_ID`         | not set                                 | the Cloudflare account id                                     |
| `R2_ACCESS_KEY_ID`      | not set                                 | the R2 token's access key id                                  |
| `R2_SECRET_ACCESS_KEY`  | not set                                 | the R2 token's secret                                         |
| `R2_BUCKET`             | not set                                 | `3dwd-backups`                                                |
| `SENTRY_DSN`            | not set (Sentry off)                    | the Sentry project's DSN, on all four services                |
| `RESEND_API_KEY`        | not set (request emails off)            | Resend's sending-only key, on the API only (Email)            |

Render also sets two variables itself, never entered by hand: `RENDER_GIT_COMMIT`, the deployed commit, which `lib/sentry.js` sends as the Sentry release, and `RENDER_SERVICE_NAME`, which `npm run sentry:check` (`scripts/sentryCheck.js`) names in its test error.

`NODE_ENV=production` on staging makes `lib/config.js` check it like production: https `CORS_ORIGIN` and a cookie domain. Each environment's `JWT_SECRET` and `SECRET_ENCRYPTION_KEY` is its own; none is reused from local or the other environment.

## Render services

One Render project, `3dwd`, in the 3D Web Dev workspace, with a `staging` and a `production` environment. Everything in it is defined in `render.yaml` at the repo root (a Render Blueprint): Render creates the services from it, so the configuration is reviewed in PRs like code. The Blueprint uses **Manual Sync**: after a merge that changes `render.yaml`, click Manual Sync in Render to apply it. Code deploys and the pre-deploy migration don't wait for it: staging's run on every merge to `main`, production's on every push to `production`. Every service runs in the `virginia` region, next to Vercel's default functions region. The Node version comes from `.nvmrc` (24), the same file CI reads.

- **API** (`3dwd-api-staging` and `3dwd-api-production`): a Starter web service. Staging deploys from `main`, production from `production`, each once CI's check has passed on that branch (`autoDeployTrigger: checksPass`). CI runs on pushes to `main` and `production` for this reason: a commit that has passed only on `main` doesn't start the production deploy. Besides its custom domain, staging's is also served at `https://threedwd-api-staging.onrender.com` (Render prefixes `threedwd-`, since a hostname can't start with a digit).
  - Build: `npm ci --include=dev`. `NODE_ENV=production` is set at build time too, which makes npm omit devDependencies, and the Prisma CLI is one.
  - Pre-deploy: `npx prisma migrate deploy`, run once per deploy before the new version takes traffic (`docs/scaling.md` §7). If it fails, the deploy fails and the previous version keeps running.
  - Start: `npm start`. Health check: `GET /api/health`, which gates the switch to the new version (zero-downtime deploys).
- **Postgres** (`3dwd-db-staging` and `3dwd-db-production`): Postgres 17, the smallest paid plan, reachable only from inside Render (`ipAllowList: []`). The API and the Render Shell reach it on the private network; nothing on the internet can, so Prisma Studio from a laptop can't either.
- **`3dwd-sweep-uploads`** (production only): a Node cron job running `npm run sweep:uploads` daily at 09:00 UTC (`docs/setup.md` → Upload cleanup). Built like the API (`npm ci --include=dev`), since the sweep reads image rows through the Prisma client.
- **`3dwd-publish-scheduled`** (production only): a Node cron job running `npm run publish:scheduled` every 15 minutes (`docs/setup.md` → Scheduled publish). Built like the sweep. It publishes the drafts whose go-live date has passed and revalidates their websites; a run with nothing due ends in a few seconds.
- **`3dwd-backup-database`** (production only): a cron job running `npm run backup:database` nightly at 08:00 UTC, an hour before the sweep (`services/backupDatabase.js`). It dumps the production database with `pg_dump` (custom format, no owner or privileges), encrypts the dump with the backup public key (`docs/setup.md` → Crypto Module), and uploads it to the private R2 bucket `3dwd-backups` as `backups/<timestamp>.dump.enc`. A bucket lock keeps each dump from being deleted or overwritten for 30 days, then a lifecycle rule deletes it. Only the public key is in Render, so a leak there can't read a backup. The private key lives only in 1Password (3DWD Production). It needs a `pg_dump` of the database's major version (17), and Render's native Node runtime only has `postgresql-client` 12 to 14, so this cron job runs in Docker: `Dockerfile.backup`, Node 24 on Debian 13 (trixie), which ships `postgresql-client-17`. The image holds `lib/`, `services/`, `scripts/` and the runtime packages from a plain `npm ci --omit=dev` (checked against `package-lock.json`); `.dockerignore` keeps `.env` and the local `node_modules` out of the build. A failed run exits 1, so Render shows it.

Cron schedules are in UTC.

A new cron job can fail its first run: Render creates it from `render.yaml` and may run it on the build `production` already had, before the release that adds its script is live (its auto-deploy waits for CI). If the first run fails that way, check the job's Events for the new commit's deploy, then Trigger Run; the next scheduled run passes on its own.

### Alerts

A production failure reaches Rich by email (`docs/security.md` → Controls in place):

- **Render:** failure notifications on `3dwd-api-production` deploys and on the three cron jobs. None for staging, whose failures are the safety net working.
- **Uptime monitor (UptimeRobot):** checks `https://api.3dwebdev.com/api/health` every few minutes, outside Render. Render's health check only gates a deploy; it doesn't watch the live API. It also checks each live client website's home page (Onboarding a client website, step 6), since Vercel emails a failed deployment but doesn't watch a live site.
- **Sentry:** production only (`SENTRY_DSN` on the four services; empty on staging and locally, so nothing is sent). The API reports unexpected 500s and uncaught errors, and the three cron jobs report a failed run (`lib/sentry.js`). A failed revalidation call is a warning, one Sentry issue per website: the client website is usually up but set up wrong (a webhook secret that doesn't match, a missing `/api/revalidate` route, a redirect), so its site owner's changes silently never appear. Its "new issue" alert emails the admin. After `SENTRY_DSN` is first set, run `npm run sentry:check` once from the API's Render Shell and find the test event in Sentry, with no request data in it.

### Email

The admin's request emails (`docs/endpoints.md` → Request Emails) go out through Resend from `notifications@3dwebdev.com`, production only. `3dwebdev.com` receives no mail: Resend's records sit on `send`, `rsend` and `resend._domainkey`, so they don't touch the apex. One-time setup, Rich:

1. A Resend account with 2FA, and its row in `docs/security.md` → Access.
2. Resend → Domains → add `3dwebdev.com`. At Namecheap → Advanced DNS → Host Records (no Mail Settings change, no MX), add the records its Records tab shows exactly as given: a TXT at `resend._domainkey` (DKIM), and for SPF two CNAMEs, `send` → `send.forge.rmta.net` and `rsend` → `rsend.forge.rmta.net`. Hosts are entered without `.3dwebdev.com`. Then a DMARC TXT at `_dmarc`: `v=DMARC1; p=none;` to start, tightened to `p=quarantine` once a few weeks of mail pass. Turn on Enable Sending and wait until Resend shows the domain Verified (usually minutes, up to 72 hours).
3. Resend → API Keys → a key with **Sending access** only, limited to `3dwebdev.com`. Save it in 1Password (3DWD Production).
4. After the merge, click Manual Sync (the new `RESEND_API_KEY` entry) and enter the key on `3dwd-api-production`, then release.
5. Check on production: send or edit a request message on a website you own as a site owner, and the email arrives at the admin's address with Reply-To set to that site owner.

## Restoring a backup

Used for the test restore at launch (`docs/launch-record.md` step 25), the quarterly restore drill (recorded in `docs/security.md` → Restore drills) and in an incident (`docs/security.md` → Incident response). Needs `pg_restore` of the database's major version.

1. Download the dump from the R2 dashboard (`3dwd-backups` → `backups/`).
2. Save the private key from 1Password (3DWD Production) to a file outside the repo.
3. Create a new, empty database to restore into.
4. `npm run backup:restore -- --file <dump.enc> --key <private key .pem> --target <its URL>`. It refuses this environment's own `DATABASE_URL` and any database that already has tables. It decrypts to a temp file, checks it, runs `pg_restore`, then deletes the temp file.
5. Check the rows, then delete the private key file and the downloaded dump.

Restoring over production is never done by this script. If it is ever needed, it is a deliberate step written in the incident notes: restore into a new database, check it, then point `DATABASE_URL` at it.

## Every deploy after launch

1. **Merge.** Each PR merges to `main` with CI green (branch protection). Both staging sites deploy by themselves: Render runs `npx prisma migrate deploy`, then the new backend takes traffic; Vercel builds the frontend's `main` at `staging.3dwebdev.com`.
2. **Check staging,** in a separate browser profile (Environments).
3. **Release:** `npm run release` in this repo (`npm run release -- --dry-run` shows what it would do). It releases each repo's `origin/main`, never the local working tree:
   - stops unless the backend's `main` commit is already live on staging;
   - lists any new migrations and asks before going on. Before a migration that drops or rewrites data, take a backup first: Trigger Run on `3dwd-backup-database`, and confirm the dump is in R2 (`docs/scaling.md` §8);
   - pushes the backend's `main` to `production`. CI runs on it, then Render deploys the API (migrations first) and rebuilds the three cron jobs from the same commit. It waits until Render reports the API live, up to 20 minutes;
   - then pushes the frontend's `main` to its `production` branch and waits for Vercel;
   - then tags each repo that went live with the run's release tag (`docs/process.md` → Releases), even after a stop, so a backend that went live before the frontend failed is still tagged. A repo with nothing new is skipped and not tagged.

   If CI or the Render deploy fails, it stops before the frontend, and production keeps the previous version. Backend first is what a contract change needs: the backend accepts both the old and the new shape before the frontend uses the new one (`docs/scaling.md` §4).

4. **Check production.**

If staging has been deleted, it is added back before the first breaking change, and the change is deployed there first. After Render announces a change to its network or load balancers, sign in and check the `ip` in the newest `audit_event` row is still your real address (step 19, `docs/security.md` → Rate limits).

## Rolling back

For a release that broke production. A rollback puts back earlier code; it never undoes a migration (`docs/scaling.md` §8). A dependency that needs replacing isn't a rollback: it is fixed forward on a branch like any change.

1. **Find the pair that was live before.** The release tags record it: `git tag -n99 --list 'release-*'` in either repo, or GitHub's Tags page. Each tag message names the other repo's live release and the backend's migrations.
2. **Roll back only the repo that broke**, where possible. The frontend can always roll back alone: expand → migrate → contract keeps the backend accepting what the previous frontend sends. The backend can roll back only to a release at or after its newest migration, since older code may read a column that no longer exists; past one, fix forward instead.
3. **Roll back in the dashboards.** Render: `3dwd-api-production` → Events → the earlier deploy → Rollback. Vercel: the frontend project → Deployments → the earlier production deployment → Instant Rollback. The cron jobs follow their own last deploy; roll them back too if the bad release changed them.
4. **Fix forward on `main`.** The `production` branches stay where they are (force pushes are blocked). The fix goes through a PR and the next `npm run release`, which deploys `main` again and tags it.
5. **Record it** in the incident notes if it was an incident (`docs/security.md` → Incident response).

## Onboarding a client website

The repeatable flow for each new client website. Stevie The Dog ran it first (`docs/launch-record.md` step 27).

1. In the production admin dashboard, create the site owner account with a new website (or link a new website to an existing account). Enter the URL the website is actually served on, with no redirect (`https://www.steviethedog.com` for Stevie): revalidation calls that exact URL, and a redirect drops its Authorization header. Copy the API key and webhook secret from the one-time reveal straight into 1Password (3DWD Clients), with the Vercel project that serves the website.
2. On the client website's Vercel project, set `HEADLESS_CMS_API_URL=https://api.3dwebdev.com`, `HEADLESS_CMS_API_KEY` and `HEADLESS_CMS_WEBHOOK_SECRET`, for Production only.
3. In the client website's `next.config`, the `remotePatterns` entries allow its own folder, `3dwd/<media_folder>` (`docs/setup.md` → Client websites). `media_folder` follows the rule in `docs/setup.md` → media_folder; confirm it with a query from the API's Render Shell (`psql "$DATABASE_URL" -c "SELECT media_folder FROM website"`), since a clash adds `-2`.
4. Give the client repo the client guide, `client-kit`'s `docs/cms/`, kept in step by its Sync workflow (`client-kit`'s README):
   1. Install the `3dwd-sync` GitHub App on the repo: GitHub → Settings → Developer settings → GitHub Apps → `3dwd-sync` → Install App → the repo's owner → Only select repositories, and add it.
   2. Add the repo to `client-kit`'s `clients.json` with `autoMerge: false`, through a `client-kit` PR. Once merged, run Actions → Sync → Run workflow with dry run unticked: it opens a sync PR adding `docs/cms/`, which Rich merges by hand.
   3. In the client repo, on a branch: `docs/site.md` (the site's name, pages, design, quirks, `media_folder`, static folder, and which ability docs in `docs/cms/` it reads), `CLAUDE.md` importing `@docs/cms/client-website.md` and `@docs/site.md`, `docs/cms/` in `.prettierignore` (so formatting never changes a byte), and `.github/workflows/ci.yml` copied from `client-kit`'s `templates/ci.yml`.
   4. Settings → General → Pull Requests: tick Allow auto-merge and Automatically delete head branches. Settings → Rules → New branch ruleset on `main`, requiring the `cms` and `check` status checks.
   5. On the client's Vercel project, Settings → Build and Deployment → Ignored Build Step → Custom: `git diff --quiet HEAD^ HEAD -- . ':(exclude)docs'`, so a docs-only merge doesn't redeploy.
   6. Set the repo's `autoMerge` to `true` in `clients.json`, through a `client-kit` PR. From then on its sync PRs merge on green CI.
5. Redeploy the client website, then run Tests A–C (`docs/client-website-test.md`) against production.
6. Add the website's home page to the uptime monitor (Alerts), so Rich hears when it is down.
7. The site owner signs in with their Google account and writes their first post.
