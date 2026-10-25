# Proposal Notes

Notes for us, not for the reader, kept beside the master doc's Proposal tab. When a section of the Proposal is audited, anything that is a working note, a reminder or internal copy moves here instead of staying in the doc. Read this before updating the Proposal. Not imported from `CLAUDE.md`: it is read only when working on the proposal.

The Proposal is 3D Web Dev's business proposal, version 1, written 2026-10-25 from Rich's answers after a B2B sales friend's review of the pitch. That review asked four questions: what expensive problem it solves, what it delivers that existing solutions don't, whether it can be delivered profitably as it grows, and how it will be marketed and sold.

## How the Proposal reads

General to specific, top to bottom, like the code: the mission and Rich's background first, then how he works, then the clients, then what was built for them, then pricing. Each section sets up the next, so nothing appears before the reader has the context for it (Rich, 2026-10-25). The Client Portal section follows Clients because it answers what every client asked for.

## Still to gather

The evidence that would answer the review's questions 1 and 3 with real numbers:

- **Client questionnaire** (the four owners): time and money spent before 3D Web Dev, what changed after launch (quote requests, inquiries), and whether they would pay for Hosting or Partner.
- **Rich's worksheet:** hours per project, the effective hourly rate on each build, monthly support time, the hours each week Rich has for 3D Web Dev alongside his full-time job, and from those, how many builds and Partner clients he can carry.
- **More UX moments** like the "Book now" button, from the four projects (Rich). Once there are a few, they go back into the Proposal together (decided 2026-10-25); one example alone read oddly.

The Proposal's "What I'm validating next" list is ordered by what can be gathered soonest: the client and Rich's own numbers first, then the clients posting on their own, a feature one client wants reused by another, and last, whether clients move to Hosting or Partner after the Portal's first year.

Once these are in, the Proposal gains the owner's-time argument and a capacity and margin section. That section also gets the server-cost line held back from v1 (Rich, 2026-10-25): "The Portal's servers cost about $300 a year in total, so two clients on Hosting cover them." It answers the review's question 3 (profit as it grows), so it goes in with the rest of the numbers, not alone.

## Moved out of the Proposal

Filled in section by section as the Proposal is audited (started 2026-10-25).

### Introduction (was Status)

- The old Status line: "Draft, written from Rich's answers on 25 October 2026. The prices are drafts for Rich to confirm." The landing page copy is written from the For the landing page notes below.
- The Introduction asks for feedback "from a sales perspective, including anything you think is missing" on purpose: an experienced reviewer sees gaps that a narrower question would hide (Rich, 2026-10-25).

### Where I come from

- Kept general on purpose (Rich, 2026-10-25): an artist who ran a small business in Chicago. The shop's name, the analytics engineering job and its employer, and Rich's own projects are left out. A reviewer may not know what an analytics engineer is, and personal projects aren't proof from paying clients.
- The landing page may have an About me section with the specifics: Wild Wind Tattoo (owned 2015 to 2025, a 4.9 Google rating from 300+ reviews, a 3K mailing list, community fundraising over 10K), ten years as a freelance tattoo and graphic artist with a 1 to 3 month waitlist, the RISD BFA in Illustration and Fullstack Academy (2024).
- The Partner check-ins draw on Rich's analytics work: reading the numbers with the owner and explaining what matters. The Pricing table's Partner row should describe that plainly, with no job title (to do when Pricing is audited).

### What I do

- The "Book now" example came out (Rich, 2026-10-25): a booking button for appointment businesses, kept in the same place on every page. As a single example it read oddly here. It belongs in the drag-and-drop comparison, beside other moments like it.
- Paragraph 2 (problem first, options at different costs) stays here: it is Rich's method and holds the section together. Repetition with the Mission and How we work together is trimmed from How we work together instead.

### Clients

- The reminder to add more "Book now" moments (now under Still to gather).
- "What the four have in common" was checked for truth (2026-10-25): three clients asked to post themselves and Rich recommended it to Legacy Tattoo; Rich reached out to GB Grooming and Legacy (they didn't come to him); GB Grooming has ongoing updates, not a second version; The Pet Bodega came through the designer after seeing GB Grooming's site. The Client Portal section opens with "every client needed", not "asked", for the same reason.

### The 3DWD Client Portal

- Named "the 3DWD Client Portal" throughout the Proposal (Rich, 2026-10-25), with no "3D Web Dev (3DWD)" introduction.
- Left out on purpose (2026-10-25): what goes on behind the screen (each owner sees only their own sites, every sign-in and change is recorded, photos are resized, pages are built ahead of time). It repeats What I do; the detail is in Supporting material. Also left out: formatting, archiving, and more than one site per owner, since no client uses that yet. Bring it back when one does.

### Pricing

- **Fixed costs:** Hosting covers them, about $300 a year for the Client Portal's servers (Vercel Pro $240 and Railway Hobby about $60), shared by every client. At $240 a year per client, four clients bring in $960.
- **Market figures behind the ranges (2026):** small business builds mostly $1,500 to $8,000 with a freelancer; mid-level US freelance rates about $60 to $100 an hour; freelance care plans about $50 to $300 a month. Most sources are agencies and vendors, so the figures are estimates. Sources: [Upwork](https://www.upwork.com/resources/how-much-does-it-cost-to-build-website), [Project Cost Estimator](https://projectcostestimator.com/freelance-website-cost), [FatLab](https://fatlabwebsupport.com/blog/website-maintenance/website-maintenance-packages-compared-your-complete-buyers-guide/), [goLance](https://golance.com/hiring/best-freelance-web-developers-hourly-rate).
- **How Pricing is laid out (Rich, 2026-10-25):** three parts, matching how a client is billed: Website builds (Starter, Business site, Full build; fixed quotes), Changes after launch (hourly, a sentence, not a one-row table), and Hosting plans (Hosting, Partner; recurring, on top of the build). Every site on a hosting plan gets the 3DWD Client Portal, so it isn't a Full build feature. Hosting plans are billed yearly only, with no monthly price: $640 a year for Partner would be an awkward $53.33 a month.
- **How the prices were set (2026-10-25):** Starter and Business were set a little under the market ranges. Partner is four quarterly one-hour check-ins at $100 on top of Hosting ($240 + $400 = $640).
- **Online shops (removed from the Proposal, 2026-10-25):** for a client who wants a shop, Rich suggests connecting Square or Shopify rather than building one, to save them money, with the setup quoted with the build or billed by the hour. It's advice given in conversation with a client, one of the options at different costs in What I do, not a price line.

### Supporting material

- **Still to write:** "Why not a drag-and-drop platform", a comparison for business owners. It says "drag-and-drop platforms" and names no platform (decided 2026-10-25). Client stories keep the platform names (Squarespace, Wix), since they are history.
- **Where the technical detail lives:** the master doc's How It's Built tab, the security, scaling and deployment tabs, and Build vs Buy (CMS, and Drag and Drop, not started).

### For the landing page

The landing page speaks to the owner ("you"); the Proposal speaks about the owner, for a reviewer. Lead line, from the Mission (2026-10-25):

- "Not only will your website look great, it will help run your business."

Draft lines about the Client Portal, and when each can be used:

- "Post your updates yourself. No waiting on me." Any time.
- "Announce a deal, share news, post something new, yourself, without waiting on anyone." Any time.
- "Write a post, add a photo, publish. That's the whole dashboard." Any time.
- "Sign in with Google. No passwords to forget." Any time.
- "All your websites in one place." For owners with more than one site.
- "Your dashboard is yours. Other businesses can't see or change anything in it." Any time.
- "See your post before it goes live." Any time, now that Post preview has shipped.
- "Features your fellow businesses asked for, offered to you." Only once add-ons exist and live use justifies them.
- "Your website stays up even if your dashboard is down." Only after checking how a client site behaves when the API is unreachable.

Copy rules:

- Customer language only: no "headless", "multi-tenant", "API key" or "webhook".
- Say "within moments", never "instant", until revalidation timing is measured.
- No "own your platform" or "no lock-in" until an export or handover path exists.
- No gaps or weaknesses on the landing page.
- No competitor names or prices: say "drag-and-drop platforms".
- 3D Web Dev is the business; the Client Portal is the tool.
