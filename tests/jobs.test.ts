import { beforeEach, describe, expect, it } from "vitest";
import { canRetryJob, canTransitionJob, isTerminalJobStatus } from "@/lib/wepatent/domain/jobs";
import { getAdapters } from "@/lib/server/adapters";
import { LocalDataAdapter } from "@/lib/server/adapters/local/store";
import { cancelJob, enqueueJob, processJob } from "@/lib/server/jobs/runner";
import { createOrganizationForUser } from "@/lib/server/services/orgs";

async function setup() {
  LocalDataAdapter.reset();
  const { data } = getAdapters();
  const user = await data.createUser({ email: "jobs@example.test", displayName: "Jobs" });
  const org = await createOrganizationForUser(user.id, "Jobs Test Org");
  const inventions = await data.listInventions(org.id);
  return { data, user, org, invention: inventions[0] };
}

function generationPayload(user: { id: string }, invention: { id: string }) {
  return {
    inventionId: invention.id,
    workflow: "invention_disclosure_summary",
    tierId: "standard",
    userId: user.id,
  };
}

describe("durable-job state machine", () => {
  it("allows only queued→running→terminal plus explicit retry re-queue", () => {
    expect(canTransitionJob("queued", "running")).toBe(true);
    expect(canTransitionJob("queued", "cancelled")).toBe(true);
    expect(canTransitionJob("running", "succeeded")).toBe(true);
    expect(canTransitionJob("running", "failed")).toBe(true);
    expect(canTransitionJob("succeeded", "queued")).toBe(false);
    expect(canTransitionJob("succeeded", "failed")).toBe(false);
    expect(canTransitionJob("failed", "queued")).toBe(true);
    expect(canTransitionJob("queued", "succeeded")).toBe(false);
    expect(isTerminalJobStatus("succeeded")).toBe(true);
    expect(isTerminalJobStatus("running")).toBe(false);
    expect(canRetryJob("failed")).toBe(true);
    expect(canRetryJob("succeeded")).toBe(false);
  });
});

describe("local job runner (generation executor)", () => {
  beforeEach(() => {
    LocalDataAdapter.reset();
  });

  it("runs a queued generation job to succeeded with a version result", async () => {
    const { data, user, org, invention } = await setup();
    const enqueue = await enqueueJob(
      {
        organizationId: org.id,
        kind: "generation",
        idempotencyKey: "job-key-1",
        payload: generationPayload(user, invention),
      },
      { defer: true },
    );
    expect(enqueue.ok && !enqueue.deduplicated).toBe(true);
    if (!enqueue.ok) return;
    expect(enqueue.job.status).toBe("queued");

    const done = await processJob(org.id, enqueue.job.id);
    expect(done?.status).toBe("succeeded");
    expect(String(done?.result.versionId ?? "")).not.toBe("");

    const version = await data.getDraftVersion(org.id, String(done!.result.versionId));
    expect(version?.label).toBe("working_draft");
  });

  it("deduplicates: the same idempotency key never runs twice or double-charges", async () => {
    const { data, user, org, invention } = await setup();
    const first = await enqueueJob(
      {
        organizationId: org.id,
        kind: "generation",
        idempotencyKey: "dup-key",
        payload: generationPayload(user, invention),
      },
      { defer: true },
    );
    if (!first.ok) throw new Error("enqueue failed");
    await processJob(org.id, first.job.id);

    // Retry after success: same job returned, no new execution.
    const second = await enqueueJob(
      {
        organizationId: org.id,
        kind: "generation",
        idempotencyKey: "dup-key",
        payload: generationPayload(user, invention),
      },
      { defer: true },
    );
    if (!second.ok) throw new Error("second enqueue failed");
    expect(second.deduplicated).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(second.job.status).toBe("succeeded");

    // Exactly one settlement, one usage event, one charge.
    const usage = await data.listUsageEvents(org.id);
    expect(usage).toHaveLength(1);
    const ledger = await data.listLedgerEntries(org.id);
    expect(ledger.filter((entry) => entry.kind === "settlement")).toHaveLength(1);
  });

  it("even if a duplicate job row slips through, the reservation layer returns the prior version without charging again", async () => {
    const { data, user, org, invention } = await setup();
    const first = await enqueueJob(
      {
        organizationId: org.id,
        kind: "generation",
        idempotencyKey: "race-key",
        payload: generationPayload(user, invention),
      },
      { defer: true },
    );
    if (!first.ok) throw new Error("enqueue failed");
    const done = await processJob(org.id, first.job.id);
    const firstVersionId = String(done!.result.versionId);

    // Simulate a second worker executing a job with the same key (e.g. a
    // crashed-and-requeued duplicate): force the job back to queued.
    await data.updateJob(org.id, first.job.id, { status: "queued" });
    const rerun = await processJob(org.id, first.job.id);
    expect(rerun?.status).toBe("succeeded");
    expect(String(rerun?.result.versionId)).toBe(firstVersionId);

    const usage = await data.listUsageEvents(org.id);
    expect(usage).toHaveLength(1);
    const wallet = await data.getWallet(org.id);
    expect(wallet?.reservedCents).toBe(0);
  });

  it("fails without charging when funds are insufficient, then retries cleanly after top-up", async () => {
    const { data, user, org, invention } = await setup();
    // Drain the wallet.
    await data.saveWallet({ organizationId: org.id, balanceCents: 0, reservedCents: 0 });

    const enqueue = await enqueueJob(
      {
        organizationId: org.id,
        kind: "generation",
        idempotencyKey: "poor-key",
        payload: generationPayload(user, invention),
      },
      { defer: true },
    );
    if (!enqueue.ok) throw new Error("enqueue failed");
    const failed = await processJob(org.id, enqueue.job.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.errorSummary).toBe("insufficient_funds");
    expect(await data.listUsageEvents(org.id)).toHaveLength(0);

    // Top up, retry under the same key: job re-queues and succeeds; exactly
    // one charge in total.
    await data.saveWallet({ organizationId: org.id, balanceCents: 2_500, reservedCents: 0 });
    const retry = await enqueueJob(
      {
        organizationId: org.id,
        kind: "generation",
        idempotencyKey: "poor-key",
        payload: generationPayload(user, invention),
      },
      { defer: true },
    );
    if (!retry.ok) throw new Error("retry enqueue failed");
    expect(retry.job.id).toBe(enqueue.job.id);
    expect(retry.job.status).toBe("queued");
    const done = await processJob(org.id, retry.job.id);
    expect(done?.status).toBe("succeeded");
    expect(done?.attempts).toBe(2);
    expect(await data.listUsageEvents(org.id)).toHaveLength(1);
  });

  it("cancels a queued job and skips its execution; retry re-queues it", async () => {
    const { user, org, invention } = await setup();
    const enqueue = await enqueueJob(
      {
        organizationId: org.id,
        kind: "generation",
        idempotencyKey: "cancel-key",
        payload: generationPayload(user, invention),
      },
      { defer: true },
    );
    if (!enqueue.ok) throw new Error("enqueue failed");
    const cancelled = await cancelJob(org.id, enqueue.job.id);
    expect(cancelled?.status).toBe("cancelled");

    const processed = await processJob(org.id, enqueue.job.id);
    expect(processed?.status).toBe("cancelled"); // runner refuses non-queued

    const retry = await enqueueJob(
      {
        organizationId: org.id,
        kind: "generation",
        idempotencyKey: "cancel-key",
        payload: generationPayload(user, invention),
      },
      { defer: true },
    );
    if (!retry.ok) throw new Error("retry enqueue failed");
    expect(retry.job.status).toBe("queued");
  });

  it("rejects unknown job kinds and scopes job reads by tenant", async () => {
    const { data, user, org, invention } = await setup();
    const bad = await enqueueJob(
      {
        organizationId: org.id,
        kind: "not_a_kind" as never,
        idempotencyKey: "x",
        payload: {},
      },
      { defer: true },
    );
    expect(bad.ok).toBe(false);

    const enqueue = await enqueueJob(
      {
        organizationId: org.id,
        kind: "generation",
        idempotencyKey: "tenant-key",
        payload: generationPayload(user, invention),
      },
      { defer: true },
    );
    if (!enqueue.ok) throw new Error("enqueue failed");
    // Another org cannot see the job.
    const outsider = await data.createUser({
      email: "outsider@example.test",
      displayName: "Outsider",
    });
    const otherOrg = await createOrganizationForUser(outsider.id, "Other Org");
    expect(await data.getJob(otherOrg.id, enqueue.job.id)).toBeNull();
  });
});
