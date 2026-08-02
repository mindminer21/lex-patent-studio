import { knowledgeSearchEndpoint } from "@/lib/api/endpoints";
import { withSession } from "@/lib/api/http";

/** GET /api/knowledge/search?q=…&asOfDate=YYYY-MM-DD (PRD §12, FR-5). */
export const GET = withSession(async (session, request) => {
  const url = new URL(request.url);
  return knowledgeSearchEndpoint(
    session,
    Object.fromEntries(url.searchParams.entries()),
  );
});
