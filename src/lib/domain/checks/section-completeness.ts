import type { CheckFinding, CheckResult } from "./types";

/**
 * Section-completeness checker (PRD §5.1 "section completeness"; FR-7
 * deterministic stage). Pure function over a document's section headings
 * and bodies against a deliverable profile:
 *
 *  - SEC-MISSING   required section absent                       (error)
 *  - SEC-EMPTY     required section present but effectively empty (error)
 *  - SEC-ORDER     required sections out of expected order        (warning)
 *  - SEC-MIXED     OA responses: amendment and argument content
 *                  must be SEPARATE sections (PRD §5.1, §9.3)     (error)
 */

export const SECTION_COMPLETENESS_CHECKER = "section-completeness";
export const SECTION_COMPLETENESS_CHECKER_VERSION = "1.0.0";

export interface DocumentSectionInput {
  heading: string;
  body: string;
}

export type CompletenessProfileKey =
  | "utility_specification"
  | "oa_response"
  | "research_memo";

interface RequiredSection {
  key: string;
  /** Any of these patterns matches the heading (case-insensitive). */
  match: RegExp;
  label: string;
}

/**
 * Profiles reflect MPEP 608.01(a) arrangement (specification), separated
 * amendment/argument practice (OA responses), and the §9.5 memo contract.
 */
const PROFILES: Record<CompletenessProfileKey, RequiredSection[]> = {
  utility_specification: [
    { key: "background", match: /background/i, label: "Background" },
    { key: "summary", match: /summary/i, label: "Summary" },
    {
      key: "detailed_description",
      match: /detailed description/i,
      label: "Detailed description",
    },
    { key: "abstract", match: /abstract/i, label: "Abstract" },
  ],
  oa_response: [
    {
      key: "amendments",
      match: /amendment/i,
      label: "Amendments (MPEP-compliant markup)",
    },
    { key: "remarks", match: /remarks|argument/i, label: "Remarks / arguments" },
  ],
  research_memo: [
    { key: "question", match: /question presented/i, label: "Question presented" },
    { key: "answer", match: /short answer/i, label: "Short answer" },
    {
      key: "authority",
      match: /authority|source trail|sources/i,
      label: "Authority / source trail",
    },
  ],
};

const MIN_BODY_LENGTH = 40;

export function checkSectionCompleteness(
  sections: DocumentSectionInput[],
  profileKey: CompletenessProfileKey,
): CheckResult {
  const profile = PROFILES[profileKey];
  const findings: CheckFinding[] = [];

  const positions: Array<{ key: string; index: number }> = [];
  profile.forEach((required) => {
    const index = sections.findIndex((s) => required.match.test(s.heading));
    if (index === -1) {
      findings.push({
        code: "SEC-MISSING",
        severity: "error",
        claimNumber: 0,
        term: required.key,
        message: `Required section "${required.label}" is missing for a ${profileKey.replace(/_/g, " ")}.`,
      });
      return;
    }
    positions.push({ key: required.key, index });
    const body = sections[index].body.replace(/\s+/g, " ").trim();
    if (body.length < MIN_BODY_LENGTH) {
      findings.push({
        code: "SEC-EMPTY",
        severity: "error",
        claimNumber: 0,
        term: required.key,
        message: `Section "${required.label}" is effectively empty (${body.length} characters).`,
      });
    }
  });

  // SEC-ORDER: found sections must appear in profile order.
  for (let i = 1; i < positions.length; i += 1) {
    if (positions[i].index < positions[i - 1].index) {
      findings.push({
        code: "SEC-ORDER",
        severity: "warning",
        claimNumber: 0,
        term: positions[i].key,
        message: `Section "${positions[i].key}" appears before "${positions[i - 1].key}" — expected the ${profileKey.replace(/_/g, " ")} arrangement.`,
      });
    }
  }

  // SEC-MIXED: OA responses must not argue inside the amendment section.
  if (profileKey === "oa_response") {
    const amendment = sections.find((s) => /amendment/i.test(s.heading));
    if (
      amendment &&
      /(traversed?|respectfully submit|argu(e|ment|es)|contrary to the rejection)/i.test(
        amendment.body,
      )
    ) {
      findings.push({
        code: "SEC-MIXED",
        severity: "error",
        claimNumber: 0,
        term: "amendments",
        message:
          "Amendment section contains argument language — amendments and arguments must be drafted as separate sections (PRD §5.1, §9.3).",
      });
    }
  }

  return {
    checker: SECTION_COMPLETENESS_CHECKER,
    checkerVersion: SECTION_COMPLETENESS_CHECKER_VERSION,
    passed: findings.every((f) => f.severity !== "error"),
    findings,
  };
}
