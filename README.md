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
3. Repeating the same cluster of classes? Extract a component (`Reveal`, `HeaderSearch`),
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
