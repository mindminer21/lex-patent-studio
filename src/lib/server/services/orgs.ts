import "server-only";

import { z } from "zod";
import { can, type Role } from "@/lib/wepatent/domain/roles";
import { getAdapters } from "../adapters";
import { seedSyntheticInvention } from "../adapters/local/seed";
import type { OrganizationRecord } from "../adapters/types";

export const organizationNameSchema = z.string().trim().min(2).max(120);

/** Synthetic promotional wallet credit for local mode: $25.00. */
const LOCAL_PROMO_CREDIT_CENTS = 2_500;

/** Fallback when an email local-part yields nothing human-readable. */
export const FALLBACK_ORGANIZATION_NAME = "My workspace";

/**
 * Placeholder organization name for the auto-created first organization
 * (friction audit candidate 5; design rule "minimal human input"). Derived
 * from the email local-part because it reads like a real workspace name
 * ("jeff@…" → "Jeff's workspace") instead of a generic label; purely
 * numeric segments and separators are dropped so
 * "founder-1754300000@example.test" still becomes "Founder's workspace".
 * The name is a PLACEHOLDER: it is editable in Settings (autosaving field)
 * and carries no tenancy meaning.
 */
export function defaultOrganizationName(email: string): string {
  const localPart = email.split("@")[0] ?? "";
  const words = localPart
    .split(/[^a-zA-Z0-9]+/)
    .filter((segment) => segment.length > 0 && !/^\d+$/.test(segment))
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .slice(0, 4);
  if (words.length === 0) return FALLBACK_ORGANIZATION_NAME;
  const candidate = `${words.join(" ")}'s workspace`;
  if (candidate.length < 2 || candidate.length > 120) return FALLBACK_ORGANIZATION_NAME;
  return candidate;
}

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

/**
 * Idempotently ensures the signed-in user has an organization (friction
 * audit candidate 5): the blocking "Create your organization" step is gone
 * — the first organization is created on first sign-in with a placeholder
 * name the user can change in Settings.
 *
 * This is a UX change only. It calls the SAME transactional creation path
 * (`createOrganizationForUser`), so owner membership, default retention,
 * the wallet + promo ledger entry, the seeded synthetic record, and the
 * `organization.created` audit event are all identical. A user who already
 * belongs to an organization (including via an accepted invitation) never
 * gets a second one.
 */
export async function ensurePersonalOrganization(user: {
  id: string;
  email: string;
}): Promise<OrganizationRecord | null> {
  const { data } = getAdapters();
  const memberships = await data.getMembershipsForUser(user.id);
  if (memberships.length > 0) {
    return data.getOrganizationById(memberships[0].organizationId);
  }
  return createOrganizationForUser(user.id, defaultOrganizationName(user.email));
}

export type UpdateOrganizationNameResult =
  | { ok: true; name: string }
  | { ok: false; error: "forbidden" | "invalid_input" | "not_found" };

/**
 * Rename the organization (Settings autosave field). Owner/admin-gated via
 * `org.manage`, bounds-checked to the same 2–120 characters the creation
 * path enforces, and audited on every change.
 */
export async function updateOrganizationName(params: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  name: unknown;
}): Promise<UpdateOrganizationNameResult> {
  if (!can(params.actorRole, "org.manage")) return { ok: false, error: "forbidden" };
  const parsed = organizationNameSchema.safeParse(params.name);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const { data } = getAdapters();
  const updated = await data.updateOrganizationName(params.organizationId, parsed.data);
  if (!updated) return { ok: false, error: "not_found" };

  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: `user:${params.actorUserId}`,
    action: "organization.renamed",
    target: params.organizationId,
    meta: { name: parsed.data },
  });
  return { ok: true, name: parsed.data };
}
