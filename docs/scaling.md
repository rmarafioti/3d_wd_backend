# Scaling

Rules for changing the system after the MVP is deployed: how to add to the schema, the API and the flows without breaking production data, the frontend or client websites. Imported from `CLAUDE.md` via `@docs/scaling.md`. `docs/endpoints.md` and `docs/setup.md` say what the system is; this file says how it is allowed to change.

## Who depends on what

Every change is judged against the three consumers of this backend. They deploy at different times, so at any moment one of them may be running older code than the backend.

| Consumer            | Uses                                                    | Deploys                              | Updated in lockstep?                                     |
| ------------------- | ------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| Frontend (Vercel)   | Every `/api/auth`, `/api/admin`, `/api/siteOwner` route | Separately from the backend          | Yes, but never at the exact same second                  |
| Client websites     | `GET /api/public/posts`, the revalidation webhook       | By each website, on its own schedule | **No** — treat as a public API                           |
| Production database | Every model                                             | Migrated on backend deploy           | Data is permanent; mistakes are not undone by a redeploy |

## 1. Classify the change first

Before planning, state which kind of change it is. The kind decides the process.

- **Additive (safe):** a new table, a new nullable or defaulted column, a new endpoint, a new optional request field, a new field in a response. Old clients keep working without knowing about it.
- **Breaking:** removing or renaming a field, column, endpoint or enum value; making an optional field required; changing a type, a status code or an `error.message`; tightening a validation rule; changing what a response list contains or its order. Some deployed client stops working, or old data stops being valid.
- **Data-changing:** anything that rewrites existing rows (backfill, normalisation, splitting a column).

Breaking and data-changing changes are always split into additive steps (Section 3) and called out in the plan.

## 2. Schema rules

Everything in `docs/setup.md` → Prisma conventions still applies to new models (PascalCase singular + `@@map`, camelCase + `@map`, `id String @id @default(uuid(7))`, `createdAt` / `updatedAt`, no `onDelete: Cascade`). On top of that:

- **Migrations are append-only.** Never edit, reorder or delete a migration that has been applied anywhere, including a teammate's machine. Fix a mistake with a new migration.
- **One concern per migration**, named for what it does (`npx prisma migrate dev --name add_post_slug`). Commit the migration together with the schema change and the code that uses it.
- **Read the generated SQL before committing.** Prisma writes `DROP COLUMN` + `ADD COLUMN` for a rename. If the SQL drops anything, stop and use the expand → migrate → contract steps in Section 3.
- **New columns on existing tables are nullable or have a default.** A `NOT NULL` column with no default fails on a table that already has rows.
- **Every foreign key gets an index** (`@@index([fooId])`), and so does every column a list endpoint filters or sorts on.
- **New client-facing resources get `active Boolean @default(true)`** (soft delete) and are never hard-deleted. Child rows edited as a list (like images and links) may be deleted inside their parent's edit, as today.
- **Enums: adding a value is safe; removing or renaming one is breaking.** Add new values only, and handle the new value everywhere the enum is checked before deploying.
- **New secrets follow the API key / webhook secret pattern:** generated, hashed or encrypted only in `lib/crypto.js`, never selected outside the one place that needs them, and added to the "Never select secrets" anti-pattern in `CLAUDE.md`.
- **Run `npx prisma generate` after every schema change** (Prisma 7 does not do it on migrate).
- **Ownership must still come from the session.** A new resource hangs off a website (owned through `account_website`) or off the account directly. If it can't be traced back to `req.user`, the design is wrong.

## 3. Breaking and data changes: expand → migrate → contract

Never ship a breaking schema or contract change in one deploy. Split it:

1. **Expand** — add the new column, field or endpoint alongside the old one. Code writes both and reads the old one. Deploy.
2. **Migrate** — backfill existing rows (a separate migration, or a one-off script in `prisma/scripts/` that is idempotent and safe to re-run). Switch reads to the new one. Update the frontend. Deploy both.
3. **Contract** — once nothing reads the old one (frontend deployed, client websites confirmed), remove it in a later PR.

Example — renaming `post.header` to `post.headline`: add `headline`, write both, backfill `headline = header`, switch reads and the frontend, then drop `header` in a later release. The public API keeps returning `header` until every client website has moved (Section 4).

## 4. API contract rules

- **The contract is still changed in both repos in the same piece of work** (`docs/endpoints.md` here, `docs/api.md` in the frontend), with a cross-repo handoff.
- **Additive by default.** New response fields are fine; clients ignore fields they don't know. New request fields are optional, or they belong to a new endpoint.
- **Deploy order for a contract change:** backend first (accepting both the old and the new shape), then frontend. The backend never requires something the currently deployed frontend doesn't send.
- **The public API only grows.** `GET /api/public/posts` and the revalidation webhook body (`{ websiteId, postId }`) only ever gain fields. A breaking change to either goes to a new versioned path (`/api/public/v2/posts`), and the old path keeps working until every client website has moved. The app API (`/api/auth`, `/api/admin`, `/api/siteOwner`) stays unversioned: its only consumer is the frontend, which we deploy ourselves.
- **Error messages are contract.** A new situation gets a new row in "Error messages the frontend displays"; an existing message is never reworded without the frontend change in the same piece of work.
- **New routes go under the existing role routers** (`/api/admin`, `/api/siteOwner`, `/api/public`) so they inherit the router guards. A new role or audience gets a new router folder in `api/` with its guards set on the router, never per route.
- **Every new list endpoint is paginated from day one** (Section 6). Adding pagination to an existing endpoint later is a breaking change.

## 5. Adding a new feature: the template

Use this for any new resource (photo galleries and business hours are the known candidates):

1. **Spec first:** add the shapes, endpoints, validation rules and error messages to `docs/endpoints.md`, and the schema to `docs/setup.md`. Classify the change (Section 1).
2. **Schema:** model + migration following Section 2. Additive only.
3. **Validation:** a new file in `validation/` with `xSchema` / `xShape`, using `blankToUndefined` and `validate()` from `validation/validate.js`.
4. **Routes:** in the right role router, following the Code Style route shape, with the Role Ownership Check (`404` for both not found and not yours).
5. **Writes:** multi-row writes in one `$transaction`. If the client website shows the resource, call `revalidate(websiteId, …)` after commit, not awaited.
6. **Public exposure:** decide explicitly which fields are public. Internal fields (like `postName`) never reach `/api/public`. Adding fields to `PublicPost` is additive; a new kind of public content is a new public endpoint.
7. **Tests:** per the Unit Tests section in `CLAUDE.md`; every new status code and message gets a request test.
8. **Handoff and verification:** frontend handoff, Postman, a real frontend request, and test rows deleted afterwards (Workflow Checklist).

## 6. Performance rules

The MVP is fine at its current size. These rules stop it degrading as accounts, websites and posts grow.

- **Pagination:** list endpoints use cursor pagination on `id` (UUIDv7 is time-ordered): `?limit=&cursor=`, response `{ data: [...], nextCursor }`, `nextCursor` is `null` on the last page. Default limit 50, max 100. The existing endpoints that will need it first are `GET /api/admin/accounts`, the post summaries in `GET /api/siteOwner/websites`, and `GET /api/public/posts`. Adding it to these is a breaking change and follows Sections 3 and 4.
- **Indexes match queries.** Any new `where` / `orderBy` on a growing table gets an index in the same migration. Use a composite index when filtering and sorting together (e.g. `@@index([websiteId, active, createdAt])` for the public posts query).
- **No N+1 queries.** Load related rows with a nested `select` in one Prisma call, never a query inside a `.map`.
- **Explicit `select` everywhere** (already a Code Style rule). It also keeps payloads small as models gain columns.
- **Bounded child lists.** Every list a client can grow has a maximum in validation, as paragraphs (5), images (5) and links (10) do now.
- **Connection pool:** each backend instance opens its own `pg` pool through `PrismaPg` (`prisma/index.js`; `pg` defaults to 10 connections). Pool size × number of instances must stay under the Postgres connection limit on Railway. Check this before adding instances.

## 7. Running more than one instance

The backend is stateless today (the session is a signed JWT cookie, nothing is held in memory), so Railway can run several instances. Keep it that way:

- **No shared in-memory state** — no in-process caches, counters or sessions that other instances would need. Anything shared goes in Postgres (or, later, Redis).
- **Rate limiting** on `POST /api/auth/login` and `GET /api/public/posts` is added before more client websites are onboarded. Per-instance limits are acceptable while there is one instance; a shared store is needed once there are several.
- **Revalidation is best-effort.** It runs fire-and-forget in the request's process (`services/revalidate.js`), so a call in flight is lost if the instance restarts. When missed revalidations start to matter, move it to an outbox: a `revalidation_job` row written in the same transaction as the post change, sent by a worker with retries. Until then, the client website's own time-based regeneration is the fallback.
- **Migrations run once per deploy, not per instance:** production runs `npx prisma migrate deploy` as the Railway pre-deploy step. `prisma migrate dev` is never run against production. (The Railway deploy has not been set up yet; confirm or update this rule when it is.)

## 8. Environments and deployment

- **New env vars** are added to `.env.example` (with a comment), to `REQUIRED_ENV` in `index.js` if the server can't run without them, to `testing/setup.js` if tests need a fixed value, and to Railway before the code that reads them is deployed.
- **Back up before destructive migrations:** take a Railway Postgres backup before any migration that drops or rewrites data. `SECRET_ENCRYPTION_KEY` is backed up separately (`docs/setup.md`).
- **Staging before the first breaking change after the production launch:** a staging environment (Railway service + Vercel preview, with its own database) where migrations and contract changes are deployed and checked before production.
- **Rollback:** a code deploy can be rolled back; a migration cannot. That is why schema changes are additive and removals happen in a later release.
- **Production data changes** only through the API, a reviewed migration or a reviewed one-off script — never by hand in Prisma Studio, except the documented `active` flips for accounts and websites until endpoints exist for them.

## 9. Docs, tests and review still gate everything

- Every rule in `CLAUDE.md` (Role Ownership Check, Anti-Patterns, Code Style, Code Review, Unit Tests, Workflow Checklist) applies to new work unchanged.
- New work after the MVP is tracked as numbered features in `CLAUDE.md`, each one its own branch → plan → approval → build → verify → PR, the same rhythm as the Build Order.
- A feature that changes these rules updates this file in the same PR.
- After a change to the contract, the schema or a flow, run the Documentation Sync audit (`CLAUDE.md`) once both repos have merged it.
