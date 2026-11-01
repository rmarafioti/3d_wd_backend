# Endpoints

Full behavioral spec for each backend endpoint. `CLAUDE.md` holds the short, always-loaded rules (ownership checks, anti-patterns, patterns); this file holds the API contract and the per-endpoint detail those rules apply to. Imported from `CLAUDE.md` via `@docs/endpoints.md`.

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

| Code | Meaning                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 200  | OK                                                                                                                                   |
| 201  | Created                                                                                                                              |
| 204  | OK, no body (logout, delete a post or gallery)                                                                                       |
| 400  | Invalid input (validation failed, an image id that doesn't belong to the post or gallery, or an image not uploaded for its website)  |
| 401  | Not signed in / session expired or invalid / not authorized to log in / bad API key                                                  |
| 403  | Signed in but wrong role, or missing CSRF header                                                                                     |
| 404  | Not found **or not yours** — the same answer either way, so ids can't be probed                                                      |
| 409  | Conflict — duplicate email, duplicate website URL, account already linked to that website, or a gallery name the website already has |
| 413  | Request body over the 256 KB limit                                                                                                   |
| 429  | Too many requests: over a rate limit (login, the public API, upload signing)                                                         |
| 500  | Server error — message is always the generic "Something went wrong, please try again."                                               |

### Shapes

```
Account        { id, name, email, role, active, createdAt }
WebsiteSummary { id, websiteName, url, active }
Credentials    { apiKey, webhookSecret }            // plaintext, one-time only
UploadSignature { uploadUrl, fields }               // fields: Cloudinary form fields, posted as-is
Image          { id, src, width, height, altText }
Element        { type: 'paragraph', text } | { type: 'image', image: Image }
PostSummary    { id, postName, postDate, active, status, createdAt }
AuditEvent     { id, action, actorEmail, targetType, targetId, metadata, ip, createdAt }
Post           { id, websiteId, websiteName, postName, header, subHeader,
                 postDate, active, status, createdAt, updatedAt, body: Element[] }
GallerySummary { id, galleryName, slug, status, createdAt }
AdminGallerySummary { id, galleryName, status, imageCount, hasThumbnails, hasMobileCrops }
Crop           { x, y, width, height }              // pixels of the stored image
GalleryImage   { id, src, width, height, altText, caption,
                 thumbnailCrop: Crop | null, mobileCrop: Crop | null }
Gallery        { id, websiteId, websiteName, galleryName, slug, title, copy, status,
                 createdAt, updatedAt, images: GalleryImage[] }
CroppedImage   { src, width, height }
PublicGallery  { id, slug, title, copy, createdAt, updatedAt,
                 images: [{ src, width, height, altText, caption,
                            thumbnail: CroppedImage | null, mobile: CroppedImage | null }] }
```

Optional post fields (`header`, `subHeader`, `postDate`) are `null` when empty. Optional gallery fields (`title`, `copy`, an image's `caption`) are `null` when empty too.

A post's `body` is its content as an ordered list of elements: each element is a paragraph or an image, returned in the order the site owner arranged them, so a client website renders `body` in order to interleave text and photos. Elements have no `id`; they are identified by their position. A paragraph's `text` keeps the line breaks the site owner typed (render it with `white-space: pre-line`). A paragraph's `text` may also contain formatting markup, described in Paragraph formatting below.

### Endpoints

| Method & path                                      | Who                                               | Request body                                                                                                                                                                  | Success                                                                                     |
| -------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `POST /api/auth/login`                             | anyone                                            | `{ credential }` (Google ID token)                                                                                                                                            | `200 { role }` + sets session cookie                                                        |
| `POST /api/auth/logout`                            | anyone                                            | —                                                                                                                                                                             | `204`, ends every session of the account                                                    |
| `GET /api/auth/me`                                 | signed in                                         | —                                                                                                                                                                             | `200 { id, name, email, role }`                                                             |
| `GET /api/admin/accounts`                          | admin                                             | —                                                                                                                                                                             | `200 [ Account + { websites: [ WebsiteSummary + { galleries: AdminGallerySummary[] } ] } ]` |
| `GET /api/admin/websites`                          | admin                                             | —                                                                                                                                                                             | `200 WebsiteSummary[]` (active only)                                                        |
| `GET /api/admin/auditEvents?month=&limit=&cursor=` | admin                                             | —                                                                                                                                                                             | `200 { data: AuditEvent[], nextCursor }`                                                    |
| `GET /api/admin/auditEvents/months`                | admin                                             | —                                                                                                                                                                             | `200 string[]` (`YYYY-MM`, newest first)                                                    |
| `POST /api/admin/accounts`                         | admin                                             | `{ name, email, websiteId }` **or** `{ name, email, websiteName, websiteUrl }`                                                                                                | `201 { account, website, credentials? }`                                                    |
| `POST /api/admin/accounts/:id/websites`            | admin                                             | `{ websiteId }` **or** `{ websiteName, websiteUrl }`                                                                                                                          | `201 { website, credentials? }`                                                             |
| `GET /api/siteOwner/websites`                      | site owner                                        | —                                                                                                                                                                             | `200 [ WebsiteSummary + { posts: PostSummary[], galleries: GallerySummary[] } ]`            |
| `POST /api/siteOwner/posts`                        | site owner                                        | `{ websiteId, postName, header?, subHeader?, postDate?, status?, active?, body: [{ type: 'paragraph', text } \| { type: 'image', image: { src, width, height, altText } }] }` | `201 Post`                                                                                  |
| `GET /api/siteOwner/posts/:id`                     | site owner                                        | —                                                                                                                                                                             | `200 Post`                                                                                  |
| `PATCH /api/siteOwner/posts/:id`                   | site owner                                        | `{ postName, header, subHeader, postDate, body: [{ type: 'paragraph', text } \| { type: 'image', image: { id?, src, width, height, altText } }] }`                            | `200 Post`                                                                                  |
| `PATCH /api/siteOwner/posts/:id/status`            | site owner                                        | `{ status }` (or the legacy `{ active }`)                                                                                                                                     | `200 Post`                                                                                  |
| `DELETE /api/siteOwner/posts/:id`                  | site owner                                        | —                                                                                                                                                                             | `204`                                                                                       |
| `POST /api/siteOwner/galleries`                    | site owner                                        | `{ websiteId, galleryName, title?, copy?, status?, images: [{ src, width, height, altText, caption?, thumbnailCrop?, mobileCrop? }] }`                                        | `201 Gallery`                                                                               |
| `GET /api/siteOwner/galleries/:id`                 | site owner                                        | —                                                                                                                                                                             | `200 Gallery`                                                                               |
| `PATCH /api/siteOwner/galleries/:id`               | site owner                                        | `{ galleryName, title, copy, images: [{ id?, src, width, height, altText, caption, thumbnailCrop, mobileCrop }] }`                                                            | `200 Gallery`                                                                               |
| `PATCH /api/siteOwner/galleries/:id/status`        | site owner                                        | `{ status }`                                                                                                                                                                  | `200 Gallery`                                                                               |
| `DELETE /api/siteOwner/galleries/:id`              | site owner                                        | —                                                                                                                                                                             | `204`                                                                                       |
| `POST /api/siteOwner/uploads/sign`                 | site owner                                        | `{ websiteId }`                                                                                                                                                               | `200 UploadSignature`                                                                       |
| `GET /api/public/posts`                            | client website (`Authorization: Bearer <apiKey>`) | —                                                                                                                                                                             | `200 PublicPost[]`                                                                          |
| `GET /api/public/galleries/:slug`                  | client website (`Authorization: Bearer <apiKey>`) | —                                                                                                                                                                             | `200 PublicGallery`                                                                         |
| `GET /api/health`                                  | anyone                                            | —                                                                                                                                                                             | `200 { ok: true }`                                                                          |

Notes:

- `GET /api/admin/accounts` gives each website its galleries that aren't deleted, drafts included, newest first, as `AdminGallerySummary`: the name, status, number of images, and whether every one of its images has a thumbnail crop (`hasThumbnails`) and a mobile crop (`hasMobileCrops`); a flag is `false` when any image lacks that crop, though saves already keep a gallery's crops all or none (Validation rules). Counts and flags only, never images or text, so the administrator can see a gallery was cropped (crops aren't files, so they don't show in Cloudinary). A website with no galleries has `galleries: []`. The other admin routes return the plain `WebsiteSummary`.
- `GET /api/admin/auditEvents` lists one month of audit events, newest first, a page at a time. `month` is `YYYY-MM`, a UTC calendar month, and defaults to the current one. `limit` is 1–100, default 50. `nextCursor` sits beside `data` in the success body: send it as `cursor` to get the next page of the same month; it is `null` on the last page. All three query parameters are optional. `AuditEvent`'s `actorEmail`, `targetType`, `targetId`, `metadata` and `ip` are `null` when the row has none; `metadata` holds only ids and short facts (`{ websiteId }`, or a failed login's `{ reason }`). Read-only: no route edits or deletes an audit event.
- `GET /api/admin/auditEvents/months` lists every UTC month that has at least one audit event, as `YYYY-MM`, newest first, so the page's month controls reach only months with events. An empty log returns `[]`. It is not paginated: there is one item per month, so years of history stay a few dozen strings.
- `credentials` is only present when a **new** website was created. Its presence is what tells the frontend to open the one-time reveal dialog. When an existing website was linked, it is absent.
- On `POST /api/admin/accounts` and `POST /api/admin/accounts/:id/websites` the body must contain **either** `websiteId` **or** both `websiteName` and `websiteUrl` — never both, never neither (400).
- `PATCH /api/siteOwner/posts/:id` is a full submission of the edit form: all fields are sent every time. Send `null` to clear an optional field. `body` is the complete current list, in order. An existing image carries its `image.id`, a new one has none, and any image stored but missing from the body is deleted. Paragraphs carry no id. `websiteId`, `status` and `active` cannot be changed here.
- A post's `status` is `draft` or `published`: a published post shows on the client website, a draft doesn't (the site owner still sees it). It replaces the boolean `active` (`true` is `published`, `false` is `draft`), which is still returned beside it and still accepted in requests until a later release removes it. Send `status`. A request that sends both with values that don't match is `400` on `fields.status`. A new post is `published` unless the request says otherwise.
- `PublicPost` is `{ id, header, subHeader, postDate, createdAt, updatedAt, body: [{ type: 'paragraph', text } | { type: 'image', image: { src, width, height, altText } }] }` — `postName` is internal and is **never** returned publicly, and neither are image ids. Only published posts, newest `createdAt` first.
- `DELETE /api/siteOwner/posts/:id` deletes a post for good, as far as the site owner and the client website can tell: from then on every site owner post route returns `404` "Post not found." for it, `GET /api/siteOwner/websites` leaves it out, and `GET /api/public/posts` never returns it. There is no undelete. A draft is different: it hides a post from the client website while the site owner still sees it and can publish it again.
- Images are uploaded to 3DWD's Cloudinary account from the post form; nobody types or pastes an image URL. A picked image stays in the browser until Publish. On Publish, when the body has new images, the frontend:
  1. shrinks each new image in the browser: decoded with its own orientation (so a photo the phone saved rotated stays upright), scaled so its long side fits 2500 px, never up, and re-encoded, a png as png (keeping its transparency) and a jpg or webp as jpg at 0.85 quality. Every new image is re-encoded, however small, so its metadata, including a phone photo's GPS location, never leaves the browser. If the browser can't decode or encode a file, the file goes up as picked;
  2. requests one `UploadSignature` for the post's website (`POST /api/siteOwner/uploads/sign`);
  3. uploads each new image to `uploadUrl` as `multipart/form-data`: every entry of `fields`, plus the image as `file`. One signature covers every upload in that Publish. It expires after one hour, so it is requested at Publish, never when the form opens;
  4. saves the post with each new image's `src` set to Cloudinary's `secure_url`, and its `width` and `height` from Cloudinary's response.

  If any upload fails, the post is not saved. Before shrinking, the frontend checks that each file as picked is jpg, png or webp and at most 10 MB; Cloudinary also refuses any other format. Cloudinary still scales a larger image down to fit 2500 × 2500 as it stores it (the signed transformation, a safety net for a file that went up as picked), so the `width` and `height` it returns are the stored size.

- A gallery is a section of a client website showing a series of images. A website can have many galleries, each with 1 to 30 images in the order the site owner arranged them. Its images are uploaded exactly as a post's are (the steps above, with the gallery form's Submit in place of Publish), into the same website folder.
- A gallery's `slug` is how the client website asks for it: `GET /api/public/galleries/:slug`. The backend makes it from `galleryName` when the gallery is created (lowercase, a hyphen for each run of other characters: "Our Interior!" → `our-interior`), adds `-2`, `-3`… if the website already has it, and never changes it, so renaming a gallery never breaks the website. The dashboard shows it, so the site owner can say which gallery goes where.
- `galleryName` is internal and is **never** returned publicly, and neither are image ids. A gallery's `status` is `draft` or `published`, like a post's, and a new gallery is `published` unless the request says otherwise.
- `PATCH /api/siteOwner/galleries/:id` is a full submission of the edit form, like a post edit: `images` is the complete current list, in order; an existing image carries its `id`, a new one has none, and any stored image missing from the list is deleted. `websiteId`, `status` and `slug` cannot be changed here.
- `DELETE /api/siteOwner/galleries/:id` works like deleting a post: every site owner gallery route then returns `404` "Gallery not found." for it, `GET /api/siteOwner/websites` leaves it out, and the public route never returns it.
- Crops: each gallery image may have a `thumbnailCrop` (a square) and a `mobileCrop` (at least as tall as it is wide), the part of the image the site owner chose for a thumbnail and for phones. A crop is in the stored image's pixels, the `width` and `height` Cloudinary returned, so a crop picked on a larger file in the browser is scaled to the stored size before it is sent. Send `null` (or leave it out on create) for no crop. A gallery's crops are consistent: every image has a thumbnail crop or none does, every image has a mobile crop or none does, and every mobile crop has the same shape (Validation rules). `PublicGallery` returns each crop as a ready `CroppedImage`, a Cloudinary URL that cuts that rectangle from the stored image, with the crop's own `width` and `height` for `<Image>`; it is `null` when there is no crop, and the client website then shows the full image.

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
| Gallery: another gallery on this website (not deleted) has that name, in any case                                     | 409  | A gallery with this name already exists.                                                                          |
| Link: account already linked to that website                                                                          | 409  | This account is already linked to [Website Name].                                                                 |
| Website / account / post / gallery not found or not yours                                                             | 404  | [Website / Account / Post / Gallery] not found.                                                                   |
| Public: no published gallery with that slug on this website                                                           | 404  | Gallery not found.                                                                                                |
| Create / edit: an image id that isn't on this post or gallery, or an image `src` outside this website's upload folder | 400  | Invalid image.                                                                                                    |
| Public: missing / unknown key, or inactive website                                                                    | 401  | Invalid API key.                                                                                                  |
| Request body over the 256 KB limit                                                                                    | 413  | Request body is too large.                                                                                        |
| Over a rate limit: login, the public API or upload signing                                                            | 429  | Too many requests. Please try again later.                                                                        |

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
- `status` (create / status): `draft` or `published` ("Status must be draft or published."). The legacy `active`: a boolean ("Active must be true or false."). When both are sent they must match ("Status and active don't match.", on `status`). On create, both are optional; the status route needs one of them.
- `galleryName`: required, max 100, and unique among the website's galleries that aren't deleted, ignoring case (`409` "A gallery with this name already exists.", on create and edit; a gallery may keep its own name). The frontend checks it first, against the website's `galleries` summaries, and doesn't let the site owner submit a name that's taken; the 409 is the backend's fallback. `title`: optional, max 150. `copy`: optional, max 2000 (line breaks kept, plain text with no formatting markup).
- Gallery `images`: at least 1 ("Add at least one image."), at most 30 ("A gallery can have at most 30 images."), on `images`. Each image: `src`, `width`, `height`, `altText` as for a post image (the same upload folder rule); `caption` optional, max 300.
- Crops: `x` and `y` whole numbers from 0, `width` and `height` whole numbers from 1, and the rectangle inside the image (`x + width` at most the image's `width`, `y + height` at most its `height`). A `thumbnailCrop` must also be square ("Thumbnail crop must be a square inside the image."); a `mobileCrop` must be at least as tall as it is wide ("Mobile crop must be inside the image and at least as tall as it is wide."). The message is on `images.N.thumbnailCrop` or `images.N.mobileCrop` (on one of its numbers, such as `images.N.thumbnailCrop.x`, when that number isn't a whole number in range).
- Crops across a gallery, checked once every image passes its own rules, with the message on `images`: if any image has a `thumbnailCrop`, every image must ("Add a thumbnail crop to every image, or remove them all."); if any image has a `mobileCrop`, every image must ("Add a mobile crop to every image, or remove them all."); and every `mobileCrop`'s width ÷ height must be within 1% of the first one's in list order, which allows for whole-pixel rounding such as 750 × 938 for 4:5 ("Every mobile crop must be the same shape."). When more than one fails, the message is the first of these three.
- Gallery `status` (create / status): `draft` or `published` ("Status must be draft or published."). Optional on create; the status route needs it. Galleries have no `active`.
- Audit events query: `month` matches `YYYY-MM` with a month from 01 to 12 ("Enter a month as YYYY-MM."); `limit` is a whole number from 1 to 100 ("Limit must be a whole number from 1 to 100."); `cursor` is a UUID ("Invalid cursor."). A parameter sent twice fails its rule.

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

`app.js` first sets `app.set('trust proxy', 2)`: on Render (staging and production) two proxies sit in front of the API, Cloudflare and then Render's load balancer, and each appends to `X-Forwarded-For`. So `req.ip`, which the rate limits and the audit log need, is the client's address two entries from the end. It is a count, never `true`, because Render keeps an `X-Forwarded-For` the client sends, so the entries further left can be faked. Locally there is one proxy (Next's dev rewrite) and Express stops at the leftmost entry. Found on staging, where a count of 1 recorded Cloudflare's address (`docs/deploy.md` → Deployment checklist step 19).

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

| Route                              | Limit         | Keyed by   |
| ---------------------------------- | ------------- | ---------- |
| `POST /api/auth/login`             | 5 per 15 min  | IP         |
| `GET /api/public/*`, valid key     | 30 per minute | website    |
| `GET /api/public/*`, refused key   | 10 per minute | IP         |
| `POST /api/siteOwner/uploads/sign` | 10 per 15 min | site owner |

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

Every account where `role = site_owner` (active and inactive), sorted by `name`, each with its linked websites (via `account_website`): `[{ id, name, email, role, active, createdAt, websites: [{ id, websiteName, url, active, galleries: [{ id, galleryName, status, imageCount, hasThumbnails, hasMobileCrops }] }] }]`. Each website's galleries are the ones not deleted, newest first; `imageCount` and the two crop flags are worked out from its `gallery_image` rows, and a flag is true only when every image has that crop. No posts and no gallery content (images, captions, title or copy) — the administrator does not view site owner content, only whether a gallery has photos and crops. Powers the account list on `/admin`.

### Get All Websites — `GET /api/admin/websites`

Every **active** website, sorted by `websiteName`: `[{ id, websiteName, url, active }]`. Powers the website picker in Create an Account and Link a Website.

### Get Audit Events — `GET /api/admin/auditEvents`

The read-only audit log view, so the administrator can answer "who changed this?" without the Render Shell. Query `?month=YYYY-MM&limit=&cursor=`, all optional.

1. Validate the query with `validation/auditEvent.js` → `400` with `fields.month`, `fields.limit` or `fields.cursor`.
2. Read the `audit_event` rows created in that UTC month (from the 1st at 00:00 UTC up to, not including, the next month's), or in the current UTC month when `month` is absent. With a `cursor`, only rows whose `id` is below it. Ordered by `id` descending: UUIDv7 ids are time-ordered, so this is newest first.
3. Read `limit` + 1 rows (default 50); the extra row only tells whether another page follows.
4. Return `200 { data: AuditEvent[], nextCursor }`: every column but `actorId` (`actorEmail` already names the actor), and `nextCursor` the id of the page's last event when another page follows, else `null`.

Reading the log writes no audit event.

### Get Audit Event Months — `GET /api/admin/auditEvents/months`

Every UTC month with at least one `audit_event` row, as `YYYY-MM`, newest first: `200 { data: ["2026-10", "2026-09"] }`, or `[]` for an empty log. The Audit Events page's Previous / Next month controls step only through these months. No query parameters. `created_at` is a timestamp without time zone holding UTC, so its month is read with `to_char(created_at, 'YYYY-MM')`. Not paginated, because the list is bounded by the calendar, not by use (`docs/scaling.md` §6). Reading it writes no audit event.

Get Audit Events and Get Audit Event Months are the only routes that read `audit_event`.

### Create an Account — `POST /api/admin/accounts`

Body: `{ name, email, websiteId }` (link an existing website) **or** `{ name, email, websiteName, websiteUrl }` (create a new website).

1. Validate with `validation/account.js` + `validation/website.js` (zod). Exactly one of `websiteId` or (`websiteName` + `websiteUrl`) → otherwise `400`.
2. Lowercase the email. If an account with that email exists → `409` "An account with this email already exists."
3. **Existing website path** (`websiteId`): the website must exist and be active → otherwise `404` "Website not found." In one transaction: insert `account` (role `site_owner`), insert the `account_website` row. No key or secret is generated.
4. **New website path** (`websiteName` + `websiteUrl`): normalize the URL (`lib/normalizeUrl.js`). If a website with that URL exists, with or without a leading `www.` (`urlVariants`) → `409` "A website with this URL already exists. Select it from the dropdown." If that website is inactive (so it is not in the dropdown), the `409` names it instead: "A website with this URL already exists but is inactive. It's named [Website Name]. Reactivate and then try again." Generate the API key and webhook secret with `lib/crypto.js`, hash the key, encrypt the secret. Derive the website's `media_folder` from the normalized URL (`docs/setup.md` → Image Hosting). In one transaction: insert `account`, insert `website` (with `api_key_hash`, `webhook_secret_encrypted`, `media_folder`), insert the `account_website` row — three inserts, if any fails nothing is saved.
5. Return `201 { data: { account, website, credentials? } }`. `credentials: { apiKey, webhookSecret }` (plaintext) is included **only** on the new-website path, and only in this one response.

### Link a Website — `POST /api/admin/accounts/:id/websites`

Gives an existing site owner another website. Body: `{ websiteId }` **or** `{ websiteName, websiteUrl }`.

1. `:id` must be an existing `site_owner` account → otherwise `404` "Account not found."
2. Validate the body exactly as in Create an Account (minus `name` / `email`).
3. **Existing website path**: website must exist and be active (`404` "Website not found."). If this account is already linked to it → `409` "This account is already linked to [Website Name]." Insert the `account_website` row only.
4. **New website path**: identical to Create an Account step 4, minus the account insert — website + `account_website` in one transaction, generate key and secret.
5. Return `201 { data: { website, credentials? } }` — `credentials` only on the new-website path.

---

## Site Owner

All site-owner routes: `requireAuth` + `requireRole('site_owner')`.

**Ownership check (every route below):** the account comes from `req.user` (the session), never from anything the client sends. A website belongs to the site owner when an `account_website` row links `req.user.id` to it **and** `website.active = true`. A post or a gallery belongs to the site owner when its website does **and** it is not deleted (`deletedAt` null). The shared checks are in `lib/ownership.js`. Anything that fails the check returns `404` — identical to "doesn't exist".

### Get All Websites Tied To the Account — `GET /api/siteOwner/websites`

The site owner's active websites (via `account_website`), sorted by `websiteName`, each with **post summaries** and **gallery summaries** (published and draft, never deleted), each newest `createdAt` first: `[{ id, websiteName, url, active, posts: [{ id, postName, postDate, active, status, createdAt }], galleries: [{ id, galleryName, slug, status, createdAt }] }]`. No post body or gallery images: they load with the single post or gallery. Powers the `/dashboard` list and the website dropdown in Create a Post and Create a Gallery.

### Create a Post — `POST /api/siteOwner/posts`

1. Validate with `validation/post.js` — the backend re-validates everything regardless of what the frontend checked.
2. Ownership check on `websiteId` → `404` "Website not found." if it fails.
3. Every image `src` must be in the website's upload folder (Validation rules) → otherwise `400` "Invalid image."
4. One transaction: insert the post (`status` defaults to `published` if neither `status` nor `active` is sent; `active` is written to match), then its body in order (each image element's image, then every element with its position). If any insert fails the whole create rolls back — no orphaned post.
5. Return `201 { data: Post }`.
6. After the transaction has committed, call `revalidate(website.id, { postId: post.id })` (see Revalidation). Do not await it before responding.

### Get a Post by ID — `GET /api/siteOwner/posts/:id`

Ownership check → `404` "Post not found." Returns `200 { data: Post }` including `websiteName`, and the body in order. Powers `/dashboard/post/[id]` and pre-fills the Edit form.

### Edit a Post — `PATCH /api/siteOwner/posts/:id`

Request body: the full edit form — `{ postName, header, subHeader, postDate, body }`. `websiteId`, `status` and `active` are not accepted here (a post never moves websites; status changes only through the status route).

1. Validate with `validation/post.js`.
2. Ownership check → `404` "Post not found."
3. Every image `id` (inside `body`) must belong to this post and appear only once, and every image `src` must be in the post's website's upload folder → otherwise `400` "Invalid image." (stops editing another post's images by guessing ids, and saving an image uploaded for another website).
4. One transaction:
   - Update the post's own fields.
   - Body: the post's elements are deleted and rewritten in the new order. Stored images whose `id` is missing from the body → delete; images with an `id` → update; images without → insert. Image ids stay stable across edits; elements are re-created.
   - `updated_at` refreshes automatically (`@updatedAt`).
   - If any part fails, nothing is changed.
5. Return `200 { data: Post }`, then call `revalidate(post.websiteId, { postId: post.id })` after commit.

### Draft / Publish — `PATCH /api/siteOwner/posts/:id/status`

Body `{ status: 'draft' | 'published' }`, or the legacy `{ active: boolean }` until it is removed.

1. Validate with `validation/post.js` → `400` on `fields.status` when neither is sent or the two don't match.
2. Ownership check → `404` "Post not found."
3. One transaction: write `post.drafted` or `post.published` to the audit log, and set `post.status`, with `post.active` set to match.
4. Return `200 { data: Post }`, then call `revalidate(post.websiteId, { postId: post.id })` after commit.

A draft is hidden from the client website; the site owner still sees it on the dashboard and can publish it again.

### Delete a Post — `DELETE /api/siteOwner/posts/:id`

The site owner removes a post they no longer want. It is a soft delete, like every delete in this app: the row stays in the database with `deleted_at` stamped.

1. Ownership check → `404` "Post not found." A post already deleted fails it too (every site owner post route reads only posts whose `deletedAt` is null).
2. One transaction: write `post.deleted` to the audit log and set `post.deletedAt` to now.
3. Return `204`, then call `revalidate(post.websiteId, { postId: post.id })` after commit, so the post leaves the client website.

No request body. The post's elements and image rows are kept. The upload cleanup deletes its images from Cloudinary 30 days after `deleted_at` (`docs/setup.md` → Upload cleanup), so until then a post deleted by mistake can be recovered, with its images, by clearing `deleted_at` with SQL from the Render Shell.

### Create a Gallery — `POST /api/siteOwner/galleries`

The gallery routes live in `api/siteOwner/galleries.js`, mounted at `/api/siteOwner/galleries` behind the site owner router's guards.

1. Validate with `validation/gallery.js`.
2. Ownership check on `websiteId` → `404` "Website not found."
3. Every image `src` must be in the website's upload folder → otherwise `400` "Invalid image."
4. One transaction: check no other gallery on the website (not deleted) has the name in any case (`409` "A gallery with this name already exists."), make the slug from `galleryName` (`lib/slug.js`, `docs/setup.md` → Gallery slugs), insert the gallery (`status` defaults to `published`), insert its images in list order with their positions and crop columns, and write `gallery.created` to the audit log. If any insert fails, nothing is saved. Two creates at the same moment can pick the same slug; the second then fails the `(website_id, slug)` unique index and is retried once, which answers the 409 for the same name, or picks the next free slug for a different name that makes the same slug.
5. Return `201 { data: Gallery }`, then call `revalidate(website.id, { galleryId: gallery.id })` after commit.

### Get a Gallery by ID — `GET /api/siteOwner/galleries/:id`

Ownership check → `404` "Gallery not found." Returns `200 { data: Gallery }`, its images in order with their crops. Powers the gallery page and pre-fills the Edit form.

### Edit a Gallery — `PATCH /api/siteOwner/galleries/:id`

Request body: the full edit form, `{ galleryName, title, copy, images }`. `websiteId`, `status` and `slug` are not accepted here (zod strips them).

1. Validate with `validation/gallery.js`.
2. Ownership check → `404` "Gallery not found."
3. Every image `id` must belong to this gallery and appear only once, and every image `src` must be in the website's upload folder → otherwise `400` "Invalid image."
4. One transaction: check the name as on create (another gallery's name is `409`; its own name, in any case, is fine), update the gallery's fields (the slug never changes), delete stored images whose `id` is missing from the list, update each kept image (its new position included), insert the new ones, and write `gallery.updated` to the audit log. If any part fails, nothing is changed.
5. Return `200 { data: Gallery }`, then call `revalidate(gallery.websiteId, { galleryId: gallery.id })` after commit.

### Draft / Publish a Gallery — `PATCH /api/siteOwner/galleries/:id/status`

Body `{ status: 'draft' | 'published' }`. Validate (`400` on `fields.status`), ownership check (`404` "Gallery not found."), then in one transaction write `gallery.drafted` or `gallery.published` and set `status`. Return `200 { data: Gallery }`, then revalidate after commit. A draft is hidden from the client website; the site owner still sees it.

### Delete a Gallery — `DELETE /api/siteOwner/galleries/:id`

A soft delete, like Delete a Post. Ownership check (`404` "Gallery not found.", a gallery already deleted included), then in one transaction write `gallery.deleted` and set `deletedAt` to now. Return `204`, then revalidate after commit. The gallery's image rows are kept; the upload cleanup deletes its images from Cloudinary 30 days after `deleted_at`, and its slug stays taken, so a new gallery never reuses it.

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

## Public

### Website Fetches Posts — `GET /api/public/posts`

Called **server-side** by a client's website (at build/regeneration time) with `Authorization: Bearer <apiKey>`. The key must never be exposed in the client website's browser code.

`requireApiKey` resolves `req.website`. Return that website's **published** posts (never a deleted one), newest `createdAt` first, each with its body in order: `[{ id, header, subHeader, postDate, createdAt, updatedAt, body: [{ type: 'paragraph', text } | { type: 'image', image: { src, width, height, altText } }] }]`. `postName` and image ids are never included. No cookie, no CSRF header, no CORS needed (server-to-server).

### Website Fetches a Gallery — `GET /api/public/galleries/:slug`

Called server-side by a client's website with its API key, like the posts route. Returns the website's **published** gallery with that slug (never a draft, a deleted one or another website's: all `404` "Gallery not found."): `{ id, slug, title, copy, createdAt, updatedAt, images }`, its images in order. Each image is `{ src, width, height, altText, caption, thumbnail, mobile }`; `thumbnail` and `mobile` are `{ src, width, height }`, or `null` when the site owner didn't crop one. Their `src` is the stored image's URL with a Cloudinary crop transformation after `/image/upload/` (`lib/cloudinary.js` → `croppedSrc`, `docs/setup.md` → Gallery crops), and their `width` and `height` are the crop's. `galleryName` and image ids are never included.

How the client website uses these is specced in the master doc's "Client to Website" tab (each client website keeps it as its `docs/client-website.md`). The end-to-end test against a client website is `docs/client-website-test.md`.

### Health — `GET /api/health`

Returns `200 { data: { ok: true } }`. No auth. Render's health check (`render.yaml`) uses it to decide when a new deploy can take traffic.

---

## Audit Log

`lib/audit.js` writes one append-only `audit_event` row per sign-in, sign-out and change: who (`actorId`, plus `actorEmail` so a row reads at a glance), what (`action`), to what (`targetType`, `targetId`), from where (`ip`) and when. The schema is in `docs/setup.md`; retention and how it is used are in `docs/security.md`.

- An event for a database change is written with the transaction client, **inside the same `$transaction`** as the change, so a saved change always has its event and a rolled-back one leaves none. Routes that would otherwise do a single write (Link a Website's existing-website path, Draft / Publish, Delete a Post, and their gallery twins) use a transaction for this.
- The only routes that read audit rows are the admin's Get Audit Events and Get Audit Event Months. Nothing edits or deletes them through the API.
- `metadata` never holds a key, secret, token, Google credential, header or post content.

| `action`                                | Written by                                           | `actorId`                     | `actorEmail`                                           | Target    | `metadata`      |
| --------------------------------------- | ---------------------------------------------------- | ----------------------------- | ------------------------------------------------------ | --------- | --------------- |
| `auth.login_succeeded`                  | Login                                                | the account                   | the account's email                                    | —         | —               |
| `auth.login_failed`                     | Login                                                | the account if found, or null | the Google-verified email, or null for `invalid_token` | —         | `{ reason }`    |
| `auth.logout`                           | Logout (cookie verified)                             | the account                   | the account's email                                    | —         | —               |
| `account.created`                       | Create an Account                                    | the admin                     | the admin's email                                      | `account` | `{ websiteId }` |
| `website.created`                       | Create an Account, Link a Website (new website path) | the admin                     | the admin's email                                      | `website` | —               |
| `website.linked`                        | Create an Account, Link a Website (both paths)       | the admin                     | the admin's email                                      | `account` | `{ websiteId }` |
| `post.created` / `post.updated`         | Create a Post, Edit a Post                           | the site owner                | the site owner's email                                 | `post`    | `{ websiteId }` |
| `post.drafted` / `post.published`       | Draft / Publish                                      | the site owner                | the site owner's email                                 | `post`    | `{ websiteId }` |
| `post.deleted`                          | Delete a Post                                        | the site owner                | the site owner's email                                 | `post`    | `{ websiteId }` |
| `gallery.created` / `gallery.updated`   | Create a Gallery, Edit a Gallery                     | the site owner                | the site owner's email                                 | `gallery` | `{ websiteId }` |
| `gallery.drafted` / `gallery.published` | Draft / Publish a Gallery                            | the site owner                | the site owner's email                                 | `gallery` | `{ websiteId }` |
| `gallery.deleted`                       | Delete a Gallery                                     | the site owner                | the site owner's email                                 | `gallery` | `{ websiteId }` |

Rows written before Feature 8 (2026-10-30) name a status change `post.archived` (now `post.drafted`) or `post.activated` (now `post.published`). Audit rows are never rewritten, so both names appear in the log.

`actorEmail` is a copy of the email at the time of the event, and only ever a verified one: a Google token that fails verification records none.

## Revalidation

`services/revalidate.js` exports `revalidate(websiteId, changed)`, where `changed` is `{ postId }` or `{ galleryId }`. It takes ids, not a website object, so the webhook secret is only ever selected inside the service. It tells a client's website to regenerate its page after a post or gallery changes, so the change appears live within moments.

- Called after a **successful, committed** create, edit, status change or delete of a post or gallery. Never inside the transaction.
- Fire-and-forget: the route responds to the site owner without waiting for it. The service catches and logs every error itself and never rejects, so a failure can never throw into the request; routes call it after `res.json(...)` without `await`.
- Skip entirely if `website.active === false`.
- Decrypt `webhook_secret_encrypted` with `lib/crypto.js`, then:
  `POST {website.url}/api/revalidate` with headers `Authorization: Bearer <webhookSecret>` and `Content-Type: application/json`, body `{ "websiteId": "...", "postId": "..." }` for a post or `{ "websiteId": "...", "galleryId": "..." }` for a gallery, timeout 5 seconds (`AbortSignal.timeout(5000)`).
- Non-2xx response, timeout or network error → log the website id and status. **Never** log the secret, the Authorization header or the request headers.
- A client website's `/api/revalidate` route must not require `postId`: it revalidates its whole `cms` tag whatever the body names (Stevie The Dog's route ignores the body, checked 2026-10-31).
- The client-website side of this call (the `/api/revalidate` route that receives it) is specced in the master doc's "Client to Website" tab.
