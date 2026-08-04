import { describe, expect, it } from "vitest";
import {
  deriveUploadKind,
  UPLOAD_KINDS,
  validateUploadRequest,
} from "@/lib/wepatent/domain/uploads";

/**
 * Friction audit #6: the upload "Kind" select no longer sits above the file
 * input — it is derived from the detected file class and only overridable
 * inside the optional "Add details" disclosure. The derivation table is
 * pinned here so a wrong default is a test failure, not a support ticket.
 */

const TABLE: Array<[string, string, string]> = [
  // images
  ["photo.png", "image/png", "image"],
  ["photo.jpg", "image/jpeg", "image"],
  ["scan.tiff", "image/tiff", "image"],
  ["shot.heic", "image/heic", "image"],
  // documents
  ["bench-report.pdf", "application/pdf", "document"],
  ["notes.txt", "text/plain", "document"],
  ["memo.md", "text/markdown", "document"],
  [
    "disclosure.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "document",
  ],
  [
    "deck.pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "document",
  ],
  [
    "data.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "document",
  ],
  ["schematic.svg", "image/svg+xml", "document"],
  // 3D models
  ["bracket.stl", "model/stl", "model"],
  ["assembly.step", "model/step", "model"],
  ["part.obj", "model/obj", "model"],
  ["shell.3mf", "model/3mf", "model"],
  // audio
  ["walkthrough.mp3", "audio/mpeg", "audio"],
  ["lab.wav", "audio/wav", "audio"],
  ["voice.m4a", "audio/mp4", "audio"],
  // everything else
  ["demo.mp4", "video/mp4", "other"],
  ["clip.mov", "video/quicktime", "other"],
  ["archive.zip", "application/zip", "other"],
  ["mystery", "", "other"],
];

describe("upload kind derivation (friction audit #6)", () => {
  it.each(TABLE)("%s (%s) → %s", (filename, mimeType, expected) => {
    expect(deriveUploadKind({ filename, mimeType })).toBe(expected);
  });

  it("only ever produces a kind from the offered vocabulary", () => {
    for (const [filename, mimeType] of TABLE) {
      expect(UPLOAD_KINDS).toContain(deriveUploadKind({ filename, mimeType }));
    }
  });

  it("pins filing_receipt for the filing-receipt surface regardless of file type", () => {
    expect(
      deriveUploadKind({
        filename: "receipt.pdf",
        mimeType: "application/pdf",
        context: "filing_receipt",
      }),
    ).toBe("filing_receipt");
    expect(
      deriveUploadKind({
        filename: "receipt.png",
        mimeType: "image/png",
        context: "filing_receipt",
      }),
    ).toBe("filing_receipt");
  });

  it("handles browser octet-stream reporting for CAD/3D and audio files", () => {
    // Browsers commonly report these as octet-stream (or nothing); the
    // derivation uses the same extension fallback the validator uses.
    expect(
      deriveUploadKind({ filename: "bracket.stl", mimeType: "application/octet-stream" }),
    ).toBe("model");
    expect(
      deriveUploadKind({ filename: "walkthrough.mp3", mimeType: "application/octet-stream" }),
    ).toBe("audio");
  });

  it("never claims a confident kind for files the pipeline would reject", () => {
    const rejected = { filename: "payload.exe", mimeType: "application/x-msdownload" };
    expect(validateUploadRequest({ ...rejected, declaredBytes: 10 }).ok).toBe(false);
    expect(deriveUploadKind(rejected)).toBe("other");
  });
});
