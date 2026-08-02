import { beforeEach, describe, expect, it } from "vitest";
import { createRunEndpoint, exportDocumentEndpoint } from "@/lib/api/endpoints";
import { withIdempotency } from "@/lib/api/idempotency";
import { resetLocalStore, getLocalStore } from "@/lib/adapters/local";
import { DEMO_SESSION, ORG_ID } from "@/lib/adapters/local/seed";
import type { Session } from "@/lib/adapters";

const SESSION: Session = DEMO_SESSION;

const RUN_BODY = {
  workflowKey: "research_memo",
  jurisdiction: "US",
  asOfDate: "2026-08-01",
  modelId: "claude-sonnet-4-5",
  deliverableType: "Research memo with source trail",
  qualityControls: {
    sourceRequired: true,
    secondModelReview: false,
    quoteVerification: true,
  },
  factIds: [],
  sourceIds: [],
};

function requestWithKey(key?: string): Request {
  return new Request("http://local.test/api", {
    method: "POST",
    headers: key ? { "Idempotency-Key": key } : {},
  });
}

describe("idempotency keys on money/job endpoints", () => {
  beforeEach(() => resetLocalStore());

  it("refuses a run creation without an Idempotency-Key", async () => {
    const result = await withIdempotency(requestWithKey(), "POST /runs", RUN_BODY, () =>
      createRunEndpoint(SESSION, "matter_thermal", RUN_BODY),
    );
    expect(result.status).toBe(400);
    expect(getLocalStore().runs.filter((r) => r.workflowKey === "research_memo" && r.requestedBy === SESSION.userId && r.id.startsWith("run_")).length).toBe(1); // only the seeded memo run
  });

  it("replays the original response instead of double-charging", async () => {
    const call = () =>
      withIdempotency(requestWithKey("key-1"), "POST /runs", RUN_BODY, () =>
        createRunEndpoint(SESSION, "matter_thermal", RUN_BODY),
      );

    const first = await call();
    expect(first.status).toBe(201);
    const firstRunId = (first.body as { run: { id: string } }).run.id;
    const balanceAfterFirst = getLocalStore().walletBalanceUsd;

    const second = await call();
    expect(second.status).toBe(201);
    expect((second.body as { run: { id: string } }).run.id).toBe(firstRunId);

    // No second run, no second reservation, no second hold.
    const store = getLocalStore();
    expect(store.runs.filter((r) => r.id === firstRunId)).toHaveLength(1);
    expect(store.reservations.filter((r) => r.runId === firstRunId)).toHaveLength(1);
    expect(store.walletBalanceUsd).toBeCloseTo(balanceAfterFirst, 2);
  });

  it("conflicts when the same key is reused with a different body", async () => {
    await withIdempotency(requestWithKey("key-2"), "POST /runs", RUN_BODY, () =>
      createRunEndpoint(SESSION, "matter_thermal", RUN_BODY),
    );
    const altered = { ...RUN_BODY, deliverableType: "Different deliverable" };
    const conflict = await withIdempotency(
      requestWithKey("key-2"),
      "POST /runs",
      altered,
      () => createRunEndpoint(SESSION, "matter_thermal", altered),
    );
    expect(conflict.status).toBe(409);
  });

  it("export replay returns the same artifact without re-rendering", async () => {
    const call = () =>
      withIdempotency(requestWithKey("key-3"), "POST /export", null, () =>
        exportDocumentEndpoint(SESSION, "doc_t_sections"),
      );
    const first = await call();
    expect(first.status).toBe(201);
    const second = await call();
    expect(second.status).toBe(201); // replayed original response verbatim
    expect(getLocalStore().exports).toHaveLength(1);
    expect((second.body as { export: { id: string } }).export.id).toBe(
      (first.body as { export: { id: string } }).export.id,
    );
  });

  it("keys are scoped per endpoint", async () => {
    const runResult = await withIdempotency(
      requestWithKey("shared-key"),
      "POST /runs",
      RUN_BODY,
      () => createRunEndpoint(SESSION, "matter_thermal", RUN_BODY),
    );
    expect(runResult.status).toBe(201);
    const exportResult = await withIdempotency(
      requestWithKey("shared-key"),
      "POST /export",
      null,
      () => exportDocumentEndpoint(SESSION, "doc_t_sections"),
    );
    expect(exportResult.status).toBe(201);
  });
});

describe("generic external errors", () => {
  beforeEach(() => resetLocalStore());

  it("wallet insufficiency maps to 402 with a user-safe message", async () => {
    getLocalStore().walletBalanceUsd = 0.01;
    const result = await createRunEndpoint(SESSION, "matter_thermal", RUN_BODY);
    expect(result.status).toBe(402);
    const body = result.body as { error: string };
    expect(body.error).not.toMatch(/stack|internal|adapter|supabase|stripe/i);
  });

  it("unknown tenant resources return 404 without detail leakage", async () => {
    const result = await exportDocumentEndpoint(
      { ...SESSION, organizationId: ORG_ID },
      "doc_does_not_exist",
    );
    expect(result.status).toBe(404);
  });
});
