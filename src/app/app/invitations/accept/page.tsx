import Link from "next/link";
import { redirect } from "next/navigation";
import { acceptInvitation } from "@/lib/server/services/invitations";
import { requireUser } from "@/lib/server/session";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_token: "This invitation link is not valid.",
  expired: "This invitation has expired. Ask an administrator to send a new one.",
  revoked: "This invitation was revoked.",
  already_used: "This invitation was already used by another account.",
  email_mismatch:
    "This invitation was issued for a different email address. Sign in with the invited address.",
  already_in_organization:
    "Your account already belongs to an organization. Joining a second organization is not supported yet.",
};

/**
 * Invitation acceptance (PRD §7.1): idempotent and expiring. Requires a
 * signed-in session; accepting twice with the same account succeeds without
 * duplicating membership.
 */
export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const context = await requireUser();
  const { token } = await searchParams;
  if (!token) redirect("/app");

  const result = await acceptInvitation({
    token: token!,
    userId: context.user.id,
    userEmail: context.user.email,
  });

  return (
    <>
      <div className="wp-topbar">
        <h1>Organization invitation</h1>
      </div>
      {result.ok ? (
        <div className="wp-card" style={{ maxWidth: 640 }}>
          <h2>{result.alreadyAccepted ? "You are already a member" : "Invitation accepted"}</h2>
          <p role="status">
            Your account has the <strong>{result.membership.role}</strong> role in this
            organization.
          </p>
          <p>
            <Link className="button venture-button" href="/app">
              Go to the dashboard
            </Link>
          </p>
        </div>
      ) : (
        <div className="wp-card" style={{ maxWidth: 640 }}>
          <h2>Invitation could not be accepted</h2>
          <p className="form-error" role="alert">
            {ERROR_MESSAGES[result.error] ?? "Something went wrong."}
          </p>
          <p>
            <Link href="/app">Back to the dashboard</Link>
          </p>
        </div>
      )}
    </>
  );
}
