"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type JobView = {
  id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  result: Record<string, string | number | boolean | null>;
  errorSummary: string | null;
  attempts: number;
};

const STATUS_LABELS: Record<JobView["status"], string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const KIND_LABELS: Record<string, string> = {
  source_interpretation: "Interpretation",
  distillation: "Distillation",
  figure_plan: "Figure generation",
};

/**
 * Polls /api/jobs/:id for studio jobs (interpretation / distillation) and
 * refreshes the studio when the job settles. Failures show generic
 * summaries only — no provider detail reaches the browser (FR-5) — and a
 * retry is always safe (idempotency keys make double-charging impossible).
 */
export default function StudioJobProgress({
  jobId,
  refreshPath,
}: {
  jobId: string;
  refreshPath: string;
}) {
  const router = useRouter();
  const [job, setJob] = useState<JobView | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!active) return;
        if (!response.ok) {
          setUnavailable(true);
          return;
        }
        const next = (await response.json()) as JobView;
        setJob(next);
        if (next.status === "succeeded") {
          router.replace(refreshPath);
          router.refresh();
          return;
        }
        if (next.status === "queued" || next.status === "running") {
          timer = setTimeout(poll, 750);
        }
      } catch {
        if (active) setUnavailable(true);
      }
    }

    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, router, refreshPath]);

  const status = job?.status ?? "queued";
  const kindLabel = KIND_LABELS[job?.kind ?? ""] ?? "Studio job";

  return (
    <div className="wp-card" data-testid="studio-job-progress" style={{ marginBottom: 18 }}>
      <p className="venture-kicker">Durable job</p>
      <p role="status" data-testid="studio-job-status" data-status={status}>
        {kindLabel}: <strong>{STATUS_LABELS[status]}</strong>
        {status === "queued" || status === "running" ? "…" : ""}
        {job && job.attempts > 1 ? ` (attempt ${job.attempts})` : ""}
      </p>
      {status === "failed" && (
        <p className="form-error" role="alert">
          {job?.errorSummary === "insufficient_funds"
            ? "Your wallet balance is not sufficient to reserve this run. Nothing was started and nothing was charged."
            : "The run failed and the reservation was released without charge. You can retry safely — a retry can never double-charge."}
        </p>
      )}
      {unavailable && (
        <p className="form-error" role="alert">
          Progress is temporarily unavailable. Refresh this page to continue.
        </p>
      )}
    </div>
  );
}
