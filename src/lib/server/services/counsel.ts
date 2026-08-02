import "server-only";

import { z } from "zod";
import {
  applyTransition,
  type CounselActor,
  type CounselRequestAction,
} from "@/lib/domain/counsel-request";
import type { Role } from "@/lib/domain/roles";
import { getAdapters } from "../adapters";
import type { CounselRequestRecord, Id } from "../adapters/types";

/**
 * Limited conflict-intake fields only (PRD §7.6): no substantive private
 * invention package is disclosed to counsel before conflict-intake rules
 * permit it. The request references an invention by id but does not copy
 * its contents.
 */
export const counselRequestInputSchema = z.object({
  inventionId: z.string().min(1).nullable(),
  requestSummary: z.string().trim().min(10).max(2_000),
  adverseParties: z.string().trim().max(2_000).default(""),
  jurisdiction: z.string().trim().min(2).max(200),
  contactEmail: z.email(),
});

export type CreateCounselRequestResult =
  | { ok: true; request: CounselRequestRecord }
  | { ok: false; error: "invalid_input" };

export async function createCounselRequest(params: {
  organizationId: Id;
  userId: Id;
  input: unknown;
}): Promise<CreateCounselRequestResult> {
  const parsed = counselRequestInputSchema.safeParse(params.input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const { data } = getAdapters();
  const request = await data.createCounselRequest({
    organizationId: params.organizationId,
    createdByUserId: params.userId,
    inventionId: parsed.data.inventionId,
    requestSummary: parsed.data.requestSummary,
    adverseParties: parsed.data.adverseParties,
    jurisdiction: parsed.data.jurisdiction,
    contactEmail: parsed.data.contactEmail,
  });
  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.userId,
    action: "counsel_request.created",
    target: request.id,
    meta: { state: request.state },
  });
  return { ok: true, request };
}

export type CounselActionResult =
  | { ok: true; request: CounselRequestRecord }
  | {
      ok: false;
      error:
        | "not_found"
        | "unknown_action"
        | "invalid_from_state"
        | "actor_not_allowed"
        | "evidence_required";
    };

/**
 * Applies a counsel-request transition through the domain state machine.
 * Every transition is recorded as an append-only event. Guards guarantee
 * that ordinary user actions cannot skip states and that only counsel roles
 * move counsel-side states (PRD §7.6).
 */
export async function performCounselAction(params: {
  organizationId: Id;
  requestId: Id;
  action: CounselRequestAction;
  actor: CounselActor;
  actorUserId: Id;
  actorRole: Role;
  evidenceRef?: string;
}): Promise<CounselActionResult> {
  const { data } = getAdapters();
  const request = await data.getCounselRequest(params.organizationId, params.requestId);
  if (!request) return { ok: false, error: "not_found" };

  const result = applyTransition(request.state, params.action, params.actor, {
    evidenceRef: params.evidenceRef,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const updated = await data.updateCounselRequestState(
    params.organizationId,
    params.requestId,
    result.next,
  );
  if (!updated) return { ok: false, error: "not_found" };

  await data.appendCounselRequestEvent({
    organizationId: params.organizationId,
    requestId: params.requestId,
    fromState: request.state,
    toState: result.next,
    action: params.action,
    actorRole: params.actorRole,
    evidenceRef: params.evidenceRef ?? null,
  });
  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.actorUserId,
    action: `counsel_request.${params.action}`,
    target: params.requestId,
    meta: { from: request.state, to: result.next, actorRole: params.actorRole },
  });

  return { ok: true, request: updated };
}
