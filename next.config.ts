import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build to plain static files in out/ — upload that folder to any static host.
  output: "export",
  // The default image optimizer needs a server; static export serves images as-is.
  images: { unoptimized: true },
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
