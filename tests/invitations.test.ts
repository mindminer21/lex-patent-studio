import { beforeEach, describe, expect, it } from "vitest";
import { getAdapters } from "@/lib/server/adapters";
import { LocalDataAdapter } from "@/lib/server/adapters/local/store";
import {
  acceptInvitation,
  createInvitation,
  invitationStatus,
  revokeInvitation,
} from "@/lib/server/services/invitations";
import { createOrganizationForUser } from "@/lib/server/services/orgs";

async function setup() {
  LocalDataAdapter.reset();
  const { data } = getAdapters();
  const owner = await data.createUser({ email: "owner@example.test", displayName: "Owner" });
  const org = await createOrganizationForUser(owner.id, "Invite Test Org");
  return { data, owner, org };
}

describe("invitations (PRD §7.1: idempotent, expiring)", () => {
  beforeEach(() => LocalDataAdapter.reset());

  it("owner invites; member cannot; counsel roles are impossible", async () => {
    const { owner, org } = await setup();
    const ok = await createInvitation({
      organizationId: org.id,
      inviterUserId: owner.id,
      inviterRole: "owner",
      input: { email: "new@example.test", role: "member" },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.token).not.toBeNull();

    const memberAttempt = await createInvitation({
      organizationId: org.id,
      inviterUserId: owner.id,
      inviterRole: "member",
      input: { email: "x@example.test", role: "member" },
    });
    expect(memberAttempt).toEqual({ ok: false, error: "forbidden" });

    const counselAttempt = await createInvitation({
      organizationId: org.id,
      inviterUserId: owner.id,
      inviterRole: "owner",
      input: { email: "y@example.test", role: "counsel_attorney" },
    });
    expect(counselAttempt).toEqual({ ok: false, error: "invalid_input" });
    const ownerRoleAttempt = await createInvitation({
      organizationId: org.id,
      inviterUserId: owner.id,
      inviterRole: "owner",
      input: { email: "z@example.test", role: "owner" },
    });
    expect(ownerRoleAttempt).toEqual({ ok: false, error: "invalid_input" });
  });

  it("re-inviting the same email returns the pending invitation without duplicating", async () => {
    const { data, owner, org } = await setup();
    const first = await createInvitation({
      organizationId: org.id,
      inviterUserId: owner.id,
      inviterRole: "owner",
      input: { email: "dup@example.test", role: "viewer" },
    });
    const second = await createInvitation({
      organizationId: org.id,
      inviterUserId: owner.id,
      inviterRole: "owner",
      input: { email: "dup@example.test", role: "viewer" },
    });
    expect(second.ok && second.existing).toBe(true);
    if (first.ok && second.ok) {
      expect(second.invitation.id).toBe(first.invitation.id);
      expect(second.token).toBeNull();
    }
    expect(await data.listInvitations(org.id)).toHaveLength(1);
  });

  it("acceptance creates exactly one membership and is idempotent for the same user", async () => {
    const { data, owner, org } = await setup();
    const invited = await createInvitation({
      organizationId: org.id,
      inviterUserId: owner.id,
      inviterRole: "owner",
      input: { email: "joiner@example.test", role: "member" },
    });
    if (!invited.ok || !invited.token) throw new Error("invite failed");

    const joiner = await data.createUser({
      email: "joiner@example.test",
      displayName: "Joiner",
    });
    const first = await acceptInvitation({
      token: invited.token,
      userId: joiner.id,
      userEmail: joiner.email,
    });
    expect(first.ok && !first.alreadyAccepted).toBe(true);

    const second = await acceptInvitation({
      token: invited.token,
      userId: joiner.id,
      userEmail: joiner.email,
    });
    expect(second.ok && second.alreadyAccepted).toBe(true);

    const memberships = await data.getMembershipsForUser(joiner.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe("member");

    // A different account cannot reuse the token.
    const thief = await data.createUser({ email: "thief@example.test", displayName: "Thief" });
    const stolen = await acceptInvitation({
      token: invited.token,
      userId: thief.id,
      userEmail: thief.email,
    });
    expect(stolen).toEqual({ ok: false, error: "already_used" });
  });

  it("rejects wrong email, bad tokens, revoked and expired invitations", async () => {
    const { data, owner, org } = await setup();
    const invited = await createInvitation({
      organizationId: org.id,
      inviterUserId: owner.id,
      inviterRole: "owner",
      input: { email: "right@example.test", role: "member" },
    });
    if (!invited.ok || !invited.token) throw new Error("invite failed");

    const wrongPerson = await data.createUser({
      email: "wrong@example.test",
      displayName: "Wrong",
    });
    expect(
      await acceptInvitation({
        token: invited.token,
        userId: wrongPerson.id,
        userEmail: wrongPerson.email,
      }),
    ).toEqual({ ok: false, error: "email_mismatch" });
    expect(
      await acceptInvitation({
        token: "not-a-real-token",
        userId: wrongPerson.id,
        userEmail: wrongPerson.email,
      }),
    ).toEqual({ ok: false, error: "invalid_token" });

    // Revocation.
    await revokeInvitation({
      organizationId: org.id,
      invitationId: invited.invitation.id,
      actorUserId: owner.id,
      actorRole: "owner",
    });
    const right = await data.createUser({ email: "right@example.test", displayName: "Right" });
    expect(
      await acceptInvitation({
        token: invited.token,
        userId: right.id,
        userEmail: right.email,
      }),
    ).toEqual({ ok: false, error: "revoked" });

    // Expiry.
    const expiring = await createInvitation({
      organizationId: org.id,
      inviterUserId: owner.id,
      inviterRole: "owner",
      input: { email: "late@example.test", role: "member" },
    });
    if (!expiring.ok || !expiring.token) throw new Error("invite failed");
    const record = (await data.listInvitations(org.id)).find(
      (entry) => entry.id === expiring.invitation.id,
    )!;
    // Force expiry through the record's own field (local adapter object).
    record.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(invitationStatus(record)).toBe("expired");
    const late = await data.createUser({ email: "late@example.test", displayName: "Late" });
    expect(
      await acceptInvitation({ token: expiring.token, userId: late.id, userEmail: late.email }),
    ).toEqual({ ok: false, error: "expired" });
  });

  it("inviting an existing member is rejected; users in another org cannot join a second", async () => {
    const { data, owner, org } = await setup();
    expect(
      await createInvitation({
        organizationId: org.id,
        inviterUserId: owner.id,
        inviterRole: "owner",
        input: { email: "owner@example.test", role: "member" },
      }),
    ).toEqual({ ok: false, error: "already_member" });

    const invited = await createInvitation({
      organizationId: org.id,
      inviterUserId: owner.id,
      inviterRole: "owner",
      input: { email: "busy@example.test", role: "member" },
    });
    if (!invited.ok || !invited.token) throw new Error("invite failed");
    const busy = await data.createUser({ email: "busy@example.test", displayName: "Busy" });
    await createOrganizationForUser(busy.id, "Busy Own Org");
    expect(
      await acceptInvitation({ token: invited.token, userId: busy.id, userEmail: busy.email }),
    ).toEqual({ ok: false, error: "already_in_organization" });
  });
});
