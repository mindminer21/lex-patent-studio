import type { NextConfig } from "next";
import { legacyRedirects } from "./src/lib/config/redirects";

/**
 * Shared Next.js configuration for the two co-hosted products:
 *
 * - Lex Patent Studio — root marketing pages, /app/** workspace, its /api/**.
 * - wepatent          — /wepatent/** public pages, /wepatent/app/** workspace,
 *                       /counsel/** administration lane, its /api/**.
 *
 * Security headers are the union of both products' policies (Lex PRD §13,
 * wepatent PRD §11): the merged CSP keeps Lex's `object-src 'none'` and
 * wepatent's `font-src … data:`; Permissions-Policy is the union of the two
 * deny-lists. CSP note: Next.js App Router requires 'unsafe-inline' for its
 * bootstrap scripts unless a per-request nonce middleware is added; local
 * mode uses the static policy below. No external origins are allowed.
 *
 * Redirects: wepatent's legacy public routes (/venture, /self-service-terms)
 * permanently redirect (308) into /wepatent/** (wepatent PRD §6.1).
 */
const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  async redirects() {
    return legacyRedirects;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
