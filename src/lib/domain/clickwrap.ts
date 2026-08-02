import { z } from "zod";

/**
 * Versioned clickwrap (PRD §7.2).
 *
 * Four required acknowledgements before substantive invention intake.
 * Acceptance is recorded server-side; changing the material terms bumps
 * CURRENT_TERMS_VERSION which forces re-acceptance.
 */
export const CURRENT_TERMS_VERSION = "2026-07-30.1";

export const ACKNOWLEDGEMENTS = [
  {
    key: "not_law_firm",
    text: "I understand this self-service product is not a law firm, does not provide legal advice, and does not create an attorney-client relationship.",
  },
  {
    key: "working_drafts",
    text: "I understand every generated document is an automated working draft that may be wrong, incomplete, or unsuitable for my situation.",
  },
  {
    key: "counsel_review_required",
    text: "I agree to have patent-related draft documents reviewed and approved by qualified patent counsel before filing, disclosure, legal reliance, or consequential business use.",
  },
  {
    key: "no_deadlines_or_outcomes",
    text: "I understand the service does not monitor deadlines or guarantee patentability, ownership, freedom to operate, validity, enforceability, allowance, or any result.",
  },
] as const;

export type AcknowledgementKey = (typeof ACKNOWLEDGEMENTS)[number]["key"];

export const ACKNOWLEDGEMENT_KEYS: readonly AcknowledgementKey[] = ACKNOWLEDGEMENTS.map(
  (item) => item.key,
);

export const acceptanceInputSchema = z.object({
  termsVersion: z.string().min(1),
  acknowledgedKeys: z.array(z.string()).max(16),
});

export type AcceptanceInput = z.infer<typeof acceptanceInputSchema>;

export type AcceptanceValidation =
  | { ok: true }
  | { ok: false; error: "version_mismatch" | "missing_acknowledgements"; missing?: string[] };

/** All four acknowledgements must be present and the version must be current. */
export function validateAcceptance(input: AcceptanceInput): AcceptanceValidation {
  if (input.termsVersion !== CURRENT_TERMS_VERSION) {
    return { ok: false, error: "version_mismatch" };
  }
  const provided = new Set(input.acknowledgedKeys);
  const missing = ACKNOWLEDGEMENT_KEYS.filter((key) => !provided.has(key));
  if (missing.length > 0) {
    return { ok: false, error: "missing_acknowledgements", missing };
  }
  return { ok: true };
}

/** True when the user has never accepted, or accepted an older version. */
export function needsReacceptance(acceptedVersion: string | null | undefined): boolean {
  return acceptedVersion !== CURRENT_TERMS_VERSION;
}

export type UserAgentCategory = "desktop" | "mobile" | "bot" | "unknown";

/** Coarse, privacy-preserving user-agent category for the acceptance record. */
export function categorizeUserAgent(userAgent: string | null | undefined): UserAgentCategory {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();
  if (/bot|crawler|spider|curl|wget/.test(ua)) return "bot";
  if (/mobile|android|iphone|ipad/.test(ua)) return "mobile";
  if (/mozilla|chrome|safari|firefox|edg/.test(ua)) return "desktop";
  return "unknown";
}
