# Client Website Test

The runbook for testing a client website against this backend, end to end: posts render on the website, and a post change reaches the live site within moments. Imported from `CLAUDE.md` via `@docs/client-website-test.md`.

The client side (env vars, `getPosts()`, rendering, the `/api/revalidate` route) is specced in the master doc's "Client to Website" tab. Each client website keeps that tab as its own `docs/client-website.md`. This file covers only what is done from this repo's side. The backend behaviour it tests is in `docs/endpoints.md` → Public and → Revalidation.

The test website is Stevie The Dog (`https://www.steviethedog.com`, deployed on Vercel). Its API key and webhook secret were recorded at the one-time reveal, and its stored URL serves the site directly with no redirect (checked 2026-10-09).

## Prerequisites

- Local Postgres running (`docker compose up -d`) and the backend running (`npm run dev`, port 4000).
- The frontend running (port 3000), to create and edit posts as the test site owner.
- The client website has the code from its `docs/client-website.md`.

## Test A — local rendering (no deploy)

The client website fetches from the local backend. Nothing leaves the machine.

1. In the client website, set `.env.local`:
   - `HEADLESS_CMS_API_URL=http://localhost:4000`
   - `HEADLESS_CMS_API_KEY=<the website's API key>`
2. Run it on port 3001 (`npm run dev -- -p 3001`).
3. As the test site owner, create posts that cover each case:
   - paragraphs only, including one with line breaks
   - paragraphs and images interleaved
   - links
   - header, sub header and post date all left empty
   - an archived post (archive it after creating it)
4. Check the page:
   - posts appear newest first, each body in the order it was arranged
   - line breaks show and images load at their stored size
   - empty optional fields don't render
   - the archived post does not appear
5. Change `HEADLESS_CMS_API_KEY` to a wrong value and restart. The backend returns `401` "Invalid API key." and the website must handle it without crashing. Restore the key.
6. Run `next build && next start -p 3001` and confirm the posts page builds as static and still shows the posts.

## Test B — the webhook arrives (deployed site, no tunnel)

The local backend's revalidation call goes out over the internet to the deployed site's stored URL. This proves the route and the secret check.

1. Deploy the client website with `HEADLESS_CMS_WEBHOOK_SECRET` set on Vercel (production; revalidation only goes to the stored URL, never a preview URL).
2. Confirm a wrong secret is refused:
   `curl -i -X POST https://www.steviethedog.com/api/revalidate -H 'Authorization: Bearer wrong'` → `401`.
3. Edit one of the site owner's posts in the local dashboard.
   - The backend log shows no `Revalidation failed for website <id>` line. A line with `HTTP 401` means the secret doesn't match; `HTTP 404` means the route isn't deployed; a `TimeoutError` means the site took over 5 seconds.
   - Vercel's logs show `POST /api/revalidate` with status `200`.

The deployed site can't fetch fresh posts from `localhost`, so the page itself won't change here. That's Test C.

## Test C — the full loop (deployed site fetches from the local backend)

A tunnel gives the local backend a public https URL for the length of the test, so the deployed site can fetch from it.

1. Start a tunnel to the backend: `cloudflared tunnel --url http://localhost:4000`. Note the `https://….trycloudflare.com` URL it prints. It changes on every run.
2. On Vercel, set the client website's `HEADLESS_CMS_API_URL` to the tunnel URL and redeploy. The API key and webhook secret stay as they are.
3. In the local dashboard, as the test site owner, then refresh the live site after each step:
   - create a post: it appears
   - edit it: the change appears
   - archive it: it disappears
   - make it active: it returns
4. Each change should show on the first refresh after saving. If one only shows after a second refresh, the route is serving stale data first; check the `revalidateTag` profile in the client's `docs/client-website.md` → Check the installed Next.js version.

## Restore and clean up

1. On Vercel, set `HEADLESS_CMS_API_URL` back: unset it until this backend is deployed, then `https://api.3dwebdev.com`. Redeploy and stop the tunnel.
2. Delete every row the tests added, as in the Workflow Checklist: list the test posts first, then delete them by id in one transaction, with their elements, images and links. The local database must be back to the baseline in the Current progress line in `CLAUDE.md`.
3. Leave the website's API key and webhook secret on Vercel. They are the website's real credentials.

## Done when

- [ ] Test A: every post case renders correctly locally, a wrong key is handled, and the page builds as static
- [ ] Test B: a wrong secret gets `401`, and a post edit produces `POST /api/revalidate 200` on Vercel with no failure in the backend log
- [ ] Test C: create, edit, archive and make active each show on the live site after one refresh
- [ ] Vercel's `HEADLESS_CMS_API_URL` restored, the tunnel stopped, and the test rows deleted
