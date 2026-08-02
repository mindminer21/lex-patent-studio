import { reviewQueueEndpoint } from "@/lib/api/endpoints";
import { withSession } from "@/lib/api/http";

export const GET = withSession(async (session) => reviewQueueEndpoint(session));
