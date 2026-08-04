import Link from "next/link";
import FilingReceiptUpload from "@/components/wepatent/FilingReceiptUpload";
import {
  availableActions,
  COUNSEL_REQUEST_STATES,
  COUNSEL_REQUEST_TRANSITIONS,
  representationStatus,
  type CounselRequestAction,
} from "@/lib/wepatent/domain/counsel-request";
import { isLocalMode } from "@/lib/wepatent/env";
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

const USPTO_SELF_FILING_URL = "https://www.uspto.gov/patents/basics/apply";
// Interim scheduling link per Jeff — a more detailed attorney-intake setup
// will replace this later. The compliance copy next to the button is
// governed by docs/legal-ethics-risk-memo.md §2 and must stay adjacent.
const ATTORNEY_SCHEDULING_URL = "https://cal.com/jeffschell/talktoapatentlawyer";

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

  // Draft/export status per record — honest working-draft framing only.
  const records = await Promise.all(
    inventions.map(async (invention) => {
      const [drafts, exports, sources] = await Promise.all([
        data.listDrafts(context.organization.id, invention.id),
        data.listExports(context.organization.id, invention.id),
        data.listSources(context.organization.id, invention.id),
      ]);
      const versionLists = await Promise.all(
        drafts.map((draft) => data.listDraftVersions(context.organization.id, draft.id)),
      );
      const draftVersionCount = versionLists.reduce((total, list) => total + list.length, 0);
      const latestExportAt = exports.reduce<string | null>(
        (latest, entry) => (!latest || entry.createdAt > latest ? entry.createdAt : latest),
        null,
      );
      const receipts = sources.filter((source) => source.kind === "filing_receipt");
      return { invention, draftCount: drafts.length, draftVersionCount, latestExportAt, receipts };
    }),
  );

  return (
    <>
      <div className="wp-topbar">
        <h1>Get Help to File Your Applications</h1>
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

      <div className="wp-grid cols-2">
        <div className="wp-card">
          <p className="venture-kicker">Option 1 — File it yourself</p>
          <h2>Self-file with the USPTO</h2>
          <p>
            Filing directly with the USPTO is your own pro se decision — wepatent does not file
            for you, does not track deadlines, and does not advise you on whether or what to
            file. The drafts in your workspace are working documents that require review by a
            qualified professional before any filing.
          </p>
          <p>
            <a
              className="button venture-button"
              href={USPTO_SELF_FILING_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Go to USPTO website for self-filing instructions
            </a>
          </p>
          <p className="hint">
            Once you have filed, upload your USPTO filing receipt on the matching draft
            application below to keep the record complete.
          </p>
        </div>

        <div className="wp-card">
          <p className="venture-kicker">Option 2 — Work with an attorney</p>
          <h2>Talk to a patent attorney</h2>
          <p>
            <a
              className="button venture-button"
              href={ATTORNEY_SCHEDULING_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Get help from an attorney
            </a>
          </p>
          <p className="consent-legal">
            Scheduling a consultation does not create an attorney-client relationship. Please do
            not share confidential invention details until the attorney has completed a conflict
            check and you have a signed engagement letter.
          </p>
        </div>
      </div>

      <div className="wp-card" style={{ marginTop: 22 }}>
        <h2>Your draft applications</h2>
        <p className="hint">
          These are the working drafts in your invention records. They are not filing-ready
          applications: every record stays a working draft until reviewed by counsel or filed by
          you pro se.
        </p>
        {records.length === 0 ? (
          <div className="wp-empty">
            <h3>No invention records yet</h3>
            <p>Create an invention record first — your working drafts will appear here.</p>
            <Link className="button venture-button" href="/wepatent/app/inventions/start">
              New invention
            </Link>
          </div>
        ) : (
          records.map(({ invention, draftCount, draftVersionCount, latestExportAt, receipts }) => (
            <div
              key={invention.id}
              data-testid="help-record"
              style={{
                border: "1px solid var(--venture-line)",
                padding: "16px 18px",
                marginTop: 16,
              }}
            >
              <h3 style={{ marginTop: 0, marginBottom: 6 }}>
                <Link href={`/wepatent/app/inventions/${invention.id}`}>{invention.title}</Link>{" "}
                {invention.synthetic && <span className="wp-badge synthetic">Synthetic example</span>}{" "}
                <span className="wp-badge draft-label">Working record — counsel review required</span>
              </h3>
              <p className="hint" style={{ marginTop: 0 }}>
                {draftVersionCount} draft version{draftVersionCount === 1 ? "" : "s"} across{" "}
                {draftCount} draft{draftCount === 1 ? "" : "s"} ·{" "}
                {latestExportAt
                  ? `latest export ${new Date(latestExportAt).toLocaleDateString()}`
                  : "no exports yet"}
              </p>
              <h4 style={{ marginBottom: 6 }}>Filing receipts</h4>
              {receipts.length === 0 ? (
                <p className="hint">
                  No filing receipts uploaded yet. Once you have filed with the USPTO, upload the
                  filing receipt here.
                </p>
              ) : (
                <ul className="wp-timeline" style={{ marginBottom: 12 }}>
                  {receipts.map((receipt) => (
                    <li key={receipt.id}>
                      <span className="when">
                        {new Date(receipt.createdAt).toLocaleDateString()}
                      </span>
                      <span>
                        {receipt.name}{" "}
                        <span className="wp-badge neutral">{receipt.status}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <FilingReceiptUpload inventionId={invention.id} />
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: 34 }}>
        <h2>Structured conflict-screening intake</h2>
        <p className="hint" style={{ maxWidth: 860 }}>
          Alternatively, request a screened introduction to connected counsel through the
          platform. Only limited conflict-check information is shared; representation requires
          conflict review, attorney acceptance, and a signed engagement letter.
        </p>

        {!request ? (
          <div className="wp-card" style={{ maxWidth: 860 }}>
            <p className="venture-kicker">Limited conflict intake</p>
            <h3>Request a consultation with connected counsel</h3>
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
              <h3>{request.requestSummary.slice(0, 80)}</h3>
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
                  <h4>Engagement</h4>
                  <p>
                    {engagement.lawFirmName}:{" "}
                    {engagement.signedAt
                      ? `signed ${new Date(engagement.signedAt).toLocaleDateString()} (${engagement.signedDocumentRef})`
                      : "offered — you are not represented until the engagement letter is signed"}
                    . Scope: {engagement.scopeSummary}
                  </p>
                </>
              )}
              <h4>History</h4>
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
                  <h4>Counsel-side steps happen in the separate /counsel lane</h4>
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
      </div>
    </>
  );
}
