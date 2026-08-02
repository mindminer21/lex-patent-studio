import { NextResponse } from "next/server";
import { needsReacceptance } from "@/lib/domain/clickwrap";
import { can } from "@/lib/domain/roles";
import { getAdapters } from "@/lib/server/adapters";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { z } from "zod";

/** GET /api/inventions — tenant-scoped list (PRD §10). */
export async function GET(): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  const { data } = getAdapters();
  const inventions = await data.listInventions(auth.context.organization.id);
  return NextResponse.json({
    inventions: inventions.map((invention) => ({
      id: invention.id,
      title: invention.title,
      synthetic: invention.synthetic,
      status: invention.status,
      createdAt: invention.createdAt,
    })),
  });
}

const createSchema = z.object({
  title: z.string().trim().min(3).max(200),
  summary: z.string().trim().min(10).max(8000),
  problem: z.string().trim().min(10).max(8000),
  solution: z.string().trim().min(10).max(8000),
  businessContext: z.string().trim().max(8000).optional().default(""),
});

/** POST /api/inventions — requires role permission and current clickwrap. */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "invention.create")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { data } = getAdapters();
  const acceptance = await data.getLatestAcceptance(
    auth.context.organization.id,
    auth.context.user.id,
  );
  if (!acceptance || needsReacceptance(acceptance.termsVersion)) {
    return NextResponse.json({ error: "terms_acceptance_required" }, { status: 428 });
  }

  const parsed = createSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return genericError(400);

  const invention = await data.createInvention({
    organizationId: auth.context.organization.id,
    title: parsed.data.title,
    summary: parsed.data.summary,
    businessContext: parsed.data.businessContext ?? "",
    problem: parsed.data.problem,
    solution: parsed.data.solution,
    synthetic: false,
  });
  return NextResponse.json({ id: invention.id }, { status: 201 });
}
