import "server-only";

import {
  isEmptyRecord,
  type RecordContentCounts,
} from "@/lib/wepatent/domain/record-emptiness";
import { getAdapters } from "../adapters";
import type { Id } from "../adapters/types";

/**
 * Loads the content counts behind `isEmptyRecord` (see
 * `domain/record-emptiness.ts`). Tenant-scoped like every other read: the
 * organization id comes from the session, never from the request body.
 *
 * All seven reads run in parallel and are cheap list queries the Studio
 * page already performs for its own panels.
 */
export async function loadRecordContentCounts(
  organizationId: Id,
  inventionId: Id,
): Promise<RecordContentCounts> {
  const { data } = getAdapters();
  const [
    sources,
    facts,
    psPairs,
    components,
    drafts,
    interviewSessions,
    figureSets,
  ] = await Promise.all([
    data.listSources(organizationId, inventionId),
    data.listFacts(organizationId, inventionId),
    data.listPsPairs(organizationId, inventionId),
    data.listComponents(organizationId, inventionId),
    data.listDrafts(organizationId, inventionId),
    data.listInterviewSessions(organizationId, inventionId),
    data.listFigureSets(organizationId, inventionId),
  ]);
  return {
    sources: sources.length,
    facts: facts.length,
    psPairs: psPairs.length,
    components: components.length,
    drafts: drafts.length,
    interviewSessions: interviewSessions.length,
    figureSets: figureSets.length,
  };
}

/** Convenience wrapper: load the counts and apply the shared predicate. */
export async function isInventionRecordEmpty(
  organizationId: Id,
  inventionId: Id,
): Promise<boolean> {
  return isEmptyRecord(await loadRecordContentCounts(organizationId, inventionId));
}
