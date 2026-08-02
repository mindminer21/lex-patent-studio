import {
  createStyleProfileEndpoint,
  listStyleProfilesEndpoint,
} from "@/lib/api/endpoints";
import { readJson, withSession } from "@/lib/api/http";

/** GET|POST /api/style-profiles (PRD §12, §5.4). */
export const GET = withSession(async (session) =>
  listStyleProfilesEndpoint(session),
);

export const POST = withSession(async (session, request) =>
  createStyleProfileEndpoint(session, await readJson(request)),
);
