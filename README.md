# Woody's Paper — Website (Next.js)

Next.js 16 (App Router) + React 19 + TypeScript. Styling is **Tailwind CSS v4**;
plain CSS is used only where Tailwind has no primitive. In production it is
hosted in **two parts**: the pages are plain files on the web host (GoDaddy cPanel), and
the API routes under `src/app/api`, which handle customer accounts (SQL Server) and
Lightspeed lookups, run as a Node server on our own server. See [Deploying](#deploying).

## Setup

Create `.env.local` (never committed):

```
# Lightspeed (Ecwid) store
NEXT_PUBLIC_LIGHTSPEED_STORE_ID=<store id>
NEXT_PUBLIC_LIGHTSPEED_PUBLIC_TOKEN=<public_ token: search suggestions, category bar>
LIGHTSPEED_SECRET_TOKEN=<secret_ token, server only: customer lookups; needs read_customers>

# Website accounts
AUTH_SECRET=<48+ random characters>
DB_USER=woodys_web
DB_PASSWORD=<the password chosen in db/002_web_login.sql>
# Optional: DB_SERVER (localhost), DB_PORT (1433), DB_NAME (WOODYS_IND)

# Account email (Microsoft 365 mailbox). Without SMTP_HOST, dev prints emails to the console.
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=<mailbox address>
SMTP_PASS=<mailbox or app password>
MAIL_FROM="Woody's Paper <mailbox address>"

# Optional: automatic store sign-in for store accounts created through the website
ECWID_SSO_CLIENT_ID=<custom app client_id>
ECWID_SSO_CLIENT_SECRET=<custom app client_secret>
```

Create the accounts database once, as a SQL Server administrator (see the comments in
each script):

```bash
sqlcmd -E -S localhost -b -i db\001_accounts.sql
sqlcmd -E -S localhost -b -v WEB_PASSWORD="<password>" -i db\002_web_login.sql
sqlcmd -E -S localhost -b -i db\003_lightspeed_data.sql
```

When querying or editing the database by hand with `sqlcmd`, add `-I` (quoted
identifiers on); without it, deletes fail on a filtered index.

## Scripts

```bash
npm install
npm run dev      # http://localhost:5000
npm run build:site   # the pages as plain files in out/, for the web host
npm run build:api    # the API only, in .next-api/
npm start            # serves the API build on http://127.0.0.1:5100
npm run lint
npm test         # unit tests (tests/) for hashing, codes, sign-on payload, validation
```

## Deploying

Production is two builds of this one project (`next.config.ts`, `scripts/build.mjs`):

| Build | Command | Result | Goes to |
|---|---|---|---|
| Site | `npm run build:site` | `out/`: the pages as plain files | the web host (GoDaddy cPanel, `public_html`) |
| API | `npm run build:api` | `.next-api/`: only the routes in `src/app/api` | our server, next to SQL Server, run with `npm start` |

`npm run dev` runs both together on one address, so nothing below is needed to develop.

The split works through file names: API routes are called `route.api.ts`, and the site
build doesn't recognise that extension. A new API route must use that name too.

**Settings** (`.env.local`, read when building *and* when running):

- `NEXT_PUBLIC_API_URL`: where the API is reachable, e.g. `https://api.woodyspaper.com`.
  Built into the site's pages, so set it before `npm run build:site`. It must be on the
  same domain as the website (a subdomain), or browsers treat the sign-in cookie as
  third-party and block it.
- `SITE_ORIGINS`: the website's address(es), comma separated, e.g.
  `https://woodyspaper.com`. Only pages from these may call the API. Set it before
  `npm run build:api` (it is built into the cross-origin headers) and keep it set when
  running (`src/server/http.ts` checks each request against it).
- `CLIENT_IP_HEADER`: see below.

**The site (GoDaddy).** Upload everything inside `out/`, hidden `.htaccess` included, to
`public_html`. Each page is a folder with an `index.html` (`/inventory/`), so no rewrite
rules are needed. `public/.htaccess` forces HTTPS, sends `www` to the bare domain, and
sets the security headers (HTTPS-only, no framing by other sites, no content-type
guessing, a short referrer). There is no Content-Security-Policy, because the Lightspeed
store loads from too many changing addresses for one to be safe. `/robots.txt` and
`/sitemap.xml` come from `src/app/robots.ts` and `src/app/sitemap.ts`; both assume
`https://woodyspaper.com`.

**The API (our server).** `npm start` listens on `127.0.0.1:5100` only; a Cloudflare
Tunnel publishes it as `https://api.woodyspaper.com`, so no port is opened to the
internet. The session cookie is `Secure` in production, so sign-in only works over HTTPS
(or on `localhost`). The API serves no pages: anything outside `/api` is a 404.

The visitor's address, for throttling, comes from a request header. By default the API
reads the last entry of `X-Forwarded-For`. Behind Cloudflare set
`CLIENT_IP_HEADER=cf-connecting-ip`. If no address arrives (requests just look like they
come from this machine), the per-address limits fall back to one shared bucket with a
ceiling 20 times higher, so a few mistyped passwords can't lock everyone out; the
per-email and per-account limits still apply.

**Updating.** Site change: `npm run build:site`, upload `out/`. API change (anything in
`src/app/api` or `src/server`): `npm run build:api`, restart the API. If the website is
up but the API isn't, the pages and the store still work; signing in and the account page
show an error until it is back.

**Backups.** `WOODYS_IND` is covered by this server's nightly Windows Server Backup
(11 PM), which captures every SQL Server database. To take one by hand:

```bash
sqlcmd -E -S localhost -Q "BACKUP DATABASE WOODYS_IND TO DISK = N'WOODYS_IND.bak' WITH COPY_ONLY, CHECKSUM, INIT"
```

## Styling conventions

All design decisions live as tokens in the `@theme` block of `src/app/globals.css`, and
are consumed as ordinary utilities in components.

| Token group   | Examples                                                  | Utilities produced                                     |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| Colour        | `--color-brand-blue`, `--color-brand-mist`, `--color-ink` | `bg-brand-blue`, `text-ink`, `hover:text-brand-sky`    |
| Type          | `--font-display`, `--text-3xs`, `--tracking-ultra`        | `text-3xs`, `tracking-ultra`, `leading-hero`           |
| Chrome sizing | `--spacing-utility`, `--spacing-header`, `--spacing-chrome` | `h-header`, `top-utility`, `pt-chrome`, `scroll-mt-chrome` |
| Radii         | `--radius-card`, `--radius-panel`                         | `rounded-card`, `rounded-panel`                        |
| Shadow        | `--shadow-glass`, `--shadow-lift`, `--shadow-cta`         | `shadow-cta`, `shadow-panel`                           |
| Motion        | `--animate-float`, `--ease-brand`                         | `animate-float`, `ease-brand`                          |

Fonts (Inter, Playfair Display) load through `next/font` in `src/app/layout.tsx` and
feed `--font-sans` / `--font-display`.

**Rules of thumb**

1. Reach for an existing utility first.
2. Need a new colour, size, radius, shadow or animation? Add a token to `@theme` —
   don't write `bg-[#437a3d]` or `text-[11px]` in a component.
3. Repeating the same cluster of classes? Extract a component (`Reveal`, `HeaderSearch`),
   not a CSS class.
4. Write raw CSS only for things utilities can't express: the `tilt-stage` /
   `tilt-target` utilities, the base layer, and the Lightspeed storefront overrides
   (`#products .ec-store …`).

## Structure

```
src/
  app/          layout.tsx (site chrome + fonts), page.tsx (home), inventory/ (store),
                login/, signup/, reset-password/, account/, privacy/, globals.css
    api/        auth/* (sign-up, sign-in, codes, reset), lightspeed/* (link, sso), account
  components/   UI, one file per section + shared pieces; account/ holds the account pages
  hooks/        useReveal, useTilt
  services/     browser-side: account.ts (website account), storeCustomer.ts (store
                sign-in state), inquiries.ts (supply inquiry email), store API helpers
  server/       server-only: db.ts, accounts.ts, sessions.ts, lightspeed.ts, mailer.ts,
                rateLimit.ts, plus pure helpers (passwords, tokens, ecwidSso, validation,
                lightspeedData)
db/             SQL Server scripts for the WOODYS_IND accounts database
tests/          unit tests for the pure helpers in src/server
scripts/
  add-home-meta.mjs   adds the home page's description/sharing tags after the build
```

## Home page

`src/app/page.tsx` is built to send visitors into the store. Top to bottom:

- **`HeroSection`** — what we sell, a "Shop all products" button and an account button
  ("Get account pricing", or "Your account" when signed in), three short promises
  (`PROMISES`; keep each one true) and the warehouse phone number. The product count in
  the sentence ("1,100+ products") is live from Lightspeed (`loadCatalogSize`), rounded
  down to the nearest 50, and simply left out if the store can't be reached.
- **`BrandCarousel`** — "Brands we carry": one slide per brand, with the brand name, how
  many of its products are in stock, a "Shop all" link (the store's search filtered to
  that brand and in-stock items) and up to four of its in-stock products with photo,
  SKU and list price. Brand tabs, arrow buttons, swiping and the keyboard all move the
  same scroll-snapping strip, and it moves on by itself every 5 seconds
  (`AUTO_ADVANCE_MS`), wrapping from the last brand to the first. It holds still while
  the pointer or keyboard focus is on it or the browser tab is in the background; where
  the system asks for reduced motion (Windows with animations off) the next brand
  appears without sliding. An "All products" button sits under the carousel. `services/brandShowcase.ts` takes the ten brands with the
  most in-stock products from the store's Brand attribute (skipping `NOT_A_BRAND`
  values such as GENERIC) and, per brand, the first products that have a photo and a
  real price and aren't named "discontinued". There are no brand logos: Lightspeed
  holds only the names. Hidden entirely if the store can't be reached. (Categories
  aren't repeated here: the category bar under the header already lists them.)
- **`HomeSteps`** — "Ordering is simple" in three steps (`STEPS`), plain text with blue
  numerals, with Create an account / Sign in buttons, or "Continue shopping" for
  signed-in customers.
- **`InquirySection`** — a small "Need a quote?" card (`#contact`). Kept compact on
  purpose; the supply inquiry is the fallback, not the main action.
- **`AboutSection`** — "About us" (`#about`, linked from the footer), last on the page because it is reading matter: who we are, what
  we sell in four product lines, the brands we carry, and a chip per store category
  linking into the inventory. This is the page's search-engine text, so it is written
  into the HTML and not loaded from Lightspeed: `PRODUCT_LINES`, `CATEGORIES` (ids
  from the store) and `BRANDS` must be kept true by hand when the catalog changes.

## Loading, retries and errors

Anything that loads shows a placeholder, is retried when it fails for a passing reason,
and tells the visitor if it still can't be had.

- **Placeholders.** `components/Skeleton.tsx` has `Skeleton` (a pulsing grey block; size
  it like what replaces it) and `LoadError` (a message with a "Try again" button). They
  are used by the brand carousel, the category bar, the search suggestions, the store's
  filter row, the store itself (cards laid over it until it is usable), the account
  page and the account name in the header.
- **Retries.** `services/retry.ts` (`withRetry`) repeats a request up to three times in
  all, after 0.4s and 1.2s, when the connection fails, it times out, or the server
  answers 408, 429 or 5xx. Anything else (a 4xx) fails at once. It wraps every *read*:
  `storeApiGet` (Lightspeed from the browser), GET calls through `api()` (our own
  `/api` routes) and the server's Lightspeed calls (`server/lightspeed.ts`). The store's
  script is also loaded again by itself, twice, before its error shows.
- **Never retried automatically: actions.** POSTs through `api()` (sign up, sign in,
  send a code, link, reset) and the supply inquiry email run once. The first try may
  have worked even if its answer was lost, so a repeat could send a second code or a
  duplicate inquiry. The form shows the error and the visitor presses the button again.
- **When it still fails.** The brand carousel and the account page say so with a "Try
  again" button; the store says so with a button that reloads the page; forms show the
  message by the button. The category bar, the store's filter row and the hero's product
  count are extras, so they are quietly left out and the page works without them.

## Lightspeed storefront

The store lives on `/inventory` (`InventoryContent` → `InventorySection` →
`LightSpeedStore`). The home page has no store; the header and the category bar, which
are on every page, lead into it.

- **Header search (`HeaderSearch.tsx`):** the product search box. On `/inventory` it
  searches the store in place; from any other page it goes to `/inventory?q=…`.
- **Category bar (`CategoryBar.tsx`):** "All products", the store's top-level categories
  and an "All categories" menu, under the header. Each opens that category on
  `/inventory`. It is fixed on desktop; on mobile it scrolls away with the page. The list
  comes from Lightspeed (`services/categories.ts`), so new categories appear by
  themselves. Categories with no products are left out, and so are the ids in
  `HIDDEN_CATEGORY_IDS` (keep that list in step with the matching rule in `globals.css`).

`LightSpeedStore.tsx` embeds the Ecwid store with its dynamic-widget pattern, and
`StoreSearch.tsx` drives it through Ecwid's JS API. It has no search field of its own:
the header and the category bar send it requests through `services/storePages.ts`
(`requestStorePage`). When there is no store on the page, nothing answers, and they
navigate to `/inventory` instead. `?q=…` on `/inventory` opens that search once the
store is ready, and searches keep `?q=` in step. `services/storePages.ts` also shares
the store's single page-change hook (Ecwid can't remove one).

The store owns the `#!/…` part of the URL on `/inventory`.

### Search suggestions

While a visitor types in the header search box (2+ characters), up to 8 matching
products drop down below it, each with photo, name, SKU, price and stock. Choosing one
opens that product: in place on `/inventory`, or on `/inventory` from any other page.
Enter, the Search button, or "See all N results" runs the full store search.

- `src/services/productSearch.ts` asks Lightspeed's product API
  (`GET /products?keyword=…`), which matches partial words ("napk", "text rep") and SKUs.
  Requests wait for a 200 ms pause in typing, older ones are cancelled, and recent
  answers are cached.
- It and the category bar use the store's **public** token (`services/storeApi.ts`),
  `NEXT_PUBLIC_LIGHTSPEED_PUBLIC_TOKEN` in `.env.local`, from the custom app's Details
  page at `my.ecwid.com/#develop-apps`. That token is read-only and made for storefronts,
  so shipping it in the site is fine. Never use the `secret_` token there. Without a
  public token, suggestions are off and the category bar shows only "All products".
- Prices shown are list prices. Customer-group discounts still apply in the cart.
- `src/components/SearchSuggestions.tsx` is the dropdown, and `HeaderSearch.tsx` drives
  it (an accessible combobox: ↑/↓, Enter, Esc).

### Customer accounts

There are two accounts, and the website account is the one Woody's owns:

- **Website account** — name, email and password, stored in the `WOODYS_IND` database
  on our SQL Server (`db/001_accounts.sql`). Pages: `/signup`, `/login`,
  `/reset-password`, `/account`. The header's **Sign In / first name** link is this
  account (`services/account.ts`, `useAccount()`).
- **Lightspeed store account** — the customer record in Lightspeed that carries the
  **customer group** pricing and is used at checkout. Set groups up under Customers →
  Customer groups in the Lightspeed admin.

On `/account`, once the email is confirmed, a customer connects the two
(`server/lightspeed.ts`, table `LightspeedLinks`):

- **Linked** (already a store customer): they enter the email on their store account and
  we email a 6-digit code to that address; entering it links the account. (If it is the
  same address they already confirmed for the website account, it links at once.) The
  account page then shows their store name and pricing group, read from Lightspeed with
  the secret token. At checkout they still sign in to the store with Lightspeed's own
  emailed code — the **Store Sign-In** control beside the cart (`StoreAccount.tsx`).
- **Created through the website** (new to the store): "Create my store account" marks
  the account for Lightspeed **single sign-on**. The store then creates the customer on
  their first visit and signs them in automatically whenever they are signed in to the
  website (`server/ecwidSso.ts`, `LightSpeedStore.tsx`). This option only appears when
  `ECWID_SSO_CLIENT_ID` / `ECWID_SSO_CLIENT_SECRET` are set; they come from a custom app
  with the `create_customers` scope, and SSO needs a paid Lightspeed eCom plan.

Why two paths: Lightspeed's single sign-on cannot attach to a store customer that already
exists under the same email, so existing customers keep the store's own sign-in.

**Saved Lightspeed data.** Once an account has a store customer, a copy of that
customer's Lightspeed record is kept in `dbo.LightspeedCustomers`
(`db/003_lightspeed_data.sql`, one row per website account):

- pricing: `CustomerGroupId` / `CustomerGroupName` (the tier) and `DiscountPercent`,
  `DiscountName`, `DiscountDescription` — the largest active percent-off **promotion**
  Lightspeed has for that group (Marketing → Promotions, triggered by customer group);
- name, company, phone, billing address, tax-exempt flag and tax ID, order count and
  sales totals, registration date;
- JSON columns for the rest: `ShippingAddressesJson`, `ContactsJson`, `PromotionsJson`
  (every promotion applying to the group) and `RawJson` (the whole record, including
  staff-only fields such as private admin notes — never send this column to the browser).

`syncStoreCustomer()` in `server/lightspeed.ts` writes it when the account is linked and
again each time the customer opens `/account`; `server/lightspeedData.ts` does the
mapping. It is a snapshot: changes made in Lightspeed appear here at the customer's next
account-page visit. Unlinking, or deleting the website account, deletes the row. The
website doesn't display any of it yet beyond the name and pricing group.

Security notes:

- Passwords are hashed with scrypt; session tokens and emailed codes are stored only as
  hashes. Codes expire after 15 minutes, work once and allow 5 tries.
- The session is an HttpOnly, SameSite=Lax cookie (`woodys_session`, 30 days).
- Sign-in, sign-up and code requests are throttled (table `AuthAttempts`).
- Linking never reveals whether someone else's email belongs to a store customer. Only
  for the account's own confirmed email does it say "no store account found".
- On `/account` a customer can change their name, and their password by giving the
  current one (`AccountSettings.tsx`, `/api/account/profile`, `/api/account/password`).
  A password change signs out their other browsers and emails them a notice. The email
  address itself can't be changed yet.
- The header menu offers "Orders & store account" only to accounts that have a store
  account; others get "Link store account". Arriving at the store's account page while
  signed in to the website shows a line explaining the store's separate sign-in
  (`StoreSignInHelp.tsx`).
- The website's SQL login (`woodys_web`) can only read and write rows in `WOODYS_IND`.

`src/services/storeCustomer.ts` still mirrors the store's own sign-in state
(`Ecwid.Customer.get`, `Ecwid.OnSetProfile`) into `localStorage`, for the greeting
beside the cart. It holds a name and email, never prices or tokens.

### Meta tags

The store rewrites and deletes the page's description / Open Graph / Twitter meta tags
while it runs. If React (Next's `metadata`) rendered those tags, it would crash when
leaving a page with the store. So they are **never** set through `metadata`:
`scripts/add-home-meta.mjs` writes the home page's tags straight into the built
`out/index.html` after the site build (`npm run build:site` runs both). Search engines and link previews read
them from there. Edit the wording in that script. They don't exist in `npm run dev`.

## Supply inquiry email

`submitInquiry({ company, email, details })` in `src/services/inquiries.ts` posts to
FormSubmit (alias `FORMSUBMIT_ID`), with the visitor's address as Reply-To. If sending
fails, the form offers a `mailto:` link instead. To use another mail endpoint, replace the
body of `submitInquiry` and keep its signature. Never call a paid API with a secret key
from the browser — a key shipped to the client is public.
