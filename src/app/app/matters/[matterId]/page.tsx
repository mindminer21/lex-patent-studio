import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdapters } from "@/lib/adapters";
import {
  DraftWatermark,
  ProvenanceBadge,
  ReviewBadge,
  RunStateBadge,
  TierBadge,
  VerificationBadge,
} from "@/components/workspace/badges";
import { Composer } from "./Composer";
import { CancelRunButton, RunAutoRefresh } from "./RunControls";
import { DEADLINE_DISCLAIMER } from "@/lib/domain/schemas";
import { formatUsd } from "@/lib/domain/pricing";
import { isTerminalRunState, runProgress } from "@/lib/domain/run-state";

const paneHeading =
  "m-0 mb-2 text-[0.68rem] font-bold uppercase tracking-[0.13em] text-[var(--muted)]";

export default async function MatterWorkspace({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;
  const org = session.organizationId;

  const matter = await adapters.data.getMatter(org, matterId);
  if (!matter) notFound();

  const [facts, sources, runs, documents, reviewItems, audit, wallet, deadlines] =
    await Promise.all([
      adapters.data.listFacts(org, matterId),
      adapters.data.listSources(org, matterId),
      adapters.data.listRuns(org, matterId),
      adapters.data.listDocuments(org, matterId),
      adapters.data.listReviewItems(org, { matterId }),
      adapters.data.listAuditEvents(org, { matterId, limit: 6 }),
      adapters.billing.getWalletBalanceUsd(org),
      adapters.data.listDeadlines(org),
    ]);

  const matterDeadlines = deadlines.filter((d) => d.matterId === matterId);
  const approvedFacts = facts.filter((f) => f.provenance === "counsel_reviewed").length;
  const allFlags = documents.flatMap((d) =>
    d.sections.flatMap((s) => s.flags.map((flag) => ({ doc: d.title, flag }))),
  );
  const reviewFlags = reviewItems.flatMap((i) =>
    i.unresolvedFlags.map((flag) => ({ doc: i.documentTitle, flag })),
  );

  const hasActiveRuns = runs.some((r) => !isTerminalRunState(r.state));

  return (
    <div>
      <RunAutoRefresh active={hasActiveRuns} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[290px_minmax(0,1fr)_290px]">
        {/* LEFT PANE — facts, sources, workflow state */}
        <div className="min-w-0 space-y-5">
          <section aria-label="Workflow state" className="border border-[var(--line)] bg-[var(--white)] p-3">
            <h2 className={paneHeading}>Workflow state</h2>
            {runs.length === 0 ? (
              <p className="m-0 text-[0.8rem] text-[var(--muted)]">
                No runs yet. Composed runs appear here with stage progress and
                tier labels.
              </p>
            ) : (
              <ul className="m-0 list-none space-y-3 p-0">
                {runs.map((run) => (
                  <li key={run.id} className="border-b border-[var(--line)] pb-2 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <RunStateBadge state={run.state} />
                      <TierBadge tier={run.tier} compact />
                    </div>
                    <p className="mb-1 mt-1.5 text-[0.82rem] font-semibold leading-snug">
                      {run.deliverableType}
                    </p>
                    <div
                      role="progressbar"
                      aria-valuenow={Math.round(runProgress(run.state) * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Run progress: ${run.state}`}
                      className="h-1.5 w-full bg-[#e6e2d6]"
                    >
                      <div
                        className="h-full bg-[var(--forest)]"
                        style={{ width: `${runProgress(run.state) * 100}%` }}
                      />
                    </div>
                    <p className="mb-0 mt-1 text-[0.7rem] text-[var(--muted)]">
                      {run.workflowVersion} · {run.modelId}
                    </p>
                    {!isTerminalRunState(run.state) && (
                      <CancelRunButton runId={run.id} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Fact ledger" className="border border-[var(--line)] bg-[var(--white)] p-3">
            <h2 className={paneHeading}>
              Fact ledger · {approvedFacts}/{facts.length} approved
            </h2>
            {facts.length === 0 ? (
              <p className="m-0 text-[0.8rem] text-[var(--muted)]">
                No facts yet. Drafting is blocked until a practitioner approves
                a fact baseline.
              </p>
            ) : (
              <ul className="m-0 list-none space-y-2.5 p-0">
                {facts.map((fact) => (
                  <li key={fact.id} className="border-b border-[var(--line)] pb-2 last:border-b-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[0.66rem] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                        {fact.category}
                      </span>
                      <ProvenanceBadge state={fact.provenance} />
                    </div>
                    <p className="mb-0 mt-1 text-[0.8rem] leading-snug">{fact.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Sources" className="border border-[var(--line)] bg-[var(--white)] p-3">
            <h2 className={paneHeading}>Sources</h2>
            {sources.length === 0 ? (
              <p className="m-0 text-[0.8rem] text-[var(--muted)]">No sources uploaded.</p>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {sources.map((src) => (
                  <li key={src.id} className="text-[0.8rem] leading-snug">
                    <strong>{src.title}</strong>
                    <span className="block text-[0.7rem] text-[var(--muted)]">
                      {src.kind.replaceAll("_", " ")} · {src.extractionState}
                      {src.pageCount ? ` · ${src.pageCount} pp.` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {matterDeadlines.length > 0 && (
            <section aria-label="Observed dates" className="border border-[#b9a76a] bg-[#f4ecd2] p-3">
              <h2 className={paneHeading}>Observed dates</h2>
              <ul className="m-0 list-none space-y-2 p-0">
                {matterDeadlines.map((d) => (
                  <li key={d.id} className="text-[0.78rem] leading-snug">
                    <strong>{d.observedDate}</strong> — {d.windowKind}
                  </li>
                ))}
              </ul>
              <p className="mb-0 mt-2 text-[0.7rem] font-semibold text-[#5d4a12]">
                {DEADLINE_DISCLAIMER}
              </p>
            </section>
          )}
        </div>

        {/* CENTER PANE — composer + work product */}
        <div className="min-w-0 space-y-5">
          <Composer matterId={matterId} walletBalanceUsd={wallet} />

          <section aria-label="Work product">
            <h2 className={paneHeading}>Work product</h2>
            {documents.length === 0 ? (
              <p className="border border-dashed border-[var(--line)] bg-[var(--white)] p-4 text-[0.85rem] text-[var(--muted)]">
                No work product yet. Every generated document appears here
                labeled <strong>DRAFT — NOT REVIEWED</strong> with its work
                tier until a practitioner records an approval.
              </p>
            ) : (
              <div className="space-y-4">
                {documents.map((doc) => (
                  <article key={doc.id} className="border border-[var(--line)] bg-[var(--white)]">
                    <header className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2.5">
                      <DraftWatermark reviewState={doc.reviewState} />
                      <TierBadge tier={doc.tier} compact />
                      <VerificationBadge state={doc.verificationState} />
                      <span className="ml-auto text-[0.7rem] text-[var(--muted)]">
                        v{doc.version} · hash {doc.versionHash}
                      </span>
                    </header>
                    <div className="px-4 py-3">
                      <h3 className="m-0 text-lg font-medium" style={{ fontFamily: "Georgia, serif" }}>
                        {doc.title}
                      </h3>
                      {doc.sections.map((section) => (
                        <div key={section.heading} className="mt-3">
                          <h4 className="m-0 text-[0.95rem] font-bold">{section.heading}</h4>
                          <p className="mb-0 mt-1 text-[0.88rem] leading-relaxed text-[#333a35]">
                            {section.body}
                          </p>
                          {section.flags.map((flag) => (
                            <p
                              key={flag}
                              className="mb-0 mt-2 border-l-4 border-[#b9a76a] bg-[#f4ecd2] px-2 py-1.5 text-[0.78rem] text-[#5d4a12]"
                            >
                              {flag}
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* RIGHT PANE — citations, model, cost, warnings, review state */}
        <div className="min-w-0 space-y-5">
          <section aria-label="Review state" className="border border-[var(--line)] bg-[var(--white)] p-3">
            <h2 className={paneHeading}>Review state</h2>
            {reviewItems.length === 0 ? (
              <p className="m-0 text-[0.8rem] text-[var(--muted)]">
                Nothing awaiting review in this matter.
              </p>
            ) : (
              <ul className="m-0 list-none space-y-3 p-0">
                {reviewItems.map((item) => (
                  <li key={item.id} className="border-b border-[var(--line)] pb-2 last:border-b-0">
                    <div className="flex flex-wrap gap-1.5">
                      <TierBadge tier={item.tier} compact />
                      <ReviewBadge state={item.state} />
                    </div>
                    <p className="mb-0 mt-1 text-[0.8rem] font-semibold leading-snug">
                      {item.documentTitle}
                    </p>
                    <p className="mb-0 mt-0.5 text-[0.7rem] text-[var(--muted)]">
                      due {item.dueDate ?? "—"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mb-0 mt-3 text-right">
              <Link href="/app/review-queue" className="text-[0.8rem] font-bold underline underline-offset-4">
                Decide in review queue →
              </Link>
            </p>
          </section>

          <section aria-label="Model and cost" className="border border-[var(--line)] bg-[var(--white)] p-3">
            <h2 className={paneHeading}>Model · cost</h2>
            {runs.length === 0 ? (
              <p className="m-0 text-[0.8rem] text-[var(--muted)]">No runs recorded.</p>
            ) : (
              <ul className="m-0 list-none space-y-2.5 p-0">
                {runs.map((run) => (
                  <li key={run.id} className="text-[0.78rem] leading-snug">
                    <strong>{run.modelId}</strong> ({run.modelTier})
                    <span className="block text-[var(--muted)]">
                      est. {formatUsd(run.estimatedChargeLowUsd)}–{formatUsd(run.estimatedChargeHighUsd)}
                      {run.actualChargeUsd != null && ` · actual ${formatUsd(run.actualChargeUsd)}`}
                    </span>
                    <span className="block text-[var(--muted)]">
                      {run.corpusRelease} · as of {run.asOfDate}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Citations and verification" className="border border-[var(--line)] bg-[var(--white)] p-3">
            <h2 className={paneHeading}>Citations · verification</h2>
            {documents.length === 0 ? (
              <p className="m-0 text-[0.8rem] text-[var(--muted)]">
                Verification states appear per document once work product
                exists.
              </p>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {documents.map((doc) => (
                  <li key={doc.id} className="flex flex-wrap items-center gap-2 text-[0.78rem]">
                    <VerificationBadge state={doc.verificationState} />
                    <span className="min-w-0 flex-1 leading-snug">{doc.title}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mb-0 mt-2 text-[0.7rem] text-[var(--muted)]">
              A quote or citation that fails verification blocks
              &ldquo;verified&rdquo; status and flags the document.
            </p>
          </section>

          <section aria-label="Warnings" className="border border-[var(--line)] bg-[var(--white)] p-3">
            <h2 className={paneHeading}>Warnings</h2>
            {allFlags.length + reviewFlags.length === 0 ? (
              <p className="m-0 text-[0.8rem] text-[var(--muted)]">No unresolved flags.</p>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {[...reviewFlags, ...allFlags].map(({ doc, flag }, i) => (
                  <li key={`${doc}-${i}`} className="border-l-4 border-[#a05252] bg-[#f6dcdc] px-2 py-1.5 text-[0.75rem] leading-snug text-[#7c1f1f]">
                    <strong>{doc}:</strong> {flag}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Recent activity" className="border border-[var(--line)] bg-[var(--white)] p-3">
            <h2 className={paneHeading}>Recent activity (audit)</h2>
            {audit.length === 0 ? (
              <p className="m-0 text-[0.8rem] text-[var(--muted)]">No recorded events.</p>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {audit.map((event) => (
                  <li key={event.id} className="text-[0.72rem] leading-snug text-[var(--muted)]">
                    <strong className="text-[var(--ink)]">{event.action}</strong>{" "}
                    · {new Date(event.createdAt).toISOString().slice(0, 16).replace("T", " ")}Z
                    <span className="block">{event.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
