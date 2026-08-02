import Link from "next/link";
import {
  availableActions,
  COUNSEL_REQUEST_STATES,
  COUNSEL_REQUEST_TRANSITIONS,
  representationStatus,
  type CounselRequestAction,
} from "@/lib/domain/counsel-request";
import { isLocalMode } from "@/lib/env";
import { getAdapters } from "@/lib/server/adapters";
import { requireOnboarded } from "@/lib/server/session";
import { createCounselRequestAction, requesterCounselAction } from "./actions";

const ACTION_LABELS: Record<CounselRequestAction, string> = {
  submit: "Submit conflict-intake request",
  begin_conflict_review: "Begin conflict review",
  decline: "Decline request",
  offer_consultation: "Offer consultation",
  schedule_consultation: "Schedule consultation",
  offer_engagement: "Offer engagement",
  record_signed_engagement: "Record signed engagement",
  convert_to_matter: "Convert to matter",
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: "Please complete the required fields with valid values.",
  actor_not_allowed:
    "Your role cannot perform that step. Conflict review, accept/decline, engagement, and matter conversion belong to counsel administrators.",
  invalid_from_state: "That step is not available from the current state — states cannot be skipped.",
  evidence_required: "Recording a signed engagement requires a signed-engagement document reference.",
  unknown_action: "Unknown action.",
  not_found: "Request not found.",
  not_available: "This control is only available in local preview mode.",
};

export default async function CounselPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const context = await requireOnboarded();
  const { data } = getAdapters();
  const requests = await data.listCounselRequests(context.organization.id);
  const inventions = await data.listInventions(context.organization.id);
  const request = requests[requests.length - 1] ?? null;
  const events = request
    ? await data.listCounselRequestEvents(context.organization.id, request.id)
    : [];
  const engagement = request ? await data.getEngagementByRequest(request.id) : null;
  const status = request ? representationStatus(request.state) : null;
  const userActions = request
    ? availableActions(request.state, { kind: "user", role: context.membership.role })
    : [];

  return (
    <>
      <div className="wp-topbar">
        <h1>Counsel requests</h1>
        <span className="org">{context.organization.name}</span>
      </div>

      {status ? (
        <p>
          <span
            className={`wp-status-strip ${status.represented ? "represented" : "not-represented"}`}
          >
            {status.label}
          </span>
        </p>
      ) : (
        <p>
          <span className="wp-status-strip not-represented">Not represented</span>
        </p>
      )}
      <div className="wp-boundary-banner">
        {status?.detail ??
          "Requesting a consultation with connected counsel never creates representation. Representation requires conflict review, attorney acceptance, and a signed engagement agreement with the identified law firm."}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {ERROR_MESSAGES[error] ?? "Something went wrong."}
        </p>
      )}

      {!request ? (
        <div className="wp-card" style={{ maxWidth: 860 }}>
          <p className="venture-kicker">Limited conflict intake</p>
          <h2>Request a consultation with connected counsel</h2>
          <p>
            Only the limited information below is shared for conflict checking. Your invention
            record contents are <strong>not</strong> disclosed to counsel at this stage.
          </p>
          <form action={createCounselRequestAction} className="wp-form">
            <div className="field">
              <label htmlFor="cr-invention">Related invention record (reference only)</label>
              <select id="cr-invention" name="inventionId" defaultValue="">
                <option value="">None / general</option>
                {inventions.map((invention) => (
                  <option key={invention.id} value={invention.id}>
                    {invention.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cr-summary">What do you want to discuss?</label>
              <textarea id="cr-summary" name="requestSummary" required minLength={10} />
              <p className="hint">
                High-level only — for example “patent strategy for our cooling system”. Do not
                include confidential technical detail here.
              </p>
            </div>
            <div className="field">
              <label htmlFor="cr-adverse">
                Companies or people on the other side of any dispute (for conflict checking)
              </label>
              <textarea id="cr-adverse" name="adverseParties" />
            </div>
            <div className="field">
              <label htmlFor="cr-jurisdiction">Your company location (state/country)</label>
              <input id="cr-jurisdiction" name="jurisdiction" required minLength={2} />
            </div>
            <div className="field">
              <label htmlFor="cr-email">Contact email</label>
              <input id="cr-email" name="contactEmail" type="email" required />
            </div>
            <div>
              <button className="button venture-button" type="submit">
                Create draft request
              </button>
            </div>
            <p className="hint">
              Creating and submitting a request does not make you a client and does not create an
              attorney-client relationship.
            </p>
          </form>
        </div>
      ) : (
        <div className="wp-grid cols-2">
          <div className="wp-card">
            <p className="venture-kicker">Request status</p>
            <h2>{request.requestSummary.slice(0, 80)}</h2>
            <ol className="wp-state-flow" aria-label="Counsel request progress">
              {COUNSEL_REQUEST_STATES.filter(
                (state) => state !== "declined" || request.state === "declined",
              ).map((state) => {
                const currentIndex = COUNSEL_REQUEST_STATES.indexOf(request.state);
                const index = COUNSEL_REQUEST_STATES.indexOf(state);
                const className =
                  state === request.state ? "current" : index < currentIndex ? "past" : undefined;
                return (
                  <li key={state} className={className}>
                    {state.replace(/_/g, " ")}
                    {state === request.state && <span> — current</span>}
                  </li>
                );
              })}
            </ol>
            {userActions.length > 0 && (
              <div className="wp-actions">
                {userActions.map((action) => (
                  <form action={requesterCounselAction} key={action} className="wp-inline-form">
                    <input type="hidden" name="requestId" value={request.id} />
                    <input type="hidden" name="action" value={action} />
                    <button className="button venture-button button-small" type="submit">
                      {ACTION_LABELS[action]}
                    </button>
                  </form>
                ))}
              </div>
            )}
            {engagement && (
              <>
                <h3>Engagement</h3>
                <p>
                  {engagement.lawFirmName}:{" "}
                  {engagement.signedAt
                    ? `signed ${new Date(engagement.signedAt).toLocaleDateString()} (${engagement.signedDocumentRef})`
                    : "offered — you are not represented until the engagement letter is signed"}
                  . Scope: {engagement.scopeSummary}
                </p>
              </>
            )}
            <h3>History</h3>
            <ul className="wp-timeline">
              {events.map((event) => (
                <li key={event.id}>
                  <span className="when">{new Date(event.createdAt).toLocaleDateString()}</span>
                  <span>
                    {event.fromState.replace(/_/g, " ")} → {event.toState.replace(/_/g, " ")} by{" "}
                    {event.actorRole}
                    {event.evidenceRef && <> · evidence: {event.evidenceRef}</>}
                  </span>
                </li>
              ))}
              {events.length === 0 && <li><span className="when">—</span><span>Draft created; not yet submitted.</span></li>}
            </ul>
          </div>

          <div>
            <div className="wp-card">
              <p className="venture-kicker">How the process works</p>
              <ul>
                {COUNSEL_REQUEST_TRANSITIONS.map((transition) => (
                  <li key={transition.action} style={{ marginBottom: 8, lineHeight: 1.5 }}>
                    <strong>{ACTION_LABELS[transition.action]}:</strong> {transition.description}
                  </li>
                ))}
              </ul>
              <p className="consent-legal">
                Legal fees are billed by the law firm under its own engagement — never through
                wepatent subscriptions or AI usage. See <Link href="/wepatent/terms">terms</Link>.
              </p>
            </div>

            {isLocalMode && (
              <div className="wp-card" style={{ marginTop: 22, borderStyle: "dashed" }}>
                <p className="venture-kicker">Local preview — counsel administration lane</p>
                <h3>Counsel-side steps happen in the separate /counsel lane</h3>
                <p className="hint">
                  Conflict review, accept/decline, engagement, and matter conversion live in the
                  connected-counsel administration lane (PRD §6.3), restricted to counsel roles
                  with a separate audit trail. In this local preview, sign in as{" "}
                  <code>counsel-intake@wepatent.local</code> or{" "}
                  <code>counsel-attorney@wepatent.local</code> to exercise it against the same
                  state-machine guards.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
