import type { NextConfig } from "next";

/**
 * GKSetu — Next.js configuration
 *
 * P-SEC (security-audit session): production security headers added. The
 * split is deliberate:
 *  - development (the sandbox preview): the essential hardening headers only —
 *    no frame restrictions (the preview panel may frame the app cross-origin)
 *    and no HSTS (the platform edge terminates TLS its own way).
 *  - production (Vercel builds run NODE_ENV=production): the full set —
 *    CSP, frame-ancestors 'self', HSTS, and Permissions-Policy lock-down.
 *
 * CSP is the pragmatic Next.js form: 'unsafe-inline' on script/style (Next's
 * bootstrap + client-side JSON-LD injection need it; there is no nonce
 * infrastructure and none is warranted at this scale — the win is the
 * default-src/connect-src 'self' closure: no exfiltration channel even if
 * an XSS lands, which matters because the §4 bearer token lives in
 * localStorage on the client by design).
 */

const isProd = process.env.NODE_ENV === "production";

const productionHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join("; "),
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
];

const developmentHeaders = [
  // Dev: CSP without frame-ancestors/XFO (the sandbox preview panel may frame
  // the app cross-origin); 'unsafe-eval' for React Fast Refresh.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // No `output: "standalone"` — Vercel manages builds itself (P1-S1 decision).
  reactStrictMode: true,
  // Don't advertise the framework in responses.
  poweredByHeader: false,
  // DEPLOY-S2: the §16 URL space is real paths now (no '#'), documented
  // with trailing slashes (/{country}/, /gk/{topic}/{unit}/ …). Serving
  // BOTH forms directly (no 308 redirects) keeps every client fetch('/api/…')
  // single-hop — the trailing-slash redirect would have doubled every API
  // call — while share links and canonicals keep their §16 shape.
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  typescript: {
    // Fail builds on type errors — quality is enforced by `bun run type-check` in CI.
    ignoreBuildErrors: false,
  },
  // P4-S4 (§16): serve robots.txt and sitemap.xml at their standard crawler
  // locations — rewrites onto the seo module's API routes (no extra route
  // files; the gateway sees one app).
  //
  // DEPLOY-S2: BEFORE-FILES — the app shell is now an optional catch-all
  // ([[...slug]]), so an afterFiles rewrite would never run (the catch-all
  // page matches /robots.txt first). beforeFiles rewrites ahead of the
  // filesystem, keeping the crawler endpoints on the API routes.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/robots.txt", destination: "/api/seo/robots" },
        { source: "/sitemap.xml", destination: "/api/seo/sitemap" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          ...(isProd ? productionHeaders : developmentHeaders),
        ],
      },
    ];
  },
};

export default nextConfig;
