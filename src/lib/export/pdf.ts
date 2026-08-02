import type { WorkProductDocument } from "@/lib/domain/schemas";
import { planDocx, type DocxPlan } from "./docx";

/**
 * USPTO-style PDF rendering (FR-8 "PDF rendering"), dependency-free.
 *
 * Mirrors the DOCX formatting rules: Times-Roman 12 pt, double-spaced body,
 * 1.5" left margin (1" top/right/bottom), the DRAFT watermark on every page
 * unless a human approved the document, and the export disclaimer in the
 * footer. Deterministic: identical input document → identical bytes (no
 * embedded timestamps), so the manifest's pdfSha256 is reproducible.
 *
 * A minimal PDF 1.4 writer with base-14 fonts is deliberate: it avoids a
 * heavyweight rendering dependency for local mode while producing valid,
 * openable PDFs. Production may swap a richer renderer behind the same
 * plan contract without changing manifests' guarantees.
 */

const PAGE_WIDTH = 612; // 8.5" × 72
const PAGE_HEIGHT = 792; // 11" × 72
const MARGIN_LEFT = 108; // 1.5"
const MARGIN_RIGHT = 72;
const MARGIN_TOP = 72;
const MARGIN_BOTTOM = 96; // extra room for footer + page number
const USABLE_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT; // 432pt

const BODY_SIZE = 12;
const BODY_LEADING = 28; // double-spaced 12pt
const META_SIZE = 10;
const FOOTER_SIZE = 8;

/** Approximate average glyph width for Times at size 1 (em fraction). */
const AVG_CHAR_WIDTH = 0.5;

/** WinAnsi mappings for the non-ASCII characters this product emits. */
const WINANSI: Record<string, number> = {
  "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94,
  "–": 0x96, "—": 0x97, "™": 0x99, "§": 0xa7, "©": 0xa9,
  "«": 0xab, "®": 0xae, "°": 0xb0, "±": 0xb1, "µ": 0xb5,
  "·": 0xb7, "»": 0xbb, "×": 0xd7, "é": 0xe9, "ü": 0xfc,
};

function encodeWinAnsi(text: string): Buffer {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    if (code === 0x28 || code === 0x29 || code === 0x5c) {
      bytes.push(0x5c, code); // escape ( ) \
    } else if (code >= 0x20 && code < 0x7f) {
      bytes.push(code);
    } else if (WINANSI[ch] !== undefined) {
      bytes.push(WINANSI[ch]);
    } else if (code >= 0xa0 && code <= 0xff) {
      bytes.push(code);
    } else {
      bytes.push(0x3f); // '?'
    }
  }
  return Buffer.from(bytes);
}

function wrap(text: string, size: number, width: number): string[] {
  const maxChars = Math.max(16, Math.floor(width / (size * AVG_CHAR_WIDTH)));
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length === 0) {
      line = word;
    } else if (line.length + 1 + word.length <= maxChars) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
    // Hard-break pathological unbroken tokens.
    while (line.length > maxChars) {
      lines.push(line.slice(0, maxChars));
      line = line.slice(maxChars);
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

interface Line {
  text: string;
  font: "F1" | "F2"; // F1 Times-Roman, F2 Times-Bold
  size: number;
  x: number;
  y: number;
  gray?: number;
}

function centeredX(text: string, size: number): number {
  const estimated = text.length * size * AVG_CHAR_WIDTH;
  return Math.max(MARGIN_LEFT, (PAGE_WIDTH - estimated) / 2);
}

/** Lay the plan out into pages of positioned lines. */
export function layoutPdfPages(plan: DocxPlan): Line[][] {
  const pages: Line[][] = [];
  let current: Line[] = [];
  let y = PAGE_HEIGHT - MARGIN_TOP - (plan.watermark ? 24 : 0);

  const pageChrome = (): Line[] => {
    const chrome: Line[] = [];
    if (plan.watermark) {
      chrome.push({
        text: plan.watermark,
        font: "F2",
        size: BODY_SIZE,
        x: centeredX(plan.watermark, BODY_SIZE),
        y: PAGE_HEIGHT - MARGIN_TOP + 8,
        gray: 0.55,
      });
    }
    return chrome;
  };

  const openPage = () => {
    current = pageChrome();
    y = PAGE_HEIGHT - MARGIN_TOP - (plan.watermark ? 20 : 0);
  };
  openPage();

  const emit = (
    text: string,
    font: Line["font"],
    size: number,
    leading: number,
    opts: { center?: boolean; gray?: number } = {},
  ) => {
    for (const lineText of wrap(text, size, USABLE_WIDTH)) {
      if (y < MARGIN_BOTTOM + 24) {
        pages.push(current);
        openPage();
      }
      current.push({
        text: lineText,
        font,
        size,
        x: opts.center ? centeredX(lineText, size) : MARGIN_LEFT,
        y,
        gray: opts.gray,
      });
      y -= leading;
    }
  };

  for (const paragraph of plan.paragraphs) {
    switch (paragraph.kind) {
      case "title":
        emit(paragraph.text.toUpperCase(), "F2", BODY_SIZE, BODY_LEADING, { center: true });
        break;
      case "meta":
        emit(paragraph.text, "F1", META_SIZE, 14, { center: true, gray: 0.25 });
        y -= 8;
        break;
      case "heading":
        y -= 6;
        emit(paragraph.text.toUpperCase(), "F2", BODY_SIZE, BODY_LEADING);
        break;
      case "flag":
        emit(paragraph.text, "F2", 11, 16, { gray: 0.3 });
        break;
      default:
        emit(paragraph.text, "F1", BODY_SIZE, BODY_LEADING);
    }
  }
  pages.push(current);

  // Footer chrome on every page.
  pages.forEach((page, index) => {
    const footerLines = wrap(plan.footerText, FOOTER_SIZE, USABLE_WIDTH);
    let footerY = MARGIN_BOTTOM - 28;
    for (const footerLine of footerLines.slice(0, 4)) {
      page.push({
        text: footerLine,
        font: "F1",
        size: FOOTER_SIZE,
        x: centeredX(footerLine, FOOTER_SIZE),
        y: footerY,
        gray: 0.35,
      });
      footerY -= 10;
    }
    const pageLabel = `Page ${index + 1} of ${pages.length}`;
    page.push({
      text: pageLabel,
      font: "F1",
      size: 9,
      x: centeredX(pageLabel, 9),
      y: footerY - 2,
      gray: 0.35,
    });
  });

  return pages;
}

function contentStream(lines: Line[]): Buffer {
  const parts: Buffer[] = [Buffer.from("BT\n")];
  let lastGray = -1;
  for (const line of lines) {
    const gray = line.gray ?? 0;
    if (gray !== lastGray) {
      parts.push(Buffer.from(`${gray.toFixed(2)} g\n`));
      lastGray = gray;
    }
    parts.push(
      Buffer.from(
        `/${line.font} ${line.size} Tf\n1 0 0 1 ${line.x.toFixed(2)} ${line.y.toFixed(2)} Tm\n(`,
      ),
      encodeWinAnsi(line.text),
      Buffer.from(") Tj\n"),
    );
  }
  parts.push(Buffer.from("ET\n"));
  return Buffer.concat(parts);
}

/** Render the document to a valid, deterministic PDF 1.4 buffer. */
export function renderUsptoPdf(document: WorkProductDocument): Buffer {
  const plan = planDocx(document);
  const pages = layoutPdfPages(plan);

  // Object plan: 1 Catalog, 2 Pages, 3 F1, 4 F2, then per page: page obj,
  // content obj.
  const objects: Buffer[] = [];
  const pageObjectIds: number[] = [];
  let nextId = 5;
  for (let i = 0; i < pages.length; i += 1) {
    pageObjectIds.push(nextId);
    nextId += 2;
  }

  const obj = (id: number, body: Buffer | string): Buffer =>
    Buffer.concat([
      Buffer.from(`${id} 0 obj\n`),
      typeof body === "string" ? Buffer.from(body) : body,
      Buffer.from("\nendobj\n"),
    ]);

  objects.push(obj(1, "<< /Type /Catalog /Pages 2 0 R >>"));
  objects.push(
    obj(
      2,
      `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    ),
  );
  objects.push(
    obj(
      3,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>",
    ),
  );
  objects.push(
    obj(
      4,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>",
    ),
  );

  pages.forEach((page, i) => {
    const pageId = pageObjectIds[i];
    const contentId = pageId + 1;
    objects.push(
      obj(
        pageId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
    const stream = contentStream(page);
    objects.push(
      obj(
        contentId,
        Buffer.concat([
          Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
          stream,
          Buffer.from("endstream"),
        ]),
      ),
    );
  });

  // Assemble with a correct xref table.
  const header = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1");
  const chunks: Buffer[] = [header];
  const offsets: number[] = [0]; // object 0 is the free head
  let position = header.length;
  for (const object of objects) {
    offsets.push(position);
    chunks.push(object);
    position += object.length;
  }
  const xrefStart = position;
  const count = objects.length + 1;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(Buffer.from(xref + trailer));
  return Buffer.concat(chunks);
}

/** Stable PDF file name mirroring the DOCX name. */
export function exportPdfFileName(docxFileName: string): string {
  return docxFileName.replace(/\.docx$/, ".pdf");
}
