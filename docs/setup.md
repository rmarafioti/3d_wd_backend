# Setup

Instructions for the setup and behavior of database functionality: schema, Prisma conventions, the test database, the crypto module and seeding. Imported from `CLAUDE.md` via `@docs/setup.md`.

## Proposed MVP Functionality

- An administrator can log in.
- An administrator can create an account for a site owner, linked to a new or an existing website.
- An administrator can link another website (new or existing) to an existing site owner account.
- The administrator receives one-time access to a **new** website's API key and webhook secret.
- A site owner can log in.
- A site owner can create, edit and delete a post, and set it to draft or published.
- A site owner can create, edit and delete a photo gallery, and set it to draft or published (Feature 10, after launch).
- The site owner's website fetches its published content from the app using its API key, and receives on-demand revalidation calls via its webhook whenever a post or gallery changes.

Out of scope for the MVP: key/secret rotation, admin UI to deactivate accounts or websites (flip `active` by hand for now: Prisma Studio locally, SQL from the API's Render Shell when deployed), business hours. Photo galleries were added after launch (Feature 10).

## Schema

```
Table account {
  id         string   [primary key, default: uuid v7]
  name       string   [not null]
  email      string   [not null, unique]        // always stored lowercase
  role       role     [not null]
  active     bool     [not null, default: true]
  session_version integer [not null, default: 0] // bumped on logout; a session cookie works only while its sv matches
  created_at datetime [not null, default: now()]
  updated_at datetime [not null]                // auto-updated on every change
}

Table website {
  id                       string   [primary key, default: uuid v7]
  website_name             string   [not null]
  url                      string   [not null, unique]  // normalized: https, lowercase host, no trailing slash
  api_key_hash             string   [not null, unique]  // SHA-256 hex of the API key
  webhook_secret_encrypted string   [not null]          // "iv:tag:ciphertext", AES-256-GCM, base64 parts
  media_folder             string   [not null, unique]  // its Cloudinary upload folder, set once (Image Hosting)
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
  active     bool     [not null, default: true]   // being retired for status (Feature 8); written to match it
  status     post_status [not null, default: 'published']  // draft or published; only published posts are public
  deleted_at datetime [null]       // set by Delete a Post: the post is gone from every route, the row stays
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
  src      string  [not null]   // Cloudinary secure_url in 3DWD's account, in the website's folder
  width    integer [not null]   // required by next/image on the client website
  height   integer [not null]
  alt_text string  [not null]

  indexes {
    post_id
  }
}

Table gallery {
  id           string   [primary key, default: uuid v7]
  website_id   string   [not null]
  gallery_name string   [not null]   // internal label, shown on the dashboard only, never public
  slug         string   [not null]   // how the client website asks for it; set once (Gallery slugs)
  title        string   [null]       // optional public headline
  copy         string   [null]       // optional public description; line breaks kept
  status       gallery_status [not null, default: 'published']  // only published galleries are public
  deleted_at   datetime [null]       // set by Delete a Gallery: gone from every route, the row stays
  created_at   datetime [not null, default: now()]
  updated_at   datetime [not null]

  indexes {
    (website_id, slug) [unique]  // a slug is unique within its website, deleted galleries included
  }
}

Table gallery_image {
  id               string  [primary key, default: uuid v7]
  gallery_id       string  [not null]
  position         integer [not null]   // order within the gallery: 0, 1, 2…
  src              string  [not null]   // Cloudinary secure_url in 3DWD's account, in the website's folder
  width            integer [not null]   // the stored image's size, for next/image
  height           integer [not null]
  alt_text         string  [not null]
  caption          string  [null]
  thumbnail_x      integer [null]       // the thumbnail crop (a square), in the stored image's pixels:
  thumbnail_y      integer [null]       //   all four set, or none
  thumbnail_width  integer [null]
  thumbnail_height integer [null]
  mobile_x         integer [null]       // the mobile crop (at least as tall as wide), the same way
  mobile_y         integer [null]
  mobile_width     integer [null]
  mobile_height    integer [null]

  indexes {
    (gallery_id, position)
  }
}

Table audit_event {
  id          string   [primary key, default: uuid v7]
  action      string   [not null]  // e.g. post.updated (docs/endpoints.md → Audit Log)
  actor_id    string   [null]      // the signed-in account; null for a failed login with no account
  actor_email string   [null]      // the actor's email, readable at a glance; null for an unverified token
  target_type string   [null]      // account, website, post or gallery
  target_id   string   [null]
  metadata    json     [null]      // never a key, secret, token, header or post content
  ip          string   [null]
  created_at  datetime [not null, default: now()]

  indexes {
    actor_id
    actor_email
    (target_type, target_id)
    created_at
  }
}

Enum role {
  admin
  site_owner
}

Enum post_status {
  draft
  published
}

Enum gallery_status {
  draft
  published
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
Ref: gallery.website_id > website.id         // a website can have many galleries
Ref: gallery_image.gallery_id > gallery.id   // a gallery can have many images
// audit_event has no references on purpose: an event never blocks or depends on another row
```

### Prisma conventions

- Use the current stable Prisma. Models are PascalCase singular (`Account`, `Website`, `AccountWebsite`, `Post`, `Element`, `Image`, `Gallery`, `GalleryImage`, `AuditEvent`) mapped to the snake_case tables above with `@@map`.
- Every snake_case column has a camelCase field with `@map` (e.g. `apiKeyHash String @unique @map("api_key_hash")`), so nothing snake_case ever reaches an API response.
- Every `id`: `String @id @default(uuid(7))`. UUIDv7 is time-ordered, so `orderBy: { id: 'asc' }` returns rows in the order they were created.
- A post's body is its `element` rows, and a gallery's images its `gallery_image` rows, both read with `orderBy: { position: 'asc' }`. Elements are reordered on edit, so they carry an explicit `position` instead of relying on id order; an image's place in the post is its element's position.
- `createdAt DateTime @default(now()) @map("created_at")`, `updatedAt DateTime @updatedAt @map("updated_at")`.
- `postDate DateTime? @db.Date @map("post_date")`.
- `Element.text` is `@db.Text`.
- No `onDelete: Cascade` anywhere — accounts, websites, posts and galleries are never hard-deleted (a deleted post or gallery keeps its row, with `deleted_at` set). The only deletes are elements and images removed in Edit a Post, and gallery images removed in Edit a Gallery. `Element.image` is `onDelete: Restrict` (Prisma's default for an optional relation would be `SetNull`), so an image can't be deleted while an element still shows it.
- Prisma client is a single shared instance exported from `prisma/index.js`.

### Prisma 7 notes

- Generator is `prisma-client-js`. The newer `prisma-client` generator only outputs TypeScript, which would need a build step before Node could `require` it; `prisma-client-js` outputs plain CommonJS imported with `require('@prisma/client')`.
- `prisma.config.js` (repo root) holds the datasource URL, migrations path and seed command — not the schema's `datasource` block. It loads `.env` itself with `require('dotenv/config')`.
- `prisma/index.js` builds the client with the `PrismaPg` driver adapter (`@prisma/adapter-pg` + `pg`). It does not load `.env`; each entry point (`index.js`, `prisma/seed.js`) requires `dotenv/config` first, and every test file that touches the environment or the database requires `testing/setup.js` first.
- `prisma migrate dev` does **not** regenerate the client in v7. Run `npx prisma generate` after every schema change. The `postinstall` script covers fresh installs.
- Local Postgres (docker-compose) runs on host port **5433**, because a native Postgres already uses 5432.
- npm 11 (Node 24) runs a dependency's install scripts only once they are approved. Prisma's two (`prisma`, `@prisma/engines`) are approved in `package.json` → `allowScripts`, pinned to their version, so a Prisma upgrade shows the warning again until `npm install-scripts approve prisma @prisma/engines` is run on that branch.

### Test database

- `npm test` runs against a separate database on the same docker-compose Postgres: `TEST_DATABASE_URL` (`headless_cms_test` locally). The dev database is never used by the suite.
- `testing/setup.js` points `DATABASE_URL` at `TEST_DATABASE_URL` and refuses to run unless the database name ends in `_test`, because the suite truncates every table.
- The `pretest` script (`testing/migrate.js`) creates the test database if it doesn't exist, then runs `prisma migrate deploy` against it, so a new migration reaches the test database on the next `npm test`.
- Every test starts from empty tables and empty rate limit counts (`resetState` in `beforeEach`) and builds its own rows with `testing/helpers.js`. Nothing is seeded.

## Crypto Module — `lib/crypto.js`

The only place keys and secrets are generated, hashed, encrypted or decrypted. Used by Create an Account, Link a Website, `requireApiKey` and `services/revalidate.js`. Never duplicated inline.

- `generateApiKey()` → `crypto.randomBytes(32).toString('base64url')`.
- `generateWebhookSecret()` → `crypto.randomBytes(32).toString('base64url')`.
- `hashApiKey(key)` → SHA-256 hex digest. Stored in `api_key_hash`; the public endpoint hashes the incoming key and looks it up.
- `encryptSecret(secret)` → AES-256-GCM with a random 12-byte IV, key = `SECRET_ENCRYPTION_KEY` (32 bytes, base64 in `.env`). Stored as one string: `base64(iv):base64(authTag):base64(ciphertext)`.
- `decryptSecret(stored)` → reverses the above. Used only by `services/revalidate.js`, immediately before sending.

Database backups (`docs/deploy.md` → Render services):

- `generateBackupKeyPair()` → an RSA 4096 key pair, PEM. Run once through `npm run backup:keygen`; the private key goes only into 1Password.
- `backupPublicKey(encoded)` → reads `BACKUP_PUBLIC_KEY` (the public key's PEM, base64 on one line). Throws unless it is an RSA public key of at least 4096 bits; a private key is refused too.
- `createBackupEncryptor(publicKey)` → a stream that encrypts one dump: a random AES-256-GCM key for that dump, wrapped with the public key (RSA-OAEP, SHA-256). The file is `3DWDBK01` (8 bytes) | wrapped key length (2 bytes) | wrapped key | IV (12 bytes) | ciphertext | GCM tag (16 bytes). The tag goes last because GCM only knows it once the whole dump has passed through.
- `decryptBackup(filePath, privateKey, output)` → reverses it. A wrong key, a file that isn't a backup or any changed byte rejects, so the output is used only once it resolves.

`SECRET_ENCRYPTION_KEY` must be backed up as carefully as the database password — if it is lost, every stored webhook secret becomes unreadable.

## Image Hosting

Images are stored in 3DWD's Cloudinary account, so site owners never need one of their own. The browser uploads each image straight to Cloudinary with a signature from `POST /api/siteOwner/uploads/sign` (`docs/endpoints.md` → Sign an Upload); the backend never handles the file.

The account uses Cloudinary's fixed folder mode, where the signed `folder` is also the start of each upload's public id (and so of its `secure_url`). The `src` rule and the cleanup both rely on that. Everything that talks to Cloudinary is in `lib/cloudinary.js` (no Cloudinary SDK: signing uses Node's `crypto`, the Admin API calls use `fetch`); the folder name rule is `lib/mediaFolder.js`.

Environment variables:

- `CLOUDINARY_CLOUD_NAME` and `CLOUDINARY_API_KEY`: the account's cloud name and API key. Both are public: they appear in upload URLs and in the signature's `fields`.
- `CLOUDINARY_API_SECRET`: signs uploads and authorizes the cleanup. It is a secret like `SECRET_ENCRYPTION_KEY`: never logged, never returned, kept only in `.env` and Render, and backed up.
- `CLOUDINARY_FOLDER`: the environment's root folder, `3dwd` in production and `3dwd-dev` locally. Production and local share the one Cloudinary account, separated by this root. Tests use a fixed value and never call Cloudinary.

Every upload goes to `<CLOUDINARY_FOLDER>/<website.mediaFolder>/`. No folder is created by hand: Cloudinary creates each folder on the first upload into it. File names are Cloudinary's random public ids (letters, digits, `_` and `-`), and the `src` rule accepts only those, so the upload preset option "use filename" stays off. A stored `src` looks like `https://res.cloudinary.com/<cloud name>/image/upload/v1760000000/3dwd/steviethedog/abc123.jpg`, and the backend accepts an image `src` only in the post's website's folder.

### media_folder

Set once, when a website is created (Create an Account or Link a Website, new-website path), and never changed, so stored image URLs stay valid:

1. Take the normalized URL's host name (no port) and remove a leading `www.`.
2. Drop the last label (the top-level domain) and turn the remaining dots into hyphens. A host with a single label keeps it whole.
3. If another website already has that folder, add `-2`, then `-3`, and so on.

| URL                                             | `media_folder`    |
| ----------------------------------------------- | ----------------- |
| `https://www.steviethedog.com`                  | `steviethedog`    |
| `https://shop.example.co.uk`                    | `shop-example-co` |
| `https://example.org` (when `example` is taken) | `example-2`       |

The migration that adds the column backfills every existing website by the same rule (locally, Stevie The Dog → `steviethedog`).

### Gallery crops

A gallery image is uploaded once. Its thumbnail and mobile versions are not separate uploads: the site owner picks a rectangle of the stored image for each, saved as four numbers (`thumbnail_x`, `thumbnail_y`, `thumbnail_width`, `thumbnail_height`, and the same for mobile), and the public API turns each into a Cloudinary delivery URL that cuts that rectangle out (`lib/cloudinary.js` → `croppedSrc`). A gallery's crops are consistent: all of its images have a thumbnail crop or none do, the same for mobile crops, and every mobile crop has one shape (`docs/endpoints.md` → Validation rules):

```
https://res.cloudinary.com/<cloud name>/image/upload/c_crop,x_200,y_0,w_800,h_800/v1760000000/3dwd/steviethedog/abc123.jpg
```

Cloudinary builds the cropped version the first time the URL is requested and caches it, so nothing extra is stored and a changed crop costs nothing. This needs Cloudinary's "strict transformations" setting off, which it is in 3DWD's account (checked 2026-10-31); turning it on would break every cropped URL. The crop is in the stored image's pixels, so the cropped version is exactly the crop's `width` × `height`, which is what the public API returns for `<Image>`. A cropped URL has one more path segment than a stored `src` (the crop, before the version), so a client website that shows gallery crops needs the two extra `remotePatterns` entries in Client websites, below.

### Gallery slugs

A gallery's `slug` is how a client website asks for it (`GET /api/public/galleries/:slug`). Set once, when the gallery is created, and never changed, so renaming a gallery never breaks the website showing it (`lib/slug.js`):

1. Take the gallery name, remove accents, and lowercase it.
2. Turn every run of characters other than `a`–`z` and `0`–`9` into one hyphen, keep the first 60 characters, and drop hyphens at either end. A name with nothing left becomes `gallery`.
3. If another gallery on the same website already has that slug, deleted ones included, add `-2`, then `-3`, and so on. Other websites' galleries don't count.

| Gallery name                                  | `slug`           |
| --------------------------------------------- | ---------------- |
| `Our Interior!`                               | `our-interior`   |
| `Café Art`                                    | `cafe-art`       |
| `Our Interior` (when `our-interior` is taken) | `our-interior-2` |

### Upload cleanup

The database is the record of which images are kept. Post and gallery saves never call Cloudinary: an image removed in an edit, uploaded for a save that then failed, or on a deleted post or gallery, is left for the cleanup.

`npm run sweep:uploads` (`scripts/sweepUploads.js`, running `services/sweepUploads.js`):

- lists every image under `<CLOUDINARY_FOLDER>/` uploaded more than 24 hours ago (Cloudinary Admin API);
- deletes each one that no kept `image.src` or `gallery_image.src` refers to. An image row is kept while its post or gallery is published or a draft (drafts keep their images), or was deleted less than 30 days ago. After 30 days a deleted post's or gallery's images are deleted, unless a post or gallery that is still kept uses the same `src`. Image rows themselves are never deleted by the cleanup;
- never touches anything outside `CLOUDINARY_FOLDER`, so a local run can't delete production images, nor the reverse.

Uploads happen at Publish and the save follows straight away, so 24 hours leaves a wide margin: an image is never swept before its post is saved. The 30 days for a deleted post or gallery match how long database backups are kept, so a restored backup still has its images, and a mistaken delete can be undone with them (`DELETED_POST_GRACE_MS` in `services/sweepUploads.js`; it may come down to 15 days if storage gets tight). The script is safe to re-run. Locally it is run by hand; once deployed, a daily Render cron job runs it.

### Client websites

A client website shows its images with `next/image`, so its `next.config` must allow their host. It allows only its own images in 3DWD's account, never all of `res.cloudinary.com`: three `remotePatterns` entries (five once it shows a gallery's crops), each with `protocol: "https"` and `hostname: "res.cloudinary.com"` (checked against Next.js 16.3.4's matcher, 2026-10-21):

| `pathname`                                                  | Allows                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `/<cloud name>/image/upload/*/3dwd/<media_folder>/**`       | its uploads, production                                |
| `/<cloud name>/image/upload/*/3dwd-dev/<media_folder>/**`   | its uploads, local testing                             |
| `/<cloud name>/image/upload/**/<static folder>/**`          | its own static images (Stevie: `stevie_the_dog`)       |
| `/<cloud name>/image/upload/*/*/3dwd/<media_folder>/**`     | its gallery crops, production (only with a gallery)    |
| `/<cloud name>/image/upload/*/*/3dwd-dev/<media_folder>/**` | its gallery crops, local testing (only with a gallery) |

In a pattern `*` matches exactly one path segment: the version (`v1760000000`) in a stored `src`, and the crop then the version in a gallery crop (Gallery crops). The crop rows are added when the website first shows a gallery (checked against Next.js 16.4.3's matcher, 2026-10-31: the one-`*` pattern refuses a cropped URL, the `*/*` pattern accepts it, and both refuse `steviethedog-2`). Another website's folder, a sibling folder such as `steviethedog-2`, and other Cloudinary accounts are refused. The master doc's "Client to Website" tab carries the same rule.

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
