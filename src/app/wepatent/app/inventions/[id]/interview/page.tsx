import Link from "next/link";
import { notFound } from "next/navigation";
import InterviewPanel from "@/components/wepatent/InterviewPanel";
import { getAdapters } from "@/lib/server/adapters";
import { getInterviewView } from "@/lib/server/services/interview";
import { requireOnboarded } from "@/lib/server/session";
import { applyProposedEditAction, dismissProposedEditAction } from "./actions";

/**
 * Adaptive invention interview (Intake Studio §6) as a SINGLE-THREAD CHAT
 * (Jeff's direction, 2026-08-05). This route is the conversation and
 * nothing else: the compliance banner, the record's name, and the thread.
 *
 * There is no "start the interview" landing wall — arriving with no session
 * auto-creates one and shows the first question (the client component does
 * this on mount, so a link prefetch can never spend money by drafting a
 * question nobody asked for).
 *
 * The components box on the right is GATED by `shouldShowComponentsPanel`
 * and renders nothing until the record can actually distill components.
 * The coverage meter and the full P/S ledger live in the Studio — this
 * surface does not duplicate them.
 *
 * The header disclaimer is FIXED interview-surface copy (§6.4).
 */
export default async function InterviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireOnboarded();
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, id);
  if (!invention) notFound();

  const sessions = await data.listInterviewSessions(context.organization.id, id);
  const mySession = [...sessions]
    .reverse()
    .find((session) => session.userId === context.user.id);
  const initialView = mySession
    ? await getInterviewView(context.organization.id, mySession.id)
    : null;

  return (
    <>
      {/* Fixed interview-surface disclaimer (§6.4) — do not reword without
          counsel approval (feature PRD §15.5). Legal invariant 4: it stays
          visible on this surface. */}
      <div className="wp-boundary-banner" data-testid="interview-disclaimer">
        wepatent collects facts about your invention; it does not give legal advice. Questions
        about whether or when to file, patentability, or claim breadth are for qualified patent
        counsel. Everything below is a working draft — counsel review required.
      </div>
      <div className="wp-topbar">
        <h1>Invention interview: {invention.title}</h1>
        <Link className="button button-small" href={`/wepatent/app/inventions/${id}/studio`}>
          Open the Intake Studio
        </Link>
      </div>

      <InterviewPanel
        inventionId={id}
        initialView={initialView}
        applyProposedEdit={applyProposedEditAction}
        dismissProposedEdit={dismissProposedEditAction}
      />
    </>
  );
}
