/**
 * Wallet top-up defaults (friction audit #7).
 *
 * Pure helpers only — no adapter, no I/O. The "last amount" is derived from
 * the immutable wallet ledger rather than stored as new preference state:
 * the ledger already records every settled top-up, so there is nothing new
 * to keep in sync and no schema change.
 */

export type TopUpLedgerEntry = {
  kind: string;
  amountCents: number;
  createdAt: string;
};

/**
 * The amount to preselect in the top-up control: the most recent SETTLED
 * top-up amount, when it is still one of the offered amounts, otherwise the
 * standing default. Only settled `top_up` entries count — a promotional
 * credit or a usage settlement is not a top-up choice the user made.
 */
export function lastTopUpAmountCents(
  entries: readonly TopUpLedgerEntry[],
  allowedCents: readonly number[],
  fallbackCents: number,
): number {
  const topUps = entries
    .filter((entry) => entry.kind === "top_up" && allowedCents.includes(entry.amountCents))
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const last = topUps[topUps.length - 1];
  return last ? last.amountCents : fallbackCents;
}
