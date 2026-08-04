/**
 * Gateway error type, extracted into its own module so provider adapters
 * (OpenAI/Anthropic/xAI text, Google image) can all import it without a
 * circular dependency between them.
 *
 * The invariant it exists to protect: no provider API key and no raw
 * provider error body ever appears in a thrown error `message`. Callers get
 * a stable `code`; anything provider-supplied stays in `internalDetail`,
 * which route handlers must never serialize to the browser (PRD FR-5).
 */
export type GatewayErrorCode =
  | "gateway_disabled"
  | "circuit_open"
  | "provider_not_configured"
  | "model_not_registered"
  | "cost_cap_exceeded"
  | "provider_timeout"
  | "provider_error"
  | "invalid_provider_response";

export class ModelGatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly internalDetail: string;
  readonly retryable: boolean;

  constructor(code: GatewayErrorCode, internalDetail = "", retryable = false) {
    super(code);
    this.name = "ModelGatewayError";
    this.code = code;
    this.internalDetail = internalDetail;
    this.retryable = retryable;
  }
}
