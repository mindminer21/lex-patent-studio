-- Intake Studio tables (migration 0009): cross-tenant isolation, write
-- denial for application roles, and append-only immutability (feature PRD
-- §8; parent PRD §5.7, §13). Fixture rows are inserted here as the
-- superuser (stand-in for the service role) against the shared seed's
-- orgs/inventions, inside the rolled-back transaction.
begin;
select plan(34);

-- ---------------------------------------------------------------------------
-- Fixture (service-role stand-in; RLS does not bind the table owner)
-- ---------------------------------------------------------------------------
insert into public.ps_pairs (id, organization_id, invention_id, kind, statement, state, origin, created_by_actor) values
  ('9a000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'problem', 'Org A problem (synthetic)', 'ai_proposed', 'upload_distillation', 'model'),
  ('9a000000-0000-4000-8000-000000000002', '0a600000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'solution', 'Org A solution (synthetic)', 'ai_proposed', 'upload_distillation', 'model'),
  ('9b000000-0000-4000-8000-000000000001', '0b600000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', 'problem', 'Org B problem (synthetic)', 'ai_proposed', 'upload_distillation', 'model'),
  ('9b000000-0000-4000-8000-000000000002', '0b600000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', 'solution', 'Org B solution (synthetic)', 'ai_proposed', 'upload_distillation', 'model');

insert into public.ps_links (organization_id, invention_id, problem_id, solution_id) values
  ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
   '9a000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000002'),
  ('0b600000-0000-4000-8000-00000000000b', '1b000000-0000-4000-8000-000000000001',
   '9b000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000002');

insert into public.ps_events (organization_id, invention_id, pair_id, kind, actor, detail) values
  ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
   '9a000000-0000-4000-8000-000000000001', 'proposed', 'model:test', 'seed'),
  ('0b600000-0000-4000-8000-00000000000b', '1b000000-0000-4000-8000-000000000001',
   '9b000000-0000-4000-8000-000000000001', 'proposed', 'model:test', 'seed');

insert into public.working_titles (organization_id, invention_id, text, state, created_by_actor) values
  ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001', 'Org A title', 'ai_proposed', 'model'),
  ('0b600000-0000-4000-8000-00000000000b', '1b000000-0000-4000-8000-000000000001', 'Org B title', 'ai_proposed', 'model');

insert into public.components (id, organization_id, invention_id, name) values
  ('7a000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'Org A component'),
  ('7b000000-0000-4000-8000-000000000001', '0b600000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', 'Org B component');

insert into public.private_sources (id, organization_id, invention_id, name, kind, status) values
  ('6a000000-0000-4000-8000-000000000009', '0a600000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'studio-memo-a.md', 'design_doc', 'extracted'),
  ('6b000000-0000-4000-8000-000000000009', '0b600000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', 'studio-memo-b.md', 'design_doc', 'extracted');

insert into public.extraction_artifacts (id, organization_id, invention_id, source_id, type, content) values
  ('5a000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000009', 'interpretation_summary', 'Org A artifact'),
  ('5b000000-0000-4000-8000-000000000001', '0b600000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', '6b000000-0000-4000-8000-000000000009', 'interpretation_summary', 'Org B artifact');

insert into public.associations (organization_id, invention_id, solution_id, component_id) values
  ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
   '9a000000-0000-4000-8000-000000000002', '7a000000-0000-4000-8000-000000000001'),
  ('0b600000-0000-4000-8000-00000000000b', '1b000000-0000-4000-8000-000000000001',
   '9b000000-0000-4000-8000-000000000002', '7b000000-0000-4000-8000-000000000001');

insert into public.enablement_coverage (organization_id, invention_id, solution_id, dimension, status, coverage_version) values
  ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
   '9a000000-0000-4000-8000-000000000002', 'concept_stated', 'satisfied', 'coverage-v1.test'),
  ('0b600000-0000-4000-8000-00000000000b', '1b000000-0000-4000-8000-000000000001',
   '9b000000-0000-4000-8000-000000000002', 'concept_stated', 'satisfied', 'coverage-v1.test');

insert into public.interview_sessions (id, organization_id, invention_id, user_id) values
  ('4a000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'a11ce000-0000-4000-8000-000000000001'),
  ('4b000000-0000-4000-8000-000000000001', '0b600000-0000-4000-8000-00000000000b',
   '1b000000-0000-4000-8000-000000000001', 'b0b00000-0000-4000-8000-000000000001');

insert into public.interview_turns (organization_id, session_id, turn_index, question) values
  ('0a600000-0000-4000-8000-00000000000a', '4a000000-0000-4000-8000-000000000001', 0, 'Org A question (synthetic)'),
  ('0b600000-0000-4000-8000-00000000000b', '4b000000-0000-4000-8000-000000000001', 0, 'Org B question (synthetic)');

-- ---------------------------------------------------------------------------
-- Alice (owner, org A): sees org A rows, is blind to org B on every table.
-- ---------------------------------------------------------------------------
select tests.authenticate_as('a11ce000-0000-4000-8000-000000000001');

select is((select count(*) from public.ps_pairs where organization_id = '0a600000-0000-4000-8000-00000000000a'), 2::bigint, 'A sees own ps_pairs');
select is((select count(*) from public.ps_pairs where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B ps_pairs');
select is((select count(*) from public.ps_pairs where id = '9b000000-0000-4000-8000-000000000001'), 0::bigint, 'A cannot fetch org B pair by id');
select is((select count(*) from public.ps_links where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B ps_links');
select is((select count(*) from public.ps_events where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B ps_events');
select is((select count(*) from public.working_titles where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B working_titles');
select is((select count(*) from public.components where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B components');
select is((select count(*) from public.associations where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B associations');
select is((select count(*) from public.extraction_artifacts where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B extraction_artifacts');
select is((select count(*) from public.enablement_coverage where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B enablement_coverage');
select is((select count(*) from public.interview_sessions where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B interview_sessions');
select is((select count(*) from public.interview_turns where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B interview_turns');
select is((select count(*) from public.working_titles where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own working title');
select is((select count(*) from public.enablement_coverage where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own coverage rows');

-- Application roles have NO write path (writes are service-role only):
-- inserts are rejected outright, in-tenant and cross-tenant alike (42501).
select throws_ok(
  $$insert into public.ps_pairs (organization_id, invention_id, kind, statement, state, origin, created_by_actor)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001', 'problem', 'client-side insert', 'user_confirmed', 'manual', 'user')$$,
  '42501', null, 'A cannot insert ps_pairs directly (service-role only)');
select throws_ok(
  $$insert into public.ps_pairs (organization_id, invention_id, kind, statement, state, origin, created_by_actor)
    values ('0b600000-0000-4000-8000-00000000000b', '1b000000-0000-4000-8000-000000000001', 'problem', 'cross-tenant insert', 'ai_proposed', 'manual', 'user')$$,
  '42501', null, 'A cannot insert ps_pairs into org B');
select throws_ok(
  $$insert into public.ps_events (organization_id, invention_id, kind, actor, detail)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001', 'confirmed', 'user:fake', 'forged event')$$,
  '42501', null, 'A cannot forge ps_events');
select throws_ok(
  $$insert into public.working_titles (organization_id, invention_id, text, created_by_actor)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001', 'forged', 'user')$$,
  '42501', null, 'A cannot insert working_titles directly');
select throws_ok(
  $$insert into public.enablement_coverage (organization_id, invention_id, solution_id, dimension, status, coverage_version)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000002', 'concept_stated', 'satisfied', 'forged')$$,
  '42501', null, 'A cannot forge coverage rows (deterministic server code only)');

-- Updates/deletes against own and foreign rows affect zero rows.
select lives_ok(
  $$update public.ps_pairs set state = 'user_confirmed' where id = '9a000000-0000-4000-8000-000000000001'$$,
  'A direct ps_pairs state upgrade runs without effect');
select is((select count(*) from public.ps_pairs where id = '9a000000-0000-4000-8000-000000000001' and state = 'ai_proposed'), 1::bigint,
  'ps_pair state cannot be upgraded client-side');
select lives_ok(
  $$delete from public.components where organization_id = '0a600000-0000-4000-8000-00000000000a'$$,
  'A direct component delete runs without effect');
select is((select count(*) from public.components where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint,
  'components not deletable client-side');

-- ---------------------------------------------------------------------------
-- Bob (owner, org B) is equally blind to org A.
-- ---------------------------------------------------------------------------
select tests.clear_auth();
select tests.authenticate_as('b0b00000-0000-4000-8000-000000000001');
select is((select count(*) from public.ps_pairs where organization_id = '0a600000-0000-4000-8000-00000000000a'), 0::bigint, 'B cannot see org A ps_pairs');
select is((select count(*) from public.extraction_artifacts where organization_id = '0a600000-0000-4000-8000-00000000000a'), 0::bigint, 'B cannot see org A artifacts');
select is((select count(*) from public.interview_sessions where organization_id = '0a600000-0000-4000-8000-00000000000a'), 0::bigint, 'B cannot see org A interview sessions');
select is((select count(*) from public.ps_pairs where organization_id = '0b600000-0000-4000-8000-00000000000b'), 2::bigint, 'B sees own ps_pairs');

-- ---------------------------------------------------------------------------
-- Anonymous sessions see nothing.
-- ---------------------------------------------------------------------------
select tests.clear_auth();
select tests.authenticate_anon();
select is((select count(*) from public.ps_pairs), 0::bigint, 'anon sees zero ps_pairs');
select is((select count(*) from public.working_titles), 0::bigint, 'anon sees zero working titles');
select is((select count(*) from public.interview_turns), 0::bigint, 'anon sees zero interview turns');

-- ---------------------------------------------------------------------------
-- Append-only immutability triggers hold even for trusted roles.
-- ---------------------------------------------------------------------------
select tests.clear_auth();
select throws_ok(
  $$update public.ps_events set detail = 'rewritten' where detail = 'seed'$$,
  'P0001', null, 'ps_events rows are immutable even for trusted roles');
select throws_ok(
  $$delete from public.working_titles where text = 'Org A title'$$,
  'P0001', null, 'working_titles history is immutable even for trusted roles');
select throws_ok(
  $$update public.extraction_artifacts set content = 'rewritten' where content = 'Org A artifact'$$,
  'P0001', null, 'extraction_artifacts are immutable even for trusted roles');
select throws_ok(
  $$update public.enablement_coverage set status = 'gap' where coverage_version = 'coverage-v1.test'$$,
  'P0001', null, 'coverage history is immutable even for trusted roles');

select * from finish();
rollback;
