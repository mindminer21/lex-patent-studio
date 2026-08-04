/**
 * THE CLIENT DELIVERY GATE.
 *
 * Jeff's directive (2026-08-04): "Nothing is exported/delivered as a
 * counsel/client package until the set reaches READY_FOR_REVIEW *and* a
 * human accepts. If Pass 2 cannot complete (missing figures, unresolved
 * numerals, budget pause), the product says exactly what is blocking and
 * what it needs — it must not emit a Pass-1-only package silently."
 *
 * Two rules, and the second is the one that is easy to get wrong:
 *
 *   1. The gate is CLOSED by default. It opens only on an explicit positive
 *      result. There is no path where an unknown state falls through to
 *      "allowed".
 *   2. A refusal must be ACTIONABLE. "Not ready" is not an answer. Every
 *      blocker names what is wrong and what the product needs to proceed.
 *
 * PRODUCT-AGNOSTIC. wepatent's counsel-ready disclosure package and Lex's
 * practitioner draft both pass through this one function. The per-product
 * difference is the LABEL on the package, not whether the gate applies.
 */
import type { DraftPassState } from "./pass-state";
import type { ReconciliationReport } from "./reconcile";

export type DeliveryBlockerCode =
  | "pass_1_only"
  | "figures_not_built"
  | "figures_incomplete"
  | "pass_2_not_run"
  | "unreconciled_numerals"
  | "budget_paused"
  | "needs_user_input"
  | "run_failed"
  | "not_accepted_by_human"
  | "no_pass_2_version";

export type DeliveryBlocker = {
  code: DeliveryBlockerCode;
  /** What is wrong, in the customer's terms. */
  message: string;
  /** What the product needs in order to proceed. Never empty. */
  needs: string;
};

export type DeliveryGateInput = {
  state: DraftPassState;
  /** The stage an interruption paused, when the state is an interruption. */
  interruptedStage?: string | null;
  /** Free-text reason recorded when the run paused or failed. */
  statusDetail?: string;
  /** Pass 1 produced a draft version. */
  passOneVersionId: string | null;
  /** Pass 2 produced a NEW draft version — never an in-place mutation. */
  passTwoVersionId: string | null;
  /** The figure set the passes are reconciled against. */
  figureSetId: string | null;
  /** Figures that reached a composed/ready state. */
  readyFigureCount: number;
  /** Figures still asking a question or failed. */
  unresolvedFigureCount: number;
  /** The two-way §608.02 result. Null when Pass 2 has not run. */
  reconciliation: ReconciliationReport | null;
  /** A person accepted the set. The platform can never set this itself. */
  acceptedByUserId: string | null;
  acceptedAt: string | null;
};

export type DeliveryGateResult =
  | { allowed: true; acceptedByUserId: string; acceptedAt: string }
  | { allowed: false; blockers: DeliveryBlocker[] };

/**
 * Evaluate the gate.
 *
 * Blockers are returned in the order the user would have to resolve them,
 * so the first line of the message is the next thing to do.
 */
export function evaluateDeliveryGate(input: DeliveryGateInput): DeliveryGateResult {
  const blockers: DeliveryBlocker[] = [];

  switch (input.state) {
    case "PASS_1_DRAFTING":
      blockers.push({
        code: "pass_1_only",
        message:
          "The first-pass draft is still being written. Only a first pass exists, and a first pass has not been checked against any drawing.",
        needs:
          "Wait for Pass 1 to finish. The figures are then built from its illustrations brief, and Pass 2 revises the draft against them.",
      });
      break;
    case "FIGURES_PENDING":
      blockers.push({
        code: "figures_not_built",
        message:
          "The figures have not been built yet. The draft currently cites reference numerals that no drawing has been produced for.",
        needs: "Wait for the figures to be generated from the illustrations brief.",
      });
      break;
    case "FIGURES_READY":
      blockers.push({
        code: "pass_2_not_run",
        message:
          "The figures exist but the second pass has not run. The draft has not yet been revised for enablement against the drawings actually produced.",
        needs: "Run Pass 2 — the enablement revision against the figures.",
      });
      break;
    case "PASS_2_REVISING":
      blockers.push({
        code: "pass_2_not_run",
        message: "The second pass is still running.",
        needs: "Wait for Pass 2 to finish and for the reconciliation check to pass.",
      });
      break;
    case "NEEDS_INPUT":
      blockers.push({
        code: "needs_user_input",
        message:
          input.statusDetail?.trim() ||
          "We need information from you before this set can be completed.",
        needs:
          "Answer the open questions on the figures or the record, then the run resumes at the stage it paused.",
      });
      break;
    case "PAUSED_BUDGET":
      blockers.push({
        code: "budget_paused",
        message:
          input.statusDetail?.trim() ||
          "The run paused because it reached a spend cap before it could finish.",
        needs:
          "Raise the budget cap or top up the wallet, then resume. Nothing already paid for is charged again.",
      });
      break;
    case "FAILED":
      blockers.push({
        code: "run_failed",
        message: input.statusDetail?.trim() || "The drafting run failed.",
        needs: "Retry the run. A retry re-uses the existing reservation and does not double-charge.",
      });
      break;
    case "READY_FOR_REVIEW":
      break;
  }

  // Structural checks, independent of state — a state value alone must not
  // be sufficient to open the gate.
  if (input.state === "READY_FOR_REVIEW") {
    if (!input.figureSetId || input.readyFigureCount === 0) {
      blockers.push({
        code: "figures_not_built",
        message: "The set is marked ready but carries no produced figures.",
        needs: "Rebuild the figures from the illustrations brief before delivering anything.",
      });
    }
    if (input.unresolvedFigureCount > 0) {
      blockers.push({
        code: "figures_incomplete",
        message: `${input.unresolvedFigureCount} figure(s) are still unresolved — they are asking a question or failed to draw.`,
        needs:
          "Resolve every outstanding figure question, or remove the figure and its numerals from the brief, then re-run Pass 2.",
      });
    }
    if (!input.passTwoVersionId) {
      blockers.push({
        code: "no_pass_2_version",
        message:
          "No second-pass draft version exists. Delivering now would send a Pass-1-only package.",
        needs: "Run Pass 2. Its output is a NEW version; the first-pass version stays inspectable.",
      });
    }
    if (!input.reconciliation) {
      blockers.push({
        code: "unreconciled_numerals",
        message:
          "The prose ↔ drawings reconciliation has not been run, so we cannot say the description and the figures agree.",
        needs: "Run Pass 2, which performs the two-way §608.02 check as part of completing.",
      });
    } else if (!input.reconciliation.reconciled) {
      blockers.push({
        code: "unreconciled_numerals",
        message: `The description and the drawings do not agree on ${input.reconciliation.findings.length} reference numeral(s) or figure(s). We flag these rather than changing your draft.`,
        needs:
          "Review each flagged mismatch and either amend the description or correct the figure, then re-run Pass 2.",
      });
    }
  }

  // The human acceptance is checked LAST so the message a user sees names
  // the substantive problem first when there is one.
  if (!input.acceptedByUserId || !input.acceptedAt) {
    blockers.push({
      code: "not_accepted_by_human",
      message:
        "No person has accepted this set. The platform cannot accept on your behalf — an automated output stays AI-proposed until someone acts on it.",
      needs: "Review the two draft versions and the figures, then accept the set for delivery.",
    });
  }

  if (blockers.length > 0) return { allowed: false, blockers };

  // Unreachable unless both are set, but the compiler does not know that and
  // an unchecked non-null assertion here is exactly the kind of shortcut a
  // delivery gate should not contain.
  if (!input.acceptedByUserId || !input.acceptedAt) {
    return {
      allowed: false,
      blockers: [
        {
          code: "not_accepted_by_human",
          message: "No person has accepted this set.",
          needs: "Accept the set for delivery.",
        },
      ],
    };
  }
  return {
    allowed: true,
    acceptedByUserId: input.acceptedByUserId,
    acceptedAt: input.acceptedAt,
  };
}

/**
 * The exact text the product shows when delivery is refused. One line per
 * blocker, each naming the problem and what is needed — never a bare
 * "not ready".
 */
export function describeDeliveryBlockers(blockers: readonly DeliveryBlocker[]): string {
  return blockers.map((blocker) => `${blocker.message} ${blocker.needs}`).join("\n");
}

/** Short, machine-readable summary for logs and the export manifest. */
export function blockerCodes(result: DeliveryGateResult): DeliveryBlockerCode[] {
  return result.allowed ? [] : result.blockers.map((blocker) => blocker.code);
}
