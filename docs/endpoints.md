# Endpoints

Full behavioral spec for each backend endpoint. `CLAUDE.md` holds the short, always-loaded rules (ownership checks, anti-patterns, patterns); this file holds the API contract and the per-endpoint detail those rules apply to. Read on demand (`CLAUDE.md` → Read before).

The API Contract section below is the **source of truth** for both repos. The frontend repo keeps an identical copy in its `docs/api.md`. Any change to the contract is made in both repos in the same piece of work.

## API Contract

The single agreement between the frontend and backend repos. The backend copy (`backend/docs/endpoints.md`) is the source of truth; the frontend keeps an identical copy in `docs/api.md`. Any change to the contract is made in **both** repos in the same piece of work.

### Conventions

- Every route lives under `/api`.
- All request and response fields are camelCase. snake_case exists only inside the database (Prisma `@map`). One exception: `fields` in `UploadSignature` keeps Cloudinary's own form-field names (`api_key`, `timestamp`, …), because the frontend sends it to Cloudinary unchanged.
- Dates and times are ISO 8601 strings. `postDate` is a date only: `YYYY-MM-DD`.
- Success response: `{ "data": ... }`
- Error response: `{ "error": { "message": "...", "fields": { "fieldName": "message" } } }` — `fields` is only present on validation errors (400) so the form can show a message next to each field. Each key is the full path to the input, joined with dots: top-level fields use their own name (`email`, `postName`), items in a list use their index (`body.0.text`, `body.1.image.src`), and a list-level error such as too many items uses the list name (`body`).
- Every `POST`, `PATCH` and `DELETE` must carry the header `X-CSRF-Protection: 1`, or the backend returns `403`. `GET` requests do not need it.
- Every request from the app frontend is sent with `credentials: 'include'` (the session cookie). This is handled once, in the frontend's `apiFetch()`.
- `api_key_hash` and `webhook_secret_encrypted` never appear in any response.

### Status codes

| Code | Meaning                                                                                                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200  | OK                                                                                                                                                                                                                   |
| 201  | Created                                                                                                                                                                                                              |
| 204  | OK, no body (logout, delete a post or gallery, remove an ability, withdraw an update)                                                                                                                                |
| 400  | Invalid input (validation failed, an image id that doesn't belong to the post or gallery, or an image not uploaded for its website)                                                                                  |
| 401  | Not signed in / session expired or invalid / not authorized to log in / bad API key                                                                                                                                  |
| 403  | Signed in but wrong role, missing CSRF header, or a gallery created on a website without the Photo Galleries ability                                                                                                 |
| 404  | Not found **or not yours** — the same answer either way, so ids can't be probed                                                                                                                                      |
| 409  | Conflict — duplicate email, duplicate website URL, account already linked to that website, a gallery name the website already has, or an ability change its current state doesn't allow, or a reply to a full thread |
| 413  | Request body over the 256 KB limit                                                                                                                                                                                   |
| 429  | Too many requests: over a rate limit (login, the public API, upload signing, thread messages)                                                                                                                        |
| 500  | Server error — message is always the generic "Something went wrong, please try again."                                                                                                                               |

### Shapes

```
Account        { id, name, email, role, active, createdAt }
WebsiteSummary { id, websiteName, url, active }
Credentials    { apiKey, webhookSecret }            // plaintext, one-time only
UploadSignature { uploadUrl, fields }               // fields: Cloudinary form fields, posted as-is
Image          { id, src, width, height, altText }
Element        { type: 'paragraph', text } | { type: 'image', image: Image }
PostSummary    { id, postName, postDate, status, publishAt, publishedAt, createdAt }
DeletedPostSummary { id, websiteId, websiteName, postName, postDate, status, deletedAt, restorableUntil }
DeletedItem    { type: 'post' | 'gallery' | 'update' | 'thread', id, name,
                 websiteId, websiteName, deletedAt, restorableUntil }   // websiteId, websiteName null for mail
DeletedRef     { type, id }                          // an item a bulk delete or restore named
FailedRef      { type, id, message }                 // one it couldn't delete or restore, and why
AuditEvent     { id, action, actorEmail, targetType, targetId, metadata, ip, createdAt }
Post           { id, websiteId, websiteName, postName, header, subHeader,
                 postDate, status, publishAt, publishedAt, createdAt, updatedAt, body: Element[] }
GallerySummary { id, galleryName, slug, status, placement, requestedAt, publishAt, publishedAt, createdAt }
AdminPostSummary { id, postName, status }
AdminGallerySummary { id, galleryName, slug, status, placement, requestNote, imageCount, hasThumbnails, hasMobileCrops }
Crop           { x, y, width, height }              // pixels of the stored image
GalleryImage   { id, src, width, height, altText, caption,
                 thumbnailCrop: Crop | null, mobileCrop: Crop | null }
Gallery        { id, websiteId, websiteName, galleryName, slug, title, copy, status, placement,
                 requestNote, requestedAt, publishAt, publishedAt, createdAt, updatedAt, images: GalleryImage[] }
CroppedImage   { src, width, height }
PublicGallery  { id, slug, title, copy, createdAt, updatedAt,
                 images: [{ src, width, height, altText, caption,
                            thumbnail: CroppedImage | null, mobile: CroppedImage | null }] }
Ability        { id, kind: 'posts' | 'galleries', status: 'added' | 'live', turnedOn,
                 placement, requestNote, requestedAt, createdAt, updatedAt }
// placement: 'requested' | 'live' | null, on Ability (posts only) and on every gallery shape
Notification   { id, title, body, kind: 'general' | 'automatic', createdAt, updatedAt, readAt }
AdminNotification { id, title, body, kind, createdAt, updatedAt,
                    recipientCount, readCount }
ThreadSummary  { id, subject, lastMessageAt, createdAt, unread }
AdminThreadSummary ThreadSummary + { account: { id, name } }
ThreadMessage  { id, from: 'admin' | 'site_owner', authorName, body, createdAt }
Thread         ThreadSummary + { messages: ThreadMessage[] }      // oldest message first
AdminThread    AdminThreadSummary + { messages: ThreadMessage[] }
```

Optional post fields (`header`, `subHeader`, `postDate`) are `null` when empty. Optional gallery fields (`title`, `copy`, an image's `caption`) are `null` when empty too. An ability's `requestNote`, `requestedAt` and `placement` are `null` until its request form is sent, and a gallery's until its request message is sent. A galleries ability's are always `null`: each gallery has its own.

A post's `body` is its content as an ordered list of elements: each element is a paragraph or an image, returned in the order the site owner arranged them, so a client website renders `body` in order to interleave text and photos. Elements have no `id`; they are identified by their position. A paragraph's `text` keeps the line breaks the site owner typed (render it with `white-space: pre-line`). A paragraph's `text` may also contain formatting markup, described in Paragraph formatting below.

### Endpoints

| Method & path                                                | Who                                               | Request body                                                                                                                                                                     | Success                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/login`                                       | anyone                                            | `{ credential }` (Google ID token)                                                                                                                                               | `200 { role }` + sets session cookie                                                                                                         |
| `POST /api/auth/logout`                                      | anyone                                            | —                                                                                                                                                                                | `204`, ends every session of the account                                                                                                     |
| `GET /api/auth/me`                                           | signed in                                         | —                                                                                                                                                                                | `200 { id, name, email, role }`                                                                                                              |
| `GET /api/admin/accounts`                                    | admin                                             | —                                                                                                                                                                                | `200 [ Account + { websites: [ WebsiteSummary + { abilities: Ability[], posts: AdminPostSummary[], galleries: AdminGallerySummary[] } ] } ]` |
| `GET /api/admin/websites`                                    | admin                                             | —                                                                                                                                                                                | `200 WebsiteSummary[]` (active only)                                                                                                         |
| `GET /api/admin/auditEvents?month=&from=&to=&limit=&cursor=` | admin                                             | —                                                                                                                                                                                | `200 { data: AuditEvent[], nextCursor, pages }`                                                                                              |
| `GET /api/admin/auditEvents/months`                          | admin                                             | —                                                                                                                                                                                | `200 string[]` (`YYYY-MM`, newest first)                                                                                                     |
| `POST /api/admin/accounts`                                   | admin                                             | `{ name, email, websiteId }` **or** `{ name, email, websiteName, websiteUrl }`                                                                                                   | `201 { account, website, credentials? }`                                                                                                     |
| `POST /api/admin/accounts/:id/websites`                      | admin                                             | `{ websiteId }` **or** `{ websiteName, websiteUrl }`                                                                                                                             | `201 { website, credentials? }`                                                                                                              |
| `PATCH /api/admin/abilities/:id/status`                      | admin                                             | `{ status: 'live' }`                                                                                                                                                             | `200 Ability`                                                                                                                                |
| `PATCH /api/admin/galleries/:id/placement`                   | admin                                             | `{ placement: 'live' }`                                                                                                                                                          | `200 AdminGallerySummary`                                                                                                                    |
| `POST /api/admin/notifications`                              | admin                                             | `{ title, body }`                                                                                                                                                                | `201 AdminNotification`                                                                                                                      |
| `GET /api/admin/notifications?limit=&cursor=`                | admin                                             | —                                                                                                                                                                                | `200 { data: AdminNotification[], nextCursor }`                                                                                              |
| `PATCH /api/admin/notifications/:id`                         | admin                                             | `{ title, body }`                                                                                                                                                                | `200 AdminNotification`                                                                                                                      |
| `DELETE /api/admin/notifications/:id`                        | admin                                             | —                                                                                                                                                                                | `204`                                                                                                                                        |
| `POST /api/admin/threads`                                    | admin                                             | `{ accountId, subject, message }`                                                                                                                                                | `201 AdminThread`                                                                                                                            |
| `GET /api/admin/threads?limit=&cursor=`                      | admin                                             | —                                                                                                                                                                                | `200 { data: AdminThreadSummary[], nextCursor }`                                                                                             |
| `GET /api/admin/threads/unreadCount`                         | admin                                             | —                                                                                                                                                                                | `200 { threads }`                                                                                                                            |
| `GET /api/admin/threads/:id`                                 | admin                                             | —                                                                                                                                                                                | `200 AdminThread`                                                                                                                            |
| `POST /api/admin/threads/:id/messages`                       | admin                                             | `{ message }`                                                                                                                                                                    | `201 AdminThread`                                                                                                                            |
| `POST /api/admin/threads/:id/read`                           | admin                                             | —                                                                                                                                                                                | `200 AdminThreadSummary`                                                                                                                     |
| `GET /api/admin/deleted?limit=&cursor=`                      | admin                                             | —                                                                                                                                                                                | `200 { data: DeletedItem[], nextCursor }`                                                                                                    |
| `POST /api/admin/deleted`                                    | admin                                             | `{ items: [{ type: 'update' \| 'thread', id }] }`                                                                                                                                | `200 { data: { deleted: DeletedRef[], failed: FailedRef[] } }`                                                                               |
| `POST /api/admin/deleted/restore`                            | admin                                             | `{ items: [{ type: 'update' \| 'thread', id }] }`                                                                                                                                | `200 { data: { restored: DeletedRef[], failed: FailedRef[] } }`                                                                              |
| `GET /api/siteOwner/websites`                                | site owner                                        | —                                                                                                                                                                                | `200 [ WebsiteSummary + { abilities: Ability[], posts: PostSummary[], galleries: GallerySummary[] } ]`                                       |
| `POST /api/siteOwner/posts`                                  | site owner                                        | `{ websiteId, postName, header?, subHeader?, postDate?, status?, publishAt?, body: [{ type: 'paragraph', text } \| { type: 'image', image: { src, width, height, altText } }] }` | `201 Post`                                                                                                                                   |
| `GET /api/siteOwner/posts/:id`                               | site owner                                        | —                                                                                                                                                                                | `200 Post`                                                                                                                                   |
| `PATCH /api/siteOwner/posts/:id`                             | site owner                                        | `{ postName, header, subHeader, postDate, publishAt?, body: [{ type: 'paragraph', text } \| { type: 'image', image: { id?, src, width, height, altText } }] }`                   | `200 Post`                                                                                                                                   |
| `PATCH /api/siteOwner/posts/:id/status`                      | site owner                                        | `{ status }`                                                                                                                                                                     | `200 Post`                                                                                                                                   |
| `PATCH /api/siteOwner/posts/:id/publishAt`                   | site owner                                        | `{ publishAt }`                                                                                                                                                                  | `200 Post`                                                                                                                                   |
| `DELETE /api/siteOwner/posts/:id`                            | site owner                                        | —                                                                                                                                                                                | `204`                                                                                                                                        |
| `GET /api/siteOwner/posts/deleted?limit=&cursor=`            | site owner                                        | —                                                                                                                                                                                | `200 { data: DeletedPostSummary[], nextCursor }`                                                                                             |
| `POST /api/siteOwner/posts/:id/restore`                      | site owner                                        | —                                                                                                                                                                                | `200 Post`                                                                                                                                   |
| `POST /api/siteOwner/galleries`                              | site owner                                        | `{ websiteId, galleryName, title?, copy?, status?, publishAt?, images: [{ src, width, height, altText, caption?, thumbnailCrop?, mobileCrop? }] }`                               | `201 Gallery`                                                                                                                                |
| `GET /api/siteOwner/galleries/:id`                           | site owner                                        | —                                                                                                                                                                                | `200 Gallery`                                                                                                                                |
| `PATCH /api/siteOwner/galleries/:id`                         | site owner                                        | `{ galleryName, title, copy, publishAt?, images: [{ id?, src, width, height, altText, caption, thumbnailCrop, mobileCrop }] }`                                                   | `200 Gallery`                                                                                                                                |
| `PATCH /api/siteOwner/galleries/:id/status`                  | site owner                                        | `{ status }`                                                                                                                                                                     | `200 Gallery`                                                                                                                                |
| `PATCH /api/siteOwner/galleries/:id/publishAt`               | site owner                                        | `{ publishAt }`                                                                                                                                                                  | `200 Gallery`                                                                                                                                |
| `POST /api/siteOwner/galleries/:id/request`                  | site owner                                        | `{ requestNote }`                                                                                                                                                                | `200 Gallery`                                                                                                                                |
| `PATCH /api/siteOwner/galleries/:id/request`                 | site owner                                        | `{ requestNote }`                                                                                                                                                                | `200 Gallery`                                                                                                                                |
| `DELETE /api/siteOwner/galleries/:id`                        | site owner                                        | —                                                                                                                                                                                | `204`                                                                                                                                        |
| `POST /api/siteOwner/abilities`                              | site owner                                        | `{ websiteId, kind }`                                                                                                                                                            | `201 Ability`                                                                                                                                |
| `POST /api/siteOwner/abilities/:id/request`                  | site owner                                        | `{ requestNote }`                                                                                                                                                                | `200 Ability`                                                                                                                                |
| `PATCH /api/siteOwner/abilities/:id/request`                 | site owner                                        | `{ requestNote }`                                                                                                                                                                | `200 Ability`                                                                                                                                |
| `PATCH /api/siteOwner/abilities/:id/turnedOn`                | site owner                                        | `{ turnedOn }`                                                                                                                                                                   | `200 Ability`                                                                                                                                |
| `DELETE /api/siteOwner/abilities/:id`                        | site owner                                        | —                                                                                                                                                                                | `204`                                                                                                                                        |
| `POST /api/siteOwner/uploads/sign`                           | site owner                                        | `{ websiteId }`                                                                                                                                                                  | `200 UploadSignature`                                                                                                                        |
| `GET /api/siteOwner/notifications?limit=&cursor=`            | site owner                                        | —                                                                                                                                                                                | `200 { data: Notification[], nextCursor }`                                                                                                   |
| `GET /api/siteOwner/notifications/unreadCount`               | site owner                                        | —                                                                                                                                                                                | `200 { updates, threads }`                                                                                                                   |
| `POST /api/siteOwner/notifications/:id/read`                 | site owner                                        | —                                                                                                                                                                                | `200 Notification`                                                                                                                           |
| `POST /api/siteOwner/threads`                                | site owner                                        | `{ subject, message }`                                                                                                                                                           | `201 Thread`                                                                                                                                 |
| `GET /api/siteOwner/threads?limit=&cursor=`                  | site owner                                        | —                                                                                                                                                                                | `200 { data: ThreadSummary[], nextCursor }`                                                                                                  |
| `GET /api/siteOwner/threads/:id`                             | site owner                                        | —                                                                                                                                                                                | `200 Thread`                                                                                                                                 |
| `POST /api/siteOwner/threads/:id/messages`                   | site owner                                        | `{ message }`                                                                                                                                                                    | `201 Thread`                                                                                                                                 |
| `POST /api/siteOwner/threads/:id/read`                       | site owner                                        | —                                                                                                                                                                                | `200 ThreadSummary`                                                                                                                          |
| `GET /api/siteOwner/deleted?limit=&cursor=`                  | site owner                                        | —                                                                                                                                                                                | `200 { data: DeletedItem[], nextCursor }`                                                                                                    |
| `POST /api/siteOwner/deleted`                                | site owner                                        | `{ items: [{ type: 'update' \| 'thread', id }] }`                                                                                                                                | `200 { data: { deleted: DeletedRef[], failed: FailedRef[] } }`                                                                               |
| `POST /api/siteOwner/deleted/restore`                        | site owner                                        | `{ items: [{ type: 'post' \| 'gallery' \| 'update' \| 'thread', id }] }`                                                                                                         | `200 { data: { restored: DeletedRef[], failed: FailedRef[] } }`                                                                              |
| `GET /api/public/posts`                                      | client website (`Authorization: Bearer <apiKey>`) | —                                                                                                                                                                                | `200 PublicPost[]`                                                                                                                           |
| `GET /api/public/galleries/:slug`                            | client website (`Authorization: Bearer <apiKey>`) | —                                                                                                                                                                                | `200 PublicGallery`                                                                                                                          |
| `GET /api/health`                                            | anyone                                            | —                                                                                                                                                                                | `200 { ok: true }`                                                                                                                           |

Notes:

- `GET /api/admin/accounts` gives each website its posts that aren't deleted, drafts included, newest `createdAt` first, as `AdminPostSummary`: the name and status only, never the post's content (header, sub header, date, body or images). A website with no posts has `posts: []`. It also gives each website its galleries that aren't deleted, drafts included, newest first, as `AdminGallerySummary`: the name, the slug (the Gallery Code the site owner sees too), status, the site owner's request note (where it should go on the site), number of images, and whether every one of its images has a thumbnail crop (`hasThumbnails`) and a mobile crop (`hasMobileCrops`); a flag is `false` when any image lacks that crop, though saves already keep a gallery's crops all or none (Validation rules). Counts and flags only, never images, captions, title or copy, so the administrator can see a gallery was cropped (crops aren't files, so they don't show in Cloudinary). A website with no galleries has `galleries: []`. The other admin routes return the plain `WebsiteSummary`.
- `GET /api/admin/auditEvents` lists one month of audit events, newest first, a page at a time. `month` is `YYYY-MM`, a UTC calendar month, and defaults to the current one. Instead of a month, `from` and `to` (ISO 8601 instants, such as `2026-11-05T05:00:00.000Z`, always sent together) give a time range: events with `from` ≤ `createdAt` < `to`, at most 31 days, and `month` is ignored. The frontend sends the admin's local day this way, local midnight to the next converted to UTC. `limit` is 1–100, default 50. `nextCursor` sits beside `data` in the success body: send it as `cursor`, with the same `month` or `from` and `to`, to get the next page; it is `null` on the last page. `pages` is how many pages of `limit` events the whole month or range fills, the same on every page of it (`0` when it has none), so the frontend can show "Page 2 of 3" while counting the page it is on itself; events written while paging can raise it on a later page. Every query parameter is optional. `AuditEvent`'s `actorEmail`, `targetType`, `targetId`, `metadata` and `ip` are `null` when the row has none; `metadata` holds only ids and short facts (`{ websiteId }`, or a failed login's `{ reason }`). Read-only: no route edits or deletes an audit event.
- `GET /api/admin/auditEvents/months` lists every UTC month that has at least one audit event, as `YYYY-MM`, newest first, so the page's month controls reach only months with events. An empty log returns `[]`. It is not paginated: there is one item per month, so years of history stay a few dozen strings.
- `credentials` is only present when a **new** website was created. Its presence is what tells the frontend to open the one-time reveal dialog. When an existing website was linked, it is absent.
- On `POST /api/admin/accounts` and `POST /api/admin/accounts/:id/websites` the body must contain **either** `websiteId` **or** both `websiteName` and `websiteUrl` — never both, never neither (400).
- `PATCH /api/siteOwner/posts/:id` is a full submission of the edit form: all fields are sent every time. Send `null` to clear an optional field. `body` is the complete current list, in order. An existing image carries its `image.id`, a new one has none, and any image stored but missing from the body is deleted. Paragraphs carry no id. `websiteId` and `status` cannot be changed here. `publishAt` is the one field that may be left out: absent leaves it as it is, `null` clears it.
- A post's `status` is `draft` or `published`: a published post shows on the client website, a draft doesn't (the site owner still sees it). A new post is `published` unless the request says otherwise.
- `publishAt` is a draft's go-live date, or `null`. The site owner picks a date only, never a time: the frontend sends midnight at the start of that day in the browser's time zone, as an ISO 8601 instant with its offset, so the earliest date is tomorrow. When that moment passes, the draft becomes `published` by itself (Scheduled Publish), up to 15 minutes later. The backend stores and checks the instant, so a time could be offered later without a contract change. Only a draft has one: publishing by hand or deleting clears it, so a restored post comes back without one, and removing Photo Galleries clears it on that website's galleries. A post or gallery published on schedule keeps its `createdAt`, so the client website lists it where its creation date puts it; the dashboard suggests setting Post Date to the go-live day. A scheduled gallery still needs its placement to show on the site, and while an ability is turned off its published items stay hidden, scheduled or not. It is kept apart from `postDate`, the date readers see.
- `publishedAt` is when a post or gallery last went live: set when it is created as `published`, when a draft is published by hand or on schedule, and back to `null` when it is set to draft (publishing an item that is already published keeps it). A draft has `null`. Items published before this field existed have their `createdAt`. The dashboard's Live on column shows `publishedAt` for a published item and `publishAt` for a scheduled draft.
- `PublicPost` is `{ id, header, subHeader, postDate, createdAt, updatedAt, body: [{ type: 'paragraph', text } | { type: 'image', image: { src, width, height, altText } }] }` — `postName` is internal and is **never** returned publicly, and neither are image ids. Only published posts, newest `createdAt` first.
- `DELETE /api/siteOwner/posts/:id` takes a post off the client website and out of the dashboard: from then on the site owner post routes return `404` "Post not found." for it, `GET /api/siteOwner/websites` leaves it out, and `GET /api/public/posts` never returns it. For 30 days it is listed by `GET /api/siteOwner/posts/deleted` and can be restored (below); after that it is gone for good. A draft is different: it hides a post from the client website while the site owner still sees it and can publish it again.
- `GET /api/siteOwner/posts/deleted` lists the posts the site owner deleted in the last 30 days, on every active website linked to the account, newest `deletedAt` first, a page at a time: `limit` is 1–100, default 50, and `nextCursor` sits beside `data` (send it as `cursor` for the next page; `null` on the last page). `restorableUntil` is the moment the post can no longer be restored, 30 days after `deletedAt`: the frontend shows the days left from it, never from a number of its own. If the post a `cursor` names is restored before the next page is asked for, that page is empty with `nextCursor` `null`, so after a restore the list is fetched again from the start. `POST /api/siteOwner/posts/:id/restore` brings one back until `restorableUntil`, exactly as it was deleted: its body, images and `status` (a published post goes back on the client website). Posts `placement` is left as it is. After `restorableUntil` the post is `404` "Post not found." on both, since the upload cleanup has deleted its images.
- Images are uploaded to 3DWD's Cloudinary account from the post form; nobody types or pastes an image URL. A picked image stays in the browser until Publish. On Publish, when the body has new images, the frontend:
  1. shrinks each new image in the browser: decoded with its own orientation (so a photo the phone saved rotated stays upright), scaled so its long side fits 2500 px, never up, and re-encoded, a png as png (keeping its transparency) and a jpg or webp as jpg at 0.85 quality. Every new image is re-encoded, however small, so its metadata, including a phone photo's GPS location, never leaves the browser. If the browser can't decode or encode a file, the file goes up as picked;
  2. requests one `UploadSignature` for the post's website (`POST /api/siteOwner/uploads/sign`);
  3. uploads each new image to `uploadUrl` as `multipart/form-data`: every entry of `fields`, plus the image as `file`. One signature covers every upload in that Publish. It expires after one hour, so it is requested at Publish, never when the form opens;
  4. saves the post with each new image's `src` set to Cloudinary's `secure_url`, and its `width` and `height` from Cloudinary's response.

  If any upload fails, the post is not saved. Before shrinking, the frontend checks that each file as picked is jpg, png or webp and at most 10 MB; Cloudinary also refuses any other format. Cloudinary still scales a larger image down to fit 2500 × 2500 as it stores it (the signed transformation, a safety net for a file that went up as picked), so the `width` and `height` it returns are the stored size.

- A gallery is a section of a client website showing a series of images. A website can have many galleries, each with 1 to 30 images in the order the site owner arranged them. Its images are uploaded exactly as a post's are (the steps above, with the gallery form's Submit in place of Publish), into the same website folder.
- A gallery's `slug` is how the client website asks for it: `GET /api/public/galleries/:slug`. The backend generates it when the gallery is created, 8 random lowercase letters and digits (`k3x9p2qa`), unique within the website, and never changes it, so renaming a gallery never breaks the website. It is not made from `galleryName`; galleries made before keep the name-based slugs they have. The dashboard shows it as the Gallery Code, so the site owner can say which gallery goes where.
- `galleryName` is internal and is **never** returned publicly, and neither are image ids. A gallery's `status` is `draft` or `published`, like a post's, and a new gallery is `published` unless the request says otherwise.
- `PATCH /api/siteOwner/galleries/:id` is a full submission of the edit form, like a post edit: `images` is the complete current list, in order; an existing image carries its `id`, a new one has none, and any stored image missing from the list is deleted. `websiteId`, `status` and `slug` cannot be changed here.
- `DELETE /api/siteOwner/galleries/:id` works like deleting a post: every site owner gallery route then returns `404` "Gallery not found." for it, `GET /api/siteOwner/websites` leaves it out, and the public route never returns it. For 30 days it is in Recently Deleted, and restoring it (`POST /api/siteOwner/deleted/restore`) brings it back as it was deleted: its images, crops, `status` and `placement` (a published, placed gallery goes back on the client website). If another gallery on the website has taken its name since, that item fails with "A gallery with this name already exists." and the gallery stays deleted until that one is renamed. A gallery deleted by removing Photo Galleries isn't listed or restorable on its own ("Gallery not found."): adding Photo Galleries back within 30 days brings those galleries back (Abilities).
- **Recently Deleted** is one list per role of everything that viewer deleted in the last 30 days and can restore: `GET /api/siteOwner/deleted` gives the site owner's posts, galleries, updates and threads; `GET /api/admin/deleted` gives the admin's updates and threads. Newest `deletedAt` first across every type, a page at a time like the deleted posts list (`limit` 1–100, default 50, `nextCursor` beside `data`; after a restore the list is fetched again from the start). A `DeletedItem`'s `name` is the post name, gallery name, update title or thread subject; `websiteId` and `websiteName` name a post's or gallery's website and are `null` for mail. An item is named by its `type` and `id` (an update's `id` is its notification's). `restorableUntil` is `deletedAt` plus 30 days; after it the item leaves the list and can't be restored. Nothing is ever hard-deleted: the rows stay, as a deleted post's do. Abilities are not in it: turning one off is undone by turning it on, and removing one stays behind its confirmation. `GET /api/siteOwner/posts/deleted`, `DeletedPostSummary` and `POST /api/siteOwner/posts/:id/restore` remain until the frontend has moved to this list and the bulk routes, then are removed.
- **Bulk delete and restore.** The mailboxes and Recently Deleted act on the items the viewer ticks, one request for all of them, `{ items: [{ type, id }] }` with 1 to 100 items (an item sent twice is handled once):
  - `POST /api/siteOwner/deleted` and `POST /api/admin/deleted` move updates and threads from the viewer's own mailbox to Recently Deleted, in one transaction. For the admin an `update` is one they sent, hidden from their mailbox only; site owners keep it (withdrawing is separate).
  - `POST /api/siteOwner/deleted/restore` restores any type in the site owner's Recently Deleted; `POST /api/admin/deleted/restore` restores the admin's updates and threads. Each item is restored on its own, exactly as it was deleted (a post with its body, images and `status`, a gallery as above, mail with its read state), so one that fails doesn't stop the rest. A restored post or gallery revalidates its website after commit, once per website in a request.
  - Both answer `200` with what was done and `failed`, each failure with the message for it: "Update not found." or "Thread not found." (not in the mailbox, or not in Recently Deleted), "Post not found." or "Gallery not found.", or "A gallery with this name already exists.". A request where every item failed is still `200`. The frontend fetches its lists again from the start afterwards. Deleting isn't confirmed for one item, and is for 2 or more: "Delete {n} messages? You can restore them for 30 days."
- An ability is something the Client Portal lets a site owner update on their website themselves: `posts` or `galleries` (Photo Galleries). It belongs to a website. `abilities` on a website lists the ones it has, oldest first; a kind it doesn't have isn't listed, and the dashboard offers "+ Add" for it. Every website has `posts` from the moment it is created, and it can't be removed. A website must add `galleries` before creating a gallery (`403` otherwise).
- An ability's `status` says whether its code is wired into the client website: `added` → `live`. The site owner adds it, and the administrator sets it `live` once its component is in the site. Where its content goes is a separate thing, `placement`: `requested` once the site owner says where on their site it should appear, then `live` once the administrator has placed and styled it and the site owner approved the mock-up. A status never goes back to `added`, and nothing a site owner does to a post or gallery changes it. Where it goes is asked in a required message:
  - **Posts:** one placement, on the posts ability. The request form (`POST /api/siteOwner/abilities/:id/request`) is sent once, after the website's first post. Deleting posts, every one included, never changes the placement and never asks for the form again: a `requested` or `live` placement stays as it is, and the site owner changes it only through the edit form (`PATCH`). The administrator sets posts live with one switch (`PATCH /api/admin/abilities/:id/status`), which sets both their `placement` and, if still `added`, the ability's `status`.
  - **Photo Galleries:** a placement per gallery. Each gallery's own request message (`POST /api/siteOwner/galleries/:id/request`) is sent once, after that gallery is created, since two galleries usually go in different places. A gallery whose `requestedAt` is `null` still needs its message. The administrator sets the ability live on its own, with no request, once the gallery component is wired, and then each gallery live (`PATCH /api/admin/galleries/:id/placement`), which needs the ability live first. Deleting a gallery changes nothing on the ability.
  - **Changing where it goes:** a message already sent can be edited, live or not, with the same route as a `PATCH` (`PATCH /api/siteOwner/abilities/:id/request` for posts, `PATCH /api/siteOwner/galleries/:id/request` for a gallery). The edit replaces the note and puts that `placement` back to `requested` until the administrator moves the content and sets it `live` again. The ability's `status` stays as it is.
  - Sending or editing a message also emails the administrator; the response never waits for it (`docs/endpoints.md` → Request Emails).
- `turnedOn` is the site owner's switch, changeable only once `live`: while it is `false`, `GET /api/public/posts` returns `[]` for posts, and `GET /api/public/galleries/:slug` returns `404` for galleries. The site owner can still create and edit while it is off. An ability's pill reads "off" while it is `live` and `turnedOn` is `false`, else its status; posts and each gallery also show their `placement` ("requested" or "live") once their message is sent.
- `DELETE /api/siteOwner/abilities/:id` removes Photo Galleries from the website: its galleries are deleted with it, and the upload cleanup deletes their images 30 days later. Adding it again (`POST /api/siteOwner/abilities`) keeps the ability's status and switch, since removing it doesn't unwire its code; within those 30 days it also brings those galleries back, each with its own placement, and after 30 days they stay deleted. A removed ability isn't listed and is `404` "Ability not found." on every ability route.
- Crops: each gallery image may have a `thumbnailCrop` (a square) and a `mobileCrop` (at least as tall as it is wide), the part of the image the site owner chose for a thumbnail and for phones. A crop is in the stored image's pixels, the `width` and `height` Cloudinary returned, so a crop picked on a larger file in the browser is scaled to the stored size before it is sent. Send `null` (or leave it out on create) for no crop. A gallery's crops are consistent: every image has a thumbnail crop or none does, every image has a mobile crop or none does, and every mobile crop has the same shape (Validation rules). `PublicGallery` returns each crop as a ready `CroppedImage`, a Cloudinary URL that cuts that rectangle from the stored image, with the crop's own `width` and `height` for `<Image>`; it is `null` when there is no crop, and the client website then shows the full image.
- **Updates and threads** (the Inbox). The admin reaches site owners two ways, and they differ in whether a reply is possible:
  - An **update** (`Notification`) is one way: nobody replies to it. `kind` `general` is the admin's site-wide update (`POST /api/admin/notifications`), sent to every account that is an active site owner at that moment; an account created later never receives it. `kind` `automatic` is written by the backend when the administrator sets an ability live (`PATCH /api/admin/abilities/:id/status`) or a gallery live (`PATCH /api/admin/galleries/:id/placement`), to the active site owners linked to that website, in the same transaction as the change (none is written when the website has no active site owner). The wording: Photo Galleries "Your Photo Galleries are now live!" / "Photo Galleries are now part of [Website Name]. Add a gallery from your dashboard and send its request message to say where it goes."; posts "Your posts are now live!" / "Your posts now show on [Website Name]."; a gallery "Your gallery is on your website" / ""[Gallery Name]" is now live on [Website Name]." An update's `body` uses paragraph formatting (Paragraph formatting below).
  - A **thread** is a conversation between one site owner and the admin, which either side starts and both reply to: a site owner's suggestion or question (`POST /api/siteOwner/threads`), or the admin's message to one site owner (`POST /api/admin/threads`). Messages use paragraph formatting. A thread holds at most 100 messages; past that, a new thread is started.
- A site owner's updates are listed newest first, a page at a time, each with its own `readAt` (`null` until `POST /api/siteOwner/notifications/:id/read`, which keeps the first `readAt` when sent again). `GET /api/siteOwner/notifications/unreadCount` gives `updates` (unread updates) and `threads` (threads with a message they haven't read), so the navbar badge shows their sum. The admin's badge is `GET /api/admin/threads/unreadCount` (`threads` only: the admin receives no updates).
- The administrator can edit an update's `title` and `body` (`PATCH`), which keeps its recipients and their `readAt`, or withdraw it (`DELETE`), which removes it from every inbox, and every Recently Deleted, for good: every route then answers `404` "Update not found." for it.
- **Deleting mail is per viewer.** Either side deletes an update or a thread from its own mailbox only; the other side keeps its copy. Mail is deleted with the bulk delete below: the admin's own sent update is hidden from the admin only, with its read tally (site owners keep it; withdrawing is separate). A deleted item leaves that viewer's list and unread count, and every mailbox route of theirs answers `404` for it; restoring it from Recently Deleted brings it back with its read state for 30 days.
- **A reply brings a thread back:** when the other side writes in a thread you deleted, it returns to your mailbox, unread, and leaves your Recently Deleted, even after 30 days. A deleted thread never hides a new message.
- Mail nobody deleted never expires. `AdminNotification` gives counts only, `recipientCount` (how many it was sent to) and `readCount` (how many opened it), never who: the admin doesn't see which site owner read an update.
- A thread's `unread` is from the viewer's side: true while the other side has written a message since that side last marked it read (`POST .../threads/:id/read`). Writing a message, or starting the thread, never makes it unread for its author. Threads are listed newest activity (`lastMessageAt`) first, a page at a time; a thread that gets a message while paging moves to the top, so the list is fetched again from the start after a reply. A site owner sees only their own threads (another's is `404` "Thread not found."); the admin sees every site owner's, with `account` naming the site owner. A message's `from` says which side wrote it and `authorName` who.

### Error messages the frontend displays

| Situation                                                                                                             | Code | `error.message`                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| Login: no account, inactive account, unverified or invalid Google token                                               | 401  | You are not authorized to log in.                                                                                 |
| Any session route with no / expired / invalid cookie                                                                  | 401  | Your session expired, please sign in again.                                                                       |
| Wrong role                                                                                                            | 403  | You do not have access to this page.                                                                              |
| Missing CSRF header                                                                                                   | 403  | Request blocked.                                                                                                  |
| Validation failed                                                                                                     | 400  | Please fix the highlighted fields. (+ `fields`)                                                                   |
| Create account: email already exists                                                                                  | 409  | An account with this email already exists.                                                                        |
| New website: URL already exists                                                                                       | 409  | A website with this URL already exists. Select it from the dropdown.                                              |
| New website: URL belongs to an inactive website                                                                       | 409  | A website with this URL already exists but is inactive. It's named [Website Name]. Reactivate and then try again. |
| Gallery create, edit or restore: another gallery on this website (not deleted) has that name, in any case             | 409  | A gallery with this name already exists.                                                                          |
| Create a gallery on a website without the Photo Galleries ability                                                     | 403  | Add Photo Galleries to this website first.                                                                        |
| Add an ability the website already has (posts always)                                                                 | 409  | This ability has already been added.                                                                              |
| Posts request form: already requested or live                                                                         | 409  | This ability has already been requested.                                                                          |
| Request form for a Photo Galleries ability, sent or edited                                                            | 409  | Photo Galleries are requested one gallery at a time.                                                              |
| A gallery's request message sent twice                                                                                | 409  | This gallery has already been requested.                                                                          |
| Edit a gallery's request message before it is sent                                                                    | 409  | This gallery hasn't been requested yet.                                                                           |
| Edit the posts request form before it is sent                                                                         | 409  | This ability hasn't been requested yet.                                                                           |
| Turn on or off an ability that isn't live                                                                             | 409  | This ability can be turned on or off once it is live.                                                             |
| Remove posts                                                                                                          | 409  | Posts can't be removed.                                                                                           |
| Admin: set posts live before their request form is sent                                                               | 409  | This ability hasn't been requested yet.                                                                           |
| Admin: set live Photo Galleries already live, or posts already placed live                                            | 409  | This ability is already live.                                                                                     |
| Admin: set a gallery live before Photo Galleries is live                                                              | 409  | Set Photo Galleries live first.                                                                                   |
| Admin: set a gallery live before its request message is sent                                                          | 409  | This gallery hasn't been requested yet.                                                                           |
| Admin: set a gallery live that is already live                                                                        | 409  | This gallery is already live.                                                                                     |
| Reply to a thread that already has 100 messages                                                                       | 409  | This thread is full. Start a new thread.                                                                          |
| Update withdrawn, not found, not sent to this site owner, or deleted from this viewer's mailbox                       | 404  | Update not found.                                                                                                 |
| Thread not found, another site owner's, or deleted from this viewer's mailbox                                         | 404  | Thread not found.                                                                                                 |
| Link: account already linked to that website                                                                          | 409  | This account is already linked to [Website Name].                                                                 |
| Website / account / post / gallery / ability not found or not yours                                                   | 404  | [Website / Account / Post / Gallery / Ability] not found.                                                         |
| Public: no published gallery with that slug on this website                                                           | 404  | Gallery not found.                                                                                                |
| Create / edit: an image id that isn't on this post or gallery, or an image `src` outside this website's upload folder | 400  | Invalid image.                                                                                                    |
| Public: missing / unknown key, or inactive website                                                                    | 401  | Invalid API key.                                                                                                  |
| Request body over the 256 KB limit                                                                                    | 413  | Request body is too large.                                                                                        |
| Over a rate limit: login, the public API, upload signing or thread messages                                           | 429  | Too many requests. Please try again later.                                                                        |

### Validation rules (identical on frontend and backend)

- Every text field is trimmed first; a field that is blank after trimming counts as empty.
- `name` (account): required, max 100.
- `email`: required, valid email format, stored lowercase.
- `websiteName`: required, max 100.
- `websiteUrl`, image `src`: valid URL starting with `https://`. Website URLs are normalized by the backend (lowercase host, no trailing slash) before the uniqueness check and before saving. The uniqueness check treats `www.example.com` and `example.com` as the same website; the URL is stored as entered (it is also the revalidation target).
- Image `src` must also be a Cloudinary `secure_url` in the post's website's upload folder: `https://res.cloudinary.com/<cloud name>/image/upload/v<version>/<folder>/<file name>`, where `<folder>` is the `folder` in that website's `UploadSignature`. Checked on create and edit, for every image, new and existing. A `src` outside the folder is `400` "Invalid image." without `fields`, since the site owner can't fix it in the form.
- `postName`: required, max 100. `header`: optional, max 150. `subHeader`: optional, max 200.
- `postDate`: optional, valid date `YYYY-MM-DD`.
- `body`: a list of elements, each with `type` `paragraph` or `image`. At least 1 paragraph, max 5 paragraphs and max 5 images per post. Paragraph `text`: required, max 10000 (trimmed at the ends; line breaks inside are kept). Image element: `image` required, with `src`, `width`, `height`, `altText` all required; `width`/`height` whole numbers 1–10000; `altText` max 200.
- Paragraph links: every `[text](url)` in a paragraph's `text` (see Paragraph formatting) must have link text (max 100, after trimming) and a valid URL starting with `https://`. A failing link reports on that paragraph's `body.N.text`, with the message for the first failing link in the text (a link's text is checked before its URL).
- `status` (create / status): `draft` or `published` ("Status must be draft or published."). Optional on create; the status route needs it.
- `publishAt` (a post's or a gallery's, create / edit / Set Publish Date): optional on create and edit, required on Set Publish Date, an ISO 8601 instant with an offset ("Enter a valid date and time."), or `null` / blank to clear it. Only on a draft ("Only a draft can have a go-live date."): on create the body's `status` decides, which is `published` when left out; on edit and Set Publish Date the stored status does. It must be in the future ("Pick a go-live date after today.", since today's midnight has passed), except on edit and Set Publish Date when it is the go-live date already stored, so a form resent between two runs of the job doesn't fail. When more than one fails, the message is the first of these. On create the go-live check runs once every other field passes.
- `galleryName`: required, max 100, and unique among the website's galleries that aren't deleted, ignoring case (`409` "A gallery with this name already exists.", on create and edit; a gallery may keep its own name). The frontend checks it first, against the website's `galleries` summaries, and doesn't let the site owner submit a name that's taken; the 409 is the backend's fallback. `title`: optional, max 150. `copy`: optional, max 2000 (line breaks kept, plain text with no formatting markup).
- Gallery `images`: at least 1 ("Add at least one image."), at most 30 ("A gallery can have at most 30 images."), on `images`. Each image: `src`, `width`, `height`, `altText` as for a post image (the same upload folder rule); `caption` optional, max 300.
- Crops: `x` and `y` whole numbers from 0, `width` and `height` whole numbers from 1, and the rectangle inside the image (`x + width` at most the image's `width`, `y + height` at most its `height`). A `thumbnailCrop` must also be square ("Thumbnail crop must be a square inside the image."); a `mobileCrop` must be at least as tall as it is wide ("Mobile crop must be inside the image and at least as tall as it is wide."). The message is on `images.N.thumbnailCrop` or `images.N.mobileCrop` (on one of its numbers, such as `images.N.thumbnailCrop.x`, when that number isn't a whole number in range).
- Crops across a gallery, checked once every image passes its own rules, with the message on `images`: if any image has a `thumbnailCrop`, every image must ("Add a thumbnail crop to every image, or remove them all."); if any image has a `mobileCrop`, every image must ("Add a mobile crop to every image, or remove them all."); and every `mobileCrop`'s width ÷ height must be within 1% of the first one's in list order, which allows for whole-pixel rounding such as 750 × 938 for 4:5 ("Every mobile crop must be the same shape."). When more than one fails, the message is the first of these three.
- Gallery `status` (create / status): `draft` or `published` ("Status must be draft or published."). Optional on create; the status route needs it.
- Abilities: `kind` is `posts` or `galleries` ("Choose posts or galleries."). `requestNote` (an ability's or a gallery's): required, max 1000 (line breaks kept). `turnedOn`: a boolean ("Turned on must be true or false."). The admin's `status`: `live` ("Status must be live."). The admin's gallery `placement`: `live` ("Placement must be live.").
- Updates: `title` required, max 120; `body` required, max 10000 (line breaks kept), with the paragraph link rules on `body`.
- Threads: `subject` required, max 120; `message` required, max 5000 (line breaks kept), with the paragraph link rules on `message`. The admin's new thread also needs `accountId` ("Choose an account."), an active site owner (`404` "Account not found." otherwise).
- Deleted posts, Recently Deleted, updates and threads queries: `limit` and `cursor` as in the audit events query below.
- Bulk delete and restore: `items` a list of 1 to 100 (on `items`: "Choose at least one item." when missing, empty or not a list, "Choose at most 100 items." over 100). Each item's `type` is `update` or `thread` for a delete and the admin's restore ("Type must be update or thread."), and `post`, `gallery`, `update` or `thread` for the site owner's restore ("Type must be post, gallery, update or thread."), on `items.N.type`; its `id` a UUID ("Invalid id.", on `items.N.id`).
- Audit events query: `month` matches `YYYY-MM` with a month from 01 to 12 ("Enter a month as YYYY-MM."); `limit` is a whole number from 1 to 100 ("Limit must be a whole number from 1 to 100."); `cursor` is a UUID ("Invalid cursor."); `from` and `to` are ISO 8601 instants ("Enter a valid date and time."), sent together (on the missing one: "Send from and to together."), `to` after `from` (on `to`: "To must be after from.") and at most 31 days apart (on `to`: "The range can be at most 31 days."). A parameter sent twice fails its rule.

### Paragraph formatting

A paragraph's `text` is stored exactly as the site owner typed it. Four patterns in it are shown formatted; everything else is plain text.

- `**text**` is bold.
- `*text*` is italic.
- `***text***` is bold and italic.
- `[link text](https://…)` is a link.

Rules:

1. Read the text left to right. At each `[`, try a link; at `***`, try bold-italic; at `**`, try bold; at a single `*`, try italic. If the pattern doesn't complete, only its first character shows as typed, and reading continues with the next character (so `**a*` is a `*` followed by italic `a`).
2. A link is `[`, the link text (no `]` and no line break), `](`, the URL (no spaces, no line break and no `)`), then `)`. Because the URL ends at the first `)`, a URL that itself contains `)` can't be linked in v1.
3. Bold-italic ends at the next `***` on the same line, bold at the next `**`, and italic at the next `*`. While looking for the closing marker, a link (rule 2) is skipped whole, so markers inside its text or URL don't close the format. A format applies only when the text between the markers isn't empty and doesn't start or end with a space. Formatting never crosses a line break.
4. Bold, italic and bold-italic may contain links, and nothing else: any other markup inside them shows as typed. Link text is plain: markup inside it shows as typed.
5. `_text_` is not italic. There is one way to write each format.
6. HTML is never stored or rendered. `<`, `>` and `&` in the text show as typed. A renderer builds elements from the text and never sets raw HTML.
7. Bold renders as `<b>`, italic as `<i>`, and bold-italic as `<b><i>…</i></b>`, so one CSS rule styles them the same everywhere. A link renders as `<a>` with its URL as `href`, inside any format around it. A link is built only when its URL starts with `https://`; otherwise its characters show as typed (saving rejects such a link, but the preview shows unsaved text). Whether a link opens in a new tab is up to the renderer.

Line breaks are kept as in any paragraph. The dashboard (post page and preview) and the client website template must render identically, and both test against the examples below. The output column is written as HTML to show the result; renderers build the equivalent elements.

Rendering examples:

| Input                                                     | Output                                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `Hello **world**`                                         | `Hello <b>world</b>`                                                         |
| `An *easy* walk`                                          | `An <i>easy</i> walk`                                                        |
| `See [our menu](https://example.com/menu).`               | `See <a href="https://example.com/menu">our menu</a>.`                       |
| `**Bold** and *italic* and [a link](https://example.com)` | `<b>Bold</b> and <i>italic</i> and <a href="https://example.com">a link</a>` |
| `5 * 3 * 2`                                               | `5 * 3 * 2`                                                                  |
| `** not bold **`                                          | `** not bold **`                                                             |
| `*open`                                                   | `*open`                                                                      |
| `[no url]`                                                | `[no url]`                                                                   |
| `[menu] (https://example.com)`                            | `[menu] (https://example.com)`                                               |
| `**across` + line break + `lines**`                       | `**across` + line break + `lines**`                                          |
| `_not italic_`                                            | `_not italic_`                                                               |
| `**a *b* c**`                                             | `<b>a *b* c</b>`                                                             |
| `[**Menu**](https://example.com)`                         | `<a href="https://example.com">**Menu**</a>`                                 |
| `<b>hi</b> & more`                                        | `&lt;b&gt;hi&lt;/b&gt; &amp; more` (shown as typed)                          |
| `***both***`                                              | `<b><i>both</i></b>`                                                         |
| `*** spaced ***`                                          | `*** spaced ***`                                                             |
| `**a*`                                                    | `*<i>a</i>`                                                                  |
| `**[our menu](https://example.com/menu)**`                | `<b><a href="https://example.com/menu">our menu</a></b>`                     |
| `*see [the map](https://example.com/map)*`                | `<i>see <a href="https://example.com/map">the map</a></i>`                   |
| `***[both](https://example.com)***`                       | `<b><i><a href="https://example.com">both</a></i></b>`                       |
| `**[a](https://example.com/**x)**`                        | `<b><a href="https://example.com/**x">a</a></b>`                             |
| `[menu](http://example.com)` (preview only)               | `[menu](http://example.com)`                                                 |

Rejected examples (`400` on `body.N.text`):

| Input                                           | Field message                                        |
| ----------------------------------------------- | ---------------------------------------------------- |
| `[menu](http://example.com)`                    | Each link must be a valid URL starting with https:// |
| `[menu](javascript:alert(1))`                   | Each link must be a valid URL starting with https:// |
| `**[menu](http://example.com)**`                | Each link must be a valid URL starting with https:// |
| `[ ](https://example.com)`                      | Each link needs link text.                           |
| `[` + 101 characters + `](https://example.com)` | Link text must be 100 characters or fewer.           |

---

## Middleware Stack

`app.js` first sets `app.set('trust proxy', 2)`: on Render (staging and production) two proxies sit in front of the API, Cloudflare and then Render's load balancer, and each appends to `X-Forwarded-For`. So `req.ip`, which the rate limits and the audit log need, is the client's address two entries from the end. It is a count, never `true`, because Render keeps an `X-Forwarded-For` the client sends, so the entries further left can be faked. Locally there is one proxy (Next's dev rewrite) and Express stops at the leftmost entry.

Applied in `app.js` / `api/index.js`, in this order:

1. `helmet()` — standard security headers.
2. `cors({ origin: process.env.CORS_ORIGIN, credentials: true, allowedHeaders: ['Content-Type', 'X-CSRF-Protection', 'Authorization'] })` — exact origin, never a wildcard.
3. `express.json({ limit: '256kb' })` and `cookie-parser`. The limit is set explicitly (Express defaults to 100kb) so a post at its validation limits always fits.
4. `requireCsrfHeader` — every `POST` / `PATCH` / `DELETE` without `X-CSRF-Protection: 1` returns `403`. `GET` passes through.
5. Routers mounted at `/api/auth`, `/api/admin`, `/api/siteOwner`, `/api/public`, plus `GET /api/health`.
6. A catch-all for unknown routes — `404` "Not found.", so they get the JSON envelope instead of Express's HTML page.
7. The single error handler from `errors/` — every error leaves the server as the `{ error: { message, fields? } }` envelope. A malformed JSON body (rejected by `express.json()`) is `400` "Invalid request body."; a body over the limit is `413` "Request body is too large." Unexpected errors are logged and returned as a generic 500.

Per-router guards:

- `/api/admin/*` → `requireAuth` then `requireRole('admin')`.
- `/api/siteOwner/*` → `requireAuth` then `requireRole('site_owner')`.
- `/api/public/*` → `invalidApiKeyRateLimit`, `requireApiKey`, then `publicApiRateLimit` (no cookie, no CSRF header — this is a server-to-server `GET`).

Rate limits (`lib/rateLimit.js`, express-rate-limit, in-memory per instance). Over a limit → `429` "Too many requests. Please try again later.", with the standard `RateLimit` and `RateLimit-Policy` headers. The numbers are a few times real use of each route, to be tuned from the audit log after launch:

| Route                                                                                          | Limit         | Keyed by   |
| ---------------------------------------------------------------------------------------------- | ------------- | ---------- |
| `POST /api/auth/login`                                                                         | 5 per 15 min  | IP         |
| `GET /api/public/*`, valid key                                                                 | 30 per minute | website    |
| `GET /api/public/*`, refused key                                                               | 10 per minute | IP         |
| `POST /api/siteOwner/uploads/sign`                                                             | 10 per 15 min | site owner |
| `POST /api/siteOwner/threads` and `POST /api/siteOwner/threads/:id/messages`, counted together | 20 per 15 min | site owner |

The public valid-key limit counts every public route together (posts and galleries) and is keyed by website, not IP, because client websites on Vercel share outgoing IP addresses. The refused-key limit counts only `requireApiKey`'s 401s, so a website's valid calls never use it up.

`requireAuth`: reads the `session` cookie, verifies the JWT (`lib/jwt.js`), then loads the account by `sub`. If the cookie is missing, the JWT is invalid/expired, its `sv` doesn't match the account's `sessionVersion` (ended by a logout), or the account no longer exists or is inactive → clear the cookie and return `401` "Your session expired, please sign in again." Otherwise sets `req.user = { id, name, email, role }`. Clearing the cookie on a bad token matters: the frontend `proxy.js` redirects on cookie _presence_, so a dead cookie must not be left behind.

`requireRole(role)`: `req.user.role !== role` → `403` "You do not have access to this page."

`requireApiKey`: reads `Authorization: Bearer <apiKey>`, hashes it with SHA-256 (`lib/crypto.js`), looks up `website` by `api_key_hash`. Missing header, no match, or `website.active === false` → `401` "Invalid API key." Otherwise sets `req.website`.

---

## Session Cookie

- Name: `session`. Value: a JWT signed with `JWT_SECRET`, payload `{ sub: account.id, role, sv: account.sessionVersion }`, expires in **24 hours** (fixed — no refresh tokens, no sliding expiry).
- `sv` is the account's session version. Logout increments it, so every cookie issued before then stops working (Logout).
- Production: `httpOnly: true, secure: true, sameSite: 'lax', domain: COOKIE_DOMAIN (.3dwebdev.com), path: '/', maxAge: 24h`.
- Local: `httpOnly: true, secure: false, sameSite: 'lax'`, no domain (the frontend dev proxy makes the backend same-origin).
- The token is **only** ever in the `Set-Cookie` header — never in a JSON body.

---

## Auth

### Login — `POST /api/auth/login`

1. Body `{ credential }` — the Google ID token from the frontend's Google sign-in button.
2. Verify it with `google-auth-library` (`OAuth2Client.verifyIdToken`, `audience: GOOGLE_CLIENT_ID`) — this checks signature, expiry and that it was issued for our app.
3. Require `payload.email_verified === true`.
4. Look up the account by `payload.email` lowercased. Email only — the Google display name is never compared.
5. No account, or `account.active === false`, or any failure in steps 2–3 → `401` "You are not authorized to log in." (one message for every case, so nobody can probe which emails have accounts). The failure is written to the audit log with its reason (`invalid_token`, `no_account` with the verified email as the actor email, or `inactive` with the account as actor); the reason never reaches the response.
6. Success → write `auth.login_succeeded` to the audit log, set the session cookie and return `200 { data: { role } }`. The frontend uses `role` once, to route to `/admin` or `/dashboard`.

### Logout — `POST /api/auth/logout`

Ends **every** session of the account, then clears the `session` cookie (same options it was set with) and returns `204`.

- If the cookie verifies and carries an `sv`, increment the account's `sessionVersion` where it still equals that `sv`, and write `auth.logout` to the audit log, in one transaction. Every cookie issued before then, in this browser or any other, now fails `requireAuth`. The `sv` condition means an already-ended cookie sent again changes nothing.
- Works whether or not the cookie is valid: a missing or bad cookie changes nothing and is still `204`.

### Me — `GET /api/auth/me`

Behind `requireAuth`. Returns `200 { data: req.user }` → `{ id, name, email, role }`. The frontend's `/dashboard` and `/admin` layouts call this on load to know who is signed in after a page refresh.

---

## Admin

All admin routes: `requireAuth` + `requireRole('admin')`. `api_key_hash` and `webhook_secret_encrypted` are always excluded from every `select`.

### Get All Accounts — `GET /api/admin/accounts`

Every account where `role = site_owner` (active and inactive), sorted by `name`, each with its linked websites (via `account_website`), in the shape in the Endpoints table. Each website's abilities are the ones not removed, oldest first; its posts and galleries are the ones not deleted, drafts included, newest `createdAt` first. `imageCount` and the two crop flags are worked out from the gallery's `gallery_image` rows. No post or gallery content (API Contract → Notes). Powers the account list on `/admin`.

### Get All Websites — `GET /api/admin/websites`

Every **active** website, sorted by `websiteName`: `[{ id, websiteName, url, active }]`. Powers the website picker in Create an Account and Link a Website.

### Get Audit Events — `GET /api/admin/auditEvents`

The read-only audit log view, so the administrator can answer "who changed this?" without the Render Shell. Query `?month=YYYY-MM&from=&to=&limit=&cursor=`, all optional.

1. Validate the query with `validation/auditEvent.js` → `400` with `fields.month`, `fields.from`, `fields.to`, `fields.limit` or `fields.cursor`.
2. With `from` and `to`, read the `audit_event` rows created from `from` up to, not including, `to`, and ignore `month`. Otherwise read the rows created in that UTC month (from the 1st at 00:00 UTC up to, not including, the next month's), or in the current UTC month when `month` is absent. With a `cursor`, only rows whose `id` is below it. Ordered by `id` descending: UUIDv7 ids are time-ordered, so this is newest first.
3. Read `limit` + 1 rows (default 50); the extra row only tells whether another page follows. Beside it, count the rows in the whole month or range, ignoring the cursor.
4. Return `200 { data: AuditEvent[], nextCursor, pages }`: every column but `actorId` (`actorEmail` already names the actor), `nextCursor` the id of the page's last event when another page follows, else `null`, and `pages` the count divided by `limit`, rounded up.

Reading the log writes no audit event.

### Get Audit Event Months — `GET /api/admin/auditEvents/months`

Every UTC month with at least one `audit_event` row, as `YYYY-MM`, newest first: `200 { data: ["2026-10", "2026-09"] }`, or `[]` for an empty log. The Audit Events page's Previous / Next month controls step only through these months. No query parameters. `created_at` is a timestamp without time zone holding UTC, so its month is read with `to_char(created_at, 'YYYY-MM')`. Not paginated, because the list is bounded by the calendar, not by use (`docs/scaling.md` §6). Reading it writes no audit event.

Get Audit Events and Get Audit Event Months are the only routes that read `audit_event`.

### Set an Ability Live — `PATCH /api/admin/abilities/:id/status`

Body `{ status: 'live' }`, the only value for now. Status apart from placement: API Contract → Notes.

1. Validate → `400` on `fields.status`.
2. The ability must exist and not be removed → `404` "Ability not found."
3. **Photo Galleries:** its `status` must be `added` → otherwise `409` "This ability is already live."
4. **Posts:** one switch for both. Its `placement` must be `requested` → `409` "This ability hasn't been requested yet." (`null`) or "This ability is already live." (`live`).
5. One transaction: set `status` to `live` (and, for posts, `placement` to `live`), write `ability.live`, and send the website's active site owners the automatic update (API Contract → Notes) with its `notification.sent`.
6. Return `200 { data: Ability }`. No revalidation: the public API already returns content whatever the status.

### Set a Gallery Live — `PATCH /api/admin/galleries/:id/placement`

Body `{ placement: 'live' }`, the only value (API Contract → Notes).

1. Validate → `400` on `fields.placement`.
2. The gallery must exist and not be deleted → `404` "Gallery not found."
3. Its website's Photo Galleries ability must be `live` → `409` "Set Photo Galleries live first."
4. Its `placement` must be `requested` → `409` "This gallery hasn't been requested yet." (`null`) or "This gallery is already live." (`live`).
5. One transaction: write `gallery.live`, set `placement` to `live`, and send the website's active site owners the automatic update with its `notification.sent`.
6. Return `200 { data: AdminGallerySummary }`. No revalidation: nothing public changes.

### Send an Update — `POST /api/admin/notifications`

Body `{ title, body }`.

1. Validate → `400` on `fields.title` / `fields.body`.
2. Read every active `site_owner` account.
3. One transaction: insert the `notification` (`kind` `general`, `created_by` the admin), one `notification_recipient` per account, and `notification.sent` with `{ recipientCount, kind }`.
4. Return `201 { data: AdminNotification }`.

### Get Updates — `GET /api/admin/notifications`

The updates in the admin's mailbox (not withdrawn, `admin_deleted_at` null), newest first (`id` descending), `limit` + 1 rows as Get Audit Events reads them: `200 { data: AdminNotification[], nextCursor }`. Automatic updates are listed too.

### Edit an Update — `PATCH /api/admin/notifications/:id`

Body `{ title, body }`; anything else is ignored. Validate → `400`; withdrawn, deleted from the admin's mailbox or not found → `404` "Update not found."; one transaction: `notification.updated` and the new title and body. Recipients and their `readAt` stay. Returns `200 { data: AdminNotification }`.

### Withdraw an Update — `DELETE /api/admin/notifications/:id`

Withdrawn, deleted from the admin's mailbox or not found → `404` "Update not found."; one transaction: `notification.withdrawn` and `deleted_at` set (never a hard delete). Returns `204`.

### Admin's Recently Deleted — `GET /api/admin/deleted`

In `api/admin/deleted.js`, as the site owner's Recently Deleted below, with the admin's two types:

- `GET /`: the updates and threads with `admin_deleted_at` in the last 30 days (withdrawn updates excluded) → `200 { data: DeletedItem[], nextCursor }`.
- `POST /` (bulk delete): an `update` must be in the admin's mailbox (not withdrawn, `admin_deleted_at` null) and gets `admin_deleted_at` now with `notification.deleted`; a `thread` must have `admin_deleted_at` null and gets it now with `thread.deleted`. Site owners' copies are left as they are.
- `POST /restore`: an `update` must not be withdrawn and have `admin_deleted_at` within the last 30 days, a `thread` `admin_deleted_at` within the last 30 days; each clears it with `notification.restored` or `thread.restored`.

### Admin Threads — `/api/admin/threads`

- `POST /` body `{ accountId, subject, message }`: validate → `400`; `accountId` must be an active `site_owner` → `404` "Account not found."; one transaction: the thread (`account_id` the site owner, `admin_read_at` and `last_message_at` now), its first message and `thread.started`. Returns `201 { data: AdminThread }`.
  Every route below reads only threads in the admin's mailbox (`admin_deleted_at` null); any other is `404` "Thread not found."

- `GET /` lists every thread in the admin's mailbox, `last_message_at` then `id` descending, with Prisma's cursor: `200 { data: AdminThreadSummary[], nextCursor }`.
- `GET /unreadCount` → `200 { data: { threads } }`, the threads in the mailbox unread for the admin.
- `GET /:id` → `200 { data: AdminThread }`, or `404` "Thread not found."
- `POST /:id/messages` body `{ message }`: validate → `400`; not found → `404`; one transaction: `last_message_at` and `admin_read_at` set to now and `owner_deleted_at` cleared, so a thread the site owner deleted comes back to them (the update locks the thread's row), at 100 messages already → `409` "This thread is full. Start a new thread.", the message, and `thread.replied`. Returns `201 { data: AdminThread }`.
- `POST /:id/read` sets `admin_read_at` to now → `200 { data: AdminThreadSummary }`. Not audited.
- Deleting and restoring a thread is the bulk routes' (Admin's Recently Deleted).

### Create an Account — `POST /api/admin/accounts`

Body: `{ name, email, websiteId }` (link an existing website) **or** `{ name, email, websiteName, websiteUrl }` (create a new website).

1. Validate with `validation/account.js` + `validation/website.js` (zod). Exactly one of `websiteId` or (`websiteName` + `websiteUrl`) → otherwise `400`.
2. Lowercase the email. If an account with that email exists → `409` "An account with this email already exists."
3. **Existing website path** (`websiteId`): the website must exist and be active → otherwise `404` "Website not found." In one transaction: insert `account` (role `site_owner`), insert the `account_website` row. No key or secret is generated.
4. **New website path** (`websiteName` + `websiteUrl`): normalize the URL (`lib/normalizeUrl.js`). If a website with that URL exists, with or without a leading `www.` (`urlVariants`) → `409` "A website with this URL already exists. Select it from the dropdown." If that website is inactive (so it is not in the dropdown), the `409` names it instead: "A website with this URL already exists but is inactive. It's named [Website Name]. Reactivate and then try again." Generate the API key and webhook secret with `lib/crypto.js`, hash the key, encrypt the secret. Derive the website's `media_folder` from the normalized URL (`docs/setup.md` → Image Hosting). In one transaction: insert `account`, insert `website` (with `api_key_hash`, `webhook_secret_encrypted`, `media_folder`), insert its `posts` ability (`added`, Abilities), insert the `account_website` row — four inserts, if any fails nothing is saved.
5. Return `201 { data: { account, website, credentials? } }`. `credentials: { apiKey, webhookSecret }` (plaintext) is included **only** on the new-website path, and only in this one response.

### Link a Website — `POST /api/admin/accounts/:id/websites`

Gives an existing site owner another website. Body: `{ websiteId }` **or** `{ websiteName, websiteUrl }`.

1. `:id` must be an existing `site_owner` account → otherwise `404` "Account not found."
2. Validate the body exactly as in Create an Account (minus `name` / `email`).
3. **Existing website path**: website must exist and be active (`404` "Website not found."). If this account is already linked to it → `409` "This account is already linked to [Website Name]." Insert the `account_website` row only.
4. **New website path**: identical to Create an Account step 4, minus the account insert — website, its `posts` ability and `account_website` in one transaction, generate key and secret.
5. Return `201 { data: { website, credentials? } }` — `credentials` only on the new-website path.

---

## Site Owner

All site-owner routes: `requireAuth` + `requireRole('site_owner')`.

**Ownership check (every route below):** the account comes from `req.user` (the session), never from anything the client sends. A website belongs to the site owner when an `account_website` row links `req.user.id` to it **and** `website.active = true`. A post or a gallery belongs to the site owner when its website does **and** it is not deleted (`deletedAt` null). Recently Deleted Posts, Restore a Post and Recently Deleted's list and restore are the one exception: they read only posts and galleries deleted in the last 30 days, through the same website check. The shared checks are in `lib/ownership.js`. Anything that fails the check returns `404` — identical to "doesn't exist".

### Get All Websites Tied To the Account — `GET /api/siteOwner/websites`

The site owner's active websites (via `account_website`), sorted by `websiteName`, in the shape in the Endpoints table: abilities not removed, oldest first; post and gallery summaries not deleted, drafts included, each newest `createdAt` first. No post body or gallery images: they load with the single post or gallery. Powers the `/dashboard` list and the website dropdown in Create a Post and Create a Gallery.

### Create a Post — `POST /api/siteOwner/posts`

1. Validate with `validation/post.js` — the backend re-validates everything regardless of what the frontend checked.
2. Ownership check on `websiteId` → `404` "Website not found." if it fails.
3. Every image `src` must be in the website's upload folder (Validation rules) → otherwise `400` "Invalid image."
4. One transaction: insert the post (`status` defaults to `published`; a published post gets `publishedAt` now), then its body in order (each image element's image, then every element with its position). If any insert fails the whole create rolls back — no orphaned post.
5. Return `201 { data: Post }`.
6. After the transaction has committed, call `revalidate(website.id, { postId: post.id })` (see Revalidation). Do not await it before responding.

### Get a Post by ID — `GET /api/siteOwner/posts/:id`

Ownership check → `404` "Post not found." Returns `200 { data: Post }` including `websiteName`, and the body in order. Powers `/dashboard/post/[id]` and pre-fills the Edit form.

### Edit a Post — `PATCH /api/siteOwner/posts/:id`

Request body: the full edit form, `{ postName, header, subHeader, postDate, publishAt?, body }` (API Contract → Notes). `websiteId` and `status` are stripped: a post never moves websites, and its status changes only through the status route.

1. Validate with `validation/post.js`.
2. Ownership check → `404` "Post not found."
3. The go-live date against the stored post (`validation/fields.js` → `assertPublishAtAllowed`): one on a published post, or a new one that has passed → `400` on `fields.publishAt` (Validation rules).
4. Every image `id` (inside `body`) must belong to this post and appear only once, and every image `src` must be in the post's website's upload folder → otherwise `400` "Invalid image." (stops editing another post's images by guessing ids, and saving an image uploaded for another website).
5. One transaction:
   - Update the post's own fields.
   - Body: the post's elements are deleted and rewritten in the new order. Stored images whose `id` is missing from the body → delete; images with an `id` → update; images without → insert. Image ids stay stable across edits; elements are re-created.
   - `updated_at` refreshes automatically (`@updatedAt`).
   - If any part fails, nothing is changed.
6. Return `200 { data: Post }`, then call `revalidate(post.websiteId, { postId: post.id })` after commit.

### Draft / Publish — `PATCH /api/siteOwner/posts/:id/status`

Body `{ status: 'draft' | 'published' }`.

1. Validate with `validation/post.js` → `400` on `fields.status`.
2. Ownership check → `404` "Post not found."
3. One transaction: write `post.drafted` or `post.published` to the audit log, and set `post.status` (`lib/status.js` → `toStatusData`). Publishing a draft also clears `publishAt` and sets `publishedAt` to now; drafting sets `publishedAt` to `null`.
4. Return `200 { data: Post }`, then call `revalidate(post.websiteId, { postId: post.id })` after commit.

### Set a Post's Publish Date — `PATCH /api/siteOwner/posts/:id/publishAt`

Body `{ publishAt }`: a go-live date, or `null` to clear it. It is required ("Enter a valid date and time." when left out). The post's page sets it without the full edit form.

1. Validate with `validation/fields.js` → `publishAtSchema` → `400` on `fields.publishAt`.
2. Ownership check → `404` "Post not found."
3. The go-live date against the stored post, as on Edit a Post → `400` on `fields.publishAt`.
4. One transaction: write `post.updated` to the audit log and set `publishAt`.
5. Return `200 { data: Post }`. No revalidation: only a draft has a go-live date, so the client website shows nothing new.

### Delete a Post — `DELETE /api/siteOwner/posts/:id`

A soft delete (API Contract → Notes): the row stays in the database with `deleted_at` stamped.

1. Ownership check → `404` "Post not found." A post already deleted fails it too (every site owner post route but Recently Deleted Posts and Restore a Post reads only posts whose `deletedAt` is null).
2. One transaction: write `post.deleted` to the audit log, set `post.deletedAt` to now and clear `publishAt`. The posts placement is left as it is, even when this was the website's last post.
3. Return `204`, then call `revalidate(post.websiteId, { postId: post.id })` after commit, so the post leaves the client website.

No request body. The post's elements and image rows are kept. The upload cleanup deletes its images from Cloudinary 30 days after `deleted_at` (`docs/setup.md` → Upload cleanup), so until then the site owner can restore it, with its images (Restore a Post).

### Recently Deleted Posts — `GET /api/siteOwner/posts/deleted`

Query `limit` and `cursor` (API Contract → Notes).

1. Validate with `validation/post.js` → `400` on `fields.limit` / `fields.cursor`.
2. Read the posts whose `deletedAt` is within the last 30 days (`DELETED_GRACE_MS`, the upload cleanup's cutoff) on the account's active websites (the ownership check as a filter), ordered by `deletedAt` then `id`, newest first, one more than `limit` to tell whether another page follows. The cursor is Prisma's own (`cursor: { id }`), since the order isn't the id's.
3. Return `200 { data: DeletedPostSummary[], nextCursor }`. No body or images.

Registered before `GET /api/siteOwner/posts/:id`, so `deleted` is never read as an id.

### Restore a Post — `POST /api/siteOwner/posts/:id/restore`

No request body.

1. Ownership check, on deleted posts this time: the post's website is the site owner's and active, and its `deletedAt` is within the last 30 days → otherwise `404` "Post not found." (a post that isn't deleted, deleted too long ago, or not yours).
2. One transaction: write `post.restored` to the audit log and set `post.deletedAt` to `null`. The post keeps its `status`, and posts `placement` is left as it is.
3. Return `200 { data: Post }`, then call `revalidate(post.websiteId, { postId: post.id })` after commit, so a published post is back on the client website.

The restore and the upload cleanup share the cutoff, and it only moves forward, so a post that can be restored still has its images.

### Create a Gallery — `POST /api/siteOwner/galleries`

The gallery routes live in `api/siteOwner/galleries.js`, mounted at `/api/siteOwner/galleries` behind the site owner router's guards.

1. Validate with `validation/gallery.js`.
2. Ownership check on `websiteId` → `404` "Website not found."
3. The website must have the Photo Galleries ability, not removed → otherwise `403` "Add Photo Galleries to this website first." (Abilities). The other gallery routes need no such check: removing the ability deletes the website's galleries.
4. Every image `src` must be in the website's upload folder → otherwise `400` "Invalid image."
5. One transaction: check no other gallery on the website (not deleted) has the name in any case (`409` "A gallery with this name already exists."), generate the slug (`lib/slug.js`, `docs/setup.md` → Gallery slugs), insert the gallery (`status` defaults to `published`; a published gallery gets `publishedAt` now), insert its images in list order with their positions and crop columns, and write `gallery.created` to the audit log. If any insert fails, nothing is saved. The transaction is `Serializable`, so two creates on one website at the same moment can't both pass the name check: Postgres fails one (a serialization failure, or a unique index clash), and it is retried once, which answers the 409 for the same name, or saves a different name with its own slug.
6. Return `201 { data: Gallery }`, then call `revalidate(website.id, { galleryId: gallery.id })` after commit.

### Get a Gallery by ID — `GET /api/siteOwner/galleries/:id`

Ownership check → `404` "Gallery not found." Returns `200 { data: Gallery }`, its images in order with their crops. Powers the gallery page and pre-fills the Edit form.

### Edit a Gallery — `PATCH /api/siteOwner/galleries/:id`

Request body: the full edit form, `{ galleryName, title, copy, publishAt?, images }`. `websiteId`, `status` and `slug` are not accepted here (zod strips them).

1. Validate with `validation/gallery.js`.
2. Ownership check → `404` "Gallery not found."
3. The go-live date against the stored gallery, as on Edit a Post → `400` on `fields.publishAt`.
4. Every image `id` must belong to this gallery and appear only once, and every image `src` must be in the website's upload folder → otherwise `400` "Invalid image."
5. One transaction: check the name as on create (another gallery's name is `409`; its own name, in any case, is fine), update the gallery's fields (the slug never changes), delete stored images whose `id` is missing from the list, update each kept image (its new position included), insert the new ones, and write `gallery.updated` to the audit log. If any part fails, nothing is changed.
6. Return `200 { data: Gallery }`, then call `revalidate(gallery.websiteId, { galleryId: gallery.id })` after commit.

### Draft / Publish a Gallery — `PATCH /api/siteOwner/galleries/:id/status`

Body `{ status: 'draft' | 'published' }`. Validate (`400` on `fields.status`), ownership check (`404` "Gallery not found."), then in one transaction write `gallery.drafted` or `gallery.published` and set `status`, `publishAt` and `publishedAt` as on Draft / Publish. Return `200 { data: Gallery }`, then revalidate after commit.

### Set a Gallery's Publish Date — `PATCH /api/siteOwner/galleries/:id/publishAt`

Body `{ publishAt }`, as on Set a Post's Publish Date: validate, ownership check (`404` "Gallery not found."), check the go-live date against the stored gallery, then in one transaction write `gallery.updated` and set `publishAt`. Return `200 { data: Gallery }`, with no revalidation.

### Request a Gallery — `POST /api/siteOwner/galleries/:id/request`

Body `{ requestNote }`, sent once per gallery (API Contract → Notes).

1. Validate → `400` on `fields.requestNote`. Ownership check → `404` "Gallery not found."
2. The gallery's `requestedAt` must be `null` → otherwise `409` "This gallery has already been requested."
3. One transaction: set the gallery's `requestNote`, `requestedAt` and `placement` (`requested`), and write `gallery.requested` (without the note). The ability isn't changed.
4. Return `200 { data: Gallery }`, then call `sendRequestEmail` (Request Emails) after commit, not awaited. No revalidation: nothing public changes.

Galleries made before this route (the `backfill_gallery_request` migration) have `requestedAt` set to when they were created and no note, so no message is asked for them.

### Edit a Gallery's Request — `PATCH /api/siteOwner/galleries/:id/request`

Body `{ requestNote }`, live or not (API Contract → Notes).

1. Validate → `400` on `fields.requestNote`. Ownership check → `404` "Gallery not found."
2. The gallery's `requestedAt` must be set → otherwise `409` "This gallery hasn't been requested yet." A gallery backfilled with `requestedAt` and no note can be edited, which gives it one.
3. One transaction, as in Request a Gallery: replace the gallery's `requestNote`, set `requestedAt` to now and `placement` back to `requested`, and write `gallery.request_updated` (without the note). The ability isn't changed.
4. Return `200 { data: Gallery }`, then call `sendRequestEmail` after commit, not awaited.

### Delete a Gallery — `DELETE /api/siteOwner/galleries/:id`

A soft delete, like Delete a Post. Ownership check (`404` "Gallery not found.", a gallery already deleted included), then in one transaction write `gallery.deleted`, set `deletedAt` to now and clear `publishAt`. Return `204`, then revalidate after commit. The gallery's image rows are kept; the upload cleanup deletes its images from Cloudinary 30 days after `deleted_at`, and its slug stays taken, so a new gallery never reuses it.

A deleted gallery is restored from Recently Deleted (`POST /api/siteOwner/deleted/restore`, below).

### Abilities

The ability routes live in `api/siteOwner/abilities.js`, mounted at `/api/siteOwner/abilities` behind the site owner router's guards. An ability is one `website_ability` row per website and kind (`docs/setup.md`), reused when a removed ability is added again. It belongs to the site owner when its website does and it isn't removed (`lib/abilities.js` → `findOwnedAbility`); anything else is `404` "Ability not found." Every change writes its audit event in the same transaction, with the ability's whole state after the change in `metadata` (Audit Log).

**Add — `POST /api/siteOwner/abilities`**, body `{ websiteId, kind }`.

1. Validate. Ownership check on `websiteId` → `404` "Website not found."
2. The website already has it (a row that isn't removed; `posts` always) → `409` "This ability has already been added."
3. One transaction, one of three:
   - **No row:** insert it (`added`, on) and write `ability.added`.
   - **Removed less than 30 days ago:** clear `removedAt`, and clear `deletedAt` on the website's galleries whose `deletedAt` equals the ability's `removedAt` (the ones the removal deleted; galleries deleted one by one before stay deleted), writing `gallery.restored` for each, then `ability.restored`. The status, switch and request note are kept, and each gallery keeps its placement. 30 days is `DELETED_GRACE_MS` (`lib/retention.js`), the time the upload cleanup keeps a deleted gallery's images.
   - **Removed longer ago:** clear `removedAt`, keeping the status and switch (removing doesn't unwire the code); the galleries stay deleted → `ability.added`.
4. Return `201 { data: Ability }`. After a restore, call `revalidate(websiteId, { ability })` after commit, since the galleries return to the website.

**Request form — `POST /api/siteOwner/abilities/:id/request`**, body `{ requestNote }`. Posts only; when it is sent is in API Contract → Notes.

1. Validate → `400` on `fields.requestNote`. Ownership check → `404`.
2. A galleries ability → `409` "Photo Galleries are requested one gallery at a time."
3. `placement` must be `null` → otherwise `409` "This ability has already been requested." The backend doesn't check that the website has a post: the frontend's dialog keeps that order, and a request sent before any post only flags the dashboard early.
4. One transaction: set `placement` to `requested`, and `requestNote` and `requestedAt` (replacing any earlier ones), and write `ability.requested` (without the note). The `status` is left as it is.
5. Return `200 { data: Ability }`, then call `sendRequestEmail` (Request Emails) after commit, not awaited.

**Edit the request form — `PATCH /api/siteOwner/abilities/:id/request`**, body `{ requestNote }`. Posts only, live or not.

1. Validate → `400` on `fields.requestNote`. Ownership check → `404`.
2. A galleries ability → `409` "Photo Galleries are requested one gallery at a time." (each gallery's message is edited on the gallery).
3. `requestedAt` must be set (the form was sent) → otherwise `409` "This ability hasn't been requested yet."
4. One transaction: set `placement` to `requested`, replace `requestNote`, set `requestedAt` to now, and write `ability.request_updated` (without the note). The `status` is left as it is. The new `requestedAt` is what a later new first post is compared with.
5. Return `200 { data: Ability }`, then call `sendRequestEmail` after commit, not awaited.

**On / Off — `PATCH /api/siteOwner/abilities/:id/turnedOn`**, body `{ turnedOn }`.

1. Validate → `400` on `fields.turnedOn`. Ownership check → `404`.
2. `status` must be `live` → `409` "This ability can be turned on or off once it is live."
3. Already as asked: return `200 { data: Ability }` with no change, event or revalidation.
4. One transaction: set `turnedOn` and write `ability.turned_on` or `ability.turned_off`.
5. Return `200 { data: Ability }`, then `revalidate(websiteId, { ability })` after commit.

**Remove — `DELETE /api/siteOwner/abilities/:id`**. No body.

1. Ownership check → `404` (a removed ability included).
2. `posts` → `409` "Posts can't be removed."
3. One transaction, with one time `now`: set `deletedAt = now` and clear `publishAt` on the website's galleries that aren't deleted (`gallery.deleted` for each), set the ability's `removedAt = now`, and write `ability.removed`.
4. Return `204`, then `revalidate(websiteId, { ability })` after commit.

### Sign an Upload — `POST /api/siteOwner/uploads/sign`

Body `{ websiteId }`. Returns what the frontend needs to upload images for one website straight to Cloudinary (API Contract → Notes). The backend never receives the image file and writes nothing to the database. Rate limited per site owner (Middleware Stack → Rate limits).

1. Validate `{ websiteId }` → `400` with `fields.websiteId`.
2. Ownership check on `websiteId` → `404` "Website not found."
3. Build every signed parameter on the backend; none comes from the request:
   - `folder`: `<CLOUDINARY_FOLDER>/<website.mediaFolder>` (`3dwd/steviethedog` in production)
   - `timestamp`: now, in Unix seconds
   - `allowed_formats`: `jpg,jpeg,png,webp`
   - `transformation`: `c_limit,w_2500,h_2500` (applied as the image is stored: scaled down to fit, never up)
4. Sign them with `CLOUDINARY_API_SECRET`, by Cloudinary's signed-upload rule: the parameters sorted by name, joined as `key=value` with `&`, the secret appended, then the SHA-1 hex digest.
5. Return `200 { data: { uploadUrl, fields } }`. `uploadUrl` is `https://api.cloudinary.com/v1_1/<CLOUDINARY_CLOUD_NAME>/image/upload`. `fields` holds the signed parameters, `signature`, and `api_key` (`CLOUDINARY_API_KEY`, which Cloudinary treats as public).

`CLOUDINARY_API_SECRET` is never returned or logged.

---

### Inbox Updates — `/api/siteOwner/notifications`

A site owner reaches an update only through their own `notification_recipient` row, never a withdrawn one, and not one they deleted (`deleted_at` set); anything else is `404` "Update not found."

- `GET /` lists them newest first (`notification_id` descending, the cursor a notification id): `200 { data: Notification[], nextCursor }`.
- `GET /unreadCount` → `200 { data: { updates, threads } }`, counting neither deleted updates nor threads the site owner deleted.
- `POST /:id/read` sets `read_at` if it is still `null` → `200 { data: Notification }`. Not audited.
- Deleting and restoring an update is the bulk routes' (Recently Deleted, below).

### Threads — `/api/siteOwner/threads`

Only threads whose `account_id` is the site owner's and that they haven't deleted (`owner_deleted_at` null); anything else is `404` "Thread not found." `POST /` and `POST /:id/messages` share one rate limit (Middleware Stack).

- `POST /` body `{ subject, message }`: validate → `400`; one transaction: the thread (`owner_read_at` and `last_message_at` now), its first message and `thread.started`. Returns `201 { data: Thread }`.
- `GET /` → `200 { data: ThreadSummary[], nextCursor }`, ordered as the admin's.
- `GET /:id` → `200 { data: Thread }`.
- `POST /:id/messages` body `{ message }`: as the admin's reply, with `owner_read_at`, clearing `admin_deleted_at`. Returns `201 { data: Thread }`.
- `POST /:id/read` sets `owner_read_at` to now → `200 { data: ThreadSummary }`. Not audited.
- Deleting and restoring a thread is the bulk routes' (Recently Deleted, below).

### Recently Deleted — `/api/siteOwner/deleted`

The routes live in `api/siteOwner/deleted.js` and `api/admin/deleted.js`, the list's merge and the bulk runner in `lib/deleted.js`.

**List — `GET /`**, query `limit` and `cursor` (API Contract → Notes).

1. Validate with `validation/deleted.js` → `400` on `fields.limit` / `fields.cursor`.
2. Four sources, each with the account's restorable rows: posts and galleries as the bulk restore reads them, the account's `notification_recipient` rows with `deleted_at` in the last 30 days (withdrawn updates excluded; the item's `id` is the `notification_id`), and its threads with `owner_deleted_at` in the last 30 days.
3. With a `cursor`, its item's deletion time is looked up in the sources; if it is in none (restored since), the answer is an empty page with `nextCursor` `null`. Each source then reads `limit` + 1 rows after the cursor in (`deletedAt`, `id`) descending order, the rows are merged and sorted the same way, and the first `limit` are the page. No raw SQL: every source is a plain Prisma query.
4. Return `200 { data: DeletedItem[], nextCursor }`.

**Bulk delete — `POST /`**, body `{ items }`, updates and threads.

1. Validate with `validation/deleted.js` → `mailItemsSchema` → `400` on `fields.items` / `fields.items.N.type` / `fields.items.N.id`.
2. One transaction for the batch, each distinct item in the order sent (`lib/deleted.js` → `runPerItem`): an `update` must be the site owner's own copy in their Inbox (not withdrawn, `deleted_at` null), and gets `deleted_at` now with `notification.deleted`; a `thread` must be theirs with `owner_deleted_at` null, and gets it now with `thread.deleted`. An item that fails its check goes to `failed` with "Update not found." or "Thread not found." and writes nothing; the rest still move. The admin's side is left as it is.
3. Return `200 { data: { deleted, failed } }`.

**Bulk restore — `POST /restore`**, body `{ items }`, any type.

1. Validate with `allItemsSchema` → `400` as above.
2. Each distinct item in its own transaction, so a failure leaves the others restored. A `404` or `409` puts the item in `failed` with its message; any other error is the generic `500`.
   - `post` (`lib/restore.js` → `restorePost`, which Restore a Post also uses): deleted in the last 30 days on an active website of theirs → `post.restored` and `deletedAt` cleared; else "Post not found."
   - `gallery` (`restoreGallery`): deleted in the last 30 days on an active website of theirs that has Photo Galleries (not removed), else "Gallery not found."; then one Serializable transaction, retried on a clash like Create a Gallery (`lib/galleryNames.js`): no other gallery on the website that isn't deleted has its name, in any case, else "A gallery with this name already exists."; `gallery.restored` and `deletedAt` cleared. It keeps its `status`, `placement` and images; `publishAt` was cleared by the delete.
   - `update`: their copy, update not withdrawn, `deleted_at` within the last 30 days → `notification.restored` and `deleted_at` cleared, `read_at` kept; else "Update not found."
   - `thread`: theirs, `owner_deleted_at` within the last 30 days → `thread.restored` and it cleared; else "Thread not found."
3. Return `200 { data: { restored, failed } }`, then, after commit, `revalidate` once per website a post or gallery was restored on, naming its first one (`{ postId }` or `{ galleryId }`).

The restores and the upload cleanup share the cutoff, so a post or gallery that can be restored still has its images.

---

## Public

### Website Fetches Posts — `GET /api/public/posts`

Called **server-side** by a client's website (at build/regeneration time) with `Authorization: Bearer <apiKey>`. The key must never be exposed in the client website's browser code.

`requireApiKey` resolves `req.website`. Return that website's **published** posts (never a deleted one, and none while its posts ability is turned off), newest `createdAt` first, as `PublicPost` (API Contract → Notes), each with its body in order. No cookie, no CSRF header, no CORS needed (server-to-server).

### Website Fetches a Gallery — `GET /api/public/galleries/:slug`

Called server-side by a client's website with its API key, like the posts route. Returns the website's **published** gallery with that slug (never a draft, a deleted one, another website's, or any while its galleries ability is turned off or removed: all `404` "Gallery not found."), as `PublicGallery`, its images in order. A crop's `src` is the stored image's URL with a Cloudinary crop transformation after `/image/upload/` (`lib/cloudinary.js` → `croppedSrc`, `docs/setup.md` → Gallery crops), and its `width` and `height` are the crop's.

How the client website uses these is specced in the client guide, `client-kit`'s `docs/cms/` (`posts.md` and `galleries.md`, on the base `client-website.md`), synced unchanged into each client repo. The end-to-end test against a client website is `docs/client-website-test.md`.

### Health — `GET /api/health`

Returns `200 { data: { ok: true } }`. No auth. Render's health check (`render.yaml`) uses it to decide when a new deploy can take traffic.

---

## Audit Log

`lib/audit.js` writes one append-only `audit_event` row per sign-in, sign-out and change: who (`actorId`, plus `actorEmail` so a row reads at a glance), what (`action`), to what (`targetType`, `targetId`), from where (`ip`) and when. The schema is in `docs/setup.md`; retention and how it is used are in `docs/security.md`.

- An event for a database change is written with the transaction client, **inside the same `$transaction`** as the change, so a saved change always has its event and a rolled-back one leaves none. Routes that would otherwise do a single write (Link a Website's existing-website path, Draft / Publish, Delete a Post, Restore a Post, their gallery twins, and the ability routes) use a transaction for this.
- The only routes that read audit rows are the admin's Get Audit Events and Get Audit Event Months. Nothing edits or deletes them through the API.
- `metadata` never holds a key, secret, token, Google credential, header or post content, nor an update's or a thread's title, subject, body or message. Reading an update or a thread isn't audited; deleting or restoring one is, with the viewer as the actor, one event per item a bulk delete or restore moved.

| `action`                                          | Written by                                                                         | `actorId`                     | `actorEmail`                                           | Target         | `metadata`                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------ | -------------- | ---------------------------------------------------- |
| `auth.login_succeeded`                            | Login                                                                              | the account                   | the account's email                                    | —              | —                                                    |
| `auth.login_failed`                               | Login                                                                              | the account if found, or null | the Google-verified email, or null for `invalid_token` | —              | `{ reason }`                                         |
| `auth.logout`                                     | Logout (cookie verified)                                                           | the account                   | the account's email                                    | —              | —                                                    |
| `account.created`                                 | Create an Account                                                                  | the admin                     | the admin's email                                      | `account`      | `{ websiteId }`                                      |
| `website.created`                                 | Create an Account, Link a Website (new website path)                               | the admin                     | the admin's email                                      | `website`      | —                                                    |
| `website.linked`                                  | Create an Account, Link a Website (both paths)                                     | the admin                     | the admin's email                                      | `account`      | `{ websiteId }`                                      |
| `post.created` / `post.updated`                   | Create a Post, Edit a Post, Set a Post's Publish Date                              | the site owner                | the site owner's email                                 | `post`         | `{ websiteId }`                                      |
| `post.drafted` / `post.published`                 | Draft / Publish; Scheduled Publish (`post.published`)                              | the site owner, or null       | the site owner's email, or null                        | `post`         | `{ websiteId }`, plus `scheduled: true` from the job |
| `post.deleted`                                    | Delete a Post                                                                      | the site owner                | the site owner's email                                 | `post`         | `{ websiteId }`                                      |
| `post.restored`                                   | Restore a Post, bulk restore (a post)                                              | the site owner                | the site owner's email                                 | `post`         | `{ websiteId }`                                      |
| `gallery.created` / `gallery.updated`             | Create a Gallery, Edit a Gallery, Set a Gallery's Publish Date                     | the site owner                | the site owner's email                                 | `gallery`      | `{ websiteId }`                                      |
| `gallery.drafted` / `gallery.published`           | Draft / Publish a Gallery; Scheduled Publish (`gallery.published`)                 | the site owner, or null       | the site owner's email, or null                        | `gallery`      | `{ websiteId }`, plus `scheduled: true` from the job |
| `gallery.deleted`                                 | Delete a Gallery, Remove (Abilities)                                               | the site owner                | the site owner's email                                 | `gallery`      | `{ websiteId }`                                      |
| `gallery.restored`                                | Bulk restore (a gallery); Add (Abilities), within 30 days of a removal             | the site owner                | the site owner's email                                 | `gallery`      | `{ websiteId }`                                      |
| `gallery.requested`                               | Request a Gallery                                                                  | the site owner                | the site owner's email                                 | `gallery`      | `{ websiteId }`                                      |
| `gallery.request_updated`                         | Edit a Gallery's Request                                                           | the site owner                | the site owner's email                                 | `gallery`      | `{ websiteId }`                                      |
| `gallery.live`                                    | Set a Gallery Live                                                                 | the admin                     | the admin's email                                      | `gallery`      | `{ websiteId }`                                      |
| `ability.added`                                   | Add (Abilities); a new website's posts ability (Create an Account, Link a Website) | the site owner, or the admin  | their email                                            | `ability`      | the state, below                                     |
| `ability.requested`                               | Request form (posts)                                                               | the site owner                | the site owner's email                                 | `ability`      | the state                                            |
| `ability.request_updated`                         | Edit the request form                                                              | the site owner                | the site owner's email                                 | `ability`      | the state                                            |
| `ability.request_cleared`                         | No longer written (older rows: Delete a Post cleared a `requested` placement)      | the site owner                | the site owner's email                                 | `ability`      | the state                                            |
| `ability.live`                                    | Set an Ability Live                                                                | the admin                     | the admin's email                                      | `ability`      | the state                                            |
| `ability.turned_on` / `ability.turned_off`        | On / Off                                                                           | the site owner                | the site owner's email                                 | `ability`      | the state                                            |
| `notification.sent`                               | Send an Update; Set an Ability Live and Set a Gallery Live (automatic)             | the admin                     | the admin's email                                      | `notification` | `{ recipientCount, kind }`                           |
| `notification.updated` / `notification.withdrawn` | Edit an Update, Withdraw an Update                                                 | the admin                     | the admin's email                                      | `notification` | —                                                    |
| `thread.started`                                  | Start a thread (either side)                                                       | the site owner or the admin   | their email                                            | `thread`       | —                                                    |
| `thread.replied`                                  | Reply in a thread (either side)                                                    | the site owner or the admin   | their email                                            | `thread`       | —                                                    |
| `notification.deleted` / `notification.restored`  | Bulk delete or restore (an update, either side's mailbox)                          | the site owner or the admin   | their email                                            | `notification` | —                                                    |
| `thread.deleted` / `thread.restored`              | Bulk delete or restore (a thread, either side's mailbox)                           | the site owner or the admin   | their email                                            | `thread`       | —                                                    |
| `ability.removed` / `ability.restored`            | Remove, Add (Abilities)                                                            | the site owner                | the site owner's email                                 | `ability`      | the state                                            |

An ability event's `metadata` is the ability's whole state after the change: `{ websiteId, kind, status, turnedOn, placement, removed }`. The log alone can then rebuild every ability's history, one row per change, for analytics (issue #83, planned for later). The request note is the site owner's own text and is never in it.

Audit rows are never rewritten, so older rows keep earlier names and shapes: a post's status change may be `post.archived` (now `post.drafted`) or `post.activated` (now `post.published`), an ability event may have no `placement`, and a gallery's request message may have written `ability.requested` with the status `requested`.

A scheduled publish has no actor and no `ip`: the job wrote it, not a person. Its `metadata` carries `scheduled: true`, so the Audit Events page can show it as scheduled.

`actorEmail` is a copy of the email at the time of the event, and only ever a verified one: a Google token that fails verification records none.

## Scheduled Publish

`services/publishScheduled.js`, run by `npm run publish:scheduled` (`scripts/publishScheduled.js`): a Render cron job in production every 15 minutes; locally and on staging, by hand (`docs/deploy.md`). Each run:

1. Finds the drafts whose `publishAt` has passed and that aren't deleted, posts then galleries.
2. For each, in its own transaction: sets `status` to `published`, clears `publishAt` and sets `publishedAt` to the run's time, guarded by the same conditions, so an item the site owner published, deleted or rescheduled since it was found is skipped. Then it writes `post.published` or `gallery.published` with no actor and `{ websiteId, scheduled: true }` (Audit Log).
3. Calls `revalidate` for each published item, `{ postId }` or `{ galleryId }`, and waits for the calls before exiting.

It is safe to re-run or overlap: an item already published no longer matches. A website's ability being off, or a gallery not yet placed, doesn't stop the publish; the public routes keep such items hidden as they do any published one.

## Revalidation

`services/revalidate.js` exports `revalidate(websiteId, changed)`, where `changed` is `{ postId }`, `{ galleryId }` or `{ ability }`. It takes ids, not a website object, so the webhook secret is only ever selected inside the service. It tells a client's website to regenerate its page after a post or gallery changes, or an ability is turned on or off, removed or restored, so the change appears live within moments.

- Called after a **successful, committed** create, edit, status change or delete of a post or gallery, after a scheduled publish, and after an ability is turned on or off, removed or restored. Never inside the transaction.
- Fire-and-forget: the route responds to the site owner without waiting for it. The service catches and logs every error itself and never rejects, so a failure can never throw into the request; routes call it after `res.json(...)` without `await`.
- Skip entirely if `website.active === false`.
- Decrypt `webhook_secret_encrypted` with `lib/crypto.js`, then:
  `POST {website.url}/api/revalidate` with headers `Authorization: Bearer <webhookSecret>` and `Content-Type: application/json`, body `{ "websiteId": "...", "postId": "..." }` for a post, `{ "websiteId": "...", "galleryId": "..." }` for a gallery, or `{ "websiteId": "...", "ability": "posts" | "galleries" }` for an ability, timeout 5 seconds (`AbortSignal.timeout(5000)`).
- Non-2xx response, timeout or network error → log the website id and status, and report the same line to Sentry as a warning grouped per website (production only, `lib/sentry.js` → `reportWarning`). **Never** log or report the secret, the URL, the Authorization header or the request headers.
- A client website's `/api/revalidate` route must not require `postId` (nor `galleryId`): it revalidates its whole `cms` tag whatever the body names (Stevie The Dog's route ignores the body).
- The client-website side of this call (the `/api/revalidate` route that receives it) is specced in the client guide (`client-kit`'s `docs/cms/client-website.md` → The revalidate route, synced into each client repo).

## Request Emails

`services/requestEmail.js` exports `sendRequestEmail(websiteId, { siteOwnerId, abilityId | galleryId, isUpdate })`. It emails the administrator each time a site owner sends or edits a request message (posts' request form, or a gallery's message), so the admin hears of it without watching the dashboard. The approval that follows happens outside the Client Portal: the administrator replies with a styling mock-up, the client approves in that thread, and the administrator sets the ability `live` on the dashboard. No email is sent when an ability goes live.

- **Provider:** Resend, `POST https://api.resend.com/emails` with `Authorization: Bearer <RESEND_API_KEY>`, called only from the backend (native `fetch`, no SDK), timeout 5 seconds.
- **From** `3D Web Dev <notifications@3dwebdev.com>`, **to** every active admin account, **Reply-To** the site owner's email, so the administrator's reply goes straight to them. `3dwebdev.com` receives no mail, so the from address is never replied to. Every address is read from the database by id, never from a request.
- **Content, plain text:** the subject `New request: Posts on <website>` or `Updated request: Photo Galleries "<gallery name>" on <website>` (line breaks replaced by spaces), then who asked, the note under "Where it should go:", "Reply to this email to send <site owner> the mock-up." and `https://3dwebdev.com/admin`. Never an id, post or gallery content, a secret, or any other link.
- **After commit, fire-and-forget**, like Revalidation: the route responds first and doesn't await it, and it catches every error itself, so a failed email never affects the site owner's request. The note stays on the admin dashboard (`GET /api/admin/accounts`), so a lost email loses nothing.
- **Production only:** with `RESEND_API_KEY` empty (locally, in tests and on staging) nothing is sent.
- **Failure** (non-2xx, timeout, network error): log the website id and the status or error name, and report the same line to Sentry as a warning grouped per website (`lib/sentry.js` → `reportWarning`). **Never** log or report the key, an email address or the note.
