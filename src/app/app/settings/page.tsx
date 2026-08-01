import { getAdapters } from "@/lib/server/adapters";
import { requireOrg } from "@/lib/server/session";

export default async function SettingsPage() {
  const context = await requireOrg();
  const { data } = getAdapters();
  const memberships = await data.getMembershipsForOrganization(context.organization.id);
  const members = await Promise.all(
    memberships.map(async (membership) => ({
      membership,
      user: await data.getUserById(membership.userId),
    })),
  );
  const audit = await data.listAuditEvents(context.organization.id);

  return (
    <>
      <div className="wp-topbar">
        <h1>Settings</h1>
        <span className="org">{context.organization.name}</span>
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
                <td>
                  {context.organization.retentionDays} days (default). Retention-aware purge and
                  deletion workflows ship with the production data plane.
                </td>
              </tr>
            </tbody>
          </table>
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
          <p className="consent-legal">
            Invitations with expiring, idempotent acceptance ship with production auth. Counsel
            roles are never granted through organization membership.
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
