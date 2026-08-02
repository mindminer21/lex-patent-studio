import { verifyQuoteEndpoint } from "@/lib/api/endpoints";
import { withSession } from "@/lib/api/http";

/** GET /api/knowledge/verify-quote?corpusDocumentId=…&quote=… (PRD §12). */
export const GET = withSession(async (session, request) => {
  const url = new URL(request.url);
  return verifyQuoteEndpoint(
    session,
    Object.fromEntries(url.searchParams.entries()),
  );
});
