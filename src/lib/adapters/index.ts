import { isLocalMode } from "@/lib/env";
import { localAdapters } from "./local";
import { createProductionAdapters } from "./supabase";
import type { Adapters } from "./types";

/**
 * Adapter factory. Local mode (the Round-1 default, and the only mode that
 * boots today) needs zero external credentials.
 */
export function getAdapters(): Adapters {
  if (isLocalMode()) return localAdapters;
  return createProductionAdapters();
}

export type { Adapters, Session } from "./types";
