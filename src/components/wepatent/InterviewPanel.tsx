"use client";

import { useRef, useState } from "react";
import {
  formatMultiplier,
  markupDisclosure,
  MARKUP_MULTIPLIERS,
} from "@/lib/shared/billing/markup";
import { useRouter } from "next/navigation";

/**
 * Adaptive interview surface (Intake Studio §6, FR-INT-6/7/10).
 *
 * - One primary question at a time with optional grouped follow-ups.
 * - Each turn accepts text, text + file attachment(s) (attachments run the
 *   FR-4 + interpretation pipeline), or skip / "I don't know".
 * - Advice-seeking turns render the FIXED counsel-referral template the
 *   server returns — this component never generates advice text.
 * - Honest progress: stage + coverage, never a fake percent.
 * - Running session spend + configurable cap, with the raise-cap resume
 *   path when the cap halts model calls.
 */

type TurnView = {
  id: string;
  turnIndex: number;
  stage: string;
  question: string;
  followups: string[];
  answerText: string | null;
  answerKind: "answer" | "skip" | "unknown" | "advice_referral" | null;
  attachmentSourceIds: string[];
};

type SessionView = {
  session: {
    id: string;
    status: "active" | "paused" | "completed";
    stage: string;
    sessionSpendCapCents: number;
    spentCents: number;
  };
  turns: TurnView[];
  pendingTurn: TurnView | null;
  progress: {
    stageLabel: string;
    stageNumber: number;
    stageCount: number;
    coverageSatisfied: number;
    coverageTotal: number;
  };
  capReached: boolean;
  proposedEdits: Array<{ eventId: string; pairId: string; proposedStatement: string }>;
  perTurnEstimate: { lowCents: number; highCents: number };
  walletAvailableCents: number;
};

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const KIND_LABELS: Record<string, string> = {
  answer: "Answered",
  skip: "Skipped",
  unknown: "“I don't know” (recorded as an enablement signal)",
  advice_referral: "Referred to counsel (fixed template)",
};

export default function InterviewPanel({
  inventionId,
  initialView,
}: {
  inventionId: string;
  initialView: SessionView | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<SessionView | null>(initialView);
  const [answer, setAnswer] = useState("");
  const [attachments, setAttachments] = useState<Array<{ sourceId: string; name: string }>>([]);
  const [referral, setReferral] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [capInput, setCapInput] = useState("");

  async function call(path: string, body?: unknown): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? "{}" : JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        view?: SessionView;
        error?: string;
        counselReferral?: string | null;
        warnings?: string[];
      };
      if (!response.ok) {
        if (payload.error === "cap_reached") {
          setNotice(
            "Session spend cap reached — model calls are halted. Raise the cap below to continue; nothing was charged for this attempt.",
          );
          setView((current) =>
            current ? { ...current, capReached: true } : current,
          );
        } else {
          setNotice("That action could not be completed. Please try again.");
        }
        return;
      }
      if (payload.view) setView(payload.view);
      setReferral(payload.counselReferral ?? null);
      setAnswer("");
      setAttachments([]);
      if (payload.warnings && payload.warnings.length > 0) {
        setNotice(
          payload.warnings.includes("drafting_insufficient_funds") ||
            payload.warnings.includes("extraction_insufficient_funds")
            ? "Wallet funds were insufficient for a model pass; deterministic fallbacks were used where possible. Top up to restore full AI assistance."
            : "A model pass did not complete; nothing was charged for it.",
        );
      }
      router.refresh(); // the right-panel ledger re-renders per turn (§6.3)
    } catch {
      setNotice("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function attachFile(): Promise<void> {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setNotice(null);
    try {
      const signResponse = await fetch(`/api/inventions/${inventionId}/uploads/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          declaredBytes: file.size,
          kind: "design_doc",
          note: "Interview answer attachment",
        }),
      });
      const signBody = (await signResponse.json()) as {
        uploadUrl?: string;
        sourceId?: string;
        error?: string;
      };
      if (!signResponse.ok || !signBody.uploadUrl || !signBody.sourceId) {
        setNotice("That attachment type was rejected by the upload allowlist.");
        return;
      }
      const putResponse = await fetch(signBody.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putResponse.ok) {
        setNotice("The attachment failed validation and was rejected.");
        return;
      }
      setAttachments((current) => [...current, { sourceId: signBody.sourceId!, name: file.name }]);
      if (fileRef.current) fileRef.current.value = "";
    } catch {
      setNotice("Attachment upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    return (
      <div className="wp-card" data-testid="interview-start">
        <h2>Adaptive invention interview</h2>
        <p>
          Seven Slusky-guided stages, general to specific: context, problem, the solution as a
          concept (WHAT), implementation (HOW), alternatives &amp; breadth, subsidiary problems,
          and boundaries. The interview adapts to what your record already contains and never
          re-asks a confirmed fact. You can pause anytime; your progress is saved.
        </p>
        <p>
          Each answered turn runs two metered AI passes (question drafting + live extraction),
          charged at {markupDisclosure()} from your wallet — the interview is a conversational
          step rather than a deliverable, so both passes are analysis tasks and bill at{" "}
          {formatMultiplier(MARKUP_MULTIPLIERS.analysis)}×. Skips, &ldquo;I don&rsquo;t
          know&rdquo;, and counsel referrals cost nothing.
        </p>
        <button
          className="button venture-button"
          type="button"
          disabled={busy}
          onClick={() => call(`/api/inventions/${inventionId}/interview/sessions`)}
        >
          {busy ? "Starting…" : "Start the interview"}
        </button>
      </div>
    );
  }

  const { session, progress } = view;
  const answered = view.turns.filter((turn) => turn.answerKind !== null);

  return (
    <div data-testid="interview-panel">
      <div className="wp-card">
        <p className="venture-kicker">Progress — honest, not a percent</p>
        <h2 data-testid="interview-progress">
          Stage {progress.stageNumber} of {progress.stageCount}: {progress.stageLabel}
        </h2>
        <p>
          Coverage: {progress.coverageSatisfied} of {progress.coverageTotal} deterministic checks
          satisfied · Session spend:{" "}
          <strong data-testid="session-spend">{usd(session.spentCents)}</strong> of{" "}
          <span data-testid="session-cap">{usd(session.sessionSpendCapCents)}</span> cap ·
          Wallet available {usd(view.walletAvailableCents)}
        </p>
        <p className="hint">
          Estimated per answered turn: {usd(view.perTurnEstimate.lowCents)}–
          {usd(view.perTurnEstimate.highCents)} (drafting + extraction, settled from actual
          usage).
        </p>
        <div className="wp-actions">
          {session.status === "active" && (
            <button
              className="button button-small"
              type="button"
              disabled={busy}
              onClick={() => call(`/api/interview/sessions/${session.id}/pause`)}
            >
              Pause interview
            </button>
          )}
          {session.status === "paused" && (
            <button
              className="button venture-button button-small"
              type="button"
              disabled={busy}
              onClick={() => call(`/api/inventions/${inventionId}/interview/sessions`)}
            >
              Resume interview
            </button>
          )}
          {session.status === "active" && view.pendingTurn && (
            <button
              className="button button-small"
              type="button"
              disabled={busy}
              onClick={() => call(`/api/interview/sessions/${session.id}/skip-stage`)}
            >
              Skip this stage
            </button>
          )}
        </div>
      </div>

      {(view.capReached || notice) && (
        <div className="wp-card" style={{ marginTop: 18 }} data-testid="interview-notice">
          {view.capReached && (
            <>
              <p role="alert">
                <strong>Session spend cap reached ({usd(session.sessionSpendCapCents)}).</strong>{" "}
                Model calls are halted for this session. Raise the cap to continue — your
                answers and progress are saved.
              </p>
              <form
                className="wp-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const dollars = Number(capInput);
                  if (Number.isFinite(dollars) && dollars >= 0) {
                    void call(`/api/interview/sessions/${session.id}/cap`, {
                      capCents: Math.round(dollars * 100),
                    });
                  }
                }}
              >
                <div className="field">
                  <label htmlFor="cap-dollars">New session cap (USD)</label>
                  <input
                    id="cap-dollars"
                    inputMode="decimal"
                    value={capInput}
                    onChange={(event) => setCapInput(event.target.value)}
                    placeholder="10.00"
                  />
                </div>
                <button className="button venture-button button-small" type="submit" disabled={busy}>
                  Raise cap and continue
                </button>
              </form>
            </>
          )}
          {notice && <p role="status">{notice}</p>}
        </div>
      )}

      <div className="wp-card" style={{ marginTop: 18 }} data-testid="interview-transcript">
        <h2>Interview transcript</h2>
        {answered.length === 0 && <p>No answers yet — the first question is below.</p>}
        <ol className="wp-studio-list">
          {answered.map((turn) => (
            <li key={turn.id} style={{ marginBottom: 10 }}>
              <p style={{ marginBottom: 2 }}>
                <strong>Q{turn.turnIndex + 1}:</strong> {turn.question}
              </p>
              <p className="hint" style={{ marginTop: 0 }}>
                {KIND_LABELS[turn.answerKind ?? ""] ?? turn.answerKind}
                {turn.answerText ? ` — ${turn.answerText}` : ""}
                {turn.attachmentSourceIds.length > 0
                  ? ` · ${turn.attachmentSourceIds.length} attachment(s) routed through the upload pipeline`
                  : ""}
              </p>
            </li>
          ))}
        </ol>
      </div>

      {referral && (
        <div className="wp-boundary-banner" role="status" data-testid="counsel-referral" style={{ marginTop: 18 }}>
          {referral}
        </div>
      )}

      {session.status === "completed" && (
        <div className="wp-card" style={{ marginTop: 18 }}>
          <h2>Interview complete</h2>
          <p>
            All seven stages are covered or explicitly skipped. Review the Problem/Solution
            ledger and coverage gaps on the right, then continue in the studio or export the
            counsel package. Working draft — counsel review required.
          </p>
        </div>
      )}

      {session.status === "paused" && (
        <div className="wp-card" style={{ marginTop: 18 }} data-testid="interview-paused">
          <h2>Interview paused</h2>
          <p>Your progress is saved. Resume anytime — the same question will be waiting.</p>
        </div>
      )}

      {session.status === "active" && view.pendingTurn && (
        <div className="wp-card" style={{ marginTop: 18 }} data-testid="pending-question">
          <p className="venture-kicker">{progress.stageLabel}</p>
          <h2 data-testid="question-text">{view.pendingTurn.question}</h2>
          {view.pendingTurn.followups.length > 0 && (
            <ul className="wp-studio-list">
              {view.pendingTurn.followups.map((followup) => (
                <li key={followup} className="hint">
                  {followup}
                </li>
              ))}
            </ul>
          )}
          <form
            className="wp-form"
            onSubmit={(event) => {
              event.preventDefault();
              void call(`/api/interview/sessions/${session.id}/turns`, {
                kind: "answer",
                answerText: answer,
                attachmentSourceIds: attachments.map((attachment) => attachment.sourceId),
              });
            }}
          >
            <div className="field">
              <label htmlFor="interview-answer">Your answer</label>
              <textarea
                id="interview-answer"
                rows={4}
                value={answer}
                maxLength={8000}
                onChange={(event) => setAnswer(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="interview-attachment">
                Attach a file to this answer (optional — it runs the same validated upload +
                interpretation pipeline)
              </label>
              <input
                id="interview-attachment"
                ref={fileRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.txt,.md,.docx,.pptx,.xlsx,.svg,.tif,.tiff,.heic,.stl,.step,.stp,.obj,.3mf,.mp3,.wav,.m4a,.mp4,.mov"
                onChange={() => void attachFile()}
              />
              {attachments.length > 0 && (
                <p className="hint" data-testid="attachment-chips">
                  Attached: {attachments.map((attachment) => attachment.name).join(", ")}
                </p>
              )}
            </div>
            <div className="wp-actions">
              <button
                className="button venture-button"
                type="submit"
                disabled={busy || answer.trim().length < 2}
              >
                {busy ? "Working…" : "Send answer"}
              </button>
              <button
                className="button button-small"
                type="button"
                disabled={busy}
                onClick={() => call(`/api/interview/sessions/${session.id}/skip`, { kind: "skip" })}
              >
                Skip this question
              </button>
              <button
                className="button button-small"
                type="button"
                disabled={busy}
                onClick={() =>
                  call(`/api/interview/sessions/${session.id}/skip`, { kind: "unknown" })
                }
              >
                I don&rsquo;t know
              </button>
            </div>
          </form>
        </div>
      )}

      {session.status === "active" && !view.pendingTurn && !view.capReached && (
        <div className="wp-card" style={{ marginTop: 18 }}>
          <p>Preparing the next question…</p>
          <button
            className="button button-small"
            type="button"
            disabled={busy}
            onClick={() => call(`/api/inventions/${inventionId}/interview/sessions`)}
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}
