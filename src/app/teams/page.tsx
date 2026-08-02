import type { Metadata } from "next";
import { CapabilityPage } from "@/components/marketing/CapabilityPage";

export const metadata: Metadata = {
  title: "For teams — Lex Patent Studio",
  description:
    "For boutiques and in-house IP teams: nine-role seats, matter ACLs, supervised R&D contributor intake, pooled billing, and a full audit trail.",
};

export default function TeamsPage() {
  return (
    <CapabilityPage
      kicker="Audience / Teams"
      title="One workspace for the legal team — and the engineers who feed it."
      lede="Practitioners, agents, paralegals, R&D contributors, and viewers each get exactly the rights their seat implies — enforced server-side, on every request, with an audit trail your compliance function will actually use."
      rows={[
        {
          title: "Nine roles, deny-by-default",
          text: "Workflow invocation, review decisions, approvals, exports, and portfolio visibility are gated by a server-side policy table. Hiding a button is not a security model.",
        },
        {
          title: "R&D contributors, supervised",
          text: "Engineering teams run invention intake, contribute facts, upload sources, and track status inside the legal team's tenant — with generation, claim work, and legal analysis reserved to practitioner seats.",
        },
        {
          title: "Matter-level access control",
          text: "Contributor and viewer seats see only the matters shared with them. Practitioner-class roles see the tenant; nobody sees another tenant, ever.",
        },
        {
          title: "Pooled billing, visible spend",
          text: "A shared usage wallet with reservation-before-run, per-run settlement records, and spend visibility for billing admins.",
        },
      ]}
      boundary="Lex Patent Studio is for teams operating under legal supervision. An R&D team without a supervising legal function belongs in wepatent — a separate product with its own boundaries."
      next={{ href: "/pricing", label: "See Team pricing" }}
    />
  );
}
