import type { CheckFinding, CheckResult } from "./types";

/**
 * SB/08 (Information Disclosure Statement) field validator
 * (PRD §5.1 "IDS preparation … SB/08 field validation for Patent Center
 * autoload", FR-7 deterministic stage, §16 unit-test target).
 *
 * Pure function over structured IDS citation rows. Deterministic rules —
 * never model opinion:
 *
 *  - SB08-US-NUMBER-MISSING      U.S. patent row without a number      (error)
 *  - SB08-US-NUMBER-FORMAT       malformed U.S. patent number          (error)
 *  - SB08-PUB-NUMBER-FORMAT      malformed U.S. publication number     (error)
 *  - SB08-DATE-MISSING           required date absent                  (error)
 *  - SB08-DATE-FORMAT            date not YYYY-MM-DD                   (error)
 *  - SB08-DATE-FUTURE            date after the validation date        (error)
 *  - SB08-NAME-MISSING           patentee/applicant name absent        (error)
 *  - SB08-COUNTRY-MISSING        foreign row without ST.3 country code (error)
 *  - SB08-COUNTRY-FORMAT         country code not two letters          (error)
 *  - SB08-NPL-DESCRIPTION        NPL row without a usable description  (error)
 *  - SB08-NPL-HAS-NUMBER         NPL row carrying a patent number      (error)
 *  - SB08-DUPLICATE              duplicate citation in the packet      (warning)
 *  - SB08-RELEVANCE-MISSING      foreign/NPL row without relevance or
 *                                translation indication (37 CFR 1.98)  (warning)
 */

export const SB08_CHECKER = "sb08-validation";
export const SB08_CHECKER_VERSION = "1.0.0";

export type Sb08RowKind = "us_patent" | "us_publication" | "foreign" | "npl";

export interface Sb08Row {
  /** 1-based row number in the packet (used as the finding anchor). */
  row: number;
  kind: Sb08RowKind;
  /** Patent/publication/document number as it will autoload. */
  citeNumber?: string;
  /** Kind code (e.g. A1, B2) where applicable. */
  kindCode?: string;
  /** Issue date / publication date, YYYY-MM-DD. */
  date?: string;
  /** Patentee or applicant of cited document. */
  name?: string;
  /** WIPO ST.3 two-letter code for foreign documents. */
  countryCode?: string;
  /** NPL description, or relevance/translation passage for foreign rows. */
  description?: string;
}

const US_PATENT_NUMBER =
  /^(?:RE\s?\d{4,6}|D\s?\d{5,7}|PP\s?\d{4,6}|\d{1,2},?\d{3},?\d{3}|\d{6,8})$/i;
const US_PUBLICATION_NUMBER = /^(?:US\s?)?\d{4}[/-]?\d{7}(?:\s?[A-Z]\d)?$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function findingFor(
  row: Sb08Row,
  code: string,
  severity: "error" | "warning",
  message: string,
): CheckFinding {
  return { code, severity, claimNumber: row.row, message };
}

/**
 * Validate an SB/08 row set. `asOfDate` (YYYY-MM-DD) bounds the future-date
 * rule; it defaults to today for interactive use but MUST be passed by the
 * orchestrator so runs stay deterministic and reproducible.
 */
export function checkSb08(
  rows: Sb08Row[],
  asOfDate: string = new Date().toISOString().slice(0, 10),
): CheckResult {
  const findings: CheckFinding[] = [];
  const seen = new Map<string, number>();

  for (const row of rows) {
    const number = row.citeNumber?.trim() ?? "";
    const name = row.name?.trim() ?? "";
    const description = row.description?.trim() ?? "";
    const date = row.date?.trim() ?? "";

    // Duplicate detection across the packet.
    const dupKey = `${row.kind}:${(number || description).toLowerCase()}`;
    if ((number || description) && seen.has(dupKey)) {
      findings.push(
        findingFor(
          row,
          "SB08-DUPLICATE",
          "warning",
          `Row ${row.row} duplicates row ${seen.get(dupKey)} — remove before filing preparation.`,
        ),
      );
    } else if (number || description) {
      seen.set(dupKey, row.row);
    }

    // Date rules (US patents, publications, foreign require a date).
    const dateRequired = row.kind !== "npl";
    if (!date && dateRequired) {
      findings.push(
        findingFor(row, "SB08-DATE-MISSING", "error", `Row ${row.row}: date is required for ${row.kind} citations.`),
      );
    } else if (date && !ISO_DATE.test(date)) {
      findings.push(
        findingFor(row, "SB08-DATE-FORMAT", "error", `Row ${row.row}: date "${date}" must be YYYY-MM-DD.`),
      );
    } else if (date && date > asOfDate) {
      findings.push(
        findingFor(row, "SB08-DATE-FUTURE", "error", `Row ${row.row}: date ${date} is after the validation date ${asOfDate}.`),
      );
    }

    switch (row.kind) {
      case "us_patent": {
        if (!number) {
          findings.push(
            findingFor(row, "SB08-US-NUMBER-MISSING", "error", `Row ${row.row}: U.S. patent number is required.`),
          );
        } else if (!US_PATENT_NUMBER.test(number)) {
          findings.push(
            findingFor(row, "SB08-US-NUMBER-FORMAT", "error", `Row ${row.row}: "${number}" is not a valid U.S. patent number format.`),
          );
        }
        if (!name) {
          findings.push(
            findingFor(row, "SB08-NAME-MISSING", "error", `Row ${row.row}: name of patentee is required.`),
          );
        }
        break;
      }
      case "us_publication": {
        if (!number || !US_PUBLICATION_NUMBER.test(number)) {
          findings.push(
            findingFor(row, "SB08-PUB-NUMBER-FORMAT", "error", `Row ${row.row}: "${number || "(empty)"}" is not a valid U.S. publication number (YYYY/NNNNNNN).`),
          );
        }
        if (!name) {
          findings.push(
            findingFor(row, "SB08-NAME-MISSING", "error", `Row ${row.row}: applicant of cited document is required.`),
          );
        }
        break;
      }
      case "foreign": {
        if (!row.countryCode) {
          findings.push(
            findingFor(row, "SB08-COUNTRY-MISSING", "error", `Row ${row.row}: WIPO ST.3 country code is required for foreign documents.`),
          );
        } else if (!/^[A-Z]{2}$/.test(row.countryCode)) {
          findings.push(
            findingFor(row, "SB08-COUNTRY-FORMAT", "error", `Row ${row.row}: country code "${row.countryCode}" must be two uppercase letters.`),
          );
        }
        if (!number) {
          findings.push(
            findingFor(row, "SB08-US-NUMBER-MISSING", "error", `Row ${row.row}: foreign document number is required.`),
          );
        }
        if (!description) {
          findings.push(
            findingFor(row, "SB08-RELEVANCE-MISSING", "warning", `Row ${row.row}: 37 CFR 1.98 — provide a concise explanation of relevance or an English translation indication for non-English documents.`),
          );
        }
        break;
      }
      case "npl": {
        if (number) {
          findings.push(
            findingFor(row, "SB08-NPL-HAS-NUMBER", "error", `Row ${row.row}: non-patent literature rows must not carry a patent number ("${number}").`),
          );
        }
        if (description.length < 20) {
          findings.push(
            findingFor(row, "SB08-NPL-DESCRIPTION", "error", `Row ${row.row}: NPL citation requires a full bibliographic description (publisher, date, pages where applicable).`),
          );
        }
        break;
      }
    }
  }

  return {
    checker: SB08_CHECKER,
    checkerVersion: SB08_CHECKER_VERSION,
    passed: findings.every((f) => f.severity !== "error"),
    findings,
  };
}
