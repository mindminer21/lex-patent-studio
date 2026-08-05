#!/usr/bin/env node

/**
 * Read-only launch gate for the two private Supabase schemas.
 *
 * The management API call always sets `read_only: true`; the script inspects
 * schema metadata only and never selects customer content. Supply the PAT in
 * SUPABASE_ACCESS_TOKEN so it is not embedded in source or command history.
 */

const contracts = {
  consumer: {
    ref: "jxehyxkcibiqluojeryy",
    tables: [
      "app_jobs",
      "associations",
      "audit_events",
      "auth_identity_links",
      "auth_sessions",
      "billing_outbox",
      "components",
      "contribution_facts",
      "contributors",
      "counsel_assignments",
      "counsel_audit_events",
      "counsel_request_events",
      "counsel_requests",
      "disclosure_events",
      "draft_citations",
      "draft_set_transitions",
      "draft_sets",
      "draft_versions",
      "drafts",
      "enablement_coverage",
      "engagements",
      "export_artifacts",
      "export_manifests",
      "exports",
      "extraction_artifacts",
      "figure_annotations",
      "figure_reference_numerals",
      "figure_sets",
      "figure_sheets",
      "figure_validations",
      "figures",
      "filing_packages",
      "generation_jobs",
      "intake_sessions",
      "interview_sessions",
      "interview_turns",
      "invention_facts",
      "inventions",
      "invitations",
      "legal_matters",
      "model_prices",
      "model_registry",
      "organization_memberships",
      "organizations",
      "private_sources",
      "ps_events",
      "ps_links",
      "ps_pairs",
      "retention_policies",
      "review_findings",
      "source_extractions",
      "stripe_events",
      "terms_acceptances",
      "terms_versions",
      "usage_events",
      "usage_reservations",
      "users_profile",
      "wallet_accounts",
      "wallet_ledger_entries",
      "working_titles",
    ],
    constraints: {
      app_jobs_kind_check: ["figure_generate", "draft_pass_1", "draft_pass_2"],
      ps_events_kind_check: [
        "ai_proposal_archived",
        "ai_proposal_restored",
        "proposal_feedback",
      ],
    },
  },
  lex: {
    ref: "uudmapfdyhgslhjtmhhz",
    tables: [
      "audit_events",
      "auth_identity_links",
      "auth_sessions",
      "billing_outbox",
      "chat_messages",
      "claim_tree_edges",
      "claim_versions",
      "claims",
      "critic_reports",
      "deadline_observations",
      "deterministic_check_results",
      "document_versions",
      "documents",
      "draft_set_transitions",
      "draft_sets",
      "export_manifests",
      "exports",
      "fact_events",
      "ids_citations",
      "ids_packets",
      "invitations",
      "matter_acl",
      "matter_facts",
      "matters",
      "model_prices",
      "model_registry",
      "organization_memberships",
      "organizations",
      "playbook_entries",
      "private_sources",
      "rejection_matrix_cells",
      "rejections",
      "review_decisions",
      "review_items",
      "run_stages",
      "search_references",
      "search_reports",
      "source_extractions",
      "stripe_events",
      "style_profiles",
      "terms_acceptances",
      "terms_versions",
      "usage_events",
      "usage_reservations",
      "users_profile",
      "verification_results",
      "wallet_accounts",
      "wallet_ledger_entries",
      "workflow_definitions",
      "workflow_runs",
    ],
    constraints: {},
  },
};

const authSessionColumns = [
  "id",
  "app_user_id",
  "auth_user_id",
  "access_token",
  "refresh_token",
  "access_expires_at",
  "aal",
  "created_at",
  "last_seen_at",
  "revoked_at",
  "ip_hash",
  "user_agent_hash",
];

const authLinkColumns = [
  "app_user_id",
  "auth_user_id",
  "email",
  "link_method",
  "linked_at",
];

function difference(expected, actual) {
  const actualSet = new Set(actual);
  return expected.filter((value) => !actualSet.has(value));
}

async function runQuery(token, ref, query) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, read_only: true }),
    },
  );
  if (!response.ok) {
    throw new Error(`Supabase schema query failed for ${ref} (${response.status}).`);
  }
  return response.json();
}

function assertExact(label, expected, actual, errors) {
  const missing = difference(expected, actual);
  const unexpected = difference(actual, expected);
  if (missing.length > 0) errors.push(`${label} missing: ${missing.join(", ")}`);
  if (unexpected.length > 0) {
    errors.push(`${label} unexpected: ${unexpected.join(", ")}`);
  }
}

async function auditLane(token, lane, contract) {
  const tableRows = await runQuery(
    token,
    contract.ref,
    `select c.relname as table_name, c.relrowsecurity as rls_enabled
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`,
  );
  const columnRows = await runQuery(
    token,
    contract.ref,
    `select table_name, column_name
       from information_schema.columns
      where table_schema = 'public'
        and table_name in ('auth_identity_links', 'auth_sessions')
      order by table_name, ordinal_position`,
  );
  const constraintRows = await runQuery(
    token,
    contract.ref,
    `select conname, pg_get_constraintdef(oid, true) as definition
       from pg_constraint
      where connamespace = 'public'::regnamespace
        and conname in ('app_jobs_kind_check', 'ps_events_kind_check')
      order by conname`,
  );
  const policyRows = await runQuery(
    token,
    contract.ref,
    `select tablename, cmd
       from pg_policies
      where schemaname = 'public'
        and tablename in ('auth_identity_links', 'auth_sessions')
      order by tablename, policyname`,
  );

  const errors = [];
  assertExact(
    `${lane} public tables`,
    contract.tables,
    tableRows.map((row) => row.table_name),
    errors,
  );
  const rlsDisabled = tableRows
    .filter((row) => !row.rls_enabled)
    .map((row) => row.table_name);
  if (rlsDisabled.length > 0) {
    errors.push(`${lane} tables without RLS: ${rlsDisabled.join(", ")}`);
  }

  assertExact(
    `${lane} auth_sessions columns`,
    authSessionColumns,
    columnRows
      .filter((row) => row.table_name === "auth_sessions")
      .map((row) => row.column_name),
    errors,
  );
  assertExact(
    `${lane} auth_identity_links columns`,
    authLinkColumns,
    columnRows
      .filter((row) => row.table_name === "auth_identity_links")
      .map((row) => row.column_name),
    errors,
  );

  for (const [name, requiredFragments] of Object.entries(contract.constraints)) {
    const definition = constraintRows.find((row) => row.conname === name)?.definition;
    if (!definition) {
      errors.push(`${lane} constraint missing: ${name}`);
      continue;
    }
    for (const fragment of requiredFragments) {
      if (!definition.includes(fragment)) {
        errors.push(`${lane} ${name} is missing ${fragment}`);
      }
    }
  }

  const nonSelectAuthPolicies = policyRows.filter((row) => row.cmd !== "SELECT");
  if (nonSelectAuthPolicies.length > 0) {
    errors.push(`${lane} auth tables expose a non-SELECT RLS policy`);
  }
  for (const table of ["auth_identity_links", "auth_sessions"]) {
    if (!policyRows.some((row) => row.tablename === table && row.cmd === "SELECT")) {
      errors.push(`${lane} ${table} self-select policy missing`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  console.log(
    `${lane}: PASS (${tableRows.length} public tables, all RLS; auth contract present)`,
  );
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error("SUPABASE_ACCESS_TOKEN is required.");
  }
  for (const [lane, contract] of Object.entries(contracts)) {
    await auditLane(token, lane, contract);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Schema audit failed.");
  process.exitCode = 1;
});
