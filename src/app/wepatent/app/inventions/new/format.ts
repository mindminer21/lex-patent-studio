import type {
  componentsSchema,
  contributorsSchema,
  sourcesSchema,
  timelineSchema,
} from "@/lib/wepatent/domain/intake";
import type { z } from "zod";

/**
 * Serializers between saved structured stage data and the documented
 * line-entry formats used by the keyboard-friendly textareas.
 */
type ComponentsData = Partial<z.infer<typeof componentsSchema>>;
type ContributorsData = Partial<z.infer<typeof contributorsSchema>>;
type TimelineData = Partial<z.infer<typeof timelineSchema>>;
type SourcesData = Partial<z.infer<typeof sourcesSchema>>;

export function componentsToText(data: ComponentsData | undefined): string {
  return (data?.components ?? [])
    .map((c) => (c.description ? `${c.name} — ${c.description}` : c.name))
    .join("\n");
}

export function stepsToText(data: ComponentsData | undefined): string {
  return (data?.steps ?? []).join("\n");
}

export function contributorsToText(data: ContributorsData | undefined): string {
  return (data?.contributors ?? [])
    .map((c) => `${c.name}${c.email ? ` <${c.email}>` : ""} — ${c.contribution}`)
    .join("\n");
}

export function timelineToText(data: TimelineData | undefined): string {
  return (data?.events ?? [])
    .map((e) => `${e.date} | ${e.kind} | ${e.description}${e.underNda ? " (NDA)" : ""}`)
    .join("\n");
}

export function sourcesToText(data: SourcesData | undefined): string {
  return (data?.sources ?? [])
    .map((s) => `${s.name} | ${s.kind}${s.note ? ` | ${s.note}` : ""}`)
    .join("\n");
}
