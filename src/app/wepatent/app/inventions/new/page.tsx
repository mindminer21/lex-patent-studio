import Link from "next/link";
import {
  canEnterStage,
  DISCLOSURE_EVENT_KINDS,
  emptyIntakeState,
  firstIncompleteStage,
  INTAKE_STAGES,
  type IntakeStageKey,
} from "@/lib/wepatent/domain/intake";
import { getAdapters } from "@/lib/server/adapters";
import { requireOnboarded } from "@/lib/server/session";
import { intakeStageAction } from "./actions";
import {
  componentsToText,
  contributorsToText,
  sourcesToText,
  stepsToText,
  timelineToText,
} from "./format";

type StageDataMap = Partial<Record<IntakeStageKey, Record<string, unknown>>>;

function str(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key];
  return typeof value === "string" ? value : "";
}

export default async function NewInventionPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; saved?: string; error?: string; issues?: string }>;
}) {
  const params = await searchParams;
  const context = await requireOnboarded();
  const { data } = getAdapters();

  const session = await data.getIntakeSession(context.organization.id, context.user.id);
  const state = session?.state ?? emptyIntakeState();
  const requested = (params.stage ?? firstIncompleteStage(state)) as IntakeStageKey;
  const stage = INTAKE_STAGES.some((s) => s.key === requested)
    ? requested
    : firstIncompleteStage(state);
  const enterable = canEnterStage(state, stage) ? stage : firstIncompleteStage(state);
  const stageMeta = INTAKE_STAGES.find((s) => s.key === enterable)!;
  const stageData = state.stageData as StageDataMap;
  const current = stageData[enterable];
  const issues = params.issues ? decodeURIComponent(params.issues).split("||").filter(Boolean) : [];

  return (
    <>
      <div className="wp-topbar">
        <h1>New invention record</h1>
        <span className="org">{context.organization.name}</span>
      </div>
      <div className="wp-boundary-banner">
        This intake collects facts and flags open questions. It never produces legal conclusions —
        inventorship, ownership, deadlines, and filing decisions belong to qualified counsel.
      </div>

      <div className="wp-grid cols-2" style={{ gridTemplateColumns: "300px minmax(0,1fr)" }}>
        <div>
          <ol className="wp-stage-nav" aria-label="Intake stages">
            {INTAKE_STAGES.map((s, index) => {
              const complete = state.completed.includes(s.key);
              const reachable = canEnterStage(state, s.key);
              const className = [
                s.key === enterable ? "current" : "",
                complete ? "complete" : "",
                !reachable ? "locked" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <li key={s.key} className={className || undefined}>
                  <span className="stage-mark" aria-hidden="true">
                    {complete ? "✓" : index + 1}
                  </span>
                  {reachable ? (
                    <Link href={`/wepatent/app/inventions/new?stage=${s.key}`}>{s.title}</Link>
                  ) : (
                    <span>{s.title}</span>
                  )}
                  {complete && <span className="sr-only"> (complete)</span>}
                </li>
              );
            })}
          </ol>
          <p className="consent-legal">
            Progress is saved on this server session. Use “Save draft” at any time and resume
            later from where you left off.
          </p>
        </div>

        <div className="wp-card">
          <p className="venture-kicker">
            Stage {INTAKE_STAGES.findIndex((s) => s.key === enterable) + 1} of {INTAKE_STAGES.length}
          </p>
          <h2>{stageMeta.title}</h2>

          {params.saved === "1" && (
            <p className="wp-boundary-banner" role="status">
              Draft saved. You can leave and resume this intake later.
            </p>
          )}
          {params.error && issues.length === 0 && (
            <p className="form-error" role="alert">
              {params.error === "stage_locked"
                ? "Complete the earlier stages first."
                : "Please review this stage — the submitted data was incomplete."}
            </p>
          )}
          {issues.length > 0 && (
            <ul className="form-issues" role="alert">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}

          <form action={intakeStageAction} className="wp-form">
            <input type="hidden" name="stage" value={enterable} />

            {enterable === "identity" && (
              <>
                <div className="field">
                  <label htmlFor="title">Invention title</label>
                  <input id="title" name="title" required minLength={3} maxLength={200} defaultValue={str(current, "title")} />
                </div>
                <div className="field">
                  <label htmlFor="summary">Short summary</label>
                  <textarea id="summary" name="summary" required defaultValue={str(current, "summary")} />
                  <p className="hint">What it is and what it does, in your own words.</p>
                </div>
                <div className="field">
                  <label htmlFor="businessContext">Business context (optional)</label>
                  <textarea id="businessContext" name="businessContext" defaultValue={str(current, "businessContext")} />
                  <p className="hint">Why this matters now — funding, diligence, product timing.</p>
                </div>
              </>
            )}

            {enterable === "problem_solution" && (
              <>
                <div className="field">
                  <label htmlFor="problem">Problem addressed</label>
                  <textarea id="problem" name="problem" required defaultValue={str(current, "problem")} />
                </div>
                <div className="field">
                  <label htmlFor="solution">Technical solution</label>
                  <textarea id="solution" name="solution" required defaultValue={str(current, "solution")} />
                  <p className="hint">Describe how it works technically, not its legal significance.</p>
                </div>
              </>
            )}

            {enterable === "components" && (
              <>
                <div className="field">
                  <label htmlFor="componentsText">Components (one per line)</label>
                  <textarea
                    id="componentsText"
                    name="componentsText"
                    required
                    defaultValue={componentsToText(current as never)}
                  />
                  <p className="hint">Format: Component name — short description. Example: “Cartridge latch — retains the phase-change cartridge”.</p>
                </div>
                <div className="field">
                  <label htmlFor="stepsText">Method steps, if any (one per line)</label>
                  <textarea id="stepsText" name="stepsText" defaultValue={stepsToText(current as never)} />
                </div>
                <div className="field">
                  <label htmlFor="alternatives">Alternatives considered (optional)</label>
                  <textarea id="alternatives" name="alternatives" defaultValue={str(current, "alternatives")} />
                </div>
                <div className="field">
                  <label htmlFor="advantages">Advantages you observed (optional)</label>
                  <textarea id="advantages" name="advantages" defaultValue={str(current, "advantages")} />
                  <p className="hint">Observed results only — not patentability conclusions.</p>
                </div>
              </>
            )}

            {enterable === "contributors" && (
              <div className="field">
                <label htmlFor="contributorsText">Contributors (one per line)</label>
                <textarea
                  id="contributorsText"
                  name="contributorsText"
                  required
                  defaultValue={contributorsToText(current as never)}
                />
                <p className="hint">
                  Format: Name &lt;email&gt; — what they contributed. Who counts as a legal inventor
                  is decided by counsel; list everyone who contributed ideas or design work.
                </p>
              </div>
            )}

            {enterable === "timeline" && (
              <>
                <div className="field">
                  <label htmlFor="eventsText">Disclosure and commercialization events (one per line)</label>
                  <textarea id="eventsText" name="eventsText" defaultValue={timelineToText(current as never)} />
                  <p className="hint">
                    Format: YYYY-MM-DD | kind | description. Kinds:{" "}
                    {DISCLOSURE_EVENT_KINDS.join(", ")}. Add “(NDA)” to a description if it was
                    under NDA.
                  </p>
                </div>
                <label className="acknowledgement">
                  <input
                    type="checkbox"
                    name="noEventsConfirmed"
                    defaultChecked={Boolean(current?.noEventsConfirmed)}
                  />
                  <span>We have no disclosure, sale, publication, or demo events yet.</span>
                </label>
              </>
            )}

            {enterable === "ownership" && (
              <>
                <div className="field">
                  <label htmlFor="employmentAgreementsExist">
                    Do contributors have employment/IP agreements with your company?
                  </label>
                  <select
                    id="employmentAgreementsExist"
                    name="employmentAgreementsExist"
                    required
                    defaultValue={str(current, "employmentAgreementsExist") || ""}
                  >
                    <option value="" disabled>
                      Select an answer
                    </option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                    <option value="unsure">Unsure</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="assignmentsExecuted">
                    Have invention assignments been executed for this invention?
                  </label>
                  <select
                    id="assignmentsExecuted"
                    name="assignmentsExecuted"
                    required
                    defaultValue={str(current, "assignmentsExecuted") || ""}
                  >
                    <option value="" disabled>
                      Select an answer
                    </option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                    <option value="unsure">Unsure</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="thirdPartyObligations">
                    Third-party obligations you know about (optional)
                  </label>
                  <textarea id="thirdPartyObligations" name="thirdPartyObligations" defaultValue={str(current, "thirdPartyObligations")} />
                  <p className="hint">Prior employers, universities, government funding, open-source terms.</p>
                </div>
                <div className="field">
                  <label htmlFor="openQuestions">Open ownership questions (optional)</label>
                  <textarea id="openQuestions" name="openQuestions" defaultValue={str(current, "openQuestions")} />
                  <p className="hint">
                    Anything unclear is recorded as an unresolved fact for counsel — the software
                    never decides ownership.
                  </p>
                </div>
              </>
            )}

            {enterable === "sources" && (
              <>
                <div className="field">
                  <label htmlFor="sourcesText">Source documents to register (one per line)</label>
                  <textarea id="sourcesText" name="sourcesText" defaultValue={sourcesToText(current as never)} />
                  <p className="hint">
                    Format: Name | kind | note. Kinds: lab_notebook, design_doc, code, presentation,
                    data, image, other. Local preview registers metadata only; production uses
                    validated, quarantined direct uploads.
                  </p>
                </div>
                <label className="acknowledgement">
                  <input
                    type="checkbox"
                    name="noSourcesConfirmed"
                    defaultChecked={Boolean(current?.noSourcesConfirmed)}
                  />
                  <span>We have no source documents to register yet.</span>
                </label>
              </>
            )}

            {enterable === "review" && (
              <>
                <p>
                  Submitting creates the invention record from your completed stages. Facts enter
                  the record as <strong>user-asserted</strong>; open questions are labeled
                  unresolved for counsel. You can keep editing the record afterward.
                </p>
                <label className="acknowledgement">
                  <input type="checkbox" name="confirmAccuracy" required />
                  <span>
                    The information I provided is accurate and complete to the best of my knowledge.
                    I understand this record and any drafts are working materials that require
                    review by qualified patent counsel.
                  </span>
                </label>
              </>
            )}

            <div className="wp-actions">
              {enterable !== "review" ? (
                <>
                  <button className="button venture-button" type="submit" name="intent" value="continue">
                    Save and continue
                  </button>
                  <button className="button button-secondary" type="submit" name="intent" value="save" formNoValidate>
                    Save draft
                  </button>
                </>
              ) : (
                <button className="button venture-button" type="submit" name="intent" value="continue">
                  Submit to invention record
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
