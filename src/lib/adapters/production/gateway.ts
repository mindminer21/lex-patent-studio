import type { ModelGatewayAdapter } from "@/lib/adapters/types";
import {
  estimateCharge,
  getModel,
  MODEL_CATALOG,
  type ChargeEstimate,
  type ModelCatalogEntry,
  type TokenWorkload,
} from "@/lib/domain/pricing";
import { getEnv } from "@/lib/env";

/**
 * PRODUCTION ModelGatewayAdapter (FR-6).
 *
 * Provider execution (OpenAI/Anthropic/xAI) is approval-gated: keys must
 * exist AND Jeff must approve provider spend (§17.4) and, separately, xAI
 * customer traffic (§20.13). Until then isLive() is false and the durable
 * job runner refuses to execute runs. Catalog and estimate math are the
 * same effective-dated registry logic used everywhere (in full production
 * the registry loads from model_registry/model_prices; the code catalog is
 * the seed for those tables).
 */
export class ProviderGatewayAdapter implements ModelGatewayAdapter {
  listModels(): ModelCatalogEntry[] {
    return MODEL_CATALOG;
  }

  estimate(modelId: string, workload: TokenWorkload): ChargeEstimate {
    const model = getModel(modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);
    return estimateCharge(model, workload);
  }

  isLive(): boolean {
    const env = getEnv();
    const hasAnyKey = Boolean(env.LEX_OPENAI_API_KEY || env.LEX_ANTHROPIC_API_KEY);
    // Keys alone are NOT sufficient: provider spend approval is a human
    // decision recorded outside this repository (PRD-wepatent §17.4).
    // This flag stays false until the approved production config sets it.
    const approved = process.env.LEX_PROVIDER_SPEND_APPROVED === "true";
    return hasAnyKey && approved;
  }
}
