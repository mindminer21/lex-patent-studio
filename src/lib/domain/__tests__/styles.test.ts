import { describe, expect, it } from "vitest";
import {
  PLAYBOOK_CHAIN_GENESIS,
  playbookContentSha256,
  playbookEntryHash,
  styleProfileCreateSchema,
  styleProfileVersionLabel,
  verifyPlaybookChain,
  type PlaybookEntry,
  type StyleProfile,
} from "@/lib/domain/styles";

function makeEntry(
  id: string,
  prevEntryHash: string,
  overrides: Partial<PlaybookEntry> = {},
): PlaybookEntry {
  const base = {
    id,
    organizationId: "org_demo_meridian",
    title: `Entry ${id}`,
    category: "approved_argument" as const,
    body: `Synthetic playbook body for ${id}.`,
    publishedBy: "user_demo_reyes",
    publishedByRole: "practitioner_admin" as const,
    publishedAt: "2026-07-01T12:00:00.000Z",
    prevEntryHash,
    ...overrides,
  };
  const contentSha256 = playbookContentSha256(base);
  const entryHash = playbookEntryHash({ ...base, contentSha256 });
  return { ...base, contentSha256, entryHash } as PlaybookEntry;
}

function makeChain(length: number): PlaybookEntry[] {
  const entries: PlaybookEntry[] = [];
  let prev = PLAYBOOK_CHAIN_GENESIS;
  for (let i = 1; i <= length; i += 1) {
    const entry = makeEntry(`pb_${i}`, prev);
    entries.push(entry);
    prev = entry.entryHash;
  }
  return entries;
}

describe("playbook hash chain (§5.4 immutable publication pipeline)", () => {
  it("verifies an intact chain", () => {
    const chain = makeChain(4);
    expect(verifyPlaybookChain(chain)).toEqual({ ok: true, checkedCount: 4 });
    expect(verifyPlaybookChain([])).toEqual({ ok: true, checkedCount: 0 });
  });

  it("detects content tampering after publication", () => {
    const chain = makeChain(3);
    chain[1] = { ...chain[1], body: "ALTERED body" };
    const result = verifyPlaybookChain(chain);
    expect(result.ok).toBe(false);
    expect(result.brokenAtId).toBe("pb_2");
    expect(result.reason).toMatch(/content hash/i);
  });

  it("detects publisher/timestamp tampering", () => {
    const chain = makeChain(3);
    chain[2] = { ...chain[2], publishedBy: "user_impostor" };
    const result = verifyPlaybookChain(chain);
    expect(result.ok).toBe(false);
    expect(result.brokenAtId).toBe("pb_3");
    expect(result.reason).toMatch(/entry hash|publication record/i);
  });

  it("detects reordering and splicing", () => {
    const chain = makeChain(3);
    const reordered = [chain[0], chain[2], chain[1]];
    expect(verifyPlaybookChain(reordered).ok).toBe(false);
    const spliced = [chain[0], chain[2]];
    expect(verifyPlaybookChain(spliced).ok).toBe(false);
  });
});

describe("style profiles", () => {
  it("version label matches the FR-7 run-record format", () => {
    const profile = {
      name: "neutral-professional",
      version: 1,
    } as StyleProfile;
    expect(styleProfileVersionLabel(profile)).toBe("neutral-professional@1");
  });

  it("creation input requires at least one rule and bounds rule length", () => {
    expect(
      styleProfileCreateSchema.safeParse({
        name: "Firm drafting style",
        kind: "application_drafting",
        rules: [],
      }).success,
    ).toBe(false);
    expect(
      styleProfileCreateSchema.safeParse({
        name: "Firm drafting style",
        kind: "application_drafting",
        rules: ["Use 'configured to' rather than means-plus-function phrasing."],
      }).success,
    ).toBe(true);
  });
});
