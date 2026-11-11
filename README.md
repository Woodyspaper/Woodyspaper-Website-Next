# Woody's Paper — Website (Next.js)

Next.js 16 (App Router) + React 19 + TypeScript. Styling is **Tailwind CSS v4**;
plain CSS is used only where Tailwind has no primitive. The site runs as a **Node
server** (`next start`): the pages are still prerendered, and the API routes under
`src/app/api` handle customer accounts (SQL Server) and Lightspeed lookups.

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
npm run build    # production build in .next/
npm start        # serves the build on http://localhost:5000
npm run lint
npm test         # unit tests (tests/) for hashing, codes, sign-on payload, validation
```

## Deploying

Run `npm run build` then `npm start` on the server that can reach SQL Server, and put it
behind HTTPS (a reverse proxy or tunnel). The session cookie is `Secure` in production,
so sign-in only works over HTTPS (or on `localhost`). The proxy must pass the `Host`
header (or `X-Forwarded-Host`) and `X-Forwarded-For` through: the API checks that
requests come from the site's own origin, and throttles by visitor address.

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
- Linking never reveals whether an email belongs to a store customer.
- The website's SQL login (`woodys_web`) can only read and write rows in `WOODYS_IND`.

`src/services/storeCustomer.ts` still mirrors the store's own sign-in state
(`Ecwid.Customer.get`, `Ecwid.OnSetProfile`) into `localStorage`, for the greeting
beside the cart. It holds a name and email, never prices or tokens.

### Meta tags

The store rewrites and deletes the page's description / Open Graph / Twitter meta tags
while it runs. If React (Next's `metadata`) rendered those tags, it would crash when
leaving a page with the store. So they are **never** set through `metadata`:
`scripts/add-home-meta.mjs` writes the home page's tags straight into the prerendered
`.next/server/app/index.html` after `next build` (`npm run build` runs both). Search engines and link previews read
them from there. Edit the wording in that script. They don't exist in `npm run dev`.

## Supply inquiry email

`submitInquiry({ company, email, details })` in `src/services/inquiries.ts` posts to
FormSubmit (alias `FORMSUBMIT_ID`), with the visitor's address as Reply-To. If sending
fails, the form offers a `mailto:` link instead. To use another mail endpoint, replace the
body of `submitInquiry` and keep its signature. Never call a paid API with a secret key
from the browser — a key shipped to the client is public.
