import { describe, expect, it } from "vitest";
import {
  allocateNumerals,
  checkRegistryConsistency,
  labelFor,
  nextSuffix,
  NUMERAL_START,
  NUMERAL_STEP,
  partKey,
  validateNumeralToken,
} from "@/lib/server/figures/numerals";
import type { NumeralEntry } from "@/lib/server/figures/types";

/**
 * The numeral registry is what turns 37 CFR 1.84(p)(4) cross-view
 * consistency from a hope into a mechanical guarantee, so it gets tested
 * hard: no renumbering, no collisions, no primed numerals.
 */

function entry(numeral: string, partLabel: string): NumeralEntry {
  return { numeral, partLabel, componentId: null, firstAssignedFigureNumber: 1 };
}

describe("numeral token validity", () => {
  it("accepts plain Arabic numerals with an optional capital suffix", () => {
    expect(validateNumeralToken("10")).toBeNull();
    expect(validateNumeralToken("100")).toBeNull();
    expect(validateNumeralToken("16A")).toBeNull();
  });

  it("rejects enclosed, primed and malformed characters", () => {
    expect(validateNumeralToken("(10)")?.kind).toBe("invalid_numeral");
    expect(validateNumeralToken("'10'")?.kind).toBe("invalid_numeral");
    expect(validateNumeralToken("10'")?.reason).toMatch(/primed/i);
    expect(validateNumeralToken("10′")?.reason).toMatch(/primed/i);
    expect(validateNumeralToken("10a")?.kind).toBe("invalid_numeral");
    expect(validateNumeralToken("010")?.kind).toBe("invalid_numeral");
    expect(validateNumeralToken(" 10")?.reason).toMatch(/whitespace/i);
  });
});

describe("allocation", () => {
  it("starts at 10 and steps by 2, leaving odd numbers free", () => {
    const result = allocateNumerals([], [
      { partLabel: "housing" },
      { partLabel: "spring" },
      { partLabel: "latch" },
    ]);
    expect(result.entries.map((e) => e.numeral)).toEqual(["10", "12", "14"]);
    expect(NUMERAL_START).toBe(10);
    expect(NUMERAL_STEP).toBe(2);
    expect(result.conflicts).toEqual([]);
  });

  it("NEVER renumbers a part that is already registered", () => {
    const existing = [entry("10", "housing"), entry("12", "spring")];
    const result = allocateNumerals(existing, [
      { partLabel: "spring" },
      { partLabel: "housing" },
      { partLabel: "latch" },
    ]);
    expect(result.assigned.get("housing")).toBe("10");
    expect(result.assigned.get("spring")).toBe("12");
    expect(result.assigned.get("latch")).toBe("14");
  });

  it("treats case and whitespace differences as the same part", () => {
    expect(partKey("  Intake  Manifold ")).toBe(partKey("intake manifold"));
    const result = allocateNumerals([entry("10", "Intake Manifold")], [
      { partLabel: "intake   manifold" },
    ]);
    expect(result.assigned.get("intake   manifold")).toBe("10");
    expect(result.entries).toHaveLength(1);
  });

  it("honors a free preferred numeral and reports a colliding one", () => {
    const good = allocateNumerals([], [{ partLabel: "housing", preferredNumeral: "100" }]);
    expect(good.assigned.get("housing")).toBe("100");
    expect(good.conflicts).toEqual([]);

    const clash = allocateNumerals([entry("10", "housing")], [
      { partLabel: "spring", preferredNumeral: "10" },
    ]);
    expect(clash.conflicts[0].kind).toBe("duplicate_numeral");
    // The colliding request still gets a valid, distinct numeral.
    expect(clash.assigned.get("spring")).not.toBe("10");
  });

  it("reports (never silently applies) a proposed renumbering of a known part", () => {
    const result = allocateNumerals([entry("10", "housing")], [
      { partLabel: "housing", preferredNumeral: "40" },
    ]);
    expect(result.assigned.get("housing")).toBe("10");
    expect(result.conflicts[0].kind).toBe("duplicate_part");
  });

  it("rejects a malformed preferred numeral and falls back to the convention", () => {
    const result = allocateNumerals([], [{ partLabel: "housing", preferredNumeral: "(12)" }]);
    expect(result.conflicts[0].kind).toBe("invalid_numeral");
    expect(result.assigned.get("housing")).toBe("10");
  });

  it("ignores blank part labels", () => {
    const result = allocateNumerals([], [{ partLabel: "   " }, { partLabel: "housing" }]);
    expect(result.entries).toHaveLength(1);
  });

  it("never hands the same numeral to two different parts", () => {
    const result = allocateNumerals(
      [],
      Array.from({ length: 60 }, (_, index) => ({ partLabel: `part ${index}` })),
    );
    const numerals = result.entries.map((e) => e.numeral);
    expect(new Set(numerals).size).toBe(numerals.length);
  });
});

describe("suffix letters for intervening parts", () => {
  it("mints 16A then 16B", () => {
    const registry = [entry("16", "bracket")];
    const first = nextSuffix(registry, "16");
    expect(first).toBe("16A");
    registry.push(entry(first, "bracket clip"));
    expect(nextSuffix(registry, "16")).toBe("16B");
  });

  it("throws rather than emitting a primed numeral when letters run out", () => {
    const registry = Array.from({ length: 26 }, (_, index) =>
      entry(`16${String.fromCharCode(65 + index)}`, `part ${index}`),
    );
    expect(() => nextSuffix(registry, "16")).toThrow(/no free suffix/i);
  });
});

describe("registry consistency", () => {
  it("passes a clean registry", () => {
    expect(
      checkRegistryConsistency([entry("10", "housing"), entry("12", "spring")]),
    ).toEqual([]);
  });

  it("flags one numeral designating two parts", () => {
    const conflicts = checkRegistryConsistency([
      entry("10", "housing"),
      entry("10", "spring"),
    ]);
    expect(conflicts[0].kind).toBe("duplicate_numeral");
  });

  it("flags one part carrying two numerals", () => {
    const conflicts = checkRegistryConsistency([
      entry("10", "housing"),
      entry("12", "housing"),
    ]);
    expect(conflicts.some((conflict) => conflict.kind === "duplicate_part")).toBe(true);
  });

  it("flags a malformed numeral in the registry", () => {
    const conflicts = checkRegistryConsistency([entry("10'", "housing")]);
    expect(conflicts[0].kind).toBe("invalid_numeral");
  });
});

describe("rename propagation", () => {
  it("resolves the label from the registry, so one edit updates every view", () => {
    // Views store only the numeral; the label lives in one place. Renaming
    // the part is therefore a single-row edit that every figure picks up.
    const registry = [entry("10", "housing")];
    expect(labelFor(registry, "10")).toBe("housing");
    registry[0].partLabel = "outer housing";
    expect(labelFor(registry, "10")).toBe("outer housing");
    expect(labelFor(registry, "99")).toBeNull();
  });
});
