import Link from "next/link";
import { notFound } from "next/navigation";
import InterviewPanel from "@/components/wepatent/InterviewPanel";
import {
  COVERAGE_DIMENSION_LABELS,
  COVERAGE_DIMENSIONS,
} from "@/lib/wepatent/domain/coverage";
import { getAdapters } from "@/lib/server/adapters";
import { getInterviewView } from "@/lib/server/services/interview";
import { getLedger } from "@/lib/server/services/ps-ledger";
import { requireOnboarded } from "@/lib/server/session";
import { applyProposedEditAction } from "./actions";

const STATE_LABELS: Record<string, string> = {
  ai_proposed: "AI proposed — awaiting your review",
  user_confirmed: "Confirmed by you",
  user_edited: "Edited by you",
};

/**
 * Adaptive invention interview (Intake Studio §6). Left/center — the
 * interview conversation; right — the live Problem/Solution ledger that
 * visibly updates after each answered turn (FR-INT-7). The header
 * disclaimer is FIXED interview-surface copy (§6.4).
 */
export default async function InterviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireOnboarded();
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, id);
  if (!invention) notFound();

  const sessions = await data.listInterviewSessions(context.organization.id, id);
  const mySession = [...sessions]
    .reverse()
    .find((session) => session.userId === context.user.id);
  const initialView = mySession
    ? await getInterviewView(context.organization.id, mySession.id)
    : null;
  const ledger = await getLedger(context.organization.id, id);
  const problems = ledger.pairs.filter((pair) => pair.kind === "problem");
  const solutions = ledger.pairs.filter((pair) => pair.kind === "solution");

  return (
    <>
      {/* Fixed interview-surface disclaimer (§6.4) — do not reword without
          counsel approval (feature PRD §15.5). */}
      <div className="wp-boundary-banner" data-testid="interview-disclaimer">
        wepatent collects facts about your invention; it does not give legal advice. Questions
        about whether or when to file, patentability, or claim breadth are for qualified patent
        counsel. Everything below is a working draft — counsel review required.
      </div>
      <div className="wp-topbar">
        <h1>Invention interview: {invention.title}</h1>
        <Link className="button button-small" href={`/wepatent/app/inventions/${id}/studio`}>
          Open the Intake Studio
        </Link>
      </div>

      <div className="wp-studio">
        <section
          className="wp-studio-center"
          aria-label="Interview conversation"
          style={{ gridColumn: "span 2" }}
        >
          <InterviewPanel inventionId={id} initialView={initialView} />
        </section>

        {/* Right — live P/S ledger (updates per turn, §6.3) */}
        <section className="wp-studio-right" aria-label="Problem/Solution ledger">
          <div className="wp-card" data-testid="interview-coverage">
            <p className="venture-kicker">Enablement coverage of this record</p>
            <h2>
              {ledger.coverage.aggregate.satisfied} of {ledger.coverage.aggregate.total} checks
            </h2>
            <p className="hint">
              Deterministic checklist ({ledger.coverage.version}) computed by code, never by a
              model. Record coverage, not legal sufficiency.
            </p>
            {ledger.coverage.perSolution.map((coverage, index) => (
              <div key={coverage.solutionId} style={{ marginBottom: 10 }}>
                <strong>
                  Solution {index + 1}: {coverage.satisfiedCount}/{coverage.totalCount}
                </strong>
                <ul className="wp-studio-list">
                  {COVERAGE_DIMENSIONS.filter(
                    (dimension) => coverage.dimensions[dimension].status === "gap",
                  ).map((dimension) => (
                    <li key={dimension} className="hint">
                      Gap: {COVERAGE_DIMENSION_LABELS[dimension]} — the interview targets this.
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {ledger.coverage.perSolution.length === 0 && <p>No solutions in the ledger yet.</p>}
          </div>

          <div className="wp-card" style={{ marginTop: 18 }} data-testid="interview-ledger">
            <p className="venture-kicker">Problem/Solution ledger</p>
            <h2>
              {problems.length} problem(s) · {solutions.length} solution(s) ·{" "}
              {ledger.components.length} component(s)
            </h2>
            {initialView && initialView.proposedEdits.length > 0 && (
              <div data-testid="proposed-edits">
                <p className="hint">
                  The extraction pass proposed edits to items you already confirmed or edited.
                  Nothing changes unless you apply them (AI never mutates your items):
                </p>
                {initialView.proposedEdits.map((edit) => (
                  <div key={edit.eventId} className="wp-studio-pair">
                    <p style={{ marginTop: 0 }}>Proposed edit: {edit.proposedStatement}</p>
                    <form action={applyProposedEditAction}>
                      <input type="hidden" name="inventionId" value={id} />
                      <input type="hidden" name="pairId" value={edit.pairId} />
                      <input type="hidden" name="statement" value={edit.proposedStatement} />
                      <button className="button button-small" type="submit">
                        Apply as my edit
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}
            {ledger.pairs.map((pair) => (
              <div key={pair.id} className="wp-studio-pair" data-testid={`interview-pair-${pair.kind}`}>
                <p style={{ marginBottom: 4 }}>
                  <span className="wp-badge neutral">{pair.kind}</span>{" "}
                  <span
                    className={`wp-badge ${pair.state === "ai_proposed" ? "needs_confirmation" : "source_supported"}`}
                  >
                    {STATE_LABELS[pair.state]}
                  </span>
                </p>
                <p style={{ marginTop: 0 }}>{pair.statement}</p>
                {pair.sourceAnchors.length > 0 && (
                  <p className="hint">Evidence: {pair.sourceAnchors.join(" · ")}</p>
                )}
              </div>
            ))}
            {ledger.pairs.length === 0 && (
              <p>
                Nothing yet — answers you give will propose problems and solutions here, each
                labeled until you act on it. Full editing lives in the studio.
              </p>
            )}
            {ledger.components.length > 0 && (
              <div data-testid="interview-components">
                <p className="venture-kicker" style={{ marginTop: 12 }}>
                  Component inventory
                </p>
                <ul className="wp-studio-list">
                  {ledger.components.map((component) => (
                    <li key={component.id}>
                      <strong>{component.name}</strong>{" "}
                      <span
                        className={`wp-badge ${component.state === "ai_proposed" ? "needs_confirmation" : "source_supported"}`}
                      >
                        {component.state === "ai_proposed" ? "AI proposed" : "reviewed"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
