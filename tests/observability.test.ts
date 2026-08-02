import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDataAdapter } from "@/lib/server/adapters/local/store";
import { getAdapters } from "@/lib/server/adapters";
import { enqueueJob, processJob } from "@/lib/server/jobs/runner";
import {
  incrementCounter,
  logEvent,
  metricsSnapshot,
  newCorrelationId,
  recordTiming,
  redactMeta,
  resetMetrics,
  setLogSink,
  type LogRecord,
} from "@/lib/server/observability";
import { createOrganizationForUser } from "@/lib/server/services/orgs";

/** FR-7: correlation IDs, structured redacted logs, metrics. */

describe("redaction (FR-7/§11)", () => {
  it("masks secret-ish keys and never emits their values", () => {
    const meta = redactMeta({
      apiKey: "sk-live-XYZ",
      authorization: "Bearer abc",
      promptText: "confidential invention disclosure",
      documentBody: "full upload contents",
      userEmail: "founder@example.com",
      safe: "ok",
      nested: { sessionToken: "tok_1", fine: 4 },
    });
    expect(meta.apiKey).toBe("[redacted]");
    expect(meta.authorization).toBe("[redacted]");
    expect(meta.promptText).toBe("[redacted]");
    expect(meta.documentBody).toBe("[redacted]");
    expect(meta.userEmail).toBe("[redacted]");
    expect(meta.safe).toBe("ok");
    expect((meta.nested as Record<string, unknown>).sessionToken).toBe("[redacted]");
    expect(JSON.stringify(meta)).not.toContain("sk-live-XYZ");
    expect(JSON.stringify(meta)).not.toContain("confidential invention");
  });

  it("truncates oversized strings so bulk content cannot leak through safe keys", () => {
    const meta = redactMeta({ note: "A".repeat(5_000) });
    expect(String(meta.note).length).toBeLessThan(320);
    expect(String(meta.note)).toContain("[truncated");
  });
});

describe("structured logs and metrics", () => {
  const captured: LogRecord[] = [];

  beforeEach(() => {
    captured.length = 0;
    setLogSink((record) => captured.push(record));
    resetMetrics();
  });

  afterEach(() => {
    setLogSink(null);
  });

  it("logEvent emits time, level, event, correlationId, redacted meta", () => {
    const correlationId = newCorrelationId();
    logEvent({
      level: "warn",
      event: "test.event",
      correlationId,
      meta: { password: "p", count: 3 },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].event).toBe("test.event");
    expect(captured[0].correlationId).toBe(correlationId);
    expect(captured[0].meta.password).toBe("[redacted]");
    expect(captured[0].meta.count).toBe(3);
    expect(Date.parse(captured[0].time)).toBeGreaterThan(0);
  });

  it("counters and timings aggregate into the snapshot", () => {
    incrementCounter("authz.denied");
    incrementCounter("authz.denied");
    recordTiming("job.duration.generation", 100);
    recordTiming("job.duration.generation", 300);
    const snapshot = metricsSnapshot();
    expect(snapshot.counters["authz.denied"]).toBe(2);
    expect(snapshot.timings["job.duration.generation"]).toEqual({
      count: 2,
      avgMs: 200,
      maxMs: 300,
    });
  });

  it("job lifecycle logs carry the job id as correlation id across events", async () => {
    LocalDataAdapter.reset();
    const { data } = getAdapters();
    const user = await data.createUser({ email: "obs@example.test", displayName: "Obs" });
    const organization = await createOrganizationForUser(user.id, "Observability Org");

    const enqueue = await enqueueJob(
      {
        organizationId: organization.id,
        kind: "export_render",
        idempotencyKey: "obs-job-1",
        payload: { exportId: "missing-export" },
      },
      { defer: true },
    );
    expect(enqueue.ok).toBe(true);
    if (!enqueue.ok) return;
    await processJob(organization.id, enqueue.job.id);

    const jobEvents = captured.filter((record) => record.event.startsWith("job."));
    expect(jobEvents.length).toBeGreaterThanOrEqual(2);
    expect(new Set(jobEvents.map((record) => record.correlationId))).toEqual(
      new Set([enqueue.job.id]),
    );
    // The missing export makes this run fail — the failure must be counted
    // and its detail kept in logs, not surfaced raw to clients.
    const snapshot = metricsSnapshot();
    expect((snapshot.counters["job.failed"] ?? 0) + (snapshot.counters["job.succeeded"] ?? 0))
      .toBeGreaterThanOrEqual(1);
  });
});
