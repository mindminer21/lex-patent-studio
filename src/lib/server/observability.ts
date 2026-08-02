import "server-only";

import { randomUUID } from "node:crypto";

/**
 * FR-7 observability: correlation IDs, structured redacted logs, and
 * process-local metrics.
 *
 * Redaction policy (PRD FR-7/§11): structured logs must exclude prompts,
 * document contents, secrets, and unnecessary PII. Redaction here is
 * key-based AND size-based — any suspicious key is masked and any oversized
 * string is truncated, so a mistake upstream cannot dump content into logs.
 *
 * Metrics are in-memory counters/timers suitable for local mode and tests;
 * production export to a monitoring vendor is approval-gated (PRD §17.1)
 * and hangs off the same `metricsSnapshot()` seam.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogRecord = {
  time: string;
  level: LogLevel;
  event: string;
  correlationId: string | null;
  meta: Record<string, unknown>;
};

const REDACT_KEY_PATTERN =
  /(secret|token|key|password|authorization|cookie|prompt|content|document|email|ssn|credential)/i;
const MAX_STRING_LENGTH = 256;

export function redactMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (REDACT_KEY_PATTERN.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string") {
      out[key] =
        value.length > MAX_STRING_LENGTH
          ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated ${value.length - MAX_STRING_LENGTH} chars]`
          : value;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redactMeta(value as Record<string, unknown>);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function newCorrelationId(): string {
  return randomUUID();
}

type Sink = (record: LogRecord) => void;

let sink: Sink = (record) => {
  const line = JSON.stringify(record);
  if (record.level === "error") {
    console.error(line);
  } else if (record.level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
};

/** Test hook: capture structured log records instead of writing stdout. */
export function setLogSink(nextSink: Sink | null): void {
  sink = nextSink ?? ((record) => console.log(JSON.stringify(record)));
}

export function logEvent(params: {
  level: LogLevel;
  event: string;
  correlationId?: string | null;
  meta?: Record<string, unknown>;
}): LogRecord {
  const record: LogRecord = {
    time: new Date().toISOString(),
    level: params.level,
    event: params.event,
    correlationId: params.correlationId ?? null,
    meta: redactMeta(params.meta ?? {}),
  };
  sink(record);
  return record;
}

/* ------------------------------- metrics -------------------------------- */

type MetricsState = {
  counters: Map<string, number>;
  timings: Map<string, { count: number; totalMs: number; maxMs: number }>;
};

const METRICS_KEY = "__wepatent_metrics__";

function metricsState(): MetricsState {
  const holder = globalThis as typeof globalThis & { [METRICS_KEY]?: MetricsState };
  if (!holder[METRICS_KEY]) {
    holder[METRICS_KEY] = { counters: new Map(), timings: new Map() };
  }
  return holder[METRICS_KEY];
}

/**
 * Counter names in use (FR-7): job.succeeded, job.failed, job.retried,
 * provider.error, authz.denied, webhook.rejected, reservation.insufficient.
 */
export function incrementCounter(name: string, by = 1): void {
  const state = metricsState();
  state.counters.set(name, (state.counters.get(name) ?? 0) + by);
}

export function recordTiming(name: string, durationMs: number): void {
  const state = metricsState();
  const entry = state.timings.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
  entry.count += 1;
  entry.totalMs += durationMs;
  entry.maxMs = Math.max(entry.maxMs, durationMs);
  state.timings.set(name, entry);
}

export function metricsSnapshot(): {
  counters: Record<string, number>;
  timings: Record<string, { count: number; avgMs: number; maxMs: number }>;
} {
  const state = metricsState();
  const counters: Record<string, number> = {};
  for (const [name, value] of state.counters) counters[name] = value;
  const timings: Record<string, { count: number; avgMs: number; maxMs: number }> = {};
  for (const [name, entry] of state.timings) {
    timings[name] = {
      count: entry.count,
      avgMs: entry.count === 0 ? 0 : Math.round(entry.totalMs / entry.count),
      maxMs: entry.maxMs,
    };
  }
  return { counters, timings };
}

/** Test hook. */
export function resetMetrics(): void {
  const holder = globalThis as typeof globalThis & { [METRICS_KEY]?: MetricsState };
  holder[METRICS_KEY] = { counters: new Map(), timings: new Map() };
}
