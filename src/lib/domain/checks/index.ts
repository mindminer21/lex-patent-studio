export {
  checkClaimDependencies,
  parseDependency,
  CLAIM_DEPENDENCY_CHECKER,
  CLAIM_DEPENDENCY_CHECKER_VERSION,
  type ParsedDependency,
} from "./claim-dependency";
export {
  checkAntecedentBasis,
  introducedTerms,
  definiteReferences,
  ANTECEDENT_BASIS_CHECKER,
  ANTECEDENT_BASIS_CHECKER_VERSION,
} from "./antecedent-basis";
export {
  checkSb08,
  SB08_CHECKER,
  SB08_CHECKER_VERSION,
  type Sb08Row,
  type Sb08RowKind,
} from "./sb08";
export {
  checkNumeralConsistency,
  extractNumeralUses,
  extractFigureRefs,
  NUMERAL_CONSISTENCY_CHECKER,
  NUMERAL_CONSISTENCY_CHECKER_VERSION,
  type SpecSectionInput,
} from "./numeral-consistency";
export {
  checkSectionCompleteness,
  SECTION_COMPLETENESS_CHECKER,
  SECTION_COMPLETENESS_CHECKER_VERSION,
  type CompletenessProfileKey,
  type DocumentSectionInput,
} from "./section-completeness";
export {
  summarizeFindings,
  type CheckFinding,
  type CheckResult,
  type CheckSeverity,
  type ClaimInput,
} from "./types";
