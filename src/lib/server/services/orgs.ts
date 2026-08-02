import "server-only";

import { z } from "zod";
import { getAdapters } from "../adapters";
import { seedSyntheticInvention } from "../adapters/local/seed";
import type { OrganizationRecord } from "../adapters/types";

export const organizationNameSchema = z.string().trim().min(2).max(120);

/** Synthetic promotional wallet credit for local mode: $25.00. */
const LOCAL_PROMO_CREDIT_CENTS = 2_500;

/**
 * Creates an organization with owner membership, default retention, a wallet
 * with a synthetic promotional credit, and a seeded SYNTHETIC invention
 * record (PRD §7.1; single logical transaction in the local adapter).
 */
export async function createOrganizationForUser(
  userId: string,
  name: string,
): Promise<OrganizationRecord> {
  const { data } = getAdapters();
  const parsedName = organizationNameSchema.parse(name);
  const organization = await data.createOrganization({ name: parsedName, ownerUserId: userId });

  await data.saveWallet({
    organizationId: organization.id,
    balanceCents: LOCAL_PROMO_CREDIT_CENTS,
    reservedCents: 0,
  });
  await data.appendLedgerEntry({
    organizationId: organization.id,
    kind: "promo_credit",
    amountCents: LOCAL_PROMO_CREDIT_CENTS,
    reservationId: null,
    note: "Synthetic local-mode promotional credit (no real money).",
  });

  await seedSyntheticInvention(data, organization.id);

  await data.appendAuditEvent({
    organizationId: organization.id,
    actor: userId,
    action: "organization.created",
    target: organization.id,
    meta: { name: parsedName },
  });

  return organization;
}
