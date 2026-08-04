import { z } from "zod";
import {
  GEMINI_IMAGE_MODEL_ID,
  PROMPT_TEMPLATE_VERSION,
  type LineArtPromptInput,
} from "@/lib/server/figures/gemini-contract";
import { buildLineArtPrompt } from "@/lib/server/figures/gemini-contract";
import {
  checkRasterHygiene,
  DEFAULT_HYGIENE_THRESHOLDS,
  type HygieneThresholds,
} from "@/lib/server/figures/raster";
import type { ModelLineArtRequest, ModelLineArtResult } from "../types";
import { ModelGatewayError } from "./gateway-error";

/**
 * Nano Banana 2 (Gemini 3 Pro Image) adapter — Layer 1 only.
 *
 * DISABLED BY DEFAULT. Two independent gates must both be open before a
 * single byte leaves this process:
 *   1. `FIGURES_GEMINI_ENABLED=1` — the explicit enable flag, and
 *   2. `GEMINI_API_KEY` — the server-side key, never client-exposed.
 * With either missing the adapter refuses with `provider_not_configured`
 * and the pipeline surfaces an honest "line art unavailable" state.
 *
 * Every response passes the raster-hygiene gate before it is accepted:
 * color, greyscale, solid black areas and DETECTED TEXT are all hard
 * rejections, because Layer 2 owns every character in a patent drawing.
 * A rejected image still cost money — that cost is reported, never hidden.
 *
 * The transport is injected, so the whole success / refusal / timeout /
 * rate-limit / color-rejection / text-rejection matrix is unit-tested with
 * ZERO real spend.
 */

const inlineDataSchema = z.object({
  inlineData: z.object({
    mimeType: z.string(),
    data: z.string().min(1),
  }),
});

const textPartSchema = z.object({ text: z.string() });

const geminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.union([inlineDataSchema, textPartSchema])).default([]),
          })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .default([]),
  promptFeedback: z
    .object({ blockReason: z.string().optional() })
    .optional(),
});

export type GeminiImageAdapterOptions = {
  apiKey?: string;
  /** Explicit enable flag; nothing runs when false. */
  enabled: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Retries for RETRYABLE transport failures (429/5xx/timeout). */
  maxRetries?: number;
  /**
   * Regenerate attempts when the image comes back clean-transport but
   * dirty-content (color/text/solid black). Each attempt bills.
   */
  maxHygieneAttempts?: number;
  killSwitch?: boolean;
  hygieneThresholds?: HygieneThresholds;
  /** Provider cost per generated image, in cents (from the price registry). */
  perImageCents: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
};

export class GeminiImageAdapter {
  private readonly options: Required<
    Omit<GeminiImageAdapterOptions, "apiKey" | "fetchImpl" | "hygieneThresholds">
  > & {
    apiKey?: string;
    fetchImpl: typeof fetch;
    hygieneThresholds: HygieneThresholds;
  };

  private consecutiveFailures = 0;
  private circuitOpenedAt: number | null = null;

  constructor(options: GeminiImageAdapterOptions) {
    this.options = {
      apiKey: options.apiKey,
      enabled: options.enabled,
      fetchImpl: options.fetchImpl ?? fetch,
      timeoutMs: options.timeoutMs ?? 90_000,
      maxRetries: options.maxRetries ?? 1,
      maxHygieneAttempts: options.maxHygieneAttempts ?? 2,
      killSwitch: options.killSwitch ?? false,
      hygieneThresholds: options.hygieneThresholds ?? DEFAULT_HYGIENE_THRESHOLDS,
      perImageCents: options.perImageCents,
      now: options.now ?? (() => Date.now()),
      sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      baseUrl: options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta/models",
    };
  }

  /** True when both gates are open. The UI reads this to explain the state. */
  get available(): boolean {
    return this.options.enabled && Boolean(this.options.apiKey) && !this.options.killSwitch;
  }

  async generateLineArt(request: ModelLineArtRequest): Promise<ModelLineArtResult> {
    if (this.options.killSwitch) {
      throw new ModelGatewayError("gateway_disabled", "kill switch active");
    }
    if (!this.options.enabled) {
      throw new ModelGatewayError(
        "provider_not_configured",
        "FIGURES_GEMINI_ENABLED is not set; line-art generation is disabled by default",
      );
    }
    if (!this.options.apiKey) {
      throw new ModelGatewayError(
        "provider_not_configured",
        "GEMINI_API_KEY is missing (approval-gated, PRD §17)",
      );
    }
    this.assertCircuitClosed();

    const violations: string[] = [];
    let billedImages = 0;

    for (let attempt = 0; attempt < this.options.maxHygieneAttempts; attempt += 1) {
      const response = await this.callWithRetries(request, attempt);
      if (response.kind === "refused") {
        this.recordSuccess(); // a refusal is a healthy transport, not a fault
        return { status: "refused", reason: response.reason, providerCostCents: 0, billedImages };
      }
      this.recordSuccess();
      billedImages += 1;

      const verdict = checkRasterHygiene(response.bytes, this.options.hygieneThresholds);
      if (verdict.ok) {
        return {
          status: "ok",
          imageBytes: response.bytes,
          mimeType: response.mimeType,
          billedImages,
          providerCostCents: billedImages * this.options.perImageCents,
          modelId: GEMINI_IMAGE_MODEL_ID,
          promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
        };
      }
      violations.push(...verdict.violations.map((violation) => `${violation.code}: ${violation.detail}`));
    }

    // Every attempt produced non-compliant art. Honest outcome: report the
    // violations AND the money we actually spent trying.
    return {
      status: "rejected",
      violations,
      billedImages,
      providerCostCents: billedImages * this.options.perImageCents,
    };
  }

  private async callWithRetries(
    request: ModelLineArtRequest,
    hygieneAttempt: number,
  ): Promise<{ kind: "image"; bytes: Uint8Array; mimeType: string } | { kind: "refused"; reason: string }> {
    let lastError: ModelGatewayError | null = null;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      if (attempt > 0) await this.options.sleep(500 * attempt);
      try {
        return await this.callProvider(request, hygieneAttempt);
      } catch (error) {
        const gatewayError =
          error instanceof ModelGatewayError
            ? error
            : new ModelGatewayError("provider_error", String(error), true);
        this.recordFailure();
        lastError = gatewayError;
        if (!gatewayError.retryable) throw gatewayError;
      }
    }
    throw lastError ?? new ModelGatewayError("provider_error", "exhausted retries", false);
  }

  private async callProvider(
    request: ModelLineArtRequest,
    hygieneAttempt: number,
  ): Promise<{ kind: "image"; bytes: Uint8Array; mimeType: string } | { kind: "refused"; reason: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const parts: Array<Record<string, unknown>> = [{ text: request.prompt }];
      if (request.referenceImageBytes && request.referenceImageMimeType) {
        parts.push({
          inlineData: {
            mimeType: request.referenceImageMimeType,
            data: Buffer.from(request.referenceImageBytes).toString("base64"),
          },
        });
      }
      const url = `${this.options.baseUrl}/${encodeURIComponent(request.modelId)}:generateContent`;
      let response: Response;
      try {
        response = await this.options.fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // Header auth, never a query string — keys must not land in logs.
            "x-goog-api-key": this.options.apiKey!,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseModalities: ["IMAGE"],
              // A different seed per hygiene attempt; otherwise a rejected
              // image would simply be regenerated byte-identical.
              candidateCount: 1,
              temperature: hygieneAttempt === 0 ? 0.2 : 0.6,
            },
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new ModelGatewayError("provider_timeout", "gemini timed out", true);
        }
        throw new ModelGatewayError("provider_error", `network: ${String(error)}`, true);
      }

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        const raw = await response.text().catch(() => "");
        throw new ModelGatewayError(
          "provider_error",
          `gemini HTTP ${response.status}: ${raw.slice(0, 500)}`,
          retryable,
        );
      }

      const json = await response.json().catch(() => null);
      const parsed = geminiResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new ModelGatewayError("invalid_provider_response", parsed.error.message);
      }
      if (parsed.data.promptFeedback?.blockReason) {
        return { kind: "refused", reason: `blocked: ${parsed.data.promptFeedback.blockReason}` };
      }
      const candidate = parsed.data.candidates[0];
      const responseParts = candidate?.content?.parts ?? [];
      const image = responseParts.find(
        (part): part is z.infer<typeof inlineDataSchema> => "inlineData" in part,
      );
      if (!image) {
        const text = responseParts
          .filter((part): part is z.infer<typeof textPartSchema> => "text" in part)
          .map((part) => part.text)
          .join(" ")
          .slice(0, 300);
        return {
          kind: "refused",
          reason: text || candidate?.finishReason || "the model returned no image",
        };
      }
      return {
        kind: "image",
        bytes: new Uint8Array(Buffer.from(image.inlineData.data, "base64")),
        mimeType: image.inlineData.mimeType,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private assertCircuitClosed(): void {
    if (this.circuitOpenedAt === null) return;
    if (this.options.now() - this.circuitOpenedAt < 60_000) {
      throw new ModelGatewayError("circuit_open", "google image circuit open");
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenedAt = null;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= 5 || this.circuitOpenedAt !== null) {
      this.circuitOpenedAt = this.options.now();
    }
  }
}

/** Convenience: build the prompt and request in one step. */
export function lineArtRequest(
  input: LineArtPromptInput & { modelId?: string },
): ModelLineArtRequest {
  return {
    modelId: input.modelId ?? GEMINI_IMAGE_MODEL_ID,
    prompt: buildLineArtPrompt(input),
    subject: input.subject,
    viewType: input.viewType,
  };
}
