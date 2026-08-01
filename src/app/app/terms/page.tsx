import Link from "next/link";
import { CURRENT_TERMS_VERSION, needsReacceptance } from "@/lib/domain/clickwrap";
import { getAdapters } from "@/lib/server/adapters";
import { requireOrg } from "@/lib/server/session";
import ClickwrapForm from "./ClickwrapForm";

export default async function TermsGatePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const context = await requireOrg();
  const { data } = getAdapters();
  const acceptance = await data.getLatestAcceptance(context.organization.id, context.user.id);
  const pending = !acceptance || needsReacceptance(acceptance.termsVersion);

  return (
    <>
      <div className="wp-topbar">
        <h1>Terms and required acknowledgements</h1>
        <span className="org">{context.organization.name}</span>
      </div>

      {!pending && acceptance ? (
        <div className="wp-card" style={{ maxWidth: 760 }}>
          <p className="venture-kicker">Accepted</p>
          <h2>You have accepted the current terms.</h2>
          <p>
            Version <strong>{acceptance.termsVersion}</strong>, accepted{" "}
            {new Date(acceptance.acceptedAt).toLocaleString()} ({acceptance.userAgentCategory}).
            If the material terms change, you will be asked to accept the new version before
            continuing substantive work.
          </p>
          <Link className="button venture-button" href="/app">
            Back to dashboard
          </Link>
        </div>
      ) : (
        <div className="wp-card" style={{ maxWidth: 860 }}>
          {acceptance && needsReacceptance(acceptance.termsVersion) && (
            <div className="wp-boundary-banner wp-banner-danger">
              The terms have changed since you accepted version {acceptance.termsVersion}. Please
              review and accept version {CURRENT_TERMS_VERSION} to continue.
            </div>
          )}
          <p className="venture-kicker">Required before substantive invention intake</p>
          <h2>Know where the software stops—and counsel begins.</h2>
          <p>
            Please read the <Link href="/wepatent/terms">Self-Service Terms</Link> (version{" "}
            {CURRENT_TERMS_VERSION}), then confirm each acknowledgement. Each one requires an
            explicit action; the Continue button stays disabled until all four are selected.
          </p>
          <ClickwrapForm error={error} />
        </div>
      )}
    </>
  );
}
