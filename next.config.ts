import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The site runs as a Node server (`next start`): customer accounts need the
  // API routes in src/app/api, which talk to SQL Server and Lightspeed.
  // Images are served as-is, as they were when the site was a static export.
  images: { unoptimized: true },
  // Database driver: load from node_modules at runtime instead of bundling.
  serverExternalPackages: ["mssql", "tedious"],
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
