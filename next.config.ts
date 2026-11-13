import type { NextConfig } from "next";

/*
 * One project, built two ways for production (scripts/build.mjs):
 *
 *   site  The pages, as plain files in out/ for the web host (GoDaddy cPanel).
 *         No server code: the API routes are left out.
 *   api   Only the API routes in src/app/api, run with `next start` on the
 *         server that can reach SQL Server. No pages.
 *
 * With no target (npm run dev) pages and API run together on one address.
 *
 * The split works through file names: API routes are called `route.api.ts`,
 * and each target only recognises the extensions listed for it below.
 */
const target = process.env.BUILD_TARGET as "site" | "api" | undefined;

const PAGE_EXTENSIONS = {
  site: ["tsx", "ts"],
  api: ["api.ts"],
  all: ["tsx", "ts", "api.ts"],
};

/*
 * Security headers sent with every response. For the `site` target the same
 * list lives in public/.htaccess, because plain files can't send headers.
 *
 * There is no Content-Security-Policy: the Lightspeed store loads scripts,
 * styles and frames from a long and changing list of its own and its payment
 * providers' addresses, and a policy that missed one would break checkout.
 */
const SECURITY_HEADERS = [
  // Browsers that have seen the site over HTTPS refuse plain HTTP for a year. Ignored over plain HTTP (localhost).
  // Not "includeSubDomains": other woodyspaper.com names (erp, vault, vpn, mail) are separate systems.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  // Other sites can't put ours in a frame (clickjacking).
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Files are treated as the type we say, not guessed.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Other sites learn only that a visitor came from ours, not which page.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The site uses none of these device features.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/*
 * The website's address(es) when it is hosted apart from the API, e.g.
 * SITE_ORIGINS=https://woodyspaper.com,https://www.woodyspaper.com
 * Pages there may call the API with the sign-in cookie; no other site may.
 * (src/server/http.ts reads the same setting for its own check.)
 */
const siteOrigins = (process.env.SITE_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const nextConfig: NextConfig = {
  pageExtensions: PAGE_EXTENSIONS[target ?? "all"],
  // Images are served as-is: the image optimizer needs a server, and the pages have none in production.
  images: { unoptimized: true },
  // Database driver: load from node_modules at runtime instead of bundling.
  serverExternalPackages: ["mssql", "tedious"],
  // Don't announce what the site is built with.
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  ...(target === "site"
    ? {
        // Plain files in out/. Each page is a folder with an index.html
        // (/inventory/), which any web host serves without extra rules.
        output: "export" as const,
        trailingSlash: true,
      }
    : {
        // The api target has no pages, which Next's generated route types
        // can't express (layout.tsx then names a route that doesn't exist).
        // `npm run build:site` type-checks the whole project, API code included.
        // It also gets its own build folder, so building the site (which works
        // in .next/) never disturbs an API that is running.
        ...(target === "api" ? { typescript: { ignoreBuildErrors: true }, distDir: ".next-api" } : {}),
        async headers() {
          return [
            { source: "/:path*", headers: SECURITY_HEADERS },
            // Cross-origin access for the website, one rule per allowed address
            // (the reply must name the exact origin that asked).
            ...siteOrigins.map((origin) => ({
              source: "/api/:path*",
              has: [{ type: "header" as const, key: "origin", value: escapeRegex(origin) }],
              headers: [
                { key: "Access-Control-Allow-Origin", value: origin },
                { key: "Access-Control-Allow-Credentials", value: "true" },
                { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
                { key: "Access-Control-Allow-Headers", value: "Content-Type" },
                { key: "Access-Control-Max-Age", value: "86400" },
                { key: "Vary", value: "Origin" },
              ],
            })),
          ];
        },
      }),
};

export default nextConfig;
