import Link from "next/link";
import { requireOnboarded } from "@/lib/server/session";
import { startUploadPathAction } from "./actions";

/**
 * Path chooser (Intake Studio §4.1, FR-INT-1). The two paths are
 * composable, not exclusive — most complete records use both. Path B's
 * adaptive interview ships in M2; until then it routes to the guided form
 * intake, which writes to the same record and ledgers (no forked model).
 */
export default async function StartInventionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
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
        creates the invention record and everything lands in the same Problem/Solution ledger.
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
            {error === "invalid_name" && (
              <p className="form-error" role="alert">
                Give the invention a working name (2–300 characters). You can change it anytime.
              </p>
            )}
            <div className="field">
              <label htmlFor="working-name">Working name for this invention</label>
              <input
                id="working-name"
                name="workingName"
                type="text"
                required
                minLength={2}
                maxLength={300}
                placeholder="e.g. Self-sealing irrigation valve"
              />
            </div>
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
          <p>
            Work through structured questions that capture the problem, your solution, components,
            contributors, timeline, and ownership facts. The adaptive interview (question-by-
            question, shaped by what you have already provided) arrives in the next milestone;
            today this is the guided form intake — it writes to the same record.
          </p>
          <p>
            <Link className="button venture-button" href="/wepatent/app/inventions/new">
              Start the guided questions
            </Link>
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
