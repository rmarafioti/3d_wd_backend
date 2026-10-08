# Setup

Instructions for the setup and behavior of database functionality: schema, Prisma conventions, the test database, the crypto module and seeding. Imported from `CLAUDE.md` via `@docs/setup.md`.

## Proposed MVP Functionality

- An administrator can log in.
- An administrator can create an account for a site owner, linked to a new or an existing website.
- An administrator can link another website (new or existing) to an existing site owner account.
- The administrator receives one-time access to a **new** website's API key and webhook secret.
- A site owner can log in.
- A site owner can create, edit, archive (soft delete) and reactivate a post.
- The site owner's website fetches its published content from the app using its API key, and receives on-demand revalidation calls via its webhook whenever a post changes.

Out of scope for the MVP: key/secret rotation, admin UI to deactivate accounts or websites (flip `active` in Prisma Studio for now), photo galleries, business hours.

## Schema

```
Table account {
  id         string   [primary key, default: uuid v7]
  name       string   [not null]
  email      string   [not null, unique]        // always stored lowercase
  role       role     [not null]
  active     bool     [not null, default: true]
  created_at datetime [not null, default: now()]
  updated_at datetime [not null]                // auto-updated on every change
}

Table website {
  id                       string   [primary key, default: uuid v7]
  website_name             string   [not null]
  url                      string   [not null, unique]  // normalized: https, lowercase host, no trailing slash
  api_key_hash             string   [not null, unique]  // SHA-256 hex of the API key
  webhook_secret_encrypted string   [not null]          // "iv:tag:ciphertext", AES-256-GCM, base64 parts
  active                   bool     [not null, default: true]
  created_at               datetime [not null, default: now()]
  updated_at               datetime [not null]
}

Table account_website {
  id         string   [primary key, default: uuid v7]
  account_id string   [not null]
  website_id string   [not null]
  created_at datetime [not null, default: now()]

  indexes {
    (account_id, website_id) [unique]  // an account is never linked to the same website twice
    website_id
  }
}

Table post {
  id         string   [primary key, default: uuid v7]
  website_id string   [not null]
  post_name  string   [not null]   // internal label, shown on the dashboard only, never public
  post_date  date     [null]       // optional date shown on the website so readers know how recent the post is
  header     string   [null]       // optional public headline
  sub_header string   [null]       // optional
  active     bool     [not null, default: true]
  created_at datetime [not null, default: now()]
  updated_at datetime [not null]

  indexes {
    website_id
  }
}

Table element {
  id       string       [primary key, default: uuid v7]
  post_id  string       [not null]
  position integer      [not null]       // reading order within the post's body: 0, 1, 2…
  type     element_type [not null]
  text     string       [null]           // paragraph elements only; line breaks kept
  image_id string       [null, unique]   // image elements only; each image is placed once

  indexes {
    (post_id, position)
  }
}

Table image {
  id       string  [primary key, default: uuid v7]
  post_id  string  [not null]
  src      string  [not null]   // Cloudinary URL from the site owner's Cloudinary account
  width    integer [not null]   // required by next/image on the client website
  height   integer [not null]
  alt_text string  [not null]

  indexes {
    post_id
  }
}

Table link {
  id      string [primary key, default: uuid v7]
  post_id string [not null]
  name    string [not null]
  url     string [not null]

  indexes {
    post_id
  }
}

Enum role {
  admin
  site_owner
}

Enum element_type {
  paragraph
  image
}

// join table - an account can have many websites,
// a website can be overseen by many accounts
Ref: account_website.account_id > account.id
Ref: account_website.website_id > website.id
Ref: post.website_id > website.id   // a website can have many posts
Ref: element.post_id > post.id      // a post's body is many elements (paragraphs and images)
Ref: element.image_id - image.id    // an image element shows exactly one image
Ref: image.post_id > post.id        // a post can have many images
Ref: link.post_id > post.id         // a post can have many links
```

### Prisma conventions

- Use the current stable Prisma. Models are PascalCase singular (`Account`, `Website`, `AccountWebsite`, `Post`, `Element`, `Image`, `Link`) mapped to the snake_case tables above with `@@map`.
- Every snake_case column has a camelCase field with `@map` (e.g. `apiKeyHash String @unique @map("api_key_hash")`), so nothing snake_case ever reaches an API response.
- Every `id`: `String @id @default(uuid(7))`. UUIDv7 is time-ordered, so `orderBy: { id: 'asc' }` returns rows in the order they were created. Links are always read this way — they have no position column.
- A post's body is its `element` rows, read with `orderBy: { position: 'asc' }`. Elements are reordered on edit, so they carry an explicit `position` instead of relying on id order; an image's place in the post is its element's position.
- `createdAt DateTime @default(now()) @map("created_at")`, `updatedAt DateTime @updatedAt @map("updated_at")`.
- `postDate DateTime? @db.Date @map("post_date")`.
- `Element.text` is `@db.Text`.
- No `onDelete: Cascade` anywhere — accounts, websites and posts are never hard-deleted. The only deletes are elements, images and links removed in Edit a Post. `Element.image` is `onDelete: Restrict` (Prisma's default for an optional relation would be `SetNull`), so an image can't be deleted while an element still shows it.
- Prisma client is a single shared instance exported from `prisma/index.js`.

### Prisma 7 notes

- Generator is `prisma-client-js`. The newer `prisma-client` generator only outputs TypeScript, which Node 20 can't `require`; `prisma-client-js` outputs plain CommonJS imported with `require('@prisma/client')`.
- `prisma.config.js` (repo root) holds the datasource URL, migrations path and seed command — not the schema's `datasource` block. It loads `.env` itself with `require('dotenv/config')`.
- `prisma/index.js` builds the client with the `PrismaPg` driver adapter (`@prisma/adapter-pg` + `pg`). It does not load `.env`; each entry point (`index.js`, `prisma/seed.js`) requires `dotenv/config` first, and every test file that touches the environment or the database requires `testing/setup.js` first.
- `prisma migrate dev` does **not** regenerate the client in v7. Run `npx prisma generate` after every schema change. The `postinstall` script covers fresh installs.
- Local Postgres (docker-compose) runs on host port **5433**, because a native Postgres already uses 5432.
- If a Prisma command fails with missing engines/binaries, run `npm install-scripts approve prisma @prisma/engines` (npm blocked those install scripts during setup).

### Test database

- `npm test` runs against a separate database on the same docker-compose Postgres: `TEST_DATABASE_URL` (`headless_cms_test` locally). The dev database is never used by the suite.
- `testing/setup.js` points `DATABASE_URL` at `TEST_DATABASE_URL` and refuses to run unless the database name ends in `_test`, because the suite truncates every table.
- The `pretest` script (`testing/migrate.js`) creates the test database if it doesn't exist, then runs `prisma migrate deploy` against it, so a new migration reaches the test database on the next `npm test`.
- Every test starts from empty tables (`TRUNCATE` in `beforeEach`) and builds its own rows with `testing/helpers.js`. Nothing is seeded.

## Crypto Module — `lib/crypto.js`

The only place keys and secrets are generated, hashed, encrypted or decrypted. Used by Create an Account, Link a Website, `requireApiKey` and `services/revalidate.js`. Never duplicated inline.

- `generateApiKey()` → `crypto.randomBytes(32).toString('base64url')`.
- `generateWebhookSecret()` → `crypto.randomBytes(32).toString('base64url')`.
- `hashApiKey(key)` → SHA-256 hex digest. Stored in `api_key_hash`; the public endpoint hashes the incoming key and looks it up.
- `encryptSecret(secret)` → AES-256-GCM with a random 12-byte IV, key = `SECRET_ENCRYPTION_KEY` (32 bytes, base64 in `.env`). Stored as one string: `base64(iv):base64(authTag):base64(ciphertext)`.
- `decryptSecret(stored)` → reverses the above. Used only by `services/revalidate.js`, immediately before sending.

`SECRET_ENCRYPTION_KEY` must be backed up as carefully as the database password — if it is lost, every stored webhook secret becomes unreadable.

## Seed Users

Only the administrator is seeded. The test site owner is created afterwards through the real Create an Account flow, so that flow (validation, transaction, key generation, one-time reveal) is tested end to end through the UI.

Administrator (`prisma/seedData.js`):

```
name  : 'Richard Marafioti'
email : process.env.SEED_ADMIN_EMAIL   // never hardcoded; ask Rich for the value at build time
role  : 'admin'
```

Test data for Build Order step 3 (entered through the Create an Account form — **not** seeded):

```
name         : 'Richard Marafioti'
email        : a second Google account, different from the admin's (ask Rich at build time)
website_name : 'Stevie The Dog'
url          : 'https://www.steviethedog.com'
```

## Seed Process

- `npm run seed` runs `prisma/seed.js`.
- The seed lowercases `SEED_ADMIN_EMAIL` and checks for an existing account with that email. If it exists, it is skipped — the script is safe to run more than once.
- If it does not exist, the administrator is created with `role: admin` (`id`, `active`, timestamps come from schema defaults).
- When `NODE_ENV=production`, the script refuses to run unless passed `--confirm-production` (`npm run seed -- --confirm-production`), since seeding production is a rare, deliberate action.
- The seed does not create websites and does not call the crypto module.
- Afterwards, check the row in Prisma Studio (`npx prisma studio`). If it's there, move on to Build Order step 2, Login.
