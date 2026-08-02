-- In-database counsel-request transition guard and money invariants
-- (PRD §7.6, §5.1–§5.4, FR-6). These fire for every role, including
-- trusted server logic — defense in depth behind the application
-- state machine.
begin;
select plan(13);

-- ===========================================================================
-- Adjacency-only transitions (request A is at 'submitted').
-- ===========================================================================
select throws_ok(
  $$update public.counsel_requests set state = 'engagement_signed'
    where id = '3a000000-0000-4000-8000-000000000001'$$,
  'P0001', null, 'submitted cannot jump to engagement_signed');
select throws_ok(
  $$update public.counsel_requests set state = 'converted_to_matter'
    where id = '3a000000-0000-4000-8000-000000000001'$$,
  'P0001', null, 'submitted cannot jump to converted_to_matter');
select throws_ok(
  $$update public.counsel_requests set state = 'draft'
    where id = '3a000000-0000-4000-8000-000000000001'$$,
  'P0001', null, 'states cannot move backwards');
select lives_ok(
  $$update public.counsel_requests set state = 'conflict_review'
    where id = '3a000000-0000-4000-8000-000000000001'$$,
  'submitted -> conflict_review is the only forward move');
select lives_ok(
  $$update public.counsel_requests set state = 'declined'
    where id = '3a000000-0000-4000-8000-000000000001'$$,
  'conflict_review -> declined is allowed');
select throws_ok(
  $$update public.counsel_requests set state = 'consultation_offered'
    where id = '3a000000-0000-4000-8000-000000000001'$$,
  'P0001', null, 'declined is terminal');

-- ===========================================================================
-- engagement_signed requires a signed engagement record (request B is at
-- 'engagement_offered' with NO signed engagement row).
-- ===========================================================================
select throws_ok(
  $$update public.counsel_requests set state = 'engagement_signed'
    where id = '3b000000-0000-4000-8000-000000000001'$$,
  'P0001', null, 'engagement_signed requires signed engagement evidence');

insert into public.engagements (organization_id, request_id, law_firm_name, scope_summary, signed_document_ref, signed_at)
values ('0b600000-0000-4000-8000-00000000000b', '3b000000-0000-4000-8000-000000000001',
        'Schell IP (synthetic)', 'Synthetic scope B', 'engagement-letter-b.pdf', now());

select lives_ok(
  $$update public.counsel_requests set state = 'engagement_signed'
    where id = '3b000000-0000-4000-8000-000000000001'$$,
  'engagement_signed allowed once a signed engagement exists');

-- A signed engagement row itself requires the document reference.
select throws_ok(
  $$update public.engagements set signed_document_ref = null
    where request_id = '3b000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'signed engagement cannot drop its document reference');

-- ===========================================================================
-- Money invariants: charge = ceil(provider cost x 1.5), capped by the
-- reservation; invitations can never carry counsel roles; draft labels
-- are pinned to working_draft.
-- ===========================================================================
select throws_ok(
  $$insert into public.usage_events (organization_id, reservation_id, model_id, rate_version, provider_cost_cents, customer_charge_cents, input_tokens, output_tokens)
    values ('0a600000-0000-4000-8000-00000000000a', '7a000000-0000-4000-8000-000000000001', 'synthetic-model', 'rv-test', 10, 14, 100, 100)$$,
  '23514', null, 'usage event with wrong markup rejected (14 != ceil(10*1.5))');
select throws_ok(
  $$update public.usage_reservations
      set status = 'settled', settled_provider_cost_cents = 100, settled_customer_charge_cents = 151
    where id = '7a000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'settlement exceeding markup formula rejected');
select throws_ok(
  $$insert into public.invitations (organization_id, email, role, token_hash, invited_by, expires_at)
    values ('0a600000-0000-4000-8000-00000000000a', 'x@example.test', 'counsel_attorney', 'tok-x', 'a11ce000-0000-4000-8000-000000000001', now() + interval '7 days')$$,
  '23514', null, 'invitations can never grant counsel roles');
select throws_ok(
  $$insert into public.draft_versions (organization_id, draft_id, version, content, model_id, rate_version, estimate_customer_high_cents, actual_provider_cost_cents, actual_customer_charge_cents, label)
    values ('0a600000-0000-4000-8000-00000000000a', '4a000000-0000-4000-8000-000000000001', 3, 'x', 'synthetic-model', 'rv-test', 1, 1, 2, 'approved')$$,
  '23514', null, 'draft versions can never be labeled approved');

select * from finish();
rollback;
