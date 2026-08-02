-- ---------------------------------------------------------------------------
-- RLS test fixture: two tenants with SYNTHETIC data in every guarded table,
-- plus impersonation helpers. Applied once (committed) before pg_prove runs;
-- each pgTAP file runs inside its own rolled-back transaction.
--
-- All people, organizations, and inventions here are synthetic test data.
-- ---------------------------------------------------------------------------

create schema if not exists tests;

-- Impersonate an authenticated user the way PostgREST does: JWT claims in
-- request.jwt.claims and the `authenticated` role.
create or replace function tests.authenticate_as(uid uuid)
returns void
language plpgsql
as $$
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
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end;
$$;

create or replace function tests.clear_auth()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

grant usage on schema tests to anon, authenticated, service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fixed synthetic identities
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a11ce000-0000-4000-8000-000000000001', 'alice-owner-a@example.test'),
  ('a11ce000-0000-4000-8000-000000000002', 'avery-viewer-a@example.test'),
  ('b0b00000-0000-4000-8000-000000000001', 'bob-owner-b@example.test'),
  ('c0700000-0000-4000-8000-000000000001', 'carol-attorney@example.test'),
  ('c0700000-0000-4000-8000-000000000002', 'colin-intake@example.test');

insert into public.organizations (id, name) values
  ('0a600000-0000-4000-8000-00000000000a', 'Org A (synthetic)'),
  ('0b600000-0000-4000-8000-00000000000b', 'Org B (synthetic)');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('0a600000-0000-4000-8000-00000000000a', 'a11ce000-0000-4000-8000-000000000001', 'owner'),
  ('0a600000-0000-4000-8000-00000000000a', 'a11ce000-0000-4000-8000-000000000002', 'viewer'),
  ('0b600000-0000-4000-8000-00000000000b', 'b0b00000-0000-4000-8000-000000000001', 'owner');

insert into public.counsel_assignments (user_id, role) values
  ('c0700000-0000-4000-8000-000000000001', 'counsel_attorney'),
  ('c0700000-0000-4000-8000-000000000002', 'counsel_intake');

insert into public.counsel_audit_events (counsel_user_id, action) values
  ('c0700000-0000-4000-8000-000000000001', 'counsel.request.viewed');

insert into public.terms_versions (version, summary) values
  ('2026-07-01', 'Synthetic test terms version');

insert into public.terms_acceptances
  (organization_id, user_id, terms_version, acknowledged_keys, ip_hash, user_agent_category)
values
  ('0a600000-0000-4000-8000-00000000000a', 'a11ce000-0000-4000-8000-000000000001',
   '2026-07-01',
   array['not_law_firm','working_drafts','counsel_review_required','no_deadlines_or_outcomes'],
   'hash-a', 'desktop'),
  ('0b600000-0000-4000-8000-00000000000b', 'b0b00000-0000-4000-8000-000000000001',
   '2026-07-01',
   array['not_law_firm','working_drafts','counsel_review_required','no_deadlines_or_outcomes'],
   'hash-b', 'desktop');

insert into public.invitations
  (organization_id, email, role, token_hash, invited_by, expires_at)
values
  ('0a600000-0000-4000-8000-00000000000a', 'invitee-a@example.test', 'member', 'tok-a',
   'a11ce000-0000-4000-8000-000000000001', now() + interval '7 days'),
  ('0b600000-0000-4000-8000-00000000000b', 'invitee-b@example.test', 'member', 'tok-b',
   'b0b00000-0000-4000-8000-000000000001', now() + interval '7 days');

insert into public.retention_policies (organization_id) values
  ('0a600000-0000-4000-8000-00000000000a'),
  ('0b600000-0000-4000-8000-00000000000b');

-- ---------------------------------------------------------------------------
-- Invention records
-- ---------------------------------------------------------------------------
insert into public.inventions (id, organization_id, title, summary) values
  ('1a000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
   'Org A synthetic invention', 'Synthetic summary A'),
  ('1b000000-0000-4000-8000-000000000001', '0b600000-0000-4000-8000-00000000000b',
   'Org B synthetic invention', 'Synthetic summary B');

insert into public.invention_facts (id, organization_id, invention_id, category, statement) values
  ('2a000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'technical', 'Synthetic fact A'),
  ('2b000000-0000-4000-8000-000000000001', '0b600000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', 'technical', 'Synthetic fact B');

insert into public.contributors (organization_id, invention_id, name) values
  ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001', 'Synthetic person A'),
  ('0b600000-0000-4000-8000-00000000000b', '1b000000-0000-4000-8000-000000000001', 'Synthetic person B');

insert into public.disclosure_events (organization_id, invention_id, event_date, kind, description) values
  ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001', '2026-06-01', 'disclosure', 'Synthetic event A'),
  ('0b600000-0000-4000-8000-00000000000b', '1b000000-0000-4000-8000-000000000001', '2026-06-02', 'disclosure', 'Synthetic event B');

insert into public.private_sources (organization_id, invention_id, name, kind) values
  ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001', 'Synthetic source A', 'lab_notebook'),
  ('0b600000-0000-4000-8000-00000000000b', '1b000000-0000-4000-8000-000000000001', 'Synthetic source B', 'lab_notebook');

insert into public.drafts (id, organization_id, invention_id, workflow, title) values
  ('4a000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'invention_disclosure_summary', 'Draft A'),
  ('4b000000-0000-4000-8000-000000000001', '0b600000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', 'invention_disclosure_summary', 'Draft B');

insert into public.draft_versions
  (id, organization_id, draft_id, version, content, model_id, rate_version,
   estimate_customer_high_cents, actual_provider_cost_cents, actual_customer_charge_cents)
values
  ('5a000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
   '4a000000-0000-4000-8000-000000000001', 1, 'WORKING DRAFT A', 'synthetic-model', 'rv-test', 100, 10, 15),
  ('5b000000-0000-4000-8000-000000000001', '0b600000-0000-4000-8000-00000000000b',
   '4b000000-0000-4000-8000-000000000001', 1, 'WORKING DRAFT B', 'synthetic-model', 'rv-test', 100, 10, 15);

insert into public.exports (id, organization_id, invention_id, checksum) values
  ('6a000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'checksum-a'),
  ('6b000000-0000-4000-8000-000000000001', '0b600000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', 'checksum-b');

insert into public.export_manifests (organization_id, export_id, manifest) values
  ('0a600000-0000-4000-8000-00000000000a', '6a000000-0000-4000-8000-000000000001', '{"synthetic":true}'),
  ('0b600000-0000-4000-8000-00000000000b', '6b000000-0000-4000-8000-000000000001', '{"synthetic":true}');

-- ---------------------------------------------------------------------------
-- Counsel requests: A at submitted; B2 seeded directly at engagement_offered
-- (inserts are not transition-guarded) to exercise the signed-evidence rule.
-- ---------------------------------------------------------------------------
insert into public.counsel_requests
  (id, organization_id, created_by, state, request_summary, jurisdiction, contact_email)
values
  ('3a000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
   'a11ce000-0000-4000-8000-000000000001', 'submitted',
   'Synthetic request summary for org A', 'Colorado, USA', 'alice-owner-a@example.test'),
  ('3b000000-0000-4000-8000-000000000001', '0b600000-0000-4000-8000-00000000000b',
   'b0b00000-0000-4000-8000-000000000001', 'engagement_offered',
   'Synthetic request summary for org B', 'Colorado, USA', 'bob-owner-b@example.test');

insert into public.counsel_request_events
  (organization_id, request_id, from_state, to_state, action, actor_role)
values
  ('0a600000-0000-4000-8000-00000000000a', '3a000000-0000-4000-8000-000000000001',
   'draft', 'submitted', 'submit', 'owner'),
  ('0b600000-0000-4000-8000-00000000000b', '3b000000-0000-4000-8000-000000000001',
   'draft', 'submitted', 'submit', 'owner');

insert into public.engagements (organization_id, request_id, law_firm_name, scope_summary) values
  ('0a600000-0000-4000-8000-00000000000a', '3a000000-0000-4000-8000-000000000001',
   'Schell IP (synthetic)', 'Synthetic scope A');

-- ---------------------------------------------------------------------------
-- Billing and jobs
-- ---------------------------------------------------------------------------
insert into public.model_registry (id, provider, display_name, enabled, max_output_tokens) values
  ('synthetic-model', 'local-synthetic', 'Synthetic test model', true, 4000);

insert into public.model_prices
  (model_id, rate_version, input_cents_per_million_tokens, output_cents_per_million_tokens, effective_from)
values
  ('synthetic-model', 'rv-test', 300, 1500, '2026-07-01');

insert into public.wallet_accounts (organization_id, balance_cents, reserved_cents) values
  ('0a600000-0000-4000-8000-00000000000a', 2500, 0),
  ('0b600000-0000-4000-8000-00000000000b', 2500, 0);

insert into public.usage_reservations
  (id, organization_id, idempotency_key, amount_cents, rate_version, status)
values
  ('7a000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a', 'key-a', 100, 'rv-test', 'held'),
  ('7b000000-0000-4000-8000-000000000001', '0b600000-0000-4000-8000-00000000000b', 'key-b', 100, 'rv-test', 'held');

insert into public.usage_events
  (organization_id, reservation_id, model_id, rate_version,
   provider_cost_cents, customer_charge_cents, input_tokens, output_tokens)
values
  ('0a600000-0000-4000-8000-00000000000a', '7a000000-0000-4000-8000-000000000001',
   'synthetic-model', 'rv-test', 10, 15, 1000, 500),
  ('0b600000-0000-4000-8000-00000000000b', '7b000000-0000-4000-8000-000000000001',
   'synthetic-model', 'rv-test', 10, 15, 1000, 500);

insert into public.wallet_ledger_entries (organization_id, kind, amount_cents, note) values
  ('0a600000-0000-4000-8000-00000000000a', 'promo_credit', 2500, 'Synthetic credit A'),
  ('0b600000-0000-4000-8000-00000000000b', 'promo_credit', 2500, 'Synthetic credit B');

insert into public.audit_events (organization_id, actor, action) values
  ('0a600000-0000-4000-8000-00000000000a', 'system', 'seed.test'),
  ('0b600000-0000-4000-8000-00000000000b', 'system', 'seed.test');

insert into public.app_jobs (organization_id, kind, idempotency_key) values
  ('0a600000-0000-4000-8000-00000000000a', 'generation', 'job-key-a'),
  ('0b600000-0000-4000-8000-00000000000b', 'generation', 'job-key-b');
