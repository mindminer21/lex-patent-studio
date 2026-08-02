import type { Metadata } from "next";
import { getAdapters } from "@/lib/adapters";
import { can, ROLE_LABELS } from "@/lib/domain/roles";

export const metadata: Metadata = {
  title: "Team — Lex Patent Studio",
};

/**
 * /team (§8.2): members, seats, roles (FR-2). Local mode shows the synthetic
 * roster; sending invitations is an approval-gated production action
 * (PRD-wepatent §17.6 — no emails/outreach without Jeff's approval), so no
 * invite control is rendered here, only the documented seam.
 */
export default async function TeamPage() {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;

  const members = await adapters.data.listTeamMembers(session.organizationId);
  const mayManage = can(session.role, "team.manage");

  return (
    <div className="max-w-[1000px] space-y-8">
      <header>
        <h1 className="m-0 text-3xl font-medium tracking-tight" style={{ fontFamily: "Georgia, serif" }}>
          Team
        </h1>
        <p className="mt-1 mb-0 max-w-[760px] text-[0.92rem] text-[var(--muted)]">
          Seats and roles for {session.organizationName}. Rights are enforced
          server-side by the nine-role policy table — never by UI hiding.
          Contributor (R&D) seats are limited to intake, fact contribution,
          source upload, and status visibility.
        </p>
      </header>

      <section aria-labelledby="roster-heading">
        <h2 id="roster-heading" className="text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Members
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse bg-[var(--white)] text-[0.88rem]">
            <thead>
              <tr className="border-b border-[var(--ink)] text-left text-[0.7rem] uppercase tracking-[0.1em]">
                <th className="p-2">Member</th>
                <th className="p-2">Role</th>
                <th className="p-2">MFA</th>
                <th className="p-2">Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.userId} className="border-b border-[var(--line)] align-top">
                  <td className="p-2">
                    <strong>{member.displayName}</strong>
                    <span className="block text-[0.78rem] text-[var(--muted)]">
                      {member.email}
                    </span>
                  </td>
                  <td className="p-2">{ROLE_LABELS[member.role]}</td>
                  <td className="p-2">
                    {member.mfaEnrolled ? (
                      <span className="font-bold text-[#2f4a16]">Enrolled</span>
                    ) : (
                      <span className="text-[var(--muted)]">Not enrolled</span>
                    )}
                    {(member.role === "owner" || member.role === "practitioner_admin") &&
                      !member.mfaEnrolled && (
                        <span className="block text-[0.72rem] font-semibold text-[#7c1f1f]">
                          Required at GA (FR-1)
                        </span>
                      )}
                  </td>
                  <td className="p-2 whitespace-nowrap">{member.joinedAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="invite-heading">
        <h2 id="invite-heading" className="text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Invitations
        </h2>
        <p className="m-0 border border-[var(--line)] bg-[var(--white)] p-4 text-[0.88rem] leading-relaxed">
          {mayManage
            ? "Your role can manage seats, but sending invitations requires email delivery — an approval-gated production action (PRD-wepatent §17.6). "
            : "Seat management requires an owner or practitioner-admin role. "}
          In production, invitations are idempotent, expire, and record
          server-side acceptance; contributor invitations are clearly labeled
          as non-practitioner seats (PRD §9.1). Nothing is sent from this
          environment.
        </p>
      </section>
    </div>
  );
}
