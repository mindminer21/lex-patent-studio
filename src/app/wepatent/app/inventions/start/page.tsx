import Link from "next/link";
import { requireOnboarded } from "@/lib/server/session";
import { startInterviewPathAction, startUploadPathAction } from "./actions";

/**
 * Path chooser (Intake Studio §4.1, FR-INT-1).
 *
 * Friction audit decisions (Jeff, 2026-08-04):
 * - #1 DECLINED as written — the Path A/B buttons stay here rather than
 *   moving onto the dashboard, which keeps one clear "New invention" CTA.
 *   The page instead carries the minimum that still orients a first-time
 *   user: one line of framing, two buttons, one de-emphasized text link.
 * - #3 — the classic guided form stays reachable but visually secondary:
 *   a small understated text link, never a button or card.
 *
 * Records start with a neutral placeholder title — the AI proposes a
 * working title from uploads or interview answers and the user confirms it.
 */
export default async function StartInventionPage() {
  await requireOnboarded();

  return (
    <>
      <div className="wp-topbar">
        <h1>New invention</h1>
      </div>
      <div className="wp-boundary-banner">
        wepatent is not a law firm and does not provide legal advice; a record here is an invention
        disclosure, not a patent or a filing.
      </div>
      <p style={{ maxWidth: 760 }}>
        Two ways in — <strong>you can do both</strong>, and either one creates the record and starts
        the same Problem/Solution ledger.
      </p>
      <div className="wp-grid cols-2" style={{ marginTop: 18, alignItems: "stretch" }}>
        <div className="wp-card">
          <h2>Upload files</h2>
          <form action={startUploadPathAction} className="wp-form">
            <div>
              <button className="button venture-button" type="submit">
                Create record and upload files
              </button>
            </div>
          </form>
        </div>
        <div className="wp-card">
          <h2>Answer questions about your invention</h2>
          <form action={startInterviewPathAction} className="wp-form">
            <div>
              <button className="button venture-button" type="submit">
                Start the guided questions
              </button>
            </div>
          </form>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 14 }}>
        Prefer a fixed form? <Link href="/wepatent/app/inventions/new">Use the classic form intake</Link>
      </p>
      <p className="consent-legal" style={{ marginTop: 14 }}>
        Working draft — counsel review required. Nothing you create here is legal advice, and no
        attorney-client relationship is formed by using this software.
      </p>
    </>
  );
}
