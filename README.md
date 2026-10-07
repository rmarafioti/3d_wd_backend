# Headless CMS — Backend

## About the Project

Headless CMS project. Two repos for frontend and backend.

The frontend serves a public, static landing page and sign-in for two separate authenticated dashboards. Two roles to account for, an Administrator and a Site Owner, each with their own dashboard view, auth and API routes. The Administrator uses the frontend to see a summary of site owner accounts and their websites, create new site owner accounts and link websites to them. The Site Owner uses the frontend to view, create, edit, archive and reactivate posts.

This backend stores everything in PostgreSQL, serves the dashboards through an authenticated API, serves published post content to each site owner's live website via that website's API key, and triggers on-demand revalidation on that site by calling its webhook endpoint whenever a post changes.

- Production API: `https://api.3dwebdev.com` (Railway)
- Production frontend: `https://3dwebdev.com` (Vercel)

## Install List

```
git clone <ssh_key>
npm install
```

Installs:

- Express
- cors, helmet, cookie-parser, dotenv
- google-auth-library
- jsonwebtoken
- zod
- Prisma / @prisma/client
- Prisma driver adapter (`@prisma/adapter-pg`, `pg`)
- Dev: Prettier, ESLint

```
cp .env.example .env
```

Set:

| Variable                | Local value                         | Production value         |
| ----------------------- | ----------------------------------- | ------------------------ |
| `PORT`                  | `4000`                              | set by Railway           |
| `NODE_ENV`              | `development`                       | `production`             |
| `DATABASE_URL`          | docker-compose Postgres, port 5433  | Railway Postgres URL     |
| `GOOGLE_CLIENT_ID`      | same as the frontend's              | same                     |
| `JWT_SECRET`            | any long random string              | long random string       |
| `SECRET_ENCRYPTION_KEY` | 32 random bytes, base64 (see below) | its own key — back it up |
| `CORS_ORIGIN`           | `http://localhost:3000`             | `https://3dwebdev.com`   |
| `COOKIE_DOMAIN`         | leave empty                         | `.3dwebdev.com`          |
| `SEED_ADMIN_EMAIL`      | the admin's Google email            | same                     |

Generate `SECRET_ENCRYPTION_KEY` (and a `JWT_SECRET`) with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

If `SECRET_ENCRYPTION_KEY` is ever lost, every stored webhook secret becomes unreadable — store it somewhere safe.

```
docker compose up -d       # starts local Postgres
npx prisma migrate dev     # creates the tables
npm run seed               # seeds the administrator only
npm run dev                # starts the API on http://localhost:4000
npx prisma studio          # optional - browser GUI to inspect the database; handy right after seeding to confirm the admin row landed
```

Before committing:

```
npm run format             # Prettier
npm run lint               # ESLint
```

Health check: `GET http://localhost:4000/api/health` → `{ "data": { "ok": true } }`.

When testing in Postman, every POST/PATCH/DELETE needs the header `X-CSRF-Protection: 1`.
