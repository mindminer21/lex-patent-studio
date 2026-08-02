import Link from "next/link";
import { notFound } from "next/navigation";
import {
  availableActions,
  representationStatus,
  type CounselRequestAction,
} from "@/lib/wepatent/domain/counsel-request";
import { getAdapters } from "@/lib/server/adapters";
import { getRequestForCounsel } from "@/lib/server/services/counsel-lane";
import { requireCounsel } from "@/lib/server/session";
import { counselLaneAction } from "../../actions";

const ACTION_LABELS: Record<CounselRequestAction, string> = {
  submit: "Submit",
  begin_conflict_review: "Begin conflict review",
  decline: "Decline request",
  offer_consultation: "Offer consultation",
  schedule_consultation: "Schedule consultation",
  offer_engagement: "Offer engagement",
  record_signed_engagement: "Record signed engagement",
  convert_to_matter: "Convert to matter",
};

const ERROR_MESSAGES: Record<string, string> = {
  actor_not_allowed:
    "Your counsel role cannot perform that step. Decline/accept, engagement, and matter conversion require the attorney role.",
  invalid_from_state: "That step is not available from the current state — states cannot be skipped.",
  evidence_required: "Recording a signed engagement requires the signed-engagement document reference.",
  engagement_missing: "No engagement has been offered on this request yet.",
  scope_required: "An engagement offer requires a scope summary.",
  unknown_action: "Unknown action.",
  not_found: "Request not found.",
};

export default async function CounselRequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const context = await requireCounsel();
  const { id } = await params;
  const { error } = await searchParams;
  const request = await getRequestForCounsel(id);
  if (!request) notFound();

  const { data } = getAdapters();
  const organization = await data.getOrganizationById(request.organizationId);
  const events = await data.listCounselRequestEvents(request.organizationId, request.id);
  const engagement = await data.getEngagementByRequest(request.id);
  const matter = engagement ? await data.getLegalMatterByEngagement(engagement.id) : null;
  const status = representationStatus(request.state);
  const actions = availableActions(request.state, {
    kind: "user",
    role: context.assignment.role,
  }).filter((action) => action !== "submit" && action !== "schedule_consultation");

  return (
    <>
      <div className="wp-topbar">
        <h1>Request from {organization?.name ?? "Unknown organization"}</h1>
        <span
          className={`wp-status-strip ${status.represented ? "represented" : "not-represented"}`}
        >
          {status.label}
        </span>
      </div>
      <div className="wp-boundary-banner">{status.detail}</div>

      {error && (
        <p className="form-error" role="alert">
          {ERROR_MESSAGES[error] ?? "Something went wrong."}
        </p>
      )}

      <div className="wp-grid cols-2">
        <div className="wp-card">
          <p className="venture-kicker">Limited conflict intake</p>
          <h2>{request.requestSummary}</h2>
          <table className="wp-table">
            <tbody>
              <tr>
                <td>State</td>
                <td>
                  <span className="wp-badge neutral">{request.state.replace(/_/g, " ")}</span>
                </td>
              </tr>
              <tr>
                <td>Adverse parties</td>
                <td>{request.adverseParties || "None listed"}</td>
              </tr>
              <tr>
                <td>Jurisdiction</td>
                <td>{request.jurisdiction}</td>
              </tr>
              <tr>
                <td>Contact</td>
                <td>{request.contactEmail}</td>
              </tr>
              <tr>
                <td>Received</td>
                <td>{new Date(request.createdAt).toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
          <p className="consent-legal">
            The customer&apos;s invention record contents are not available in this lane. Access to
            substantive materials requires the engagement and consent rules to permit it.
          </p>

          <h3>History</h3>
          <ul className="wp-timeline">
            {events.map((event) => (
              <li key={event.id}>
                <span className="when">{new Date(event.createdAt).toLocaleString()}</span>
                <span>
                  {event.fromState.replace(/_/g, " ")} → {event.toState.replace(/_/g, " ")} by{" "}
                  {event.actorRole}
                  {event.evidenceRef && <> · evidence: {event.evidenceRef}</>}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="wp-card">
            <h2>Available actions ({context.assignment.role})</h2>
            {actions.length === 0 ? (
              <p>
                No actions available for your role in the current state
                {request.state === "consultation_offered"
                  ? " — the requester schedules the consultation."
                  : ""}
                .
              </p>
            ) : (
              actions.map((action) => (
                <form
                  action={counselLaneAction}
                  key={action}
                  className="wp-form"
                  style={{ marginBottom: 18 }}
                >
                  <input type="hidden" name="requestId" value={request.id} />
                  <input type="hidden" name="action" value={action} />
                  {action === "offer_engagement" && (
                    <div className="field">
                      <label htmlFor={`scope-${action}`}>Engagement scope and fees summary</label>
                      <textarea id={`scope-${action}`} name="scopeSummary" required minLength={3} />
                      <p className="hint">
                        Scope, fees, and terms live in the engagement letter itself; this summary
                        is for the record only.
                      </p>
                    </div>
                  )}
                  {action === "record_signed_engagement" && (
                    <div className="field">
                      <label htmlFor={`evidence-${action}`}>
                        Signed engagement document reference (required)
                      </label>
                      <input
                        id={`evidence-${action}`}
                        name="evidenceRef"
                        required
                        placeholder="e.g. engagement-letter-2026-08-02.pdf"
                      />
                    </div>
                  )}
                  <button className="button venture-button button-small" type="submit">
                    {ACTION_LABELS[action]}
                  </button>
                </form>
              ))
            )}
            <p className="consent-legal">
              Conflict review, accept/decline, engagement, and matter conversion are enforced by
              the state machine with your real role — steps cannot be skipped and intake
              administrators cannot decide requests.
            </p>
          </div>

          {engagement && (
            <div className="wp-card" style={{ marginTop: 22 }}>
              <h2>Engagement</h2>
              <p>
                {engagement.lawFirmName} —{" "}
                {engagement.signedAt ? "signed" : "offered, not yet signed"}
              </p>
              <p>
                <Link href={`/counsel/engagements/${engagement.id}`}>Open engagement record</Link>
              </p>
              {matter && (
                <p>
                  <Link href={`/counsel/matters/${matter.id}`}>
                    Open matter {matter.matterReference}
                  </Link>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
