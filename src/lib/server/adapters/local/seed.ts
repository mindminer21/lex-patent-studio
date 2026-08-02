import type { DataPort, Id } from "../types";

/**
 * Seeds a SYNTHETIC demonstration invention record for a new organization.
 * Every seeded record is flagged `synthetic: true` and titled accordingly —
 * no real client, privileged, or confidential data ever enters local mode.
 */
export async function seedSyntheticInvention(data: DataPort, organizationId: Id): Promise<Id> {
  const invention = await data.createInvention({
    organizationId,
    title: "Modular battery enclosure with phase-change cooling (SYNTHETIC EXAMPLE)",
    summary:
      "A demonstration record seeded with synthetic data. A battery enclosure divided into replaceable cell modules, each thermally coupled to a phase-change material cartridge that absorbs heat spikes during fast charging.",
    businessContext:
      "Synthetic example: an early-stage company preparing counsel-ready materials ahead of a seed extension and first customer pilots.",
    problem:
      "Fast charging produces thermal spikes that degrade cells; existing liquid cooling adds weight, cost, and points of failure for small-format packs.",
    solution:
      "Replaceable phase-change cartridges inside each cell module absorb transient heat without pumps; a shared aluminum frame conducts steady-state heat to a passive exterior fin array.",
    synthetic: true,
  });

  const facts: Array<{
    category: "technical" | "contributor" | "timeline" | "ownership" | "business";
    statement: string;
    provenance: "user_asserted" | "source_supported" | "needs_confirmation" | "disputed";
  }> = [
    {
      category: "technical",
      statement:
        "Each cell module accepts a replaceable phase-change material cartridge rated for 40 W-min transient absorption.",
      provenance: "source_supported",
    },
    {
      category: "technical",
      statement:
        "The enclosure frame is extruded aluminum with integrated fin channels; no pumps or fluid loops are used.",
      provenance: "user_asserted",
    },
    {
      category: "technical",
      statement:
        "Prototype thermal test on 2026-05-14 showed peak cell temperature reduced by 11 °C during 4C charge.",
      provenance: "needs_confirmation",
    },
    {
      category: "contributor",
      statement:
        "Cartridge latch mechanism was designed by Riley Nakamura (synthetic person) in April 2026.",
      provenance: "user_asserted",
    },
    {
      category: "timeline",
      statement:
        "A slide describing the cooling concept was shown to a prospective customer on 2026-06-02; whether an NDA was in place is unconfirmed.",
      provenance: "needs_confirmation",
    },
    {
      category: "ownership",
      statement:
        "One contributor performed early work while employed at a previous company; assignment status for that work is disputed by the contributor.",
      provenance: "disputed",
    },
  ];

  for (const fact of facts) {
    await data.createFact({
      organizationId,
      inventionId: invention.id,
      category: fact.category,
      statement: fact.statement,
      provenance: fact.provenance,
      createdBy: "user",
    });
  }

  const contributors = [
    ["Aisha Demir (synthetic person)", "aisha@example.test", "Overall architecture; enclosure frame design and thermal modeling."],
    ["Riley Nakamura (synthetic person)", "riley@example.test", "Replaceable cartridge latch mechanism and module interface."],
    ["Sam Okafor (synthetic person)", null, "Phase-change material selection and bench thermal testing."],
  ] as const;

  for (const [name, email, contribution] of contributors) {
    await data.createContributor({
      organizationId,
      inventionId: invention.id,
      name,
      email,
      contribution,
    });
  }

  const events = [
    ["2026-03-20", "other", "First whiteboard concept of modular phase-change cooling recorded in lab notebook.", false],
    ["2026-05-14", "other", "Prototype thermal test completed; results in test report TR-armadillo-7.", false],
    ["2026-06-02", "disclosure", "Concept slide shown to prospective customer; NDA status unconfirmed.", false],
    ["2026-07-10", "funding_or_diligence", "Investor technical diligence call referenced the cooling design at a high level.", true],
  ] as const;

  for (const [date, kind, description, underNda] of events) {
    await data.createDisclosureEvent({
      organizationId,
      inventionId: invention.id,
      date,
      kind,
      description,
      underNda,
    });
  }

  const sources = [
    ["Lab notebook pages 41-58 (synthetic)", "lab_notebook", "Concept sketches and test setup notes.", "extracted"],
    ["Thermal test report TR-armadillo-7 (synthetic)", "data", "Bench results for 4C charge cycles.", "extracted"],
    ["Enclosure CAD package rev C (synthetic)", "design_doc", "Frame, module, and cartridge geometry.", "scanned"],
    ["Customer concept slide (synthetic)", "presentation", "Single slide shown on 2026-06-02.", "registered"],
  ] as const;

  for (const [name, kind, note, status] of sources) {
    await data.createSource({
      organizationId,
      inventionId: invention.id,
      name,
      kind,
      note,
      status,
      synthetic: true,
      originalFilename: null,
      mimeType: null,
      byteSize: null,
      storagePath: null,
      checksumSha256: null,
      quarantineReason: null,
      interpretationStatus: null,
    });
  }

  await data.appendAuditEvent({
    organizationId,
    actor: "system",
    action: "seed.synthetic_invention",
    target: invention.id,
    meta: { synthetic: true },
  });

  return invention.id;
}
