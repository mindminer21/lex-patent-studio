-- Intake Studio M2 (migration 0010): interview engine columns, spend-cap
-- accounting constraints, geometry_summary artifact type, and the
-- no-client-write posture on interview tables. Fixture rows are inserted
-- as the superuser (service-role stand-in) inside the rolled-back
-- transaction, against the shared seed's orgs/inventions/users.
begin;
select plan(19);

-- ---------------------------------------------------------------------------
-- Schema shape (0010 additive columns)
-- ---------------------------------------------------------------------------
select has_column('public', 'interview_sessions', 'spent_cents', 'sessions carry spent_cents');
select has_column('public', 'interview_turns', 'stage', 'turns carry engine stage');
select has_column('public', 'interview_turns', 'answer_kind', 'turns carry answer_kind');
select has_column('public', 'interview_turns', 'followups', 'turns carry grouped followups');

-- ---------------------------------------------------------------------------
-- Fixture (service-role stand-in)
-- ---------------------------------------------------------------------------
insert into public.interview_sessions (id, organization_id, invention_id, user_id) values
  ('4c000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'a11ce000-0000-4000-8000-000000000001'),
  ('4d000000-0000-4000-8000-000000000001', '0b600000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', 'b0b00000-0000-4000-8000-000000000001');

-- Default cap from 0010 is $5.00 when the service does not override it.
select is(
  (select session_spend_cap_cents from public.interview_sessions
    where id = '4c000000-0000-4000-8000-000000000001'),
  500, 'default session spend cap is 500 cents');
select is(
  (select spent_cents from public.interview_sessions
    where id = '4c000000-0000-4000-8000-000000000001'),
  0, 'spent_cents defaults to zero');

insert into public.interview_turns
  (id, organization_id, session_id, turn_index, stage, question, target_ref, answer_kind, followups) values
  ('3c000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
   '4c000000-0000-4000-8000-000000000001', 0, 'context_field', 'Org A Q0 (synthetic)',
   'topic:context_field:field', 'answer', '["follow-up (synthetic)"]'::jsonb);

-- Constraint checks (23514): answer_kind enum and non-negative spend.
select throws_ok(
  $$insert into public.interview_turns (organization_id, session_id, turn_index, stage, question, answer_kind)
    values ('0a600000-0000-4000-8000-00000000000a', '4c000000-0000-4000-8000-000000000001', 1,
            'context_field', 'bad kind', 'model_confirmed')$$,
  '23514', null, 'answer_kind rejects values outside the fixed set');
select throws_ok(
  $$update public.interview_sessions set spent_cents = -1
     where id = '4c000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'spent_cents can never go negative');

-- geometry_summary is a legal artifact type; junk types stay illegal.
insert into public.private_sources (id, organization_id, invention_id, name, kind, status) values
  ('6c000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'bracket.stl', 'design_doc', 'extracted');
select lives_ok(
  $$insert into public.extraction_artifacts (organization_id, invention_id, source_id, type, content)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
            '6c000000-0000-4000-8000-000000000001', 'geometry_summary', 'Deterministic STL geometry summary (synthetic)')$$,
  'geometry_summary artifacts are accepted (deterministic 3D parse)');
select throws_ok(
  $$insert into public.extraction_artifacts (organization_id, invention_id, source_id, type, content)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
            '6c000000-0000-4000-8000-000000000001', 'rendered_view', 'not a real type yet')$$,
  '23514', null, 'unknown artifact types remain rejected');

-- ---------------------------------------------------------------------------
-- Application roles: members read their own org's interview rows and can
-- never write them (no insert/update/delete policies exist).
-- ---------------------------------------------------------------------------
select tests.authenticate_as('a11ce000-0000-4000-8000-000000000001');

select is((select count(*) from public.interview_sessions where organization_id = '0a600000-0000-4000-8000-00000000000a'),
  1::bigint, 'A sees own interview session');
select is((select count(*) from public.interview_sessions where organization_id = '0b600000-0000-4000-8000-00000000000b'),
  0::bigint, 'A cannot see org B interview sessions');
select is((select count(*) from public.interview_turns where organization_id = '0a600000-0000-4000-8000-00000000000a'),
  1::bigint, 'A sees own interview turns');

select throws_ok(
  $$insert into public.interview_sessions (organization_id, invention_id, user_id)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
            'a11ce000-0000-4000-8000-000000000001')$$,
  '42501', null, 'A cannot insert interview sessions directly (service-role only)');
select throws_ok(
  $$insert into public.interview_turns (organization_id, session_id, turn_index, stage, question)
    values ('0a600000-0000-4000-8000-00000000000a', '4c000000-0000-4000-8000-000000000001', 9,
            'context_field', 'forged question')$$,
  '42501', null, 'A cannot insert interview turns directly');

-- Client-side spend/cap tampering runs without effect (no update policy).
select lives_ok(
  $$update public.interview_sessions set spent_cents = 0, session_spend_cap_cents = 999999
     where id = '4c000000-0000-4000-8000-000000000001'$$,
  'A direct session cap/spend update runs without effect');
select is(
  (select session_spend_cap_cents from public.interview_sessions
    where id = '4c000000-0000-4000-8000-000000000001'),
  500, 'session cap cannot be tampered with client-side');
select lives_ok(
  $$update public.interview_turns set answer_kind = 'answer', answer_text = 'forged'
     where id = '3c000000-0000-4000-8000-000000000001'$$,
  'A direct turn rewrite runs without effect');
select is(
  (select count(*) from public.interview_turns
    where id = '3c000000-0000-4000-8000-000000000001' and answer_text is null),
  1::bigint, 'turn answers cannot be forged client-side');

select * from finish();
rollback;
