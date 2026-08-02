import {
  listPlaybookEndpoint,
  publishPlaybookEndpoint,
} from "@/lib/api/endpoints";
import { readJson, withSession } from "@/lib/api/http";

/** GET|POST /api/playbook (PRD §12, §5.4 hash-chained publications). */
export const GET = withSession(async (session) => listPlaybookEndpoint(session));

export const POST = withSession(async (session, request) =>
  publishPlaybookEndpoint(session, await readJson(request)),
);
