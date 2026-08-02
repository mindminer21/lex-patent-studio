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

/**
 * Polls /api/jobs/:id and reports durable-job progress (PRD §14). When a
 * generation job succeeds it navigates to the produced draft version.
 * Failures render the generic server summary — no provider detail reaches
 * the browser (FR-5).
 */
export default function JobProgress({
  jobId,
  successPath,
  children,
}: {
  jobId: string;
  /** Path template; `:versionId` is replaced from the job result. */
  successPath: string;
  children?: React.ReactNode;
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
          const versionId = String(next.result.versionId ?? "");
          router.replace(successPath.replace(":versionId", versionId));
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
  }, [jobId, router, successPath]);

  const status = job?.status ?? "queued";

  return (
    <div className="wp-card" data-testid="job-progress" style={{ marginBottom: 22 }}>
      <p className="venture-kicker">Durable job</p>
      <h2>
        Generation {STATUS_LABELS[status].toLowerCase()}
        {status === "queued" || status === "running" ? "…" : ""}
      </h2>
      <p role="status" data-testid="job-status" data-status={status}>
        Status: <strong>{STATUS_LABELS[status]}</strong>
        {job && job.attempts > 1 ? ` (attempt ${job.attempts})` : ""}
      </p>
      {status === "failed" && (
        <>
          <p className="form-error" role="alert">
            {job?.errorSummary === "insufficient_funds"
              ? "Your wallet balance is not sufficient to reserve this run. No generation was started and nothing was charged."
              : "The generation failed. The reservation was released without charge. You can retry safely — a retry can never double-charge."}
          </p>
          {children}
        </>
      )}
      {unavailable && (
        <p className="form-error" role="alert">
          Progress is temporarily unavailable. Refresh this page to continue.
        </p>
      )}
    </div>
  );
}
