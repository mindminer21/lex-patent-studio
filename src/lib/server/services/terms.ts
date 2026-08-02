import "server-only";

import {
  acceptanceInputSchema,
  categorizeUserAgent,
  validateAcceptance,
  type AcknowledgementKey,
} from "@/lib/wepatent/domain/clickwrap";
import { getAdapters } from "../adapters";
import { requestIpHash, requestUserAgent } from "../session";
import type { TermsAcceptanceRecord } from "../adapters/types";

export type AcceptTermsResult =
  | { ok: true; acceptance: TermsAcceptanceRecord }
  | { ok: false; error: string };

/**
 * Records a versioned clickwrap acceptance server-side (PRD §7.2). Client
 * state alone is never sufficient — this is the authoritative record, and
 * the local adapter stores it append-only.
 */
export async function acceptCurrentTerms(params: {
  userId: string;
  organizationId: string;
  termsVersion: string;
  acknowledgedKeys: string[];
}): Promise<AcceptTermsResult> {
  const parsed = acceptanceInputSchema.safeParse({
    termsVersion: params.termsVersion,
    acknowledgedKeys: params.acknowledgedKeys,
  });
  if (!parsed.success) {
    return { ok: false, error: "invalid_input" };
  }
  const validation = validateAcceptance(parsed.data);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const { data } = getAdapters();
  const acceptance = await data.recordTermsAcceptance({
    userId: params.userId,
    organizationId: params.organizationId,
    termsVersion: parsed.data.termsVersion,
    acknowledgedKeys: parsed.data.acknowledgedKeys as AcknowledgementKey[],
    ipHash: await requestIpHash(),
    userAgentCategory: categorizeUserAgent(await requestUserAgent()),
  });

  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.userId,
    action: "terms.accepted",
    target: acceptance.id,
    meta: { termsVersion: acceptance.termsVersion },
  });

  return { ok: true, acceptance };
}
