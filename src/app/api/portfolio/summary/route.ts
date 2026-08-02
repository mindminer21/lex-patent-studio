import { portfolioSummaryEndpoint } from "@/lib/api/endpoints";
import { withSession } from "@/lib/api/http";

/** GET /api/portfolio/summary (PRD §12; role-gated portfolio.view). */
export const GET = withSession(async (session) =>
  portfolioSummaryEndpoint(session),
);
