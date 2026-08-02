import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PgDataAdapter } from "@/lib/adapters/production/data";
import { PgBillingAdapter } from "@/lib/adapters/production/billing";
import { extractAccessToken } from "@/lib/adapters/production/auth";

/**
 * PRODUCTION adapter integration suite — runs against a REAL PostgreSQL 16
 * database with the full migration set applied (no external credentials).
 *
 * Provisioned by scripts/test-production-adapter.sh, which sets
 * LEX_PG_TEST_URL. Without that variable the suite is skipped (the default
 * `npm test` stays credential- and daemon-free).
 */

const TEST_URL = process.env.LEX_PG_TEST_URL;

const ORG_A = "0a000000-0000-4000-8000-0000000000aa";
const ORG_B = "0b000000-0000-4000-8000-0000000000bb";
const ANA = "a0000000-0000-4000-8000-0000000000a1"; // practitioner_admin, org A
const CHEN = "a0000000-0000-4000-8000-0000000000a4"; // contributor, org A

describe.skipIf(!TEST_URL)("PgDataAdapter against real PostgreSQL", () => {
  let pool: Pool;
  let data: PgDataAdapter;
  let billing: PgBillingAdapter;
  let matterId: string;
  let documentId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_URL, max: 3 });
    data = new PgDataAdapter(pool);
    billing = new PgBillingAdapter(pool);

    await pool.query(
      `insert into auth.users (id, email) values
         ($1, 'ana@prod-test.invalid'), ($2, 'chen@prod-test.invalid')
       on conflict do nothing`,
      [ANA, CHEN],
    );
    await pool.query(
      `insert into organizations (id, name) values
         ($1, 'Prod-test Org A (synthetic)'), ($2, 'Prod-test Org B (synthetic)')
       on conflict do nothing`,
      [ORG_A, ORG_B],
    );
    await pool.query(
      `insert into organization_memberships (organization_id, user_id, role) values
         ($1, $2, 'practitioner_admin'), ($1, $3, 'contributor')
       on conflict do nothing`,
      [ORG_A, ANA, CHEN],
    );
    await pool.query(
      `insert into wallet_accounts (organization_id) values ($1)
       on conflict do nothing`,
      [ORG_A],
    );
    await pool.query(
      `insert into wallet_ledger_entries
         (organization_id, wallet_account_id, entry_type, amount_usd, idempotency_key)
       select $1, id, 'included_credit', 30.00, 'prod-test-credit'
         from wallet_accounts where organization_id = $1
       on conflict (idempotency_key) do nothing`,
      [ORG_A],
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("creates and lists matters with tenant scoping and role policy", async () => {
    const denied = await data.createMatter(
      ORG_A,
      { matterNumber: "PT-1", title: "Contributor attempt", jurisdiction: "US", technologyArea: "X", conflictTags: [] },
      { userId: CHEN, role: "contributor" },
    );
    expect(denied.ok).toBe(false);

    const created = await data.createMatter(
      ORG_A,
      { matterNumber: "PT-1", title: "Prod-test matter (synthetic)", jurisdiction: "US", technologyArea: "Thermal", conflictTags: ["synthetic"] },
      { userId: ANA, role: "practitioner_admin" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    matterId = created.matter.id;

    // Duplicate matter number in the same tenant is refused.
    const dup = await data.createMatter(
      ORG_A,
      { matterNumber: "PT-1", title: "Duplicate", jurisdiction: "US", technologyArea: "X", conflictTags: [] },
      { userId: ANA, role: "practitioner_admin" },
    );
    expect(dup.ok).toBe(false);

    // Absolute tenant scoping (Invariant 18).
    expect(await data.getMatter(ORG_B, matterId)).toBeNull();
    expect((await data.listMatters(ORG_B)).find((m) => m.id === matterId)).toBeUndefined();
  });

  it("fact ledger: contribute → approve with events and audit", async () => {
    const fact = await data.createFact(
      ORG_A,
      matterId,
      { category: "problem", text: "Synthetic prod-test fact.", sourceIds: [] },
      { userId: CHEN, role: "contributor" },
    );
    expect(fact.ok).toBe(true);
    if (!fact.ok) return;
    expect(fact.fact.provenance).toBe("user_asserted");

    const deniedApprove = await data.approveFact(ORG_A, matterId, fact.fact.id, {
      userId: CHEN,
      role: "contributor",
    });
    expect(deniedApprove.ok).toBe(false);

    const approved = await data.approveFact(ORG_A, matterId, fact.fact.id, {
      userId: ANA,
      role: "practitioner_admin",
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.fact.provenance).toBe("counsel_reviewed");

    const events = await data.listFactEvents(ORG_A, matterId);
    expect(events.some((e) => e.eventType === "approved")).toBe(true);
    const audit = await data.listAuditEvents(ORG_A, { matterId });
    expect(audit.some((a) => a.action === "facts.approve")).toBe(true);
  });

  it("style profiles and hash-chained playbook survive a database round trip", async () => {
    const profile = await data.createStyleProfile(
      ORG_A,
      { name: "prod-test-style", kind: "application_drafting", rules: ["Rule one for the prod test."] },
      { userId: ANA, role: "practitioner_admin" },
    );
    expect(profile.ok).toBe(true);

    const first = await data.publishPlaybookEntry(
      ORG_A,
      { title: "Entry 1 (synthetic)", category: "approved_argument", body: "Body one." },
      { userId: ANA, role: "practitioner_admin" },
    );
    const second = await data.publishPlaybookEntry(
      ORG_A,
      { title: "Entry 2 (synthetic)", category: "claim_structure", body: "Body two." },
      { userId: ANA, role: "practitioner_admin" },
    );
    expect(first.ok && second.ok).toBe(true);

    const playbook = await data.listPlaybookEntries(ORG_A);
    expect(playbook.chain.ok).toBe(true);
    expect(playbook.entries.length).toBeGreaterThanOrEqual(2);
    // The DB trigger refuses tampering outright (append-only).
    await expect(
      pool.query(`update playbook_entries set body = 'tampered' where organization_id = $1`, [ORG_A]),
    ).rejects.toThrow(/append-only/);
  });

  it("grounded chat: real retrieval + verifier, matter-isolated, role-gated", async () => {
    const denied = await data.postChatMessage(
      ORG_A,
      matterId,
      { question: "What does 35 USC 103 require?" },
      { userId: CHEN, role: "contributor" },
    );
    expect(denied.ok).toBe(false);

    const posted = await data.postChatMessage(
      ORG_A,
      matterId,
      { question: "grace period for an inventor-originated public disclosure" },
      { userId: ANA, role: "practitioner_admin" },
    );
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    const authority = posted.reply.citations.filter((c) => c.kind === "authority");
    expect(authority.length).toBeGreaterThan(0);
    for (const c of authority) expect(c.verification).toBe("verified");

    expect(await data.listChatMessages(ORG_B, matterId)).toHaveLength(0);
  });

  it("documents → review decision (Invariant 16) → immutable export with manifest", async () => {
    const doc = await pool.query(
      `insert into documents
         (organization_id, matter_id, title, deliverable_type, tier, model_id, corpus_release)
       values ($1, $2, 'Prod-test doc (synthetic)', 'Research memo', 'B',
               'claude-sonnet-4-5', 'corpus-2026.07.2') returning id`,
      [ORG_A, matterId],
    );
    documentId = String(doc.rows[0].id);
    await pool.query(
      `insert into document_versions (organization_id, document_id, version, content, content_sha256)
       values ($1, $2, 1, $3, $4)`,
      [
        ORG_A,
        documentId,
        JSON.stringify({
          sections: [{ heading: "Question presented", body: "Synthetic prod-test body long enough for checks.", flags: [] }],
          citations: [],
        }),
        "d".repeat(64),
      ],
    );
    const item = await pool.query(
      `insert into review_items
         (organization_id, matter_id, document_title, document_version_hash, tier)
       values ($1, $2, 'Prod-test doc (synthetic)', $3, 'B') returning id`,
      [ORG_A, matterId, "d".repeat(16)],
    );
    const reviewItemId = String(item.rows[0].id);

    // Contributor cannot decide (Invariant 16 + role gate).
    const deniedDecision = await data.decideReviewItem(ORG_A, reviewItemId, "approve", {
      userId: CHEN,
      role: "contributor",
    });
    expect(deniedDecision.ok).toBe(false);

    const decided = await data.decideReviewItem(ORG_A, reviewItemId, "approve", {
      userId: ANA,
      role: "practitioner_admin",
      note: "prod-test approval",
    });
    expect(decided.ok).toBe(true);

    const exported = await data.createExport(ORG_A, documentId, {
      userId: ANA,
      role: "practitioner_admin",
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.reused).toBe(false);
    expect(exported.record.manifest.checksums.docxSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(exported.record.manifest.checksums.pdfSha256).toMatch(/^[0-9a-f]{64}$/);

    // Re-export returns the SAME immutable artifact (version-locked).
    const again = await data.createExport(ORG_A, documentId, {
      userId: ANA,
      role: "practitioner_admin",
    });
    expect(again.ok && again.ok === true && again.reused).toBe(true);
    if (again.ok) {
      expect(again.record.docxSha256).toBe(exported.record.docxSha256);
      expect(again.record.pdfSha256).toBe(exported.record.pdfSha256);
    }
    // Cross-tenant export read is impossible.
    expect(await data.getExport(ORG_B, exported.record.id)).toBeNull();
  });

  it("run execution refuses with the documented approval-gated seam", async () => {
    const run = await data.createRun();
    expect(run.ok).toBe(false);
    expect(run.error).toMatch(/approval-gated/);
  });

  it("wallet balance reads from the immutable ledger", async () => {
    expect(await billing.getWalletBalanceUsd(ORG_A)).toBe(30);
    expect(await billing.getWalletBalanceUsd(ORG_B)).toBe(0);
  });

  it("team roster derives from memberships", async () => {
    const team = await data.listTeamMembers(ORG_A);
    expect(team.map((m) => m.role).sort()).toEqual(["contributor", "practitioner_admin"]);
  });
});

describe("Supabase auth cookie parsing (credential-free unit)", () => {
  it("extracts access tokens from SSR cookie formats", () => {
    const json = JSON.stringify({ access_token: "tok_json" });
    expect(
      extractAccessToken([{ name: "sb-abc-auth-token", value: json }]),
    ).toBe("tok_json");
    const b64 = `base64-${Buffer.from(json).toString("base64")}`;
    expect(
      extractAccessToken([{ name: "sb-abc-auth-token", value: b64 }]),
    ).toBe("tok_json");
    expect(extractAccessToken([{ name: "other", value: "x" }])).toBeNull();
    expect(
      extractAccessToken([{ name: "sb-abc-auth-token", value: "not-json" }]),
    ).toBeNull();
  });
});
