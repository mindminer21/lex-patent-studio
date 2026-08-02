import {
  createMatterEndpoint,
  listMattersEndpoint,
} from "@/lib/api/endpoints";
import { readJson, withSession } from "@/lib/api/http";

export const GET = withSession(async (session) => listMattersEndpoint(session));

export const POST = withSession(async (session, request) =>
  createMatterEndpoint(session, await readJson(request)),
);
