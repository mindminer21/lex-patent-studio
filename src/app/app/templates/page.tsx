import type { Metadata } from "next";
import { getAdapters } from "@/lib/adapters";
import { can } from "@/lib/domain/roles";
import {
  PLAYBOOK_CATEGORY_LABELS,
  STYLE_KIND_LABELS,
  styleProfileVersionLabel,
} from "@/lib/domain/styles";
import { CreateStyleProfileForm, PublishPlaybookForm } from "./TemplateForms";

export const metadata: Metadata = {
  title: "Templates — Lex Patent Studio",
};

/**
 * /app/templates (PRD §8.2): style profiles and firm playbooks (§5.4).
 * Playbook reads are professional-lane only; contributor seats never see
 * this surface's content (server-enforced in the adapter/endpoints too).
 */
export default async function TemplatesPage() {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;

  const canReadPlaybook = can(session.role, "knowledge.search");
  const canManageStyles = can(session.role, "styles.manage");
  const canPublish = can(session.role, "playbook.publish");

  const profiles = await adapters.data.listStyleProfiles(session.organizationId);
  const playbook = canReadPlaybook
    ? await adapters.data.listPlaybookEntries(session.organizationId)
    : null;

  return (
    <div className="max-w-[1200px] space-y-10">
      <header>
        <h1 className="m-0 text-3xl font-medium tracking-tight" style={{ fontFamily: "Georgia, serif" }}>
          Templates
        </h1>
        <p className="mt-1 mb-0 max-w-[760px] text-[0.92rem] text-[var(--muted)]">
          Tenant style profiles applied to all generation, and the firm
          playbook — published entries with reviewer identity, timestamps,
          and an immutable hash chain. Nothing here ever crosses tenants.
        </p>
      </header>

      <section aria-labelledby="styles-heading" className="space-y-4">
        <h2 id="styles-heading" className="m-0 text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Style profiles
        </h2>
        {profiles.length === 0 ? (
          <p className="border border-dashed border-[var(--line)] bg-[var(--white)] p-4 text-[0.9rem] text-[var(--muted)]">
            No style profiles yet — the platform neutral default applies until
            one is created.
          </p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {profiles.map((profile) => (
              <li key={profile.id} className="border border-[var(--line)] bg-[var(--white)] p-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <strong className="text-[0.95rem]">
                    {styleProfileVersionLabel(profile)}
                  </strong>
                  <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                    {STYLE_KIND_LABELS[profile.kind]}
                  </span>
                  {profile.platformDefault && (
                    <span className="border border-[#7d94ad] bg-[#e2ebf3] px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[#2c4763]">
                      Platform default
                    </span>
                  )}
                </div>
                <ol className="mb-0 mt-2 space-y-1 pl-5 text-[0.85rem]">
                  {profile.rules.map((rule, i) => (
                    <li key={i}>{rule}</li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
        {canManageStyles ? (
          <CreateStyleProfileForm />
        ) : (
          <p className="text-[0.8rem] text-[var(--muted)]">
            Your seat can view profiles; creating them requires a practitioner
            role (styles.manage).
          </p>
        )}
      </section>

      <section aria-labelledby="playbook-heading" className="space-y-4">
        <h2 id="playbook-heading" className="m-0 text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Firm playbook
        </h2>
        {!canReadPlaybook || !playbook ? (
          <p className="border border-[var(--line)] bg-[var(--white)] p-4 text-[0.9rem]">
            Playbook content is restricted to professional-lane seats. Your
            role ({session.role}) covers intake, fact contribution, source
            upload, and status visibility only.
          </p>
        ) : (
          <>
            <p
              className={`m-0 border p-2 text-[0.8rem] font-semibold ${
                playbook.chain.ok
                  ? "border-[#5f7d4f] bg-[#e2eecd] text-[#2f4a16]"
                  : "border-[#a05252] bg-[#f6dcdc] text-[#7c1f1f]"
              }`}
            >
              Hash chain: {playbook.chain.ok ? "intact" : "BROKEN"} —{" "}
              {playbook.chain.checkedCount} entr
              {playbook.chain.checkedCount === 1 ? "y" : "ies"} verified on read
              {playbook.chain.ok
                ? "."
                : ` (broken at ${playbook.chain.brokenAtId}: ${playbook.chain.reason})`}
            </p>
            {playbook.entries.length === 0 ? (
              <p className="border border-dashed border-[var(--line)] bg-[var(--white)] p-4 text-[0.9rem] text-[var(--muted)]">
                No playbook entries yet. The first publication chains to the
                genesis marker.
              </p>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {playbook.entries.map((entry) => (
                  <li key={entry.id} className="border border-[var(--line)] bg-[var(--white)] p-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <strong className="text-[0.95rem]">{entry.title}</strong>
                      <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                        {PLAYBOOK_CATEGORY_LABELS[entry.category]}
                      </span>
                    </div>
                    <p className="mt-1 mb-1 text-[0.88rem]">{entry.body}</p>
                    <p className="m-0 text-[0.72rem] text-[var(--muted)]">
                      Published {entry.publishedAt.slice(0, 10)} by{" "}
                      {entry.publishedBy} ({entry.publishedByRole}) · content
                      sha256 {entry.contentSha256.slice(0, 12)}… · entry hash{" "}
                      {entry.entryHash.slice(0, 12)}…
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {canPublish ? (
              <PublishPlaybookForm />
            ) : (
              <p className="text-[0.8rem] text-[var(--muted)]">
                Publishing requires a practitioner role (playbook.publish).
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
