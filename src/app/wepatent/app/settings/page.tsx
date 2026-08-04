import Link from "next/link";
import { can } from "@/lib/wepatent/domain/roles";
import { openPortalAction } from "../billing/actions";
import { isLocalMode } from "@/lib/wepatent/env";
import { getAdapters } from "@/lib/server/adapters";
import { invitationStatus } from "@/lib/server/services/invitations";
import { requireOrg } from "@/lib/server/session";
import {
  inviteMemberAction,
  revokeInvitationAction,
  runPurgeAction,
  updateRetentionAction,
} from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  forbidden: "Only owners and admins can manage members.",
  invalid_input: "Enter a valid email address and role.",
  already_member: "That person is already a member of this organization.",
  retention_forbidden: "Only the organization owner can manage retention.",
  retention_invalid_input: "Retention must be between 30 and 3650 days.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    invited?: string;
    token?: string;
    existing?: string;
    retention?: string;
    purged?: string;
    pending?: string;
  }>;
}) {
  const params = await searchParams;
  const context = await requireOrg();
  const { data } = getAdapters();
  const memberships = await data.getMembershipsForOrganization(context.organization.id);
  const members = await Promise.all(
    memberships.map(async (membership) => ({
      membership,
      user: await data.getUserById(membership.userId),
    })),
  );
  const invitations = await data.listInvitations(context.organization.id);
  const audit = await data.listAuditEvents(context.organization.id);
  const softDeleted = await data.listSoftDeletedInventions(context.organization.id);
  const canManage = can(context.membership.role, "org.members.manage");
  const canManageOrg = can(context.membership.role, "org.manage");

  return (
    <>
      <div className="wp-topbar">
        <h1>Settings</h1>
        <span className="org">{context.organization.name}</span>
      </div>

      <div className="wp-card" style={{ marginBottom: 22 }}>
        <h2>Subscription &amp; billing</h2>
        <p>
          Manage your plan, payment methods, and invoices in the Stripe Customer Portal. Usage
          top-ups and plan details live on the <Link href="/wepatent/app/billing">Billing</Link>{" "}
          page.
        </p>
        {can(context.membership.role, "billing.manage") ? (
          <form action={openPortalAction}>
            <button className="button venture-button" type="submit">
              Open customer portal
            </button>
          </form>
        ) : (
          <p>Only owners and admins can manage billing for this organization.</p>
        )}
      </div>

      <div className="wp-grid cols-2">
        <div className="wp-card">
          <h2>Organization</h2>
          <table className="wp-table">
            <tbody>
              <tr>
                <td>Name</td>
                <td>{context.organization.name}</td>
              </tr>
              <tr>
                <td>Created</td>
                <td>{new Date(context.organization.createdAt).toLocaleString()}</td>
              </tr>
              <tr>
                <td>Retention</td>
                <td>{context.organization.retentionDays} days</td>
              </tr>
            </tbody>
          </table>

          <h2 style={{ marginTop: 26 }}>Retention &amp; deletion</h2>
          {params.retention === "updated" && (
            <p className="form-success" role="status">
              Retention window updated and audited.
            </p>
          )}
          {params.purged !== undefined && (
            <p className="form-success" role="status">
              Purge complete: {params.purged} record(s) permanently deleted
              {params.pending && Number(params.pending) > 0
                ? `; ${params.pending} soft-deleted record(s) remain inside the retention window`
                : ""}
              . Audit evidence retained.
            </p>
          )}
          {params.error?.startsWith("retention_") && (
            <p className="form-error" role="alert">
              {ERROR_MESSAGES[params.error] ?? "Retention update failed."}
            </p>
          )}
          <p>
            Soft-deleted invention records: {softDeleted.length}. A soft-deleted record is
            permanently purged (facts, sources, drafts, and exports removed) once it has been
            deleted for longer than the retention window; audit evidence is kept.
          </p>
          {canManageOrg ? (
            <>
              <form action={updateRetentionAction} className="wp-inline-form">
                <label htmlFor="retention-days">Retention window (days)</label>
                <input
                  id="retention-days"
                  name="retentionDays"
                  type="number"
                  min={30}
                  max={3650}
                  defaultValue={context.organization.retentionDays}
                  required
                  style={{ width: 110, marginLeft: 8, marginRight: 8 }}
                />
                <button className="button button-secondary button-small" type="submit">
                  Update retention
                </button>
              </form>
              <form action={runPurgeAction} style={{ marginTop: 10 }}>
                <button className="button button-secondary button-small" type="submit">
                  Run retention purge now
                </button>
              </form>
            </>
          ) : (
            <p className="consent-legal">Only the organization owner can manage retention.</p>
          )}
          <h2 style={{ marginTop: 26 }}>Members</h2>
          <table className="wp-table">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
              </tr>
            </thead>
            <tbody>
              {members.map(({ membership, user }) => (
                <tr key={membership.id}>
                  <td>{user?.displayName ?? "Unknown"}</td>
                  <td>{user?.email ?? "—"}</td>
                  <td>
                    <span className="wp-badge neutral">{membership.role}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2 style={{ marginTop: 26 }}>Invitations</h2>
          {params.error && (
            <p className="form-error" role="alert">
              {ERROR_MESSAGES[params.error] ?? "Something went wrong."}
            </p>
          )}
          {params.invited && params.token && (
            <div className="wp-boundary-banner" role="status">
              Invitation created. Sending email is approval-gated (PRD §17.6)
              {isLocalMode ? (
                <>
                  ; share this local accept link instead:{" "}
                  <code data-testid="invite-link">
                    /wepatent/app/invitations/accept?token={params.token}
                  </code>
                </>
              ) : (
                "."
              )}{" "}
              This link is shown once and expires in 7 days.
            </div>
          )}
          {params.invited && params.existing && (
            <p className="wp-boundary-banner" role="status">
              An invitation for that address is already pending — no duplicate was created.
            </p>
          )}
          {invitations.length > 0 && (
            <table className="wp-table">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Expires</th>
                  {canManage && <th scope="col"></th>}
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => {
                  const status = invitationStatus(invitation);
                  return (
                    <tr key={invitation.id}>
                      <td>{invitation.email}</td>
                      <td>
                        <span className="wp-badge neutral">{invitation.role}</span>
                      </td>
                      <td>
                        <span className="wp-badge neutral">{status}</span>
                      </td>
                      <td>{new Date(invitation.expiresAt).toLocaleDateString()}</td>
                      {canManage && (
                        <td>
                          {status === "pending" && (
                            <form action={revokeInvitationAction} className="wp-inline-form">
                              <input type="hidden" name="invitationId" value={invitation.id} />
                              <button
                                className="button button-secondary button-small"
                                type="submit"
                              >
                                Revoke
                              </button>
                            </form>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {canManage ? (
            <form action={inviteMemberAction} className="wp-form" style={{ marginTop: 16 }}>
              <div className="field">
                <label htmlFor="invite-email">Invite by email</label>
                <input id="invite-email" name="email" type="email" required />
              </div>
              <div className="field">
                <label htmlFor="invite-role">Role</label>
                <select id="invite-role" name="role" defaultValue="member">
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                  <option value="viewer">viewer</option>
                </select>
                <p className="hint">
                  Counsel roles can never be granted through invitations or membership (FR-2).
                </p>
              </div>
              <div>
                <button className="button venture-button" type="submit">
                  Create invitation
                </button>
              </div>
            </form>
          ) : (
            <p className="consent-legal">Only owners and admins can manage members.</p>
          )}
          <p className="consent-legal">
            Invitations expire after 7 days and acceptance is idempotent — accepting twice never
            duplicates membership.
          </p>
        </div>

        <div className="wp-card">
          <h2>Audit trail</h2>
          <table className="wp-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Action</th>
                <th scope="col">Actor</th>
              </tr>
            </thead>
            <tbody>
              {audit
                .slice(-25)
                .reverse()
                .map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.createdAt).toLocaleString()}</td>
                    <td>{event.action}</td>
                    <td>{event.actor.slice(0, 24)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="consent-legal">
            Audit events exclude prompts, document contents, and secrets. Security events carry
            correlation identifiers in the production observability stack.
          </p>
        </div>
      </div>
    </>
  );
}
