/**
 * Legacy route redirects (PRD §6.1).
 *
 * `/venture` and `/self-service-terms` were the pre-brand-migration public
 * routes for the self-service product. They permanently redirect (HTTP 308)
 * to the corresponding wepatent routes. This module is imported by
 * `next.config.ts` and unit-tested in `tests/redirects.test.ts`.
 */
export type RedirectRule = {
  source: string;
  destination: string;
  permanent: boolean;
};

export const legacyRedirects: RedirectRule[] = [
  { source: "/venture", destination: "/wepatent", permanent: true },
  { source: "/venture/:path*", destination: "/wepatent/:path*", permanent: true },
  { source: "/self-service-terms", destination: "/wepatent/terms", permanent: true },
];
