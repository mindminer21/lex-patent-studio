import { createHash } from "node:crypto";
import type { CorpusDocument, CorpusReleaseInfo, CorpusSection } from "./types";
import { isCommercialClear } from "./types";

/**
 * Local-mode synthetic corpus slice (PRD §6.1 layer model, FR-5).
 *
 * EVERY document below is a SYNTHETIC PARAPHRASE written for this repository.
 * No official text, third-party content, or licensed material is reproduced.
 * Production ingests official sources under the license audit (PRD §20.9);
 * this slice exists so retrieval ordering, as-of filtering, supersession,
 * license gating, and quote verification are REAL, testable code paths.
 *
 * The corpus registry is append-only with release versioning; a workflow run
 * records the corpus release it retrieved against (§6.5).
 */

export const CORPUS_RELEASE = "corpus-2026.07.2 (local snapshot)";

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

function doc(
  input: Omit<CorpusDocument, "checksum" | "confidentialityClass" | "synthetic">,
): CorpusDocument {
  return {
    ...input,
    confidentialityClass: "public",
    synthetic: true,
    checksum: sha256(input.sections.map((s: CorpusSection) => s.text).join("\n")),
  };
}

const SYNTH = (modeledOn: string): string =>
  `SYNTHETIC paraphrase for local-mode demonstration, modeled on ${modeledOn}. Production ingests the official text under the §20.9 license audit.`;

export const SYNTHETIC_CORPUS: CorpusDocument[] = [
  // -------------------------------------------------------------- Primary law
  doc({
    id: "corp_usc_112",
    sourceType: "statute",
    collection: "drafting",
    jurisdiction: "US",
    citation: "35 U.S.C. § 112",
    title: "Specification — written description, enablement, definiteness",
    edition: "AIA (post-2012) codification",
    effectiveDate: "2013-09-16",
    licenseClass: "government_work",
    licenseBasis: "U.S. government edict/work; 17 U.S.C. § 105; bulk-access terms verified",
    provenance: SYNTH("35 U.S.C. § 112"),
    sections: [
      {
        id: "usc112_a",
        heading: "(a) In general",
        text: "The specification shall contain a written description of the invention, and of the manner and process of making and using it, in such full, clear, concise, and exact terms as to enable any person skilled in the art to which it pertains to make and use the same, and shall set forth the best mode contemplated by the inventor of carrying out the invention.",
      },
      {
        id: "usc112_b",
        heading: "(b) Conclusion",
        text: "The specification shall conclude with one or more claims particularly pointing out and distinctly claiming the subject matter which the inventor or a joint inventor regards as the invention.",
      },
    ],
  }),
  doc({
    id: "corp_usc_103",
    sourceType: "statute",
    collection: "prosecution",
    jurisdiction: "US",
    citation: "35 U.S.C. § 103",
    title: "Conditions for patentability; non-obvious subject matter",
    edition: "AIA (post-2012) codification",
    effectiveDate: "2013-03-16",
    licenseClass: "government_work",
    licenseBasis: "U.S. government edict/work; 17 U.S.C. § 105",
    provenance: SYNTH("35 U.S.C. § 103"),
    sections: [
      {
        id: "usc103_main",
        heading: "Section text",
        text: "A patent for a claimed invention may not be obtained, notwithstanding that the claimed invention is not identically disclosed as set forth in section 102, if the differences between the claimed invention and the prior art are such that the claimed invention as a whole would have been obvious before the effective filing date of the claimed invention to a person having ordinary skill in the art to which the claimed invention pertains.",
      },
    ],
  }),
  doc({
    id: "corp_usc_102",
    sourceType: "statute",
    collection: "prosecution",
    jurisdiction: "US",
    citation: "35 U.S.C. § 102",
    title: "Conditions for patentability; novelty and grace period",
    edition: "AIA (post-2012) codification",
    effectiveDate: "2013-03-16",
    licenseClass: "government_work",
    licenseBasis: "U.S. government edict/work; 17 U.S.C. § 105",
    provenance: SYNTH("35 U.S.C. § 102"),
    sections: [
      {
        id: "usc102_a1",
        heading: "(a)(1) Novelty; prior art",
        text: "A person shall be entitled to a patent unless the claimed invention was patented, described in a printed publication, or in public use, on sale, or otherwise available to the public before the effective filing date of the claimed invention.",
      },
      {
        id: "usc102_b1",
        heading: "(b)(1) Exceptions — grace period",
        text: "A disclosure made one year or less before the effective filing date of a claimed invention shall not be prior art to the claimed invention under subsection (a)(1) if the disclosure was made by the inventor or joint inventor or by another who obtained the subject matter disclosed directly or indirectly from the inventor or a joint inventor.",
      },
    ],
  }),
  doc({
    id: "corp_cfr_197",
    sourceType: "regulation",
    collection: "prosecution",
    jurisdiction: "US",
    citation: "37 C.F.R. § 1.97",
    title: "Filing of information disclosure statement",
    edition: "eCFR point-in-time",
    effectiveDate: "2012-09-16",
    licenseClass: "government_work",
    licenseBasis: "U.S. government work; eCFR bulk terms verified",
    provenance: SYNTH("37 C.F.R. § 1.97"),
    sections: [
      {
        id: "cfr197_b",
        heading: "(b) Timing windows",
        text: "An information disclosure statement shall be considered by the Office if filed within three months of the filing date of a national application other than a continued prosecution application, within three months of the date of entry of the national stage in an international application, before the mailing of a first Office action on the merits, or before the mailing of a first Office action after the filing of a request for continued examination.",
      },
      {
        id: "cfr197_h",
        heading: "(h) No admission",
        text: "The filing of an information disclosure statement shall not be construed to be an admission that the information cited in the statement is, or is considered to be, material to patentability as defined in this part.",
      },
    ],
  }),
  doc({
    id: "corp_cfr_1118",
    sourceType: "regulation",
    collection: "prosecution",
    jurisdiction: "US",
    citation: "37 C.F.R. § 11.18",
    title: "Signature and certificate for correspondence filed in the Office",
    edition: "eCFR point-in-time",
    effectiveDate: "2013-05-03",
    licenseClass: "government_work",
    licenseBasis: "U.S. government work; eCFR bulk terms verified",
    provenance: SYNTH("37 C.F.R. § 11.18"),
    sections: [
      {
        id: "cfr1118_b",
        heading: "(b) Certification on presentation",
        text: "By presenting any paper to the Office, the party presenting such paper is certifying that statements made therein of the party's own knowledge are true, and that to the best of the party's knowledge formed after an inquiry reasonable under the circumstances the legal contentions therein are warranted by existing law and the factual contentions have evidentiary support.",
      },
    ],
  }),
  // ------------------------------------------------------------ Case law
  doc({
    id: "corp_ksr",
    sourceType: "case_scotus",
    collection: "prosecution",
    jurisdiction: "US",
    citation: "KSR Int'l Co. v. Teleflex Inc., 550 U.S. 398 (2007)",
    title: "Obviousness — flexible approach; combination of familiar elements",
    edition: "Decided 2007-04-30; precedential",
    effectiveDate: "2007-04-30",
    licenseClass: "government_work",
    licenseBasis: "Government-edicts doctrine; official reporter text",
    provenance: SYNTH("the KSR v. Teleflex holding"),
    sections: [
      {
        id: "ksr_holding",
        heading: "Holding (paraphrase)",
        text: "The combination of familiar elements according to known methods is likely to be obvious when it does no more than yield predictable results, and a rigid application of the teaching-suggestion-motivation test is inconsistent with the expansive and flexible approach the obviousness inquiry requires.",
      },
    ],
  }),
  doc({
    id: "corp_nautilus",
    sourceType: "case_scotus",
    collection: "drafting",
    jurisdiction: "US",
    citation: "Nautilus, Inc. v. Biosig Instruments, Inc., 572 U.S. 898 (2014)",
    title: "Definiteness — reasonable certainty standard",
    edition: "Decided 2014-06-02; precedential",
    effectiveDate: "2014-06-02",
    licenseClass: "government_work",
    licenseBasis: "Government-edicts doctrine; official reporter text",
    provenance: SYNTH("the Nautilus v. Biosig holding"),
    sections: [
      {
        id: "nautilus_holding",
        heading: "Holding (paraphrase)",
        text: "A patent is invalid for indefiniteness if its claims, read in light of the specification delineating the patent and the prosecution history, fail to inform, with reasonable certainty, those skilled in the art about the scope of the invention.",
      },
    ],
  }),
  doc({
    id: "corp_cafc_meridian",
    sourceType: "case_cafc",
    collection: "drafting",
    jurisdiction: "US",
    citation: "In re Meridian Signal Processing, No. 2019-1234 (Fed. Cir. 2019) [SYNTHETIC CASE]",
    title: "Antecedent basis and claim-term consistency (synthetic demonstration case)",
    edition: "Synthetic precedential-style opinion for local demo",
    effectiveDate: "2019-08-14",
    licenseClass: "government_work",
    licenseBasis: "Synthetic demonstration entry; production ingests official CAFC opinions",
    provenance:
      "FULLY SYNTHETIC case created for local-mode demonstration. It does not exist. Production ships only real, official opinions.",
    sections: [
      {
        id: "meridian_ab",
        heading: "Antecedent basis discussion (synthetic)",
        text: "A claim term that lacks an express antecedent is not automatically indefinite; the question remains whether the claim, read in light of the specification, informs skilled artisans of its scope with reasonable certainty, though drafting practice strongly favors explicit antecedent basis for every definite article.",
      },
    ],
  }),
  // ------------------------------------------------- Agency guidance (MPEP)
  doc({
    id: "corp_mpep_2143_e8",
    sourceType: "agency_guidance",
    collection: "prosecution",
    jurisdiction: "US",
    citation: "MPEP § 2143 (8th ed., Rev. 9)",
    title: "Examples of basic requirements of a prima facie case of obviousness (superseded edition)",
    edition: "Eighth Edition, Rev. 9 (Aug. 2012)",
    effectiveDate: "2012-08-01",
    supersededOn: "2014-03-01",
    supersededBy: "corp_mpep_2143",
    licenseClass: "government_work",
    licenseBasis: "U.S. government work; USPTO site terms verified",
    provenance: SYNTH("MPEP § 2143 (superseded edition; kept for point-in-time research)"),
    sections: [
      {
        id: "mpep2143_e8_main",
        heading: "Rationales (superseded edition)",
        text: "The pre-2014 edition articulated exemplary rationales supporting a conclusion of obviousness, including combining prior art elements according to known methods to yield predictable results, and noted that the list is not intended to be exhaustive.",
      },
    ],
  }),
  doc({
    id: "corp_mpep_2143",
    sourceType: "agency_guidance",
    collection: "prosecution",
    jurisdiction: "US",
    citation: "MPEP § 2143",
    title: "Examples of basic requirements of a prima facie case of obviousness",
    edition: "Ninth Edition, Rev. 07.2022",
    effectiveDate: "2014-03-01",
    licenseClass: "government_work",
    licenseBasis: "U.S. government work; USPTO site terms verified",
    provenance: SYNTH("MPEP § 2143"),
    sections: [
      {
        id: "mpep2143_main",
        heading: "Exemplary rationales",
        text: "Exemplary rationales that may support a conclusion of obviousness include combining prior art elements according to known methods to yield predictable results, simple substitution of one known element for another to obtain predictable results, and use of known technique to improve similar devices, methods, or products in the same way.",
      },
      {
        id: "mpep2143_note",
        heading: "Practice note",
        text: "Office personnel must articulate reasoning with rational underpinning; a conclusory statement that a combination would have been obvious is not sufficient to establish a prima facie case.",
      },
    ],
  }),
  doc({
    id: "corp_mpep_609",
    sourceType: "agency_guidance",
    collection: "prosecution",
    jurisdiction: "US",
    citation: "MPEP § 609",
    title: "Information disclosure statement",
    edition: "Ninth Edition, Rev. 07.2022",
    effectiveDate: "2014-03-01",
    licenseClass: "government_work",
    licenseBasis: "U.S. government work; USPTO site terms verified",
    provenance: SYNTH("MPEP § 609"),
    sections: [
      {
        id: "mpep609_main",
        heading: "IDS mechanics",
        text: "An information disclosure statement enables an applicant to submit to the Office information believed to be material to patentability; the content requirements include a list of each item of information and a legible copy of each cited foreign patent document and non-patent literature item, with timing governed by the applicable rule windows.",
      },
    ],
  }),
  doc({
    id: "corp_fr_ai_guidance",
    sourceType: "agency_guidance",
    collection: "prosecution",
    jurisdiction: "US",
    citation: "89 Fed. Reg. 25609 (Apr. 11, 2024)",
    title: "USPTO guidance on use of AI-based tools in practice before the Office",
    edition: "Federal Register notice",
    effectiveDate: "2024-04-11",
    licenseClass: "government_work",
    licenseBasis: "U.S. government work; Federal Register bulk terms",
    provenance: SYNTH("the USPTO AI-tools guidance notice"),
    sections: [
      {
        id: "fr_ai_main",
        heading: "Duty of review (paraphrase)",
        text: "Documents prepared with the assistance of artificial-intelligence tools must be reviewed by a person who forms a belief, after reasonable inquiry, that the paper is submitted consistently with the signature and certification requirements, and practitioners must consider confidentiality, foreign-filing license, and export-control implications of using such tools.",
      },
    ],
  }),
  // ---------------------------------------------------- PTAB (informative)
  doc({
    id: "corp_ptab_hulu",
    sourceType: "ptab_decision",
    collection: "ptab",
    jurisdiction: "US",
    citation: "Hulu, LLC v. Sound View Innovations, LLC, IPR2018-01039 (PTAB Dec. 20, 2019) (precedential)",
    title: "Printed-publication showing at institution",
    edition: "Precedential",
    effectiveDate: "2019-12-20",
    licenseClass: "government_work",
    licenseBasis: "U.S. government work; PTAB decision",
    provenance: SYNTH("the PTAB's Hulu precedential decision"),
    sections: [
      {
        id: "ptab_hulu_main",
        heading: "Standard (paraphrase)",
        text: "At the institution stage the petition must identify, with particularity, evidence sufficient to establish a reasonable likelihood that the reference was publicly accessible before the critical date, which is the touchstone of the printed-publication inquiry.",
      },
    ],
  }),
  // ------------------------------------- International (research grounding)
  doc({
    id: "corp_epo_gvii",
    sourceType: "intl_guidance",
    collection: "foreign_pct",
    jurisdiction: "EP",
    citation: "EPO Guidelines G-VII (inventive step)",
    title: "EPO problem-solution approach (research grounding only)",
    edition: "March 2024 edition",
    effectiveDate: "2024-03-01",
    licenseClass: "org_reuse_terms",
    licenseBasis: "EPO reuse terms — attribution required; redistribution reviewed per §6.4",
    provenance: SYNTH("EPO Guidelines G-VII"),
    sections: [
      {
        id: "epo_gvii_main",
        heading: "Problem-solution approach (paraphrase)",
        text: "In the problem-solution approach there are three main stages: determining the closest prior art, establishing the objective technical problem to be solved, and considering whether the claimed invention, starting from the closest prior art and the objective technical problem, would have been obvious to the skilled person.",
      },
    ],
  }),
  // ------------------------------------------------- Public patent data
  doc({
    id: "corp_pat_demo_ref_b",
    sourceType: "patent_document",
    collection: "technical_prior_art",
    jurisdiction: "US",
    citation: "US 10,987,654 B2 (synthetic reference B)",
    title: "Magnetic kinematic mount for optical assemblies (synthetic prior-art patent)",
    edition: "Granted 2021-04-27 (synthetic)",
    effectiveDate: "2021-04-27",
    licenseClass: "public_data_api",
    licenseBasis: "USPTO ODP public patent data; API terms respected",
    provenance:
      "FULLY SYNTHETIC prior-art patent used by the demo matters. Production links official patent records via USPTO ODP adapters instead of duplicating them.",
    sections: [
      {
        id: "patb_abstract",
        heading: "Abstract (synthetic)",
        text: "A kinematic mount for an optical element employs three hardened seats and a plurality of biasing magnets arranged to draw a carrier against the seats, whereby the carrier returns to a repeatable position after removal and replacement without adjustment.",
      },
    ],
  }),
  // ------------------------- License-blocked classes (registry entries only)
  doc({
    id: "corp_treatise_ch4",
    sourceType: "agency_guidance",
    collection: "drafting",
    jurisdiction: "US",
    citation: "Practical Patent Prosecution Treatise, ch. 4 [LICENSE-BLOCKED]",
    title: "Commercial treatise chapter — internal license only; never retrievable",
    edition: "3d ed. 2025",
    effectiveDate: "2025-01-01",
    licenseClass: "licensed_commercial",
    licenseBasis:
      "Internal license only. Commercial redistribution prohibited (PRD §6.4: do not port). Registry entry exists to prove the retrieval gate.",
    provenance:
      "Registry stub only — no content is stored or reachable. The license gate must refuse this document at retrieval.",
    sections: [
      {
        id: "treatise_stub",
        heading: "Content withheld",
        text: "Content withheld: this source class is not license-cleared for the commercial product and is unreachable by design.",
      },
    ],
  }),
  doc({
    id: "corp_cle_seminar",
    sourceType: "agency_guidance",
    collection: "prosecution",
    jurisdiction: "US",
    citation: "CLE seminar paper (2023) [LICENSE-BLOCKED]",
    title: "Recovered CLE reference material — do not port",
    edition: "2023",
    effectiveDate: "2023-06-01",
    licenseClass: "internal_only",
    licenseBasis: "Not individually licensed (PRD §6.4: do not port).",
    provenance: "Registry stub only — no content is stored or reachable.",
    sections: [
      {
        id: "cle_stub",
        heading: "Content withheld",
        text: "Content withheld: this source class is not license-cleared for the commercial product and is unreachable by design.",
      },
    ],
  }),
];

/** Registry lookup including license-blocked entries (metadata only). */
export function getRegistryEntry(id: string): CorpusDocument | undefined {
  return SYNTHETIC_CORPUS.find((d) => d.id === id);
}

export function getCorpusReleaseInfo(): CorpusReleaseInfo {
  const blocked = SYNTHETIC_CORPUS.filter((d) => !isCommercialClear(d.licenseClass));
  return {
    releaseId: CORPUS_RELEASE,
    createdAt: "2026-07-20T00:00:00.000Z",
    documentCount: SYNTHETIC_CORPUS.length,
    licenseBlockedCount: blocked.length,
    notes:
      "Immutable local-mode release of synthetic paraphrase snippets. Runs record this release id for reproducibility (§6.5). Production releases are built by the corpus pipeline after the §20.9 license audit.",
  };
}
