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
import { getAdapters } from "../adapters";
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
}): ExportSectionContent[] {
  const { record, facts, contributors, events, sources, draftVersion } = input;
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

  const write = (text: string, options: { bold?: boolean; size?: number }) => {
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

  const sections = buildExportSections({
    record,
    facts,
    contributors,
    events,
    sources,
    draftVersion,
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
