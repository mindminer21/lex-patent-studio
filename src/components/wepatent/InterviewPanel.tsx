"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import InterviewComponentsPanel, { type ComponentView } from "./InterviewComponentsPanel";
import {
  COUNSEL_REFERRAL_TEMPLATE,
  shouldShowComponentsPanel,
  type ComponentsPanelSignal,
} from "@/lib/wepatent/domain/interview";
import {
  formatMultiplier,
  markupDisclosure,
  MARKUP_MULTIPLIERS,
} from "@/lib/shared/billing/markup";

/**
 * Adaptive interview surface (Intake Studio §6, FR-INT-6/7/10) — rebuilt as
 * a SINGLE-THREAD CHAT (Jeff's direction, 2026-08-05: "This needs to be a
 * single thread chat, and then invention components should populate in a
 * box on the right side that appears only after there is enough information
 * to distill components").
 *
 * What that means here:
 * - One continuous conversation: prior turns scroll in a message thread,
 *   the composer is pinned at the bottom, and there is no landing wall.
 *   Arriving with no session AUTO-CREATES it and shows the first question
 *   (minimize inputs: never ask someone to press Start before asking them
 *   a question). The POST is idempotent — it resumes an existing session.
 * - Explanatory prose is one line; the rest sits in a closed disclosure.
 * - The components box renders only when `shouldShowComponentsPanel` says
 *   the record can actually distill components — the same function the
 *   server used, so the two can never disagree.
 *
 * Nothing about the M2 engine changed: stages, target selection, no
 * re-asking known facts, pause/resume, per-turn metering with the estimate
 * shown before spend, the session cap and its raise path, and the FIXED
 * counsel-referral template for advice-seeking turns (zero model spend) all
 * still come from the server exactly as before. Answers and attachments
 * remain evidence, never instructions (invariant 2).
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
  components: ComponentView[];
  componentsSignal: ComponentsPanelSignal;
  componentsPanelVisible: boolean;
};

type ServerAction = (formData: FormData) => void | Promise<void>;

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const ANSWER_LABELS: Record<string, string> = {
  skip: "Skipped this question.",
  unknown: "“I don't know.”",
};

/** Stage-skip bookkeeping turns are records, not conversation. */
const STAGE_SKIP_MARKER = "(stage skipped)";

/** Refresh window after an attachment turn, while interpretation lands. */
const ATTACHMENT_POLL_ATTEMPTS = 12;
const ATTACHMENT_POLL_MS = 2_500;

type Message =
  | { key: string; kind: "question"; turn: TurnView; live: boolean }
  | { key: string; kind: "answer"; turn: TurnView }
  | { key: string; kind: "referral" }
  | { key: string; kind: "stage_skip"; count: number };

function buildMessages(turns: TurnView[]): Message[] {
  const messages: Message[] = [];
  for (const turn of turns) {
    if (turn.question.startsWith(STAGE_SKIP_MARKER)) {
      const last = messages[messages.length - 1];
      if (last && last.kind === "stage_skip") {
        last.count += 1;
        continue;
      }
      messages.push({ key: `skip:${turn.id}`, kind: "stage_skip", count: 1 });
      continue;
    }
    messages.push({
      key: `q:${turn.id}`,
      kind: "question",
      turn,
      live: turn.answerKind === null,
    });
    if (turn.answerKind !== null) {
      messages.push({ key: `a:${turn.id}`, kind: "answer", turn });
      if (turn.answerKind === "advice_referral") {
        messages.push({ key: `r:${turn.id}`, kind: "referral" });
      }
    }
  }
  return messages;
}

export default function InterviewPanel({
  inventionId,
  initialView,
  applyProposedEdit,
  dismissProposedEdit,
}: {
  inventionId: string;
  initialView: SessionView | null;
  applyProposedEdit: ServerAction;
  dismissProposedEdit: ServerAction;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const bootstrapped = useRef(false);
  const [view, setView] = useState<SessionView | null>(initialView);
  const [answer, setAnswer] = useState("");
  const [attachments, setAttachments] = useState<Array<{ sourceId: string; name: string }>>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [capInput, setCapInput] = useState("");

  const call = useCallback(
    async (path: string, body?: unknown, options?: { keepDraft?: boolean }): Promise<void> => {
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
          warnings?: string[];
        };
        if (!response.ok) {
          if (payload.error === "cap_reached") {
            setNotice(
              "Session spend cap reached — model calls are halted. Raise the cap below to continue; nothing was charged for this attempt.",
            );
            setView((current) => (current ? { ...current, capReached: true } : current));
          } else if (payload.error === "forbidden") {
            setNotice(
              "Your role cannot run the interview on this record. Ask an owner or editor for access.",
            );
          } else {
            setNotice("That action could not be completed. Please try again.");
          }
          return;
        }
        if (payload.view) setView(payload.view);
        if (!options?.keepDraft) {
          setAnswer("");
          setAttachments([]);
        }
        if (payload.warnings && payload.warnings.length > 0) {
          setNotice(
            payload.warnings.includes("drafting_insufficient_funds") ||
              payload.warnings.includes("extraction_insufficient_funds")
              ? "Wallet funds were insufficient for a model pass; deterministic fallbacks were used where possible. Top up to restore full AI assistance."
              : "A model pass did not complete; nothing was charged for it.",
          );
        }
      } catch {
        setNotice("Network error. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // Arrival with no session: create it and show the first question. The ref
  // guard keeps a double effect invocation from racing two POSTs; the
  // endpoint itself resumes rather than duplicating (unit-tested).
  useEffect(() => {
    if (view || bootstrapped.current) return;
    bootstrapped.current = true;
    void call(`/api/inventions/${inventionId}/interview/sessions`);
  }, [view, inventionId, call]);

  // Attachment interpretation finishes in a background job; poll the view
  // for a short window so extracted components appear without a reload.
  const [pollsLeft, setPollsLeft] = useState(0);
  const sessionId = view?.session.id ?? null;
  useEffect(() => {
    if (pollsLeft <= 0 || !sessionId) return;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/interview/sessions/${sessionId}`, {
          cache: "no-store",
        });
        if (response.ok) {
          const payload = (await response.json()) as { view?: SessionView };
          if (payload.view) setView(payload.view);
        }
      } catch {
        /* a failed refresh is not worth a message; the next tick retries */
      }
      setPollsLeft((current) => current - 1);
    }, ATTACHMENT_POLL_MS);
    return () => clearTimeout(timer);
  }, [pollsLeft, sessionId]);

  const messages = view ? buildMessages(view.turns) : [];
  const messageCount = messages.length;

  // Keep the newest message in view; the thread itself is the live region.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messageCount]);

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

  function sendAnswer(): void {
    if (!view) return;
    const hadAttachments = attachments.length > 0;
    void call(`/api/interview/sessions/${view.session.id}/turns`, {
      kind: "answer",
      answerText: answer,
      attachmentSourceIds: attachments.map((attachment) => attachment.sourceId),
    }).then(() => {
      if (hadAttachments) setPollsLeft(ATTACHMENT_POLL_ATTEMPTS);
      composerRef.current?.focus();
    });
  }

  const disclosure = (
    <details className="wp-disclosure" data-testid="interview-about">
      <summary>How this interview works, and what a turn costs</summary>
      <p>
        Seven Slusky-guided stages, general to specific: context, problem, the solution as a
        concept (WHAT), implementation (HOW), alternatives &amp; breadth, subsidiary problems,
        and boundaries. The questions adapt to what your record already contains and never
        re-ask a confirmed fact.
      </p>
      <p>
        Each answered turn runs two metered AI passes (question drafting + live extraction),
        charged at {markupDisclosure()} from your wallet — the interview is a conversational
        step rather than a deliverable, so both passes are analysis tasks and bill at{" "}
        {formatMultiplier(MARKUP_MULTIPLIERS.analysis)}×. Skips, &ldquo;I don&rsquo;t
        know&rdquo;, and counsel referrals cost nothing. Files you attach are treated as
        evidence about your invention, never as instructions.
      </p>
    </details>
  );

  if (!view) {
    return (
      <div className="wp-chat" data-testid="interview-panel">
        <div className="wp-chat-main">
          <p className="wp-chat-line">
            One conversation about your invention — answer what you can, skip what you can&rsquo;t.
          </p>
          {disclosure}
          <div className="wp-card" data-testid="interview-booting">
            <p role="status">Opening your interview and drafting the first question…</p>
            {notice && <p className="form-error">{notice}</p>}
          </div>
        </div>
      </div>
    );
  }

  const { session, progress } = view;
  // ONE predicate, evaluated on the live component count so an inline
  // delete cannot leave the UI showing a box the gate would now close.
  // `view.componentsPanelVisible` is the same call made server-side.
  const componentsVisible = shouldShowComponentsPanel({
    ...view.componentsSignal,
    componentCount: view.components.length,
  });

  return (
    <div className="wp-chat" data-testid="interview-panel">
      <div className="wp-chat-main">
        <p className="wp-chat-line">
          One conversation about your invention — answer what you can, skip what you can&rsquo;t.
        </p>
        {disclosure}

        <p className="wp-chat-status">
          <span data-testid="interview-progress">
            Stage {progress.stageNumber} of {progress.stageCount}: {progress.stageLabel}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Spend <strong data-testid="session-spend">{usd(session.spentCents)}</strong> of{" "}
            <span data-testid="session-cap">{usd(session.sessionSpendCapCents)}</span> cap
          </span>
          <span aria-hidden="true">·</span>
          <span data-testid="turn-estimate">
            about {usd(view.perTurnEstimate.lowCents)}–{usd(view.perTurnEstimate.highCents)} per
            answered turn
          </span>
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
        </p>

        <div
          className="wp-chat-thread"
          data-testid="interview-thread"
          ref={threadRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label="Interview conversation"
          tabIndex={0}
        >
          <ol className="wp-chat-messages">
            {messages.map((message) => {
              if (message.kind === "stage_skip") {
                return (
                  <li
                    key={message.key}
                    className="wp-chat-msg from-system"
                    data-testid="chat-message"
                    data-role="system"
                  >
                    You skipped the rest of that stage ({message.count} question
                    {message.count === 1 ? "" : "s"}) — recorded as an enablement signal.
                  </li>
                );
              }
              if (message.kind === "referral") {
                return (
                  <li
                    key={message.key}
                    className="wp-chat-msg from-interview referral"
                    data-testid="chat-message"
                    data-role="referral"
                  >
                    <p className="wp-chat-who">wepatent</p>
                    <p data-testid="counsel-referral">{COUNSEL_REFERRAL_TEMPLATE}</p>
                  </li>
                );
              }
              if (message.kind === "answer") {
                const { turn } = message;
                return (
                  <li
                    key={message.key}
                    className="wp-chat-msg from-you"
                    data-testid="chat-message"
                    data-role="you"
                  >
                    <p className="wp-chat-who">You</p>
                    <p className="wp-chat-text">
                      {turn.answerText ?? ANSWER_LABELS[turn.answerKind ?? ""] ?? "Answered."}
                    </p>
                    {turn.answerKind === "unknown" && (
                      <p className="hint">
                        Recorded as an enablement signal — an honest gap, not a failure.
                      </p>
                    )}
                    {turn.answerKind === "skip" && turn.answerText === null && (
                      <p className="hint">Recorded as an enablement signal.</p>
                    )}
                    {turn.attachmentSourceIds.length > 0 && (
                      <p className="hint" data-testid="answer-attachments">
                        {turn.attachmentSourceIds.length} attachment
                        {turn.attachmentSourceIds.length === 1 ? "" : "s"} routed through the
                        validated upload pipeline (evidence, never instructions).
                      </p>
                    )}
                  </li>
                );
              }
              const { turn, live } = message;
              return (
                <li
                  key={message.key}
                  className={`wp-chat-msg from-interview${live ? " live" : ""}`}
                  data-testid="chat-message"
                  data-role="question"
                >
                  <p className="wp-chat-who">wepatent</p>
                  <p className="wp-chat-text" {...(live ? { "data-testid": "question-text" } : {})}>
                    {turn.question}
                  </p>
                  {turn.followups.length > 0 && (
                    <ul className="wp-chat-followups">
                      {turn.followups.map((followup) => (
                        <li key={followup}>{followup}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}

            {session.status === "completed" && (
              <li
                className="wp-chat-msg from-system"
                data-testid="chat-message"
                data-role="system"
              >
                Interview complete — every stage is covered or explicitly skipped. Continue in
                the Studio or export the counsel package. Working draft — counsel review
                required.
              </li>
            )}
            {session.status === "paused" && (
              <li
                className="wp-chat-msg from-system"
                data-testid="interview-paused"
                data-role="system"
              >
                Interview paused. Your progress is saved — resume anytime and the same question
                is waiting.
              </li>
            )}
          </ol>
        </div>

        {view.proposedEdits.length > 0 && (
          <div className="wp-card wp-chat-proposals" data-testid="proposed-edits">
            <p className="hint">
              The extraction pass proposed edits to items you already confirmed or edited.
              Nothing changes unless you apply them (AI never mutates your items):
            </p>
            {view.proposedEdits.map((edit) => (
              <div key={edit.eventId} className="wp-studio-pair">
                <p style={{ marginTop: 0 }}>Proposed edit: {edit.proposedStatement}</p>
                <div className="wp-actions">
                  <form action={applyProposedEdit}>
                    <input type="hidden" name="inventionId" value={inventionId} />
                    <input type="hidden" name="pairId" value={edit.pairId} />
                    <input type="hidden" name="statement" value={edit.proposedStatement} />
                    <button className="button button-small" type="submit">
                      Apply as my edit
                    </button>
                  </form>
                  <form action={dismissProposedEdit}>
                    <input type="hidden" name="inventionId" value={inventionId} />
                    <input type="hidden" name="eventId" value={edit.eventId} />
                    <button className="button button-small" type="submit">
                      Dismiss
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}

        {(view.capReached || notice) && (
          <div className="wp-card wp-chat-notice" data-testid="interview-notice">
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
                  <button
                    className="button venture-button button-small"
                    type="submit"
                    disabled={busy}
                  >
                    Raise cap and continue
                  </button>
                </form>
              </>
            )}
            {notice && <p role="status">{notice}</p>}
          </div>
        )}

        {session.status === "paused" && (
          <div className="wp-chat-composer">
            <button
              className="button venture-button"
              type="button"
              disabled={busy}
              onClick={() => call(`/api/inventions/${inventionId}/interview/sessions`)}
            >
              Resume interview
            </button>
          </div>
        )}

        {session.status === "completed" && (
          <div className="wp-chat-composer">
            <button
              className="button button-small"
              type="button"
              disabled={busy}
              onClick={() => call(`/api/inventions/${inventionId}/interview/sessions`)}
            >
              Start another pass
            </button>
          </div>
        )}

        {session.status === "active" && !view.pendingTurn && !view.capReached && (
          <div className="wp-chat-composer">
            <p role="status">Preparing the next question…</p>
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

        {session.status === "active" && view.pendingTurn && (
          <form
            className="wp-chat-composer"
            data-testid="interview-composer"
            aria-label="Answer this question"
            onSubmit={(event) => {
              event.preventDefault();
              sendAnswer();
            }}
          >
            <label className="sr-only" htmlFor="interview-answer">
              Your answer
            </label>
            <textarea
              id="interview-answer"
              ref={composerRef}
              rows={3}
              value={answer}
              maxLength={8000}
              placeholder="Type your answer…"
              onChange={(event) => setAnswer(event.target.value)}
            />
            <div className="wp-chat-composer-actions">
              <button
                className="button venture-button"
                type="submit"
                disabled={busy || answer.trim().length < 2}
              >
                {busy ? "Working…" : "Send answer"}
              </button>
              <span className="wp-chat-attach">
                <label htmlFor="interview-attachment">Attach a file</label>
                <input
                  id="interview-attachment"
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.txt,.md,.docx,.pptx,.xlsx,.svg,.tif,.tiff,.heic,.stl,.step,.stp,.obj,.3mf,.mp3,.wav,.m4a,.mp4,.mov"
                  onChange={() => void attachFile()}
                />
              </span>
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
            {attachments.length > 0 && (
              <p className="hint" data-testid="attachment-chips">
                Attached: {attachments.map((attachment) => attachment.name).join(", ")}
              </p>
            )}
          </form>
        )}
      </div>

      {componentsVisible && (
        <aside className="wp-chat-side">
          <InterviewComponentsPanel
            components={view.components}
            onUpdated={(component) =>
              setView((current) =>
                current
                  ? {
                      ...current,
                      components: current.components.map((existing) =>
                        existing.id === component.id ? component : existing,
                      ),
                    }
                  : current,
              )
            }
            onDeleted={(componentId) =>
              setView((current) =>
                current
                  ? {
                      ...current,
                      components: current.components.filter(
                        (existing) => existing.id !== componentId,
                      ),
                    }
                  : current,
              )
            }
          />
        </aside>
      )}
    </div>
  );
}
