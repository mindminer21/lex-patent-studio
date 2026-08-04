import Link from "next/link";
import { requireOnboarded } from "@/lib/server/session";
import { startInterviewPathAction, startUploadPathAction } from "./actions";

/**
 * Path chooser (Intake Studio §4.1, FR-INT-1). The two paths are
 * composable, not exclusive — most complete records use both. Path B is
 * the M2 adaptive Slusky-guided interview; the classic form intake remains
 * reachable and writes to the same record and ledgers (no forked model).
 * Records start with a neutral placeholder title — the AI proposes a
 * working title from your uploads or interview answers, and you confirm it.
 */
export default async function StartInventionPage() {
  await requireOnboarded();

  return (
    <>
      <div className="wp-topbar">
        <h1>New invention</h1>
      </div>
      <div className="wp-boundary-banner">
        Start a patent-ready disclosure. wepatent organizes facts and prepares working materials —
        it is not a law firm, does not provide legal advice, and a record here is an invention
        disclosure, not a patent or a filing.
      </div>
      <p style={{ maxWidth: 760 }}>
        Two ways in — <strong>you can do both; most complete records use both.</strong> Either path
        creates the invention record and everything lands in the same Problem/Solution ledger. No
        need to name anything yet: a working title is proposed from what you upload or say, and
        you confirm or change it anytime.
      </p>
      <div className="wp-grid cols-2" style={{ marginTop: 18, alignItems: "stretch" }}>
        <div className="wp-card">
          <p className="venture-kicker">Path A</p>
          <h2>Upload files</h2>
          <p>
            Drop in documents, images, schematics, photos, presentations, spreadsheets, or 3D
            models. AI interprets what it can into a structured starting point — every
            interpretation is a labeled proposal until you confirm it, and files we cannot
            interpret are stored honestly and flagged.
          </p>
          <form action={startUploadPathAction} className="wp-form">
            <div>
              <button className="button venture-button" type="submit">
                Create record and upload files
              </button>
            </div>
          </form>
        </div>
        <div className="wp-card">
          <p className="venture-kicker">Path B</p>
          <h2>Answer questions about your invention</h2>
          <form action={startInterviewPathAction} className="wp-form">
            <div>
              <button className="button venture-button" type="submit">
                Start the guided questions
              </button>
            </div>
          </form>
          <p className="hint">
            Prefer a fixed form?{" "}
            <Link href="/wepatent/app/inventions/new">Use the classic form intake</Link>
          </p>
        </div>
      </div>
      <p className="consent-legal" style={{ marginTop: 18 }}>
        Working draft — counsel review required. Nothing you create here is legal advice, and no
        attorney-client relationship is formed by using this software.
      </p>
    </>
  );
}
