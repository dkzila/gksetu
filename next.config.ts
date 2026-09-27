import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No `output: "standalone"` — Vercel manages builds itself (P1-S1 decision).
  reactStrictMode: true,
  typescript: {
    // Fail builds on type errors — quality is enforced by `bun run type-check` in CI.
    ignoreBuildErrors: false,
  },
  // P4-S4 (§16): serve robots.txt and sitemap.xml at their standard crawler
  // locations — rewrites onto the seo module's API routes (no extra route
  // files; the gateway sees one app).
  async rewrites() {
    return [
      { source: "/robots.txt", destination: "/api/seo/robots" },
      { source: "/sitemap.xml", destination: "/api/seo/sitemap" },
    ];
  },
};

export default nextConfig;
