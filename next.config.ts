import type { NextConfig } from "next";

/*
 * Security headers sent with every response.
 *
 * There is no Content-Security-Policy: the Lightspeed store loads scripts,
 * styles and frames from a long and changing list of its own and its payment
 * providers' addresses, and a policy that missed one would break checkout.
 */
const SECURITY_HEADERS = [
  // Browsers that have seen the site over HTTPS refuse plain HTTP for a year. Ignored over plain HTTP (localhost).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Other sites can't put ours in a frame (clickjacking).
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Files are treated as the type we say, not guessed.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Other sites learn only that a visitor came from ours, not which page.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The site uses none of these device features.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // The site runs as a Node server (`next start`): customer accounts need the
  // API routes in src/app/api, which talk to SQL Server and Lightspeed.
  // Images are served as-is, as they were when the site was a static export.
  images: { unoptimized: true },
  // Database driver: load from node_modules at runtime instead of bundling.
  serverExternalPackages: ["mssql", "tedious"],
  // Don't announce what the site is built with.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
