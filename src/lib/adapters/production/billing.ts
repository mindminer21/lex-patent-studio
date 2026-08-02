import type { Pool } from "pg";
import type { BillingAdapter } from "@/lib/adapters/types";
import { roundUsd } from "@/lib/domain/pricing";

/**
 * PRODUCTION BillingAdapter (FR-9).
 *
 * The wallet balance is the sum of the immutable ledger — credits and
 * settlements land there via Stripe webhook processing (billing outbox),
 * which requires Stripe credentials and live-billing approval
 * (PRD-wepatent §17.1/§17.4). The BALANCE READ is pure SQL and fully
 * testable without any Stripe credential.
 */
export class PgBillingAdapter implements BillingAdapter {
  constructor(private readonly pool: Pool) {}

  async getWalletBalanceUsd(organizationId: string): Promise<number> {
    const { rows } = await this.pool.query(
      `select coalesce(sum(amount_usd), 0) as balance
         from wallet_ledger_entries
        where organization_id = $1`,
      [organizationId],
    );
    return roundUsd(Number(rows[0].balance));
  }
}
