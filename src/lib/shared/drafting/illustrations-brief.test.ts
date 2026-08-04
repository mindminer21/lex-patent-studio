import { describe, expect, it } from "vitest";
import {
  briefDescriptionParagraphs,
  briefNumerals,
  describeBriefViolation,
  illustrationsBriefSchema,
  ILLUSTRATIONS_BRIEF_VERSION,
  isBriefUsable,
  partLabelFor,
  validateBriefConsistency,
  type IllustrationsBrief,
} from "./illustrations-brief";

function brief(overrides: Partial<IllustrationsBrief> = {}): IllustrationsBrief {
  return {
    version: ILLUSTRATIONS_BRIEF_VERSION,
    figures: [
      {
        figureNumber: 1,
        partialSuffix: null,
        viewType: "perspective",
        title: "Perspective view of the assembly",
        mustShow: "The housing enclosing the rotor and stator, with the bearing visible.",
        partNumerals: ["10", "12", "14"],
        briefDescription: "FIG. 1 is a perspective view of the assembly.",
        isPriorArt: false,
        sectionOf: null,
        needsInput: false,
        needsInputQuestion: "",
      },
    ],
    numerals: [
      { numeral: "10", partLabel: "housing", componentId: null, firstFigureNumber: 1 },
      { numeral: "12", partLabel: "rotor", componentId: null, firstFigureNumber: 1 },
      { numeral: "14", partLabel: "stator", componentId: null, firstFigureNumber: 1 },
    ],
    openQuestions: [],
    notes: "",
    ...overrides,
  };
}

describe("the brief schema", () => {
  it("accepts a well-formed brief", () => {
    expect(illustrationsBriefSchema.safeParse(brief()).success).toBe(true);
  });

  it("rejects a bracketed, primed, or malformed reference character", () => {
    for (const numeral of ["(10)", "10'", "10AB", "0", "abc"]) {
      const result = illustrationsBriefSchema.safeParse(
        brief({
          numerals: [{ numeral, partLabel: "part", componentId: null, firstFigureNumber: 1 }],
        }),
      );
      expect(result.success, numeral).toBe(false);
    }
  });

  it("requires a Brief Description sentence on a specified figure", () => {
    const result = illustrationsBriefSchema.safeParse(
      brief({ figures: [{ ...brief().figures[0], briefDescription: "  " }] }),
    );
    expect(result.success).toBe(false);
  });

  it("requires a needs-input figure to carry the question we are asking", () => {
    const result = illustrationsBriefSchema.safeParse(
      brief({
        figures: [
          {
            ...brief().figures[0],
            needsInput: true,
            briefDescription: "",
            needsInputQuestion: "",
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("allows a needs-input figure with no Brief Description — nothing to describe yet", () => {
    const result = illustrationsBriefSchema.safeParse(
      brief({
        figures: [
          {
            ...brief().figures[0],
            needsInput: true,
            briefDescription: "",
            needsInputQuestion: "Which side does the intake sit on?",
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });
});

describe("one numeral, one part — both directions", () => {
  it("flags a numeral assigned to two different parts", () => {
    const violations = validateBriefConsistency(
      brief({
        numerals: [
          { numeral: "10", partLabel: "housing", componentId: null, firstFigureNumber: 1 },
          { numeral: "10", partLabel: "cover", componentId: null, firstFigureNumber: 1 },
          { numeral: "12", partLabel: "rotor", componentId: null, firstFigureNumber: 1 },
          { numeral: "14", partLabel: "stator", componentId: null, firstFigureNumber: 1 },
        ],
      }),
    );
    const violation = violations.find((v) => v.kind === "duplicate_numeral");
    expect(violation).toBeDefined();
    expect(describeBriefViolation(violation!)).toContain("1.84(p)(4)");
  });

  it("flags a part carrying two numerals", () => {
    const violations = validateBriefConsistency(
      brief({
        figures: [{ ...brief().figures[0], partNumerals: ["10", "12", "14", "16"] }],
        numerals: [
          ...brief().numerals,
          { numeral: "16", partLabel: "Housing", componentId: null, firstFigureNumber: 1 },
        ],
      }),
    );
    expect(violations.some((v) => v.kind === "duplicate_part")).toBe(true);
  });

  it("treats case and spacing differences as the same part", () => {
    const violations = validateBriefConsistency(
      brief({
        figures: [{ ...brief().figures[0], partNumerals: ["10", "12", "14", "16"] }],
        numerals: [
          ...brief().numerals,
          { numeral: "16", partLabel: "  HOUSING  ", componentId: null, firstFigureNumber: 1 },
        ],
      }),
    );
    expect(violations.some((v) => v.kind === "duplicate_part")).toBe(true);
  });
});

describe("figure/numeral cross-references", () => {
  it("flags a figure citing a numeral the brief never assigned", () => {
    const violations = validateBriefConsistency(
      brief({ figures: [{ ...brief().figures[0], partNumerals: ["10", "12", "14", "44"] }] }),
    );
    const violation = violations.find((v) => v.kind === "unknown_numeral_in_figure");
    expect(violation).toBeDefined();
    expect(describeBriefViolation(violation!)).toContain("44");
  });

  it("flags a numeral assigned but appearing in no figure", () => {
    const violations = validateBriefConsistency(
      brief({
        numerals: [
          ...brief().numerals,
          { numeral: "20", partLabel: "shim", componentId: null, firstFigureNumber: null },
        ],
      }),
    );
    expect(violations.some((v) => v.kind === "numeral_in_no_figure")).toBe(true);
  });

  it("flags a specified figure that names no parts", () => {
    const violations = validateBriefConsistency(
      brief({ figures: [{ ...brief().figures[0], partNumerals: [] }] }),
    );
    expect(violations.some((v) => v.kind === "specified_figure_without_parts")).toBe(true);
  });

  it("flags a section of a figure that does not exist", () => {
    const violations = validateBriefConsistency(
      brief({ figures: [{ ...brief().figures[0], sectionOf: 7 }] }),
    );
    expect(violations.some((v) => v.kind === "section_of_unknown_figure")).toBe(true);
  });

  it("flags a gap in figure numbering", () => {
    const base = brief();
    const violations = validateBriefConsistency(
      brief({
        figures: [
          base.figures[0],
          {
            ...base.figures[0],
            figureNumber: 3,
            briefDescription: "FIG. 3 is a plan view.",
            viewType: "plan",
          },
        ],
      }),
    );
    expect(violations.some((v) => v.kind === "figure_numbers_not_consecutive")).toBe(true);
  });

  it("flags a duplicated figure number", () => {
    const base = brief();
    const violations = validateBriefConsistency(
      brief({ figures: [base.figures[0], { ...base.figures[0] }] }),
    );
    expect(violations.some((v) => v.kind === "duplicate_figure_number")).toBe(true);
  });
});

describe("usability and derived views", () => {
  it("accepts a clean brief", () => {
    expect(validateBriefConsistency(brief())).toEqual([]);
    expect(isBriefUsable(brief())).toBe(true);
  });

  it("is not usable when every figure needs input", () => {
    expect(
      isBriefUsable(
        brief({
          figures: [
            {
              ...brief().figures[0],
              needsInput: true,
              briefDescription: "",
              needsInputQuestion: "What does the intake look like?",
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("orders numerals numerically, not lexically", () => {
    const ordered = briefNumerals(
      brief({
        figures: [{ ...brief().figures[0], partNumerals: ["10", "12", "14", "100"] }],
        numerals: [
          { numeral: "100", partLabel: "shroud", componentId: null, firstFigureNumber: 1 },
          ...brief().numerals,
        ],
      }),
    ).map((entry) => entry.numeral);
    expect(ordered).toEqual(["10", "12", "14", "100"]);
  });

  it("derives the Brief Description paragraphs in figure order", () => {
    const base = brief();
    expect(
      briefDescriptionParagraphs(
        brief({
          figures: [
            {
              ...base.figures[0],
              figureNumber: 2,
              viewType: "plan",
              briefDescription: "FIG. 2 is a plan view.",
            },
            base.figures[0],
          ],
        }),
      ),
    ).toEqual(["FIG. 1 is a perspective view of the assembly.", "FIG. 2 is a plan view."]);
  });

  it("looks up a part label by numeral", () => {
    expect(partLabelFor(brief(), "12")).toBe("rotor");
    expect(partLabelFor(brief(), "99")).toBeNull();
  });
});
