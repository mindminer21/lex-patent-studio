import { beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { getAdapters } from "@/lib/server/adapters";
import { LocalDataAdapter } from "@/lib/server/adapters/local/store";
import { processJob } from "@/lib/server/jobs/runner";
import {
  mintDownloadToken,
  verifyDownloadToken,
} from "@/lib/server/services/export-download";
import {
  buildExportSections,
  DRAFT_LABEL,
  renderExportArtifacts,
} from "@/lib/server/services/export-render";
import { createExport } from "@/lib/server/services/exports";
import { runGeneration } from "@/lib/server/services/generation";
import { createOrganizationForUser } from "@/lib/server/services/orgs";

async function setup() {
  LocalDataAdapter.reset();
  const { data } = getAdapters();
  const user = await data.createUser({ email: "export@example.test", displayName: "Exporter" });
  const org = await createOrganizationForUser(user.id, "Export Test Org");
  const [invention] = await data.listInventions(org.id);
  const generation = await runGeneration({
    organizationId: org.id,
    userId: user.id,
    inventionId: invention.id,
    workflow: "invention_disclosure_summary",
    tierId: "standard",
    idempotencyKey: "export-gen-key",
  });
  if (!generation.ok) throw new Error("generation failed");
  return { data, user, org, invention, version: generation.version };
}

describe("counsel-package rendering (PRD §7.5)", () => {
  beforeEach(() => LocalDataAdapter.reset());

  it("renders DOCX + PDF + manifest artifacts with correct signatures and checksums", async () => {
    const { data, user, org, invention, version } = await setup();
    const created = await createExport({
      organizationId: org.id,
      userId: user.id,
      inventionId: invention.id,
      draftVersionId: version.id,
      sections: ["facts", "contributors", "timeline", "sources"],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // The render job was enqueued with the export id as its key. It may
    // already be running via the local scheduler; drive/await it to done.
    const job = await data.findJobByKey(org.id, "export_render", created.record.id);
    expect(job).not.toBeNull();
    let done = await processJob(org.id, job!.id);
    for (let i = 0; i < 100 && done && !["succeeded", "failed"].includes(done.status); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      done = await data.getJob(org.id, job!.id);
    }
    expect(done?.status).toBe("succeeded");

    const artifacts = await data.listExportArtifacts(org.id, created.record.id);
    expect(artifacts.map((artifact) => artifact.name).sort()).toEqual([
      "counsel-package.docx",
      "counsel-package.pdf",
      "manifest.json",
    ]);

    const { storage } = getAdapters();
    for (const artifact of artifacts) {
      const bytes = await storage.get(artifact.storagePath);
      expect(bytes).not.toBeNull();
      expect(bytes!.length).toBe(artifact.byteSize);
      expect(createHash("sha256").update(bytes!).digest("hex")).toBe(artifact.sha256);
    }

    const docx = await storage.get(`exports/${org.id}/${created.record.id}/counsel-package.docx`);
    expect(docx![0]).toBe(0x50); // P
    expect(docx![1]).toBe(0x4b); // K — DOCX is a ZIP container
    const pdf = await storage.get(`exports/${org.id}/${created.record.id}/counsel-package.pdf`);
    expect(new TextDecoder().decode(pdf!.slice(0, 5))).toBe("%PDF-");

    // Manifest artifact preserves the export checksum exactly.
    const manifestArtifact = await storage.get(
      `exports/${org.id}/${created.record.id}/manifest.json`,
    );
    const parsed = JSON.parse(new TextDecoder().decode(manifestArtifact!)) as {
      checksum: string;
      manifest: { notice: string };
    };
    expect(parsed.checksum).toBe(created.record.checksum);
    expect(parsed.manifest.notice).toContain("Not legal advice");
  });

  it("keeps required-review labels in every rendered document body", async () => {
    const { data, user, org, invention, version } = await setup();
    const created = await createExport({
      organizationId: org.id,
      userId: user.id,
      inventionId: invention.id,
      draftVersionId: version.id,
      sections: ["facts"],
    });
    if (!created.ok) throw new Error("export failed");
    const facts = await data.listFacts(org.id, invention.id);
    const sections = buildExportSections({
      record: created.record,
      facts,
      contributors: [],
      events: [],
      sources: [],
      draftVersion: version,
    });
    const text = sections.map((section) => `${section.heading}\n${section.lines.join("\n")}`).join("\n");
    expect(text).toContain(DRAFT_LABEL);
    expect(text).toContain("not a law firm");
    expect(text).toContain(created.record.checksum);
    // Fact provenance labels stay visible.
    expect(text).toContain("[technical · source_supported]");
  });

  it("re-rendering is idempotent: no duplicate artifacts", async () => {
    const { data, user, org, invention } = await setup();
    const created = await createExport({
      organizationId: org.id,
      userId: user.id,
      inventionId: invention.id,
      draftVersionId: null,
      sections: ["facts"],
    });
    if (!created.ok) throw new Error("export failed");
    // Wait for the auto-scheduled render job to reach a terminal state so
    // the manual re-render below is a true second pass.
    const job = await data.findJobByKey(org.id, "export_render", created.record.id);
    for (let i = 0; i < 100; i += 1) {
      const current = await data.getJob(org.id, job!.id);
      if (current && ["succeeded", "failed", "cancelled"].includes(current.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await renderExportArtifacts(org.id, created.record.id);
    await renderExportArtifacts(org.id, created.record.id);
    const artifacts = await data.listExportArtifacts(org.id, created.record.id);
    expect(artifacts).toHaveLength(3);
  });

  it("download tokens are scoped and expire structurally", async () => {
    const token = mintDownloadToken({
      organizationId: "org-1",
      exportId: "export-1",
      name: "counsel-package.pdf",
    });
    const claims = verifyDownloadToken(token);
    expect(claims?.organizationId).toBe("org-1");
    expect(claims?.exportId).toBe("export-1");
    expect(verifyDownloadToken(`${token}x`)).toBeNull();
    expect(verifyDownloadToken("junk")).toBeNull();
  });
});
