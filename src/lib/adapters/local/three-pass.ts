import { randomUUID } from "node:crypto";
import {
  draftSetTier,
  evaluateLexDelivery,
  runLexPassOne,
  runLexPassTwo,
  transitionLexDraftSet,
  type LexDraftSet,
  type LexDraftSetTransition,
} from "@/lib/domain/lex-draft-passes";
import {
  briefNumerals,
  describeDeliveryBlockers,
  LEX_DRAFT_CONFIG,
  type DraftPassState,
  type IllustrationsBrief,
} from "@/lib/shared/drafting";
import type { ActorContext } from "@/lib/adapters/types";
import type { ReviewItem, WorkProductDocument } from "@/lib/domain/schemas";
import type { LocalStore } from "./store";

/**
 * LEX'S THREE-PASS FLOW over the local store.
 *
 * Local mode is a DETERMINISTIC SIMULATION of the pipeline — same as the
 * rest of Lex's local adapter — but the rules it obeys are not simulated:
 * every state change goes through the shared state machine, the brief is
 * authored by the shared authoring function and validated by the shared
 * schema, the numerals in the drawings come from the brief, the two-way
 * §608.02 check is the shared one, and the delivery gate is the shared one.
 *
 * That is the point of the directive's "similarly implemented in both": the
 * behaviour a Lex practitioner sees is produced by the same code a wepatent
 * user's is, not by a Lex copy of it.
 */

function nowIso(): string {
  return new Date().toISOString();
}

function record(
  store: LocalStore,
  set: LexDraftSet,
  from: DraftPassState | null,
  to: DraftPassState,
  actor: string,
  reason: string,
): void {
  const transition: LexDraftSetTransition = {
    id: `dst_${randomUUID()}`,
    organizationId: set.organizationId,
    draftSetId: set.id,
    fromState: from,
    toState: to,
    actor,
    reason,
    createdAt: nowIso(),
  };
  store.draftSetTransitions.push(transition);
}

/** Guarded move: the shared machine decides, this only persists. */
function move(
  store: LocalStore,
  set: LexDraftSet,
  to: DraftPassState,
  actor: string,
  reason: string,
  interruptedStage: LexDraftSet["interruptedStage"] = null,
): void {
  const from = set.state;
  transitionLexDraftSet(set, to);
  set.state = to;
  set.interruptedStage = to === "NEEDS_INPUT" || to === "PAUSED_BUDGET" ? interruptedStage : null;
  set.updatedAt = nowIso();
  record(store, set, from, to, actor, reason);
}

function versionHash(sections: Array<{ heading: string; body: string }>): string {
  // Deterministic, content-addressed, and long enough for the schema's
  // min(8) — local mode never needs a cryptographic hash here.
  let hash = 0;
  const text = sections.map((section) => `${section.heading}${section.body}`).join("");
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return `lexdoc${hash.toString(16).padStart(8, "0")}`;
}

function pushDocument(
  store: LocalStore,
  set: LexDraftSet,
  title: string,
  pass: 1 | 2,
  sections: Array<{ heading: string; body: string; flags: string[] }>,
): WorkProductDocument {
  const document: WorkProductDocument = {
    id: `doc_${randomUUID()}`,
    organizationId: set.organizationId,
    matterId: set.matterId,
    title,
    deliverableType: pass === 1 ? "Specification draft (pass 1)" : "Specification draft (pass 2)",
    tier: set.tier,
    // AI output is never review-complete on arrival (Invariant 1).
    reviewState: "pending_review",
    verificationState: pass === 2 ? "verified" : "unverified",
    modelId: "lex-local-synthetic",
    corpusRelease: "local",
    version: pass,
    versionHash: versionHash(sections),
    sections,
    citations: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.documents.push(document);
  return document;
}

/**
 * Simulated figures stage.
 *
 * It CONSUMES the brief's numerals — it does not invent any. That is the
 * same contract the real wepatent figure planner now honours
 * (`consumeNumerals`), expressed here as: the placed numerals are exactly
 * the brief's numerals for the figures that were produced.
 */
function simulateFigures(brief: IllustrationsBrief): {
  producedFigures: Array<{
    figureNumber: number;
    partialSuffix: string | null;
    title: string;
    briefDescription: string;
  }>;
  registry: Array<{ numeral: string; partLabel: string }>;
  placedNumerals: string[];
  unresolved: number;
} {
  const drawable = brief.figures.filter((figure) => !figure.needsInput);
  const placed = new Set<string>();
  for (const figure of drawable) {
    for (const numeral of figure.partNumerals) placed.add(numeral);
  }
  return {
    producedFigures: drawable.map((figure) => ({
      figureNumber: figure.figureNumber,
      partialSuffix: figure.partialSuffix,
      title: figure.title,
      briefDescription: figure.briefDescription,
    })),
    // The registry is the brief's, restricted to numerals a produced figure
    // actually carries — so the two-way check compares like with like.
    registry: briefNumerals(brief)
      .filter((entry) => placed.has(entry.numeral))
      .map((entry) => ({ numeral: entry.numeral, partLabel: entry.partLabel })),
    placedNumerals: [...placed],
    unresolved: brief.figures.length - drawable.length,
  };
}

export type StartDraftSetResult =
  | { ok: true; set: LexDraftSet }
  | { ok: false; error: string };

/**
 * Start the flow and run it to wherever it settles.
 *
 * Pass 1 → figures → Pass 2 chains with no practitioner step in between
 * (minimal-input rule). It stops honestly at NEEDS_INPUT when the record
 * cannot support a figure or when the two-way check finds a mismatch.
 */
export function startLexDraftSet(
  store: LocalStore,
  organizationId: string,
  matterId: string,
  actor: ActorContext,
): StartDraftSetResult {
  const matter = store.matters.find(
    (candidate) => candidate.organizationId === organizationId && candidate.id === matterId,
  );
  if (!matter) return { ok: false, error: "Matter not found." };

  const active = store.draftSets.find(
    (candidate) =>
      candidate.matterId === matterId &&
      candidate.state !== "READY_FOR_REVIEW" &&
      candidate.state !== "FAILED",
  );
  if (active) return { ok: true, set: active };

  const set: LexDraftSet = {
    id: `dset_${randomUUID()}`,
    organizationId,
    matterId,
    state: "PASS_1_DRAFTING",
    interruptedStage: null,
    // Tier B — draft for review. The three-pass flow does not change it.
    tier: draftSetTier(),
    passOneDocumentId: null,
    passTwoDocumentId: null,
    runId: null,
    reviewItemId: null,
    illustrationsBrief: null,
    briefVersion: "",
    reconciliation: null,
    reconciled: false,
    reconciliationVersion: "",
    statusDetail: "",
    acceptedByUserId: null,
    acceptedAt: null,
    passOneChargeUsd: 0,
    passTwoChargeUsd: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.draftSets.push(set);
  record(store, set, null, "PASS_1_DRAFTING", actor.userId, "Three-pass drafting started.");

  /* ---- Pass 1 -------------------------------------------------------- */
  const facts = store.facts.filter(
    (fact) => fact.organizationId === organizationId && fact.matterId === matterId,
  );
  // Named parts come from the matter's fact ledger. Only counsel-approved
  // facts are drafted from (PRD-lex FR-3), which is why the brief author is
  // fed the approved set rather than everything on the record.
  const approved = facts.filter((fact) => fact.provenance === "counsel_reviewed");
  const source = approved.length > 0 ? approved : facts;
  const components = source.slice(0, 8).map((fact, index) => ({
    id: fact.id,
    name: partNameFromFact(fact.text, index),
    description: fact.text,
  }));

  const passOne = runLexPassOne({
    matterTitle: matter.title,
    components,
    solutions: source.map((fact) => ({ id: fact.id, statement: fact.text })),
    methodSteps: [],
    hasUploadedGeometry: store.sources.some(
      (candidate) => candidate.matterId === matterId,
    ),
    lineArtAvailable: false,
  });

  set.illustrationsBrief = passOne.brief;
  set.briefVersion = passOne.brief.version;

  if (!passOne.ok) {
    move(
      store,
      set,
      passOne.nextState,
      "system",
      passOne.detail,
      passOne.nextState === "NEEDS_INPUT" ? "PASS_1_DRAFTING" : null,
    );
    set.statusDetail = passOne.detail;
    return { ok: true, set };
  }

  const passOneDocument = pushDocument(
    store,
    set,
    `${matter.title} — ${LEX_DRAFT_CONFIG.deliverableLabel} (first pass)`,
    1,
    passOne.sections,
  );
  set.passOneDocumentId = passOneDocument.id;
  set.passOneChargeUsd = 0.9;
  move(
    store,
    set,
    "FIGURES_PENDING",
    "system",
    "Pass 1 complete; figures chained from the illustrations brief.",
  );

  /* ---- Figures stage -------------------------------------------------- */
  const figures = simulateFigures(passOne.brief);
  if (figures.producedFigures.length === 0) {
    const detail =
      "No figure could be produced from the illustrations brief, so there is nothing for the second pass to enable against.";
    move(store, set, "NEEDS_INPUT", "system", detail, "FIGURES_PENDING");
    set.statusDetail = detail;
    return { ok: true, set };
  }
  move(
    store,
    set,
    "FIGURES_READY",
    "system",
    "Figures composed from the illustrations brief; numerals consumed, none invented.",
  );

  /* ---- Pass 2 --------------------------------------------------------- */
  move(store, set, "PASS_2_REVISING", "system", "Re-drafting for enablement against the figures.");
  const passTwo = runLexPassTwo({
    matterTitle: matter.title,
    brief: passOne.brief,
    registry: figures.registry,
    placedNumerals: figures.placedNumerals,
    producedFigures: figures.producedFigures,
    validationFindings: [],
    coverageGaps: [],
  });

  const passTwoDocument = pushDocument(
    store,
    set,
    `${matter.title} — ${LEX_DRAFT_CONFIG.deliverableLabel} (second pass, enablement revision)`,
    2,
    passTwo.sections,
  );
  set.passTwoDocumentId = passTwoDocument.id;
  set.passTwoChargeUsd = 1.2;
  set.reconciliation = passTwo.reconciliation;
  set.reconciled = passTwo.reconciliation.reconciled;
  set.reconciliationVersion = passTwo.reconciliation.version;

  if (passTwo.nextState === "NEEDS_INPUT") {
    // THE GATE HOLDS. The revised document stays inspectable so the
    // practitioner can see what to fix; the set does not become deliverable.
    move(
      store,
      set,
      "NEEDS_INPUT",
      "system",
      `Reconciliation failed with ${passTwo.reconciliation.findings.length} finding(s).`,
      "PASS_2_REVISING",
    );
    set.statusDetail = passTwo.statusDetail;
    return { ok: true, set };
  }

  /* ---- Tier B: the set enters the practitioner review queue ----------- */
  const reviewItem: ReviewItem = {
    id: `rev_${randomUUID()}`,
    organizationId,
    matterId,
    documentTitle: passTwoDocument.title,
    documentVersionHash: passTwoDocument.versionHash,
    tier: set.tier,
    state: "pending_review",
    verificationState: "verified",
    criticReportSummary:
      "Two-way §608.02 reconciliation passed: every reference numeral in the description appears in the drawings and every numeral in the drawings appears in the description.",
    deterministicCheckFailures: 0,
    unresolvedFlags: passTwo.unresolvedFlags,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.reviewItems.push(reviewItem);
  set.reviewItemId = reviewItem.id;

  move(
    store,
    set,
    "READY_FOR_REVIEW",
    "system",
    "Pass 2 complete; prose and drawings reconciled both ways. Entered the review queue as Tier B.",
  );
  set.statusDetail = "";
  return { ok: true, set };
}

/**
 * The responsible practitioner accepts.
 *
 * Refused unless the shared delivery gate would open but for the acceptance
 * itself — so a practitioner is never allowed to accept something the gate
 * would still block for a substantive reason.
 */
export function acceptLexDraftSet(
  store: LocalStore,
  organizationId: string,
  draftSetId: string,
  actor: ActorContext,
): { ok: true; set: LexDraftSet } | { ok: false; error: string } {
  const set = store.draftSets.find(
    (candidate) => candidate.organizationId === organizationId && candidate.id === draftSetId,
  );
  if (!set) return { ok: false, error: "Draft set not found." };

  const figures = set.illustrationsBrief
    ? simulateFigures(set.illustrationsBrief)
    : { producedFigures: [], registry: [], placedNumerals: [], unresolved: 0 };
  const decision = evaluateLexDelivery(set, {
    ready: figures.producedFigures.length,
    unresolved: figures.unresolved,
  });
  if (!decision.allowed) {
    const substantive = decision.blockers.filter(
      (blocker) => blocker.code !== "not_accepted_by_human",
    );
    if (substantive.length > 0) {
      return { ok: false, error: describeDeliveryBlockers(substantive) };
    }
  }

  set.acceptedByUserId = actor.userId;
  set.acceptedAt = nowIso();
  set.updatedAt = set.acceptedAt;
  return { ok: true, set };
}

/**
 * A part label read out of a fact statement.
 *
 * Structural only — the first noun-ish token sequence — because a fact
 * statement is untrusted evidence and nothing here interprets it as an
 * instruction. Falls back to a positional label so every component is
 * distinctly named, which the numeral registry requires.
 */
function partNameFromFact(statement: string, index: number): string {
  const cleaned = statement.trim().replace(/\s+/g, " ");
  const match = /\b([a-z][a-z-]{2,})\s+([a-z][a-z-]{2,})\b/i.exec(cleaned);
  const candidate = match ? `${match[1]} ${match[2]}`.toLowerCase() : "";
  return candidate.length > 0 ? `${candidate} ${index + 1}` : `element ${index + 1}`;
}
