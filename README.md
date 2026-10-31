# Headless CMS — Backend

## About the Project

Headless CMS project. Two repos for frontend and backend.

The frontend serves a public, static landing page and sign-in for two separate authenticated dashboards. Two roles to account for, an Administrator and a Site Owner, each with their own dashboard view, auth and API routes. The Administrator uses the frontend to see a summary of site owner accounts and their websites, create new site owner accounts and link websites to them. The Site Owner uses the frontend to view, create, edit, archive and reactivate posts.

This backend stores everything in PostgreSQL, serves the dashboards through an authenticated API, serves published post content to each site owner's live website via that website's API key, and triggers on-demand revalidation on that site by calling its webhook endpoint whenever a post changes.

- Production API: `https://api.3dwebdev.com` (Render, defined in `render.yaml`)
- Production frontend: `https://3dwebdev.com` (Vercel)

## Install List

```
git clone <ssh_key>
nvm use          # Node 24, from .nvmrc (the version Render and CI run)
npm install
```

Installs:

- Express
- cors, helmet, cookie-parser, dotenv
- express-rate-limit
- google-auth-library
- jsonwebtoken
- zod
- Prisma / @prisma/client
- Prisma driver adapter (`@prisma/adapter-pg`, `pg`)
- No Cloudinary SDK: uploads are signed with Node's `crypto`, and the cleanup calls Cloudinary's Admin API with `fetch`
- Dev: Prettier, ESLint, Supertest (tests run on Node's built-in `node:test`)

```
cp .env.example .env
```

Set:

| Variable                | Local value                         | Production value         |
| ----------------------- | ----------------------------------- | ------------------------ |
| `PORT`                  | `4000`                              | set by Render            |
| `NODE_ENV`              | `development`                       | `production`             |
| `DATABASE_URL`          | docker-compose Postgres, port 5433  | Render Postgres URL      |
| `TEST_DATABASE_URL`     | `.../headless_cms_test`, port 5433  | not used                 |
| `GOOGLE_CLIENT_ID`      | same as the frontend's              | same                     |
| `JWT_SECRET`            | 32+ random characters               | same, never reused       |
| `SECRET_ENCRYPTION_KEY` | 32 random bytes, base64 (see below) | its own key — back it up |
| `CORS_ORIGIN`           | `http://localhost:3000`             | `https://3dwebdev.com`   |
| `COOKIE_DOMAIN`         | leave empty                         | `.3dwebdev.com`          |
| `SEED_ADMIN_EMAIL`      | the admin's Google email            | same                     |
| `CLOUDINARY_CLOUD_NAME` | 3DWD's Cloudinary cloud name        | same                     |
| `CLOUDINARY_API_KEY`    | Cloudinary → Settings → API Keys    | same                     |
| `CLOUDINARY_API_SECRET` | same place — never log or share it  | same — back it up        |
| `CLOUDINARY_FOLDER`     | `3dwd-dev`                          | `3dwd`                   |

Generate `SECRET_ENCRYPTION_KEY` (and a `JWT_SECRET`, which must be at least 32 characters) with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

If `SECRET_ENCRYPTION_KEY` is ever lost, every stored webhook secret becomes unreadable — store it somewhere safe. The server refuses to start with a missing variable or a weak secret (`lib/config.js`). Secrets, rotation and the pre-deploy checklist are in `docs/security.md`; hosting, environments and the deployment checklist are in `docs/deploy.md`.

```
docker compose up -d       # starts local Postgres
npx prisma migrate dev     # creates the tables
npm run seed               # seeds the administrator only
npm run dev                # starts the API on http://localhost:4000
npx prisma studio          # optional - browser GUI to inspect the database; handy right after seeding to confirm the admin row landed
```

Upload cleanup (deletes Cloudinary uploads more than 24 hours old that no post uses; only under `CLOUDINARY_FOLDER`):

```
npm run sweep:uploads
```

Database backups (`docs/deploy.md` → Render services and Restoring a backup; need `pg_dump` / `pg_restore` of the server's major version, Postgres 17 locally; in production the nightly job runs in Docker, `Dockerfile.backup`):

```
npm run backup:keygen -- --out <folder outside this repo>   # the backup key pair (once)
npm run backup:database                                     # encrypted dump uploaded to R2
npm run backup:restore -- --file <dump.enc> --key <private key .pem> --target <empty database URL>
```

Homebrew installs `postgresql@17` beside an existing Postgres without putting it on `PATH`, so put it first for these commands, for example `PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH npm run backup:database`.

Tests:

```
npm test                   # creates/migrates the test database, then runs the whole suite once
npm run test:watch         # re-runs tests as files change
```

The suite needs the docker-compose Postgres running. It uses its own database (`TEST_DATABASE_URL`, whose name must end in `_test`) and empties it before every test, so your dev data is never touched. Test files sit next to the code they test (`*.test.js`); shared test support is in `testing/`.

Before committing:

```
npm run format             # Prettier
npm run lint               # ESLint
npm audit --omit=dev       # no high or critical advisories
npm test                   # test suite
```

CI (`.github/workflows/ci.yml`) runs the same checks on every pull request and every push to `main` or `production`.

Health check: `GET http://localhost:4000/api/health` → `{ "data": { "ok": true } }`.

When testing in Postman, every POST/PATCH/DELETE needs the header `X-CSRF-Protection: 1`.

## Releasing

Staging deploys every merge to `main` (`https://api-staging.3dwebdev.com`). Production deploys from the `production` branch, so a change reaches it only when released, once staging looks right:

```
npm run release -- --dry-run   # shows what would be released, pushes nothing
npm run release                # backend to Render, then the frontend to Vercel
```

It needs the frontend repo (`3d_wd`) beside this one, or `FRONTEND_DIR` set, and `gh` signed in. It pushes the backend's `main` to `production`, waits until Render reports the API live (CI, migrations, then the deploy, which also rebuilds both cron jobs), then pushes the frontend's `main` to its `production` branch, and tags each repo that went live (`release-YYYY-MM-DD`, `CLAUDE.md` → Releases). The full flow, including the backup before a destructive migration, is in `docs/deploy.md` → Every deploy after launch.
