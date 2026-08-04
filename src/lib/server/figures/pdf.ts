/**
 * Combined drawing-sheet PDF.
 *
 * Driven by the SAME composition metadata the validator checks, so the PDF
 * and the SVG sheets are two renderings of one measured layout rather than
 * two independent drawings that could drift apart.
 *
 * pdf-lib is already a dependency (used by the export renderer); it is pure
 * JS with no native binaries and no headless browser, which is what the
 * serverless target requires.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Composition, DrawnSegment, Mm, TextMark } from "./compose";
import { LINE_WEIGHT_CM } from "./geometry";

/** 1 mm = 72/25.4 PDF points. */
const MM_TO_PT = 72 / 25.4;

function pt(millimetres: number): number {
  return millimetres * MM_TO_PT;
}

/** PDF's origin is bottom-left; the composer's is top-left. */
function flip(point: Mm, sheetHeightMm: number): { x: number; y: number } {
  return { x: pt(point.x), y: pt(sheetHeightMm - point.y) };
}

function dashFor(segment: DrawnSegment): number[] | undefined {
  switch (segment.lineType) {
    case "dashed":
      return [pt(1.8), pt(1.2)];
    case "phantom":
      return [pt(6), pt(1.5), pt(0.6), pt(1.5), pt(0.6), pt(1.5)];
    case "projection":
      return [pt(6), pt(1.5), pt(0.6), pt(1.5)];
    default:
      return undefined;
  }
}

function decodeDataUri(dataUri: string): Uint8Array | null {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUri);
  if (!match) return null;
  return new Uint8Array(Buffer.from(match[1], "base64"));
}

/**
 * Render every composed sheet into one PDF, one page per sheet at the true
 * physical sheet size.
 */
export async function compositionToPdf(composition: Composition): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Patent drawing sheets — working draft, counsel review required");
  pdf.setProducer("wepatent figure composer");
  // Plain, legible lettering; never ornate (37 CFR 1.84(p)(2), 1.84(u)).
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const black = rgb(0, 0, 0);

  for (const sheet of composition.sheets) {
    const widthMm = sheet.geometry.widthCm * 10;
    const heightMm = sheet.geometry.heightCm * 10;
    const page = pdf.addPage([pt(widthMm), pt(heightMm)]);
    // White paper, explicitly — never an implicit background.
    page.drawRectangle({
      x: 0,
      y: 0,
      width: pt(widthMm),
      height: pt(heightMm),
      color: rgb(1, 1, 1),
    });

    // Layer-1 raster art, placed in its figure's art box.
    for (const raster of sheet.rasters) {
      const bytes = decodeDataUri(raster.dataUri);
      const placement = sheet.figures.find(
        (figure) => figure.figureNumber === raster.figureNumber,
      );
      if (!bytes || !placement) continue;
      try {
        const image = await pdf.embedPng(bytes);
        const box = placement.artBoxMm;
        const scale = Math.min(pt(box.w) / image.width, pt(box.h) / image.height);
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        page.drawImage(image, {
          x: pt(box.x) + (pt(box.w) - drawWidth) / 2,
          y: pt(heightMm - box.y - box.h) + (pt(box.h) - drawHeight) / 2,
          width: drawWidth,
          height: drawHeight,
        });
      } catch {
        // A raster that will not embed is skipped rather than aborting the
        // whole export; the SVG sheet remains the authoritative artifact.
      }
    }

    for (const segment of sheet.segments) {
      const a = flip(segment.a, heightMm);
      const b = flip(segment.b, heightMm);
      page.drawLine({
        start: a,
        end: b,
        thickness: pt((segment.isHatch ? LINE_WEIGHT_CM.hatch : LINE_WEIGHT_CM.primary) * 10),
        color: black,
        dashArray: dashFor(segment),
      });
    }

    for (const lead of sheet.leadLines) {
      for (let index = 0; index + 1 < lead.pointsMm.length; index += 1) {
        page.drawLine({
          start: flip(lead.pointsMm[index], heightMm),
          end: flip(lead.pointsMm[index + 1], heightMm),
          thickness: pt(LINE_WEIGHT_CM.lead * 10),
          color: black,
        });
      }
    }

    for (const mark of sheet.textMarks) {
      drawTextMark(page, font, mark, heightMm, black);
    }
  }

  return pdf.save();
}

type PdfPage = Awaited<ReturnType<PDFDocument["addPage"]>>;
type PdfFont = Awaited<ReturnType<PDFDocument["embedFont"]>>;
type PdfColor = ReturnType<typeof rgb>;

function drawTextMark(
  page: PdfPage,
  font: PdfFont,
  mark: TextMark,
  sheetHeightMm: number,
  color: PdfColor,
): void {
  const size = pt(mark.heightCm * 10);
  const width = font.widthOfTextAtSize(mark.text, size);
  // The composer records the anchor; the PDF draws from the left edge, so
  // recover the left edge from the recorded box (which already accounts for
  // the text anchor the SVG used).
  const x = pt(mark.boxMm.x);
  const y = pt(sheetHeightMm - mark.atMm.y);
  page.drawText(mark.text, { x, y, size, font, color, rotate: undefined });
  if (mark.underlined) {
    page.drawLine({
      start: { x, y: y - size * 0.15 },
      end: { x: x + width, y: y - size * 0.15 },
      thickness: pt(LINE_WEIGHT_CM.lead * 10),
      color,
    });
  }
}
