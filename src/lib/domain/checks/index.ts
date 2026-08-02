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
  summarizeFindings,
  type CheckFinding,
  type CheckResult,
  type CheckSeverity,
  type ClaimInput,
} from "./types";
