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
  app/          layout.tsx (site chrome + fonts), page.tsx (home),
                inventory/page.tsx (store hub), not-found.tsx, globals.css
  components/   UI, one file per section + shared pieces
  hooks/        useReveal, useTilt
  services/     inquiries.ts  ← sends the supply inquiry email
  data/         inventory.ts (categories), catalog.ts (featured items)
  paths.ts      inventoryPath(query) → /inventory?q=…
```

## Lightspeed storefront

`LightSpeedStore.tsx` embeds the Ecwid store with its dynamic-widget pattern, and
`StoreSearch.tsx` drives it through Ecwid's JS API. `/inventory?q=…` opens that search
once the store is ready, and searches keep `?q=` in step.

The store rewrites and deletes the page's description / Open Graph / Twitter meta tags
while it runs. Those tags are therefore set only on the home page (`app/page.tsx`), never
in the shared layout or on `/inventory` — if React owned them, it would crash when
leaving the hub.

## Supply inquiry email

`submitInquiry({ company, email, details })` in `src/services/inquiries.ts` posts to
FormSubmit (alias `FORMSUBMIT_ID`), with the visitor's address as Reply-To. If sending
fails, the form offers a `mailto:` link instead. To use another mail endpoint, replace the
body of `submitInquiry` and keep its signature. Never call a paid API with a secret key
from the browser — a key shipped to the client is public.
