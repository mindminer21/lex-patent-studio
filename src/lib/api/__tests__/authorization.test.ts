import { beforeEach, describe, expect, it } from "vitest";
import {
  approveFactEndpoint,
  cancelRunEndpoint,
  createFactEndpoint,
  createMatterEndpoint,
  createRunEndpoint,
  decideReviewEndpoint,
  estimateRunEndpoint,
  exportDocumentEndpoint,
  createStyleProfileEndpoint,
  getRunEndpoint,
  knowledgeSearchEndpoint,
  listPlaybookEndpoint,
  listStyleProfilesEndpoint,
  portfolioSummaryEndpoint,
  publishPlaybookEndpoint,
  listDocumentsEndpoint,
  listFactsEndpoint,
  listMattersEndpoint,
  patchMatterEndpoint,
  reviewQueueEndpoint,
  signUploadEndpoint,
  verifyQuoteEndpoint,
} from "@/lib/api/endpoints";
import { resetLocalStore, getLocalStore } from "@/lib/adapters/local";
import { ORG_ID } from "@/lib/adapters/local/seed";
import type { Session } from "@/lib/adapters";
import { ROLES, type Role } from "@/lib/domain/roles";

/**
 * Role × endpoint deny matrix (FR-2, Invariant 21). Endpoint policy is
 * asserted for EVERY role: allowed roles must not receive 403; denied roles
 * must receive exactly 403 — enforcement is server-side policy, not UI.
 */

const sessionFor = (role: Role): Session => ({
  userId: `user_matrix_${role}`,
  displayName: `Matrix ${role}`,
  email: `${role}@demo.invalid`,
  organizationId: ORG_ID,
  organizationName: "Meridian IP Group — synthetic demo tenant",
  role,
  synthetic: true,
});

const PRACTITIONER_SET: Role[] = ["owner", "practitioner_admin", "practitioner"];
const VIEW_SET: Role[] = [...PRACTITIONER_SET, "agent_operator", "contributor", "viewer"];

interface MatrixCase {
  name: string;
  allowed: Role[];
  call: (session: Session) => Promise<{ status: number }>;
}

const RUN_BODY = {
  workflowKey: "section_draft",
  jurisdiction: "US",
  asOfDate: "2026-08-01",
  modelId: "claude-sonnet-4-5",
  deliverableType: "Background & summary",
  qualityControls: {
    sourceRequired: true,
    secondModelReview: true,
    quoteVerification: true,
  },
  factIds: [],
  sourceIds: [],
};

const CASES: MatrixCase[] = [
  {
    name: "GET /api/matters",
    allowed: VIEW_SET,
    call: (s) => listMattersEndpoint(s),
  },
  {
    name: "POST /api/matters",
    allowed: PRACTITIONER_SET,
    call: (s) =>
      createMatterEndpoint(s, {
        matterNumber: `MX-${s.role}`,
        title: "Matrix test matter (synthetic)",
        jurisdiction: "US",
        technologyArea: "Test",
        conflictTags: [],
      }),
  },
  {
    name: "PATCH /api/matters/:id",
    allowed: PRACTITIONER_SET,
    call: (s) => patchMatterEndpoint(s, "matter_thermal", { title: "Renamed (synthetic)" }),
  },
  {
    name: "GET /api/matters/:id/facts",
    allowed: VIEW_SET,
    call: (s) => listFactsEndpoint(s, "matter_thermal"),
  },
  {
    name: "POST /api/matters/:id/facts",
    allowed: [...PRACTITIONER_SET, "agent_operator", "contributor"],
    call: (s) =>
      createFactEndpoint(s, "matter_thermal", {
        category: "component",
        text: "Matrix fact (synthetic).",
        sourceIds: [],
      }),
  },
  {
    name: "POST /api/matters/:id/facts/:factId/approve",
    allowed: PRACTITIONER_SET,
    call: (s) =>
      approveFactEndpoint(s, "matter_thermal", "fact_t_component_sensor", {}),
  },
  {
    name: "POST /api/matters/:id/uploads/sign",
    allowed: [...PRACTITIONER_SET, "agent_operator", "contributor"],
    call: (s) =>
      signUploadEndpoint(s, "matter_thermal", {
        fileName: "matrix.pdf",
        contentType: "application/pdf",
        sizeBytes: 1024,
      }),
  },
  {
    name: "POST /api/matters/:id/runs/estimate (Tier B)",
    allowed: [...PRACTITIONER_SET, "agent_operator"],
    call: (s) =>
      estimateRunEndpoint(s, "matter_thermal", {
        workflowKey: "section_draft",
        modelId: "claude-sonnet-4-5",
      }),
  },
  {
    name: "POST /api/matters/:id/runs (Tier B)",
    allowed: [...PRACTITIONER_SET, "agent_operator"],
    call: (s) => createRunEndpoint(s, "matter_thermal", RUN_BODY),
  },
  {
    name: "POST /api/matters/:id/runs (Tier C decision support)",
    allowed: PRACTITIONER_SET,
    call: (s) =>
      createRunEndpoint(s, "matter_thermal", {
        ...RUN_BODY,
        workflowKey: "response_path_options",
        deliverableType: "Decision-support brief (options only)",
      }),
  },
  {
    name: "GET /api/runs/:id",
    allowed: VIEW_SET,
    call: (s) => getRunEndpoint(s, "run_t_sections"),
  },
  {
    name: "GET /api/matters/:id/documents",
    allowed: VIEW_SET,
    call: (s) => listDocumentsEndpoint(s, "matter_thermal"),
  },
  {
    name: "POST /api/documents/:id/export (draft)",
    allowed: [...PRACTITIONER_SET, "agent_operator"],
    call: (s) => exportDocumentEndpoint(s, "doc_t_sections"),
  },
  {
    name: "GET /api/review-queue",
    allowed: VIEW_SET,
    call: (s) => reviewQueueEndpoint(s),
  },
  {
    name: "POST /api/review-items/:id/decision (Tier B)",
    allowed: PRACTITIONER_SET,
    call: (s) =>
      decideReviewEndpoint(s, "rev_t_sections", { decision: "approve" }),
  },
  {
    name: "POST /api/review-items/:id/decision (Tier A)",
    allowed: [...PRACTITIONER_SET, "agent_operator"],
    call: (s) => decideReviewEndpoint(s, "rev_t_ids", { decision: "approve" }),
  },
  {
    // Contributor (R&D) seats are limited to intake/status visibility; the
    // license-gated corpus browser is a professional-lane surface.
    name: "GET /api/knowledge/search",
    allowed: [...PRACTITIONER_SET, "agent_operator", "viewer"],
    call: (s) =>
      knowledgeSearchEndpoint(s, { q: "obviousness", asOfDate: "2026-08-01" }),
  },
  {
    name: "GET /api/knowledge/verify-quote",
    allowed: [...PRACTITIONER_SET, "agent_operator", "viewer"],
    call: (s) =>
      verifyQuoteEndpoint(s, {
        corpusDocumentId: "corp_usc_112",
        quote:
          "particularly pointing out and distinctly claiming the subject matter",
      }),
  },
  {
    // Portfolio visibility is a practitioner right (FR-2); operators,
    // contributors, and viewers see single matters only.
    name: "GET /api/portfolio/summary",
    allowed: PRACTITIONER_SET,
    call: (s) => portfolioSummaryEndpoint(s),
  },
  {
    name: "GET /api/style-profiles",
    allowed: VIEW_SET,
    call: (s) => listStyleProfilesEndpoint(s),
  },
  {
    name: "POST /api/style-profiles",
    allowed: PRACTITIONER_SET,
    call: (s) =>
      createStyleProfileEndpoint(s, {
        name: `matrix-style-${s.role}`,
        kind: "application_drafting",
        rules: ["Synthetic matrix rule for authorization testing."],
      }),
  },
  {
    // Playbook is internal legal strategy: contributor AND viewer seats
    // never read it (mirrors the playbook_entries RLS policy).
    name: "GET /api/playbook",
    allowed: [...PRACTITIONER_SET, "agent_operator"],
    call: (s) => listPlaybookEndpoint(s),
  },
  {
    name: "POST /api/playbook",
    allowed: PRACTITIONER_SET,
    call: (s) =>
      publishPlaybookEndpoint(s, {
        title: `Matrix entry (${s.role})`,
        category: "examiner_note",
        body: "Synthetic playbook body for authorization-matrix testing only.",
      }),
  },
];

describe("role × endpoint authorization matrix", () => {
  for (const testCase of CASES) {
    describe(testCase.name, () => {
      for (const role of ROLES) {
        const shouldAllow = testCase.allowed.includes(role);
        it(`${shouldAllow ? "allows" : "denies (403)"} ${role}`, async () => {
          resetLocalStore();
          const result = await testCase.call(sessionFor(role));
          if (shouldAllow) {
            expect(result.status).not.toBe(403);
            expect(result.status).toBeLessThan(400);
          } else {
            expect(result.status).toBe(403);
          }
        });
      }
    });
  }
});

describe("cancel authorization follows the run's tier", () => {
  beforeEach(() => resetLocalStore());

  it("agent_operator may cancel a Tier-B run but not decide its review", async () => {
    const created = await createRunEndpoint(
      sessionFor("practitioner"),
      "matter_thermal",
      RUN_BODY,
    );
    expect(created.status).toBe(201);
    const runId = (created.body as { run: { id: string } }).run.id;

    const cancelled = await cancelRunEndpoint(sessionFor("agent_operator"), runId);
    expect(cancelled.status).toBe(200);
  });

  it("contributor may not cancel any run (Invariant 21)", async () => {
    const created = await createRunEndpoint(
      sessionFor("practitioner"),
      "matter_thermal",
      RUN_BODY,
    );
    const runId = (created.body as { run: { id: string } }).run.id;
    const denied = await cancelRunEndpoint(sessionFor("contributor"), runId);
    expect(denied.status).toBe(403);
  });
});

describe("cross-tenant isolation at the endpoint layer", () => {
  beforeEach(() => resetLocalStore());

  it("a session from another organization cannot see or touch this tenant", async () => {
    const foreign: Session = {
      ...sessionFor("practitioner"),
      organizationId: "org_other_tenant",
    };
    const matters = await listMattersEndpoint(foreign);
    expect((matters.body as { matters: unknown[] }).matters).toHaveLength(0);

    expect((await getRunEndpoint(foreign, "run_t_sections")).status).toBe(404);
    expect((await exportDocumentEndpoint(foreign, "doc_t_sections")).status).toBe(404);
    expect(
      (await decideReviewEndpoint(foreign, "rev_t_sections", { decision: "approve" }))
        .status,
    ).toBe(404);

    // And the tenant's data is untouched.
    const store = getLocalStore();
    expect(store.reviewItems.find((i) => i.id === "rev_t_sections")!.state).toBe(
      "pending_review",
    );
  });
});
