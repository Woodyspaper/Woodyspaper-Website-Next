# Woody's Paper — Website (Next.js)

Next.js 16 (App Router) + React 19 + TypeScript. Styling is **Tailwind CSS v4**;
plain CSS is used only where Tailwind has no primitive. The site builds to **static
files** (`output: 'export'`), so no Node server is needed to host it.

## Setup

Create `.env.local` with the Lightspeed (Ecwid) store ID:

```
NEXT_PUBLIC_LIGHTSPEED_STORE_ID=<store id>
```

## Scripts

```bash
npm install
npm run dev      # http://localhost:5000
npm run build    # static site in out/
npm start        # serves out/ on http://localhost:5000
npm run lint
```

## Deploying

Upload the contents of `out/` to any static host. `/inventory` is emitted as
`inventory.html`; the host should serve it for `/inventory` (most do by default).
Unknown URLs get `404.html`, which sends visitors to the home page.

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
3. Repeating the same cluster of classes? Extract a component (`Reveal`, `ProductSearchForm`),
   not a CSS class.
4. Write raw CSS only for things utilities can't express: the `tilt-stage` /
   `tilt-target` utilities, the base layer, and the Lightspeed storefront overrides
   (`#products .ec-store …`).

## Structure

```
src/
  app/          layout.tsx (site chrome + fonts), page.tsx (home, with the store),
                inventory/page.tsx (store on its own page), not-found.tsx, globals.css
  components/   UI, one file per section + shared pieces
  hooks/        useReveal, useTilt
  services/     inquiries.ts (supply inquiry email), storeCustomer.ts (sign-in state)
scripts/
  add-home-meta.mjs   adds the home page's description/sharing tags after the build
```

## Lightspeed storefront

The store appears in two places, both rendered by `InventoryContent` → `InventorySection`
→ `LightSpeedStore`:

- **Home page, Inventory Hub section:** a front window (`hubPath="/inventory"`). It shows
  the store's front page. Clicking a category or product, searching, the cart icon and
  Sign In all open on `/inventory` with that page or search open. Links are caught before
  the store follows them (a normal history entry). Any other page change is caught after
  it happens and the address is *replaced*, so Back doesn't bounce.
- **`/inventory`:** the full store, browsed in place.

`LightSpeedStore.tsx` embeds the Ecwid store with its dynamic-widget pattern, and
`StoreSearch.tsx` drives it through Ecwid's JS API. On `/inventory`, `?q=…` opens that
search once the store is ready, and searches keep `?q=` in step. `services/storePages.ts`
shares the store's single page-change hook (Ecwid can't remove one).

The store owns the `#!/…` part of the URL. That's why the header's Supply Inquiry links
scroll to the form directly when you're already on the home page.

### Search suggestions

While a visitor types in the store's search box (2+ characters), up to 8 matching
products drop down below it, each with photo, name, SKU, price and stock. Choosing one
opens that product: in place on `/inventory`, or on `/inventory` from the home page.
Enter, or "See all N results", runs the full store search as before.

- `src/services/productSearch.ts` asks Lightspeed's product API
  (`GET /products?keyword=…`), which matches partial words ("napk", "text rep") and SKUs.
  Requests wait for a 200 ms pause in typing, older ones are cancelled, and recent
  answers are cached.
- It uses the store's **public** token, `NEXT_PUBLIC_LIGHTSPEED_PUBLIC_TOKEN` in
  `.env.local`, from the custom app's Details page at `my.ecwid.com/#develop-apps`. That
  token is read-only and made for storefronts, so shipping it in the site is fine. Never
  use the `secret_` token there. Without a public token, suggestions are simply off.
- Prices shown are list prices. Customer-group discounts still apply in the cart.
- `src/components/SearchSuggestions.tsx` is the dropdown, and `StoreSearch.tsx`'s
  `ProductSearchForm` drives it (an accessible combobox: ↑/↓, Enter, Esc).

### Customer accounts

Customers sign in through the store itself (Lightspeed emails a one-time code and creates
the account if needed). Once signed in, Lightspeed applies their **customer group**
pricing and discounts — set those up under Customers → Customer groups in the Lightspeed
admin. The site adds:

- a **Sign In / My Account** link in the header → `/inventory?account=1`, which opens the
  store's account page;
- a **Hi, name · My Account · Sign out** control beside the cart (`StoreAccount.tsx`).

`src/services/storeCustomer.ts` mirrors the store's sign-in state (`Ecwid.Customer.get`,
`Ecwid.OnSetProfile`) into `localStorage`, only so the header can show the right label on
pages where the store isn't loaded. It holds a name and email, never prices or tokens.

### Meta tags

The store rewrites and deletes the page's description / Open Graph / Twitter meta tags
while it runs. If React (Next's `metadata`) rendered those tags, it would crash when
leaving a page with the store. So they are **never** set through `metadata`:
`scripts/add-home-meta.mjs` writes the home page's tags straight into `out/index.html`
after `next build` (`npm run build` runs both). Search engines and link previews read
them from there. Edit the wording in that script. They don't exist in `npm run dev`.

## Supply inquiry email

`submitInquiry({ company, email, details })` in `src/services/inquiries.ts` posts to
FormSubmit (alias `FORMSUBMIT_ID`), with the visitor's address as Reply-To. If sending
fails, the form offers a `mailto:` link instead. To use another mail endpoint, replace the
body of `submitInquiry` and keep its signature. Never call a paid API with a secret key
from the browser — a key shipped to the client is public.
