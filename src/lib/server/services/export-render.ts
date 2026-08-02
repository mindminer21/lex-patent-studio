import "server-only";

import { createHash } from "node:crypto";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  COVERAGE_DIMENSION_LABELS,
  COVERAGE_DIMENSIONS,
} from "@/lib/wepatent/domain/coverage";
import { getAdapters } from "../adapters";
import type { LedgerView } from "./ps-ledger";
import type {
  ContributorRecord,
  DisclosureEventRecord,
  DraftVersionRecord,
  ExportRecordEntry,
  Id,
  InventionFactRecord,
  SourceRecord,
} from "../adapters/types";

/**
 * Counsel-package rendering (PRD §7.5): DOCX + PDF + manifest.json produced
 * by the export_render durable job. The export row's checksum remains the
 * manifest checksum; every artifact records its own SHA-256 in the
 * append-only export_artifacts table. Draft/legal status labels are part of
 * the document body so they survive print and export (PRD §12).
 */

export const DRAFT_LABEL = "WORKING DRAFT — COUNSEL REVIEW REQUIRED";

export type ExportSectionContent = {
  heading: string;
  lines: string[];
};

/**
 * Pure content builder shared by the DOCX and PDF renderers — unit-testable
 * guarantee that the required labels and notices appear in every artifact.
 */
export function buildExportSections(input: {
  record: ExportRecordEntry;
  facts: InventionFactRecord[];
  contributors: ContributorRecord[];
  events: DisclosureEventRecord[];
  sources: SourceRecord[];
  draftVersion: DraftVersionRecord | null;
  /** Intake Studio M1: P/S ledger + coverage (optional for older exports). */
  ledger?: LedgerView | null;
}): ExportSectionContent[] {
  const { record, facts, contributors, events, sources, draftVersion, ledger } = input;
  const manifest = record.manifest;
  const sections: ExportSectionContent[] = [];

  sections.push({
    heading: `Counsel-ready package: ${manifest.inventionTitle}`,
    lines: [
      manifest.notice,
      `Package created: ${manifest.generatedAt}`,
      `Manifest checksum (SHA-256): ${record.checksum}`,
      `Included draft: ${manifest.draftLabel}`,
      `Facts: ${manifest.factCount} (${manifest.unresolvedFactCount} unresolved) · Contributors: ${manifest.contributorCount} · Timeline events: ${manifest.disclosureEventCount} · Sources: ${manifest.sourceCount}`,
    ],
  });

  if (manifest.sections.includes("facts")) {
    sections.push({
      heading: "Canonical fact record",
      lines:
        facts.length > 0
          ? facts.map((fact) => `[${fact.category} · ${fact.provenance}] ${fact.statement}`)
          : ["No facts recorded."],
    });
  }
  if (manifest.sections.includes("contributors")) {
    sections.push({
      heading: "Contributors of record",
      lines:
        contributors.length > 0
          ? contributors.map(
              (contributor) =>
                `${contributor.name}${contributor.email ? ` <${contributor.email}>` : ""}: ${contributor.contribution}`,
            )
          : ["No contributors recorded."],
    });
  }
  if (manifest.sections.includes("timeline")) {
    sections.push({
      heading: "Disclosure and commercialization timeline",
      lines:
        events.length > 0
          ? events.map(
              (event) =>
                `${event.date} (${event.kind}${event.underNda ? ", under NDA" : ""}): ${event.description}`,
            )
          : ["No disclosure events recorded."],
    });
  }
  if (manifest.sections.includes("sources")) {
    sections.push({
      heading: "Source index",
      lines:
        sources.length > 0
          ? sources.map(
              (source) =>
                `${source.name} [${source.kind}] — pipeline status: ${source.status}${source.checksumSha256 ? ` · sha256 ${source.checksumSha256}` : ""}`,
            )
          : ["No sources registered."],
    });
  }

  if (manifest.sections.includes("ps_ledger") && ledger) {
    const componentById = new Map(ledger.components.map((component) => [component.id, component]));
    const pairById = new Map(ledger.pairs.map((pair) => [pair.id, pair]));
    const lines: string[] = [
      ledger.currentTitle
        ? `Working title (${ledger.currentTitle.state}): ${ledger.currentTitle.text}`
        : "No working title recorded.",
      "Item states: ai_proposed = unreviewed AI proposal · user_confirmed / user_edited = human-reviewed.",
      "",
    ];
    for (const pair of ledger.pairs) {
      lines.push(`[${pair.kind} · ${pair.state} · origin ${pair.origin}] ${pair.statement}`);
      if (pair.sourceAnchors.length > 0) {
        lines.push(`  Evidence anchors: ${pair.sourceAnchors.join(" · ")}`);
      }
      if (pair.kind === "solution") {
        const componentNames = ledger.associations
          .filter((association) => association.solutionId === pair.id)
          .map((association) =>
            association.componentId
              ? componentById.get(association.componentId)?.name
              : null,
          )
          .filter((name): name is string => Boolean(name));
        if (componentNames.length > 0) {
          lines.push(`  Associated components: ${componentNames.join(", ")}`);
        }
      }
    }
    if (ledger.pairs.length === 0) lines.push("No problem/solution items recorded.");
    if (ledger.links.length > 0) {
      lines.push("");
      lines.push("Problem–solution pairings:");
      for (const link of ledger.links) {
        const problem = pairById.get(link.problemId);
        const solution = pairById.get(link.solutionId);
        if (problem && solution) {
          // Note: keep this line WinAnsi-safe — the PDF renderer's standard
          // Helvetica cannot encode characters like "↔".
          lines.push(
            `  "${problem.statement.slice(0, 120)}" <-> "${solution.statement.slice(0, 120)}" (${link.state})`,
          );
        }
      }
    }
    if (ledger.components.length > 0) {
      lines.push("");
      lines.push("Component inventory:");
      for (const component of ledger.components) {
        lines.push(
          `  ${component.name} (${component.state})${component.description ? ` — ${component.description}` : ""}`,
        );
      }
    }
    sections.push({ heading: "Problem/Solution ledger", lines });
  }

  if (manifest.sections.includes("coverage") && ledger) {
    const lines: string[] = [
      `Enablement coverage of this record: ${ledger.coverage.aggregate.satisfied} of ${ledger.coverage.aggregate.total} checks satisfied (${ledger.coverage.version}).`,
      "This report is computed by a deterministic checklist over the recorded material — never by a model.",
      "It measures coverage of the record, NOT legal sufficiency. Qualified patent counsel must assess enablement and written-description support (35 U.S.C. § 112(a)).",
      "",
    ];
    ledger.coverage.perSolution.forEach((coverage, index) => {
      const solution = ledger.pairs.find((pair) => pair.id === coverage.solutionId);
      lines.push(
        `Solution ${index + 1} (${coverage.satisfiedCount}/${coverage.totalCount}): ${solution ? solution.statement.slice(0, 160) : coverage.solutionId}`,
      );
      for (const dimension of COVERAGE_DIMENSIONS) {
        const entry = coverage.dimensions[dimension];
        lines.push(
          `  - ${COVERAGE_DIMENSION_LABELS[dimension]}: ${entry.status}${entry.evidence ? ` (${entry.evidence})` : ""}`,
        );
      }
    });
    if (ledger.coverage.perSolution.length === 0) {
      lines.push("No solutions recorded yet; coverage cannot be assessed.");
    }
    sections.push({ heading: "Enablement coverage report (record coverage, not a legal opinion)", lines });
  }

  if (draftVersion) {
    sections.push({
      heading: `${DRAFT_LABEL} (v${draftVersion.version}, ${draftVersion.modelId})`,
      lines: [
        `Generated ${draftVersion.createdAt} · rate version ${draftVersion.rateVersion} · unresolved facts at generation: ${draftVersion.unresolvedFactCount}`,
        "",
        ...draftVersion.content.split("\n"),
      ],
    });
  }

  sections.push({
    heading: "Status of these materials",
    lines: [
      DRAFT_LABEL,
      "wepatent is not a law firm and does not provide legal advice. No attorney-client relationship is created by preparing or exporting this package.",
      "Later changes to the invention record do not alter this export; it references immutable version identifiers.",
    ],
  });

  return sections;
}

async function renderDocx(sections: ExportSectionContent[]): Promise<Uint8Array> {
  const children: Paragraph[] = [];
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: DRAFT_LABEL, bold: true, color: "A01212" })],
    }),
  );
  for (const section of sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 120 },
        children: [new TextRun({ text: section.heading, bold: true })],
      }),
    );
    for (const line of section.lines) {
      children.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: line })],
        }),
      );
    }
  }
  const document = new Document({
    creator: "wepatent (working materials — not legal advice)",
    title: "Counsel-ready package",
    sections: [{ children }],
  });
  const buffer = await Packer.toBuffer(document);
  return new Uint8Array(buffer);
}

function wrapText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > max) {
      if (current) lines.push(current.trim());
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

async function renderPdf(sections: ExportSectionContent[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595.28; // A4
  const pageHeight = 841.89;
  const margin = 50;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const write = (rawText: string, options: { bold?: boolean; size?: number }) => {
    // Standard Helvetica encodes WinAnsi only; user/model content can carry
    // arbitrary Unicode. Replace non-Latin-1 characters instead of crashing
    // the render job (the DOCX artifact keeps the original text).
    const text = rawText.replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?");
    const size = options.size ?? 10;
    const usable = Math.floor((pageWidth - margin * 2) / (size * 0.55));
    for (const line of wrapText(text, usable)) {
      if (y < margin + size) {
        page = pdf.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
        // Required-review label repeats on every page (PRD §12).
        page.drawText(DRAFT_LABEL, { x: margin, y, size: 9, font: bold });
        y -= 20;
      }
      page.drawText(line, { x: margin, y, size, font: options.bold ? bold : font });
      y -= size + 4;
    }
  };

  write(DRAFT_LABEL, { bold: true, size: 12 });
  y -= 8;
  for (const section of sections) {
    y -= 10;
    write(section.heading, { bold: true, size: 12 });
    for (const line of section.lines) {
      write(line || " ", {});
    }
  }
  return pdf.save();
}

export type RenderedArtifact = { name: string; contentType: string; bytes: number; sha256: string };

/** Executed by the export_render job. Idempotent: re-runs skip existing artifacts. */
export async function renderExportArtifacts(
  organizationId: Id,
  exportId: Id,
): Promise<{ artifacts: RenderedArtifact[] }> {
  const { data, storage } = getAdapters();
  const record = await data.getExport(organizationId, exportId);
  if (!record) throw new Error("export_not_found");

  const existing = await data.listExportArtifacts(organizationId, exportId);
  if (existing.length > 0) {
    return {
      artifacts: existing.map((artifact) => ({
        name: artifact.name,
        contentType: artifact.contentType,
        bytes: artifact.byteSize,
        sha256: artifact.sha256,
      })),
    };
  }

  const [facts, contributors, events, sources] = await Promise.all([
    data.listFacts(organizationId, record.inventionId),
    data.listContributors(organizationId, record.inventionId),
    data.listDisclosureEvents(organizationId, record.inventionId),
    data.listSources(organizationId, record.inventionId),
  ]);
  const draftVersion = record.draftVersionId
    ? await data.getDraftVersion(organizationId, record.draftVersionId)
    : null;
  const { getLedger } = await import("./ps-ledger");
  const ledger =
    record.manifest.sections.includes("ps_ledger") ||
    record.manifest.sections.includes("coverage")
      ? await getLedger(organizationId, record.inventionId)
      : null;

  const sections = buildExportSections({
    record,
    facts,
    contributors,
    events,
    sources,
    draftVersion,
    ledger,
  });

  const files: Array<{ name: string; contentType: string; bytes: Uint8Array }> = [
    {
      name: "counsel-package.docx",
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: await renderDocx(sections),
    },
    {
      name: "counsel-package.pdf",
      contentType: "application/pdf",
      bytes: await renderPdf(sections),
    },
    {
      name: "manifest.json",
      contentType: "application/json",
      bytes: new TextEncoder().encode(
        JSON.stringify({ manifest: record.manifest, checksum: record.checksum }, null, 2),
      ),
    },
  ];

  const rendered: RenderedArtifact[] = [];
  for (const file of files) {
    const path = `exports/${organizationId}/${exportId}/${file.name}`;
    await storage.put(path, file.bytes);
    const sha256 = createHash("sha256").update(file.bytes).digest("hex");
    await data.appendExportArtifact({
      organizationId,
      exportId,
      name: file.name,
      contentType: file.contentType,
      byteSize: file.bytes.length,
      sha256,
      storagePath: path,
    });
    rendered.push({
      name: file.name,
      contentType: file.contentType,
      bytes: file.bytes.length,
      sha256,
    });
  }
  return { artifacts: rendered };
}
