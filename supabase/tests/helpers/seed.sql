-- ---------------------------------------------------------------------------
-- RLS test fixture (Lex Patent Studio): two tenants with SYNTHETIC data in
-- the guarded tables, plus impersonation helpers. Applied once (committed)
-- before pg_prove runs; each pgTAP file runs in a rolled-back transaction.
--
-- Every person, organization, matter, and document is synthetic test data.
-- ---------------------------------------------------------------------------

create schema if not exists tests;

create or replace function tests.authenticate_as(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
end;
$$;

create or replace function tests.authenticate_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end;
$$;

create or replace function tests.clear_auth()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

grant usage on schema tests to anon, authenticated, service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Identities
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'ana-admin-a@example.test'),
  ('a0000000-0000-4000-8000-000000000002', 'pia-practitioner-a@example.test'),
  ('a0000000-0000-4000-8000-000000000003', 'oscar-operator-a@example.test'),
  ('a0000000-0000-4000-8000-000000000004', 'chen-contributor-a@example.test'),
  ('a0000000-0000-4000-8000-000000000005', 'vera-viewer-a@example.test'),
  ('b0000000-0000-4000-8000-000000000001', 'bea-owner-b@example.test');

insert into public.organizations (id, name) values
  ('0a000000-0000-4000-8000-00000000000a', 'Org A (synthetic)'),
  ('0b000000-0000-4000-8000-00000000000b', 'Org B (synthetic)');

insert into public.users_profile (user_id, display_name) values
  ('a0000000-0000-4000-8000-000000000001', 'Ana Admin (synthetic)'),
  ('b0000000-0000-4000-8000-000000000001', 'Bea Owner (synthetic)');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001', 'practitioner_admin'),
  ('0a000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002', 'practitioner'),
  ('0a000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000003', 'agent_operator'),
  ('0a000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000004', 'contributor'),
  ('0a000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000005', 'viewer'),
  ('0b000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-000000000001', 'owner');

insert into public.invitations
  (organization_id, email, role, invited_by, token_hash, expires_at) values
  ('0a000000-0000-4000-8000-00000000000a', 'invitee-a@example.test', 'contributor',
   'a0000000-0000-4000-8000-000000000001', 'synthetic-hash-a', now() + interval '7 days'),
  ('0b000000-0000-4000-8000-00000000000b', 'invitee-b@example.test', 'viewer',
   'b0000000-0000-4000-8000-000000000001', 'synthetic-hash-b', now() + interval '7 days');

insert into public.terms_versions (id, lane, version, content_sha256) values
  ('77000000-0000-4000-8000-000000000001', 'professional', '2026-07-01',
   repeat('a', 64));

insert into public.terms_acceptances (organization_id, user_id, terms_version_id) values
  ('0a000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001',
   '77000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-000000000001',
   '77000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- Matters + ACL (A1 shared with chen+vera; A2 practitioner-only; B1 org B)
-- ---------------------------------------------------------------------------
insert into public.matters
  (id, organization_id, matter_number, title, technology_area, created_by) values
  ('1a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
   'A-0001', 'Synthetic matter A1', 'Mechanical', 'a0000000-0000-4000-8000-000000000001'),
  ('1a000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a',
   'A-0002', 'Synthetic matter A2 (unshared)', 'Optics', 'a0000000-0000-4000-8000-000000000001'),
  ('1b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-00000000000b',
   'B-0001', 'Synthetic matter B1', 'Chemistry', 'b0000000-0000-4000-8000-000000000001');

insert into public.matter_acl (organization_id, matter_id, user_id, granted_by) values
  ('0a000000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001'),
  ('0a000000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001');

insert into public.matter_facts
  (id, organization_id, matter_id, category, text, contributed_by) values
  ('61000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'problem', 'Synthetic fact A1',
   'a0000000-0000-4000-8000-000000000004'),
  ('61000000-0000-4000-8000-00000000000c', '0a000000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000002', 'problem', 'Synthetic fact A2',
   'a0000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', 'problem', 'Synthetic fact B1',
   'b0000000-0000-4000-8000-000000000001');

insert into public.fact_events
  (organization_id, matter_id, fact_id, event_type, actor_user_id) values
  ('0a000000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
   '61000000-0000-4000-8000-00000000000a', 'created', 'a0000000-0000-4000-8000-000000000004'),
  ('0b000000-0000-4000-8000-00000000000b', '1b000000-0000-4000-8000-000000000001',
   '61000000-0000-4000-8000-00000000000b', 'created', 'b0000000-0000-4000-8000-000000000001');

insert into public.private_sources
  (id, organization_id, matter_id, kind, title, uploaded_by) values
  ('60000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'disclosure_upload', 'Synthetic source A',
   'a0000000-0000-4000-8000-000000000004'),
  ('60000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', 'disclosure_upload', 'Synthetic source B',
   'b0000000-0000-4000-8000-000000000001');

insert into public.source_extractions (organization_id, source_id, state) values
  ('0a000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-00000000000a', 'extracted'),
  ('0b000000-0000-4000-8000-00000000000b', '60000000-0000-4000-8000-00000000000b', 'extracted');

-- ---------------------------------------------------------------------------
-- Styles + playbooks
-- ---------------------------------------------------------------------------
insert into public.style_profiles (id, organization_id, name, created_by) values
  ('50000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-00000000000a',
   'neutral-professional', 'a0000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-00000000000b',
   'neutral-professional', 'b0000000-0000-4000-8000-000000000001');

insert into public.playbook_entries
  (id, organization_id, title, body, content_sha256, reviewed_by, reviewer_role,
   prev_entry_hash, entry_hash) values
  ('51000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-00000000000a',
   'Synthetic playbook A', 'Body A', repeat('a', 64),
   'a0000000-0000-4000-8000-000000000001', 'practitioner_admin', 'genesis', repeat('b', 64)),
  ('51000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-00000000000b',
   'Synthetic playbook B', 'Body B', repeat('c', 64),
   'b0000000-0000-4000-8000-000000000001', 'owner', 'genesis', repeat('d', 64));

-- ---------------------------------------------------------------------------
-- Workflow runs + stages + checks
-- ---------------------------------------------------------------------------
insert into public.workflow_definitions (id, workflow_key, version, tier_floor, definition) values
  ('20000000-0000-4000-8000-000000000001', 'section_draft', '0.3.1', 'B', '{}');

insert into public.workflow_runs
  (id, organization_id, matter_id, workflow_definition_id, workflow_key,
   workflow_version, tier, as_of_date, model_id, model_tier, corpus_release,
   deliverable_type, estimated_charge_low_usd, estimated_charge_high_usd,
   requested_by) values
  ('30000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   'section_draft', '0.3.1', 'B', '2026-08-01', 'claude-sonnet-4-5', 'advanced',
   'corpus-2026.07.2', 'Specification sections', 1.00, 2.00,
   'a0000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   'section_draft', '0.3.1', 'B', '2026-08-01', 'gpt-5', 'advanced',
   'corpus-2026.07.2', 'Specification sections', 1.00, 2.00,
   'b0000000-0000-4000-8000-000000000001');

insert into public.run_stages (organization_id, run_id, stage) values
  ('0a000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-00000000000a', 'QUEUED'),
  ('0b000000-0000-4000-8000-00000000000b', '30000000-0000-4000-8000-00000000000b', 'QUEUED');

insert into public.deterministic_check_results
  (organization_id, run_id, check_kind, passed) values
  ('0a000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-00000000000a',
   'claim_dependency', true),
  ('0b000000-0000-4000-8000-00000000000b', '30000000-0000-4000-8000-00000000000b',
   'antecedent_basis', false);

-- ---------------------------------------------------------------------------
-- Claims
-- ---------------------------------------------------------------------------
insert into public.claims (id, organization_id, matter_id, claim_number, claim_type) values
  ('40000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 1, 'independent'),
  ('40000000-0000-4000-8000-00000000000c', '0a000000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 2, 'dependent'),
  ('40000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', 1, 'independent');

insert into public.claim_versions
  (organization_id, claim_id, version, text, content_sha256) values
  ('0a000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-00000000000a',
   1, 'A synthetic apparatus claim.', repeat('e', 64)),
  ('0b000000-0000-4000-8000-00000000000b', '40000000-0000-4000-8000-00000000000b',
   1, 'A synthetic composition claim.', repeat('f', 64));

insert into public.claim_tree_edges
  (organization_id, matter_id, parent_claim_id, child_claim_id) values
  ('0a000000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-00000000000c');

-- ---------------------------------------------------------------------------
-- Prosecution artifacts
-- ---------------------------------------------------------------------------
insert into public.rejections
  (id, organization_id, matter_id, statute, rejection_type) values
  ('42000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', '103', 'obviousness'),
  ('42000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', '112(b)', 'indefiniteness');

insert into public.rejection_matrix_cells
  (organization_id, rejection_id, claim_number, pinpoint_citation) values
  ('0a000000-0000-4000-8000-00000000000a', '42000000-0000-4000-8000-00000000000a',
   1, 'Ref B col. 3 ll. 10-22 (synthetic)'),
  ('0b000000-0000-4000-8000-00000000000b', '42000000-0000-4000-8000-00000000000b',
   1, 'OA p. 4 (synthetic)');

insert into public.search_reports (id, organization_id, matter_id, scope) values
  ('43000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'Synthetic scope A'),
  ('43000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', 'Synthetic scope B');

insert into public.search_references
  (organization_id, search_report_id, reference_identifier, relevance_rationale, rank) values
  ('0a000000-0000-4000-8000-00000000000a', '43000000-0000-4000-8000-00000000000a',
   'US 10,987,654 (synthetic)', 'Teaches the mount (synthetic)', 1),
  ('0b000000-0000-4000-8000-00000000000b', '43000000-0000-4000-8000-00000000000b',
   'US 11,111,111 (synthetic)', 'Background only (synthetic)', 1);

insert into public.ids_packets (id, organization_id, matter_id) values
  ('44000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001'),
  ('44000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001');

insert into public.ids_citations
  (organization_id, ids_packet_id, citation_class, fields) values
  ('0a000000-0000-4000-8000-00000000000a', '44000000-0000-4000-8000-00000000000a',
   'us_patent', '{"number":"10987654"}'),
  ('0b000000-0000-4000-8000-00000000000b', '44000000-0000-4000-8000-00000000000b',
   'npl', '{"description":"Synthetic NPL"}');

-- ---------------------------------------------------------------------------
-- QC + review
-- ---------------------------------------------------------------------------
insert into public.critic_reports
  (id, organization_id, run_id, critic_model_id, drafting_model_id, summary) values
  ('45000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-00000000000a',
   '30000000-0000-4000-8000-00000000000a', 'gpt-5', 'claude-sonnet-4-5', 'Synthetic critique A'),
  ('45000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-00000000000b',
   '30000000-0000-4000-8000-00000000000b', 'claude-sonnet-4-5', 'gpt-5', 'Synthetic critique B');

insert into public.verification_results
  (organization_id, run_id, target_kind, target_text, state) values
  ('0a000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-00000000000a',
   'quote', 'synthetic quotation', 'verified'),
  ('0b000000-0000-4000-8000-00000000000b', '30000000-0000-4000-8000-00000000000b',
   'quote', 'synthetic quotation', 'failed');

insert into public.review_items
  (id, organization_id, matter_id, run_id, document_title, document_version_hash, tier) values
  ('46000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-00000000000a',
   'Synthetic draft A', 'hash-a', 'B'),
  ('46000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-00000000000b',
   'Synthetic draft B', 'hash-b', 'B');

insert into public.review_decisions
  (organization_id, review_item_id, decision, actor_user_id, actor_role,
   document_version_hash) values
  ('0a000000-0000-4000-8000-00000000000a', '46000000-0000-4000-8000-00000000000a',
   'approve', 'a0000000-0000-4000-8000-000000000001', 'practitioner_admin', 'hash-a'),
  ('0b000000-0000-4000-8000-00000000000b', '46000000-0000-4000-8000-00000000000b',
   'reject', 'b0000000-0000-4000-8000-000000000001', 'owner', 'hash-b');

-- ---------------------------------------------------------------------------
-- Documents + exports + deadlines
-- ---------------------------------------------------------------------------
insert into public.documents
  (id, organization_id, matter_id, title, deliverable_type, tier, model_id,
   corpus_release) values
  ('47000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'Synthetic doc A', 'Specification sections',
   'B', 'claude-sonnet-4-5', 'corpus-2026.07.2'),
  ('47000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', 'Synthetic doc B', 'Specification sections',
   'B', 'gpt-5', 'corpus-2026.07.2');

insert into public.document_versions
  (id, organization_id, document_id, version, content, content_sha256) values
  ('48000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-00000000000a',
   '47000000-0000-4000-8000-00000000000a', 1, '{"sections":[]}', repeat('1', 64)),
  ('48000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-00000000000b',
   '47000000-0000-4000-8000-00000000000b', 1, '{"sections":[]}', repeat('2', 64));

insert into public.exports
  (id, organization_id, matter_id, document_version_id, format, watermark, exported_by) values
  ('49000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', '48000000-0000-4000-8000-00000000000a',
   'docx', 'DRAFT — NOT REVIEWED', 'a0000000-0000-4000-8000-000000000001'),
  ('49000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', '48000000-0000-4000-8000-00000000000b',
   'pdf', 'DRAFT — NOT REVIEWED', 'b0000000-0000-4000-8000-000000000001');

insert into public.export_manifests
  (organization_id, export_id, manifest, manifest_sha256) values
  ('0a000000-0000-4000-8000-00000000000a', '49000000-0000-4000-8000-00000000000a',
   '{"synthetic":true}', repeat('3', 64)),
  ('0b000000-0000-4000-8000-00000000000b', '49000000-0000-4000-8000-00000000000b',
   '{"synthetic":true}', repeat('4', 64));

insert into public.deadline_observations
  (organization_id, matter_id, label, observed_date, window_kind) values
  ('0a000000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
   'Synthetic OA window', '2026-09-24', 'statutory-3mo'),
  ('0b000000-0000-4000-8000-00000000000b', '1b000000-0000-4000-8000-000000000001',
   'Synthetic priority window', '2026-11-02', 'priority-year');

-- ---------------------------------------------------------------------------
-- Billing
-- ---------------------------------------------------------------------------
insert into public.model_registry (id, model_id, provider, display_name, model_tier) values
  ('70000000-0000-4000-8000-000000000001', 'claude-sonnet-4-5', 'anthropic',
   'Claude Sonnet 4.5', 'advanced');

insert into public.model_prices
  (id, model_registry_id, input_per_mtok_usd, output_per_mtok_usd, effective_from) values
  ('71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
   3.0, 15.0, '2026-07-01');

insert into public.wallet_accounts (id, organization_id) values
  ('72000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-00000000000a'),
  ('72000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-00000000000b');

insert into public.wallet_ledger_entries
  (organization_id, wallet_account_id, entry_type, amount_usd, idempotency_key) values
  ('0a000000-0000-4000-8000-00000000000a', '72000000-0000-4000-8000-00000000000a',
   'included_credit', 30.00, 'seed-credit-a'),
  ('0b000000-0000-4000-8000-00000000000b', '72000000-0000-4000-8000-00000000000b',
   'included_credit', 30.00, 'seed-credit-b');

insert into public.usage_reservations
  (id, organization_id, run_id, model_id, reserved_high_usd, idempotency_key) values
  ('73000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-00000000000a',
   '30000000-0000-4000-8000-00000000000a', 'claude-sonnet-4-5', 2.00, 'seed-resv-a'),
  ('73000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-00000000000b',
   '30000000-0000-4000-8000-00000000000b', 'gpt-5', 2.00, 'seed-resv-b');

insert into public.usage_events
  (organization_id, usage_reservation_id, model_price_id, input_tokens,
   output_tokens, provider_cost_usd, markup, customer_charge_usd) values
  ('0a000000-0000-4000-8000-00000000000a', '73000000-0000-4000-8000-00000000000a',
   '71000000-0000-4000-8000-000000000001', 90000, 18000, 0.54, 1.50, 0.81),
  ('0b000000-0000-4000-8000-00000000000b', '73000000-0000-4000-8000-00000000000b',
   '71000000-0000-4000-8000-000000000001', 90000, 18000, 0.54, 1.50, 0.81);

insert into public.stripe_events (stripe_event_id, event_type, payload) values
  ('evt_synthetic_1', 'checkout.session.completed', '{"synthetic":true}');

insert into public.billing_outbox (organization_id, kind, payload) values
  ('0a000000-0000-4000-8000-00000000000a', 'wallet_credit', '{"synthetic":true}');

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
insert into public.audit_events
  (organization_id, matter_id, actor_user_id, actor_role, action, subject_type,
   subject_id) values
  ('0a000000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', 'practitioner_admin', 'matter.create',
   'matter', '1a000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-00000000000b', '1b000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 'owner', 'matter.create',
   'matter', '1b000000-0000-4000-8000-000000000001');

-- Chat messages (migration 0005)
insert into public.chat_messages
  (organization_id, matter_id, author, author_user_id, body) values
  ('0a000000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
   'user', 'a0000000-0000-4000-8000-000000000001', 'Synthetic chat question A'),
  ('0b000000-0000-4000-8000-00000000000b', '1b000000-0000-4000-8000-000000000001',
   'user', 'b0000000-0000-4000-8000-000000000001', 'Synthetic chat question B');
