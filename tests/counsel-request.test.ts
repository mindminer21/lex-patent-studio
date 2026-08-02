import { describe, expect, it } from "vitest";
import {
  applyTransition,
  availableActions,
  canTransition,
  COUNSEL_REQUEST_STATES,
  COUNSEL_REQUEST_TRANSITIONS,
  isTerminal,
  representationStatus,
  type CounselActor,
  type CounselRequestState,
} from "@/lib/wepatent/domain/counsel-request";

const owner: CounselActor = { kind: "user", role: "owner" };
const member: CounselActor = { kind: "user", role: "member" };
const viewer: CounselActor = { kind: "user", role: "viewer" };
const intake: CounselActor = { kind: "user", role: "counsel_intake" };
const attorney: CounselActor = { kind: "user", role: "counsel_attorney" };
const model: CounselActor = { kind: "model" };
const system: CounselActor = { kind: "system" };

describe("counsel-request state machine (PRD §7.6)", () => {
  it("walks the full happy path with the correct actors", () => {
    let state: CounselRequestState = "draft";

    const steps: Array<[Parameters<typeof applyTransition>[1], CounselActor, CounselRequestState]> = [
      ["submit", member, "submitted"],
      ["begin_conflict_review", intake, "conflict_review"],
      ["offer_consultation", attorney, "consultation_offered"],
      ["schedule_consultation", member, "consultation_scheduled"],
      ["offer_engagement", attorney, "engagement_offered"],
      ["record_signed_engagement", attorney, "engagement_signed"],
      ["convert_to_matter", attorney, "converted_to_matter"],
    ];

    for (const [action, actor, expected] of steps) {
      const result = applyTransition(state, action, actor, {
        evidenceRef: action === "record_signed_engagement" ? "engagement-doc-1" : undefined,
      });
      expect(result.ok, `${action} from ${state}`).toBe(true);
      if (result.ok) state = result.next;
      expect(state).toBe(expected);
    }
    expect(isTerminal(state)).toBe(true);
  });

  it("ordinary users cannot skip states", () => {
    // Direct jumps that must all be impossible for any ordinary user role.
    const forbiddenJumps: Array<[CounselRequestState, CounselRequestState]> = [
      ["draft", "conflict_review"],
      ["draft", "consultation_offered"],
      ["draft", "engagement_signed"],
      ["draft", "converted_to_matter"],
      ["submitted", "consultation_offered"],
      ["submitted", "engagement_offered"],
      ["conflict_review", "engagement_signed"],
      ["consultation_offered", "engagement_offered"],
      ["engagement_offered", "converted_to_matter"],
    ];
    for (const [from, to] of forbiddenJumps) {
      for (const actor of [owner, member, viewer]) {
        expect(canTransition(from, to, actor), `${from} → ${to}`).toBe(false);
      }
    }
  });

  it("ordinary users cannot perform counsel-side transitions", () => {
    expect(applyTransition("submitted", "begin_conflict_review", owner).ok).toBe(false);
    expect(applyTransition("conflict_review", "offer_consultation", member).ok).toBe(false);
    expect(applyTransition("conflict_review", "decline", owner).ok).toBe(false);
    expect(applyTransition("consultation_scheduled", "offer_engagement", owner).ok).toBe(false);
    expect(applyTransition("engagement_offered", "record_signed_engagement", owner, { evidenceRef: "x" }).ok).toBe(false);
    expect(applyTransition("engagement_signed", "convert_to_matter", owner).ok).toBe(false);
  });

  it("viewers cannot even submit", () => {
    expect(applyTransition("draft", "submit", viewer).ok).toBe(false);
  });

  it("model and system actors can never move the machine", () => {
    for (const from of COUNSEL_REQUEST_STATES) {
      for (const rule of COUNSEL_REQUEST_TRANSITIONS) {
        expect(applyTransition(from, rule.action, model).ok).toBe(false);
        expect(applyTransition(from, rule.action, system).ok).toBe(false);
      }
      expect(availableActions(from, model)).toEqual([]);
      expect(availableActions(from, system)).toEqual([]);
    }
  });

  it("declined and converted_to_matter are terminal", () => {
    for (const actor of [owner, member, intake, attorney]) {
      expect(availableActions("declined", actor)).toEqual([]);
      expect(availableActions("converted_to_matter", actor)).toEqual([]);
    }
  });

  it("recording a signed engagement requires evidence", () => {
    const withoutEvidence = applyTransition("engagement_offered", "record_signed_engagement", attorney);
    expect(withoutEvidence).toEqual({ ok: false, error: "evidence_required" });
    const withEvidence = applyTransition("engagement_offered", "record_signed_engagement", attorney, {
      evidenceRef: "signed-letter.pdf",
    });
    expect(withEvidence.ok).toBe(true);
  });

  it("actions from the wrong state fail even for the right role", () => {
    expect(applyTransition("draft", "begin_conflict_review", intake)).toEqual({
      ok: false,
      error: "invalid_from_state",
    });
    expect(applyTransition("submitted", "offer_consultation", attorney)).toEqual({
      ok: false,
      error: "invalid_from_state",
    });
  });

  it("no state before engagement_signed reads as represented", () => {
    const notRepresented: CounselRequestState[] = [
      "draft",
      "submitted",
      "conflict_review",
      "declined",
      "consultation_offered",
      "consultation_scheduled",
      "engagement_offered",
    ];
    for (const state of notRepresented) {
      expect(representationStatus(state).represented).toBe(false);
      expect(representationStatus(state).label).toBe("Not yet represented");
    }
    expect(representationStatus("engagement_signed").represented).toBe(true);
    expect(representationStatus("converted_to_matter").represented).toBe(true);
  });
});
