# Launch Record

The checklist the first production deploy followed, staging first, from the docs to Stevie The Dog's onboarding (launched 2026-10-28), moved here word for word from `docs/deploy.md` (issue #73). Not imported into `CLAUDE.md`: it is the record of the launch, cited by step number. Steps 30 and 31 are still open; Current progress → Next in `CLAUDE.md` tracks them.

The first deploy, start to finish, in order. **[Rich]** is done outside the codebase, **[Claude]** is a branch in this repo, **[Frontend]** is a branch in the frontend repo (`3d_wd`). Tick each step when done. After launch this list stays as the record.

## Phase 0: Docs

1. [x] **[Claude]** `docs/deploy`: this file and the decisions behind it.
2. [x] **[Frontend]** The frontend's `docs/deploy.md` (handoff): the Vercel Pro team, domains and env vars, preview protection, the staging branch, the header checks.
3. [x] **[Claude]** The master doc's Deployment tab: a Frontend and a Backend section, each copied from that repo's `docs/deploy.md`.
4. [x] **[Claude]** The Documentation Sync (`CLAUDE.md`), which runs before any production deploy.

## Phase 1: Before anything is hosted

5. [x] **[Rich]** Vercel: upgrade to a Pro team and move every client website project (Stevie The Dog today) into it. Update Vercel's row in the Access table (`docs/security.md`). The frontend wasn't on Vercel yet; it was imported into the Pro team at step 16.
6. [x] **[Rich]** Branch protection on `main` in both repos: changes only through a PR, CI's `check` must pass (2026-10-23).
7. [x] **[Rich]** Cloudinary: generate two new key pairs, one for production and one for local dev and staging. Put the dev pair in the local `.env` and 1Password (3DWD Dev), keep the production pair for step 22, then delete the pair that was shared in a Claude session. Each key needs Cloudinary's **Master Admin** role: the other roles (Media Library user, Reports, User) can't upload, list and delete through the API, and a Media Library user key fails uploads with "Request forbidden due to missing permissions" (found at step 18, `docs/security.md` → Secrets).
8. [x] **[Rich]** Cloudflare: an account with 2FA (add it to the Access table), a private R2 bucket `3dwd-backups`, a lifecycle rule deleting objects after 30 days, and an R2 API token scoped to that bucket (object read and write), saved in 1Password (3DWD Production). Cloudflare may ask for a card even on the free tier. Then a bucket lock rule on the whole bucket, retaining objects 30 days, so a leaked token can't delete or overwrite a backup (added on `feat/database-backup`).
9. [x] **[Claude]** `feat/database-backup`, with its own plan: the backup and restore scripts, the Backups row in `docs/security.md` → Controls in place, the encryption in `lib/crypto.js` (a random AES-256-GCM key per dump, wrapped with the RSA public key), a key pair generator, the new env vars (`docs/scaling.md` §8) and tests. Tested against a local dump and the real bucket.
10. [x] **[Rich]** Generate the backup key pair. The private key goes into 1Password (3DWD Production) only; the public key goes to Render in step 22.

## Phase 2: Staging

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

## Phase 3: Production

21. [x] **[Claude]** `deploy/production`, with its own plan: the production environment in `render.yaml` (the API, its own Postgres 17, the `sweep-uploads` cron job daily and the `backup-database` cron job nightly) and the backup cron job's Dockerfile (Render services). Production deploys from a `production` branch, so staging is checked first (Environments → Releases). Done on `deploy/production`: `Dockerfile.backup` built locally with `pg_dump` 17.11 and dumped the local database inside the image, and `render.yaml` validated against Render's schema.
22. [x] **[Rich]** Once it is merged, in this order:
    - create the `production` branch: `git push origin main:production`, and protect it on GitHub ("Allow force pushes" and "Allow deletions" left off), so it only ever moves forward to `main`. No pull request or status check rule: a release is a push, and CI runs after it. A PR rule would make every release an admin bypass (`docs/security.md` → Accepted risks), so it was removed on 2026-10-29, and the frontend's `production` gained the same rule. Push it before the Manual Sync: a sync without it fails with "branch production could not be found".
    - generate production's `JWT_SECRET` and `SECRET_ENCRYPTION_KEY` (commands in `.env.example`) into 1Password (3DWD Production)
    - click Manual Sync on the Blueprint to create production's services, and enter the secrets per service (Environment variables): the API's seven, the sweep's three Cloudinary values, and the backup's four (`BACKUP_PUBLIC_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). Any the sync doesn't ask for are set on the service by hand, before the first deploy: a deploy without them fails the config check.
    - check the review screen's price against Hosting and plans
    - watch that the push to `production` starts the deploys. Production uses `autoDeployTrigger: checksPass`, and CI runs only on `main`; GitHub keeps a commit's check results, so Render should see them. If nothing deploys, switch production's services to `autoDeployTrigger: commit` on a branch.

    Done 2026-10-27. The first sync ran before the branch existed and the first API deploy before its secrets were entered, so both failed; with the secrets in, a Manual Deploy went live. On the first release (2026-10-29) the push didn't deploy either: Render waits for a CI run on `production` itself. So CI now also runs on pushes to `production` (`chore/streamline-release`), and `checksPass` stays.

23. [x] **[Rich]** Production's domains:
    - Render custom domain `api.3dwebdev.com` at Namecheap
    - Vercel: `3dwebdev.com`, with `www.3dwebdev.com` redirecting to it (the frontend must always be served from the one origin in `CORS_ORIGIN`), and the Production env vars pointing at `https://api.3dwebdev.com`
    - Google Cloud: `https://3dwebdev.com` in the OAuth client's authorized JavaScript origins

    Done 2026-10-27. Vercel first made `www` the primary domain and redirected the apex to it; it was flipped so `3dwebdev.com` serves production and `www` redirects to it (308). The frontend's `NEXT_PUBLIC_*` variables existed only for Preview (staging), so Google sign-in failed with "Missing required parameter: client_id" until they were added for Production and the frontend redeployed.

24. [x] **[Rich]** The first production deploy. Check the health route, seed the admin, sign in, and check the `ip` in that sign-in's `audit_event` row is your real address (step 19). Done 2026-10-27: the `ip` was Rich's real address, so `trust proxy` 2 holds in production too.
25. [x] **[Rich + Claude]** Backups: run `3dwd-backup-database` once by hand (Trigger Run in Render), confirm the encrypted dump is in R2, restore it into a throwaway local database with the private key and check the rows. `SECRET_ENCRYPTION_KEY`, `CLOUDINARY_API_SECRET` and the backup private key are in 1Password (3DWD Production). Done 2026-10-27: `backups/2026-10-28T00-15-48-612Z.dump.enc` (19,410 bytes) restored with `pg_restore` 17 into a throwaway database, matching production (1 admin, 1 audit row, 8 migrations). The throwaway database, the key file and the dump were then deleted.
26. [x] **[Frontend]** The production header checks, including the securityheaders.com and Mozilla Observatory scans moved from step 20, and the HSTS preload decision (`docs/security.md` → Frontend). Done 2026-10-27 (frontend PR #33).

## Phase 4: Stevie The Dog, the first onboarding

27. [x] **[Rich]** Onboard Stevie The Dog by the flow in Onboarding a client website. The production database starts empty, so this is a new account and website: a new API key and webhook secret, and the folder `3dwd/steviethedog`. Its `remotePatterns` already allow that folder. Done 2026-10-28: `media_folder` is `steviethedog`, the credentials are in 1Password (3DWD Clients), and Stevie's Vercel Production variables point at `https://api.3dwebdev.com`.
28. [x] **[Rich]** Write a first post with an uploaded image. Run client-website Tests A–C against production and check the audit log rows. Done 2026-10-28: a post with an image was created, archived, made active, then edited (image removed, formatted paragraphs added), and each change showed on the live site after one refresh. A wrong webhook secret gets `401`. The audit log holds every sign-in, sign-out and change, each with Rich's real `ip`.

## Phase 5: After launch

29. [x] **[Claude]** `docs/launch`: retire `docs/scaling.md` §0 (breaking changes now go through expand → migrate → contract) and the "until the first production deploy" lines in `CLAUDE.md`, add a production baseline beside the local one, and hand off so the frontend retires its own §0. In the master doc, mark the one-time sections as the record of the launch (the Runbook's build order, this checklist) and retire what no longer applies. Done 2026-10-28: the repo side on `docs/launch` (both repos), then the master doc on `docs/master-doc-sync`, a full Documentation Sync that re-copied every copy tab from both repos' `main`.
30. [ ] **[Rich + Claude]** Reassess staging. It is kept for now (Rich, 2026-10-28), at $13.30/mo, until its cost can be justified: once go-to-market is finished and more clients sign on, or existing clients sign on to the pricing tiers. If it is deleted: remove its environment from `render.yaml` on a branch, then delete its services and database in Render. Production stays on the `production` branch either way, and a deleted staging is added back before the first breaking change (`docs/scaling.md` §8).
31. [ ] **[Rich]** Onboard the VIP clients one at a time.
