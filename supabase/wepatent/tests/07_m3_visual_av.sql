-- Intake Studio M3 (migration 0011): region-anchor associations, derived
-- 3D snapshot linkage, transcript artifacts, and the extended ps_events
-- kinds (merge/split/dismissal). Fixture rows are inserted as the
-- superuser (service-role stand-in) inside the rolled-back transaction,
-- against the shared seed's orgs/inventions/users.
begin;
select plan(23);

-- ---------------------------------------------------------------------------
-- Schema shape (0011 additive columns)
-- ---------------------------------------------------------------------------
select has_column('public', 'associations', 'source_id', 'associations carry source_id');
select has_column('public', 'associations', 'region', 'associations carry region jsonb');
select has_column('public', 'associations', 'interview_turn_id',
  'associations carry interview_turn_id');
select has_column('public', 'associations', 'created_by_actor',
  'associations carry created_by_actor');
select has_column('public', 'private_sources', 'derived_from_source_id',
  'sources carry derived_from_source_id (3D snapshot linkage)');

-- ---------------------------------------------------------------------------
-- Fixture (service-role stand-in): a solution pair + an image source in A.
-- ---------------------------------------------------------------------------
insert into public.ps_pairs (id, organization_id, invention_id, kind, statement, state, origin, created_by_actor) values
  ('9e000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'solution', 'Org A M3 solution (synthetic)',
   'ai_proposed', 'upload_distillation', 'model');
insert into public.private_sources (id, organization_id, invention_id, name, kind, status) values
  ('6e000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'photo.png', 'image', 'extracted'),
  ('6e000000-0000-4000-8000-000000000002', '0a600000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'bracket.stl', 'design_doc', 'extracted');

-- Derived snapshot links to its parent 3D source.
insert into public.private_sources (id, organization_id, invention_id, name, kind, status, derived_from_source_id) values
  ('6e000000-0000-4000-8000-000000000003', '0a600000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'bracket-view-front.png', 'image', 'extracted',
   '6e000000-0000-4000-8000-000000000002');
select is(
  (select derived_from_source_id from public.private_sources
    where id = '6e000000-0000-4000-8000-000000000003'),
  '6e000000-0000-4000-8000-000000000002'::uuid,
  'derived snapshot records its parent 3D source');

-- Region-anchor association (source_id + region jsonb) is accepted.
select lives_ok(
  $$insert into public.associations
      (id, organization_id, invention_id, solution_id, source_id, region, created_by_actor, state)
    values ('7e000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
            '1a000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001',
            '6e000000-0000-4000-8000-000000000001',
            '{"page": null, "x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5, "view": null}'::jsonb,
            'model', 'ai_proposed')$$,
  'region-anchor associations are accepted');

-- Interview-turn evidence is a legal association shape too.
insert into public.interview_sessions (id, organization_id, invention_id, user_id) values
  ('4e000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'a11ce000-0000-4000-8000-000000000001');
insert into public.interview_turns (id, organization_id, session_id, turn_index, stage, question) values
  ('3e000000-0000-4000-8000-000000000001', '0a600000-0000-4000-8000-00000000000a',
   '4e000000-0000-4000-8000-000000000001', 0, 'context_field', 'Q0 (synthetic)');
select lives_ok(
  $$insert into public.associations
      (organization_id, invention_id, solution_id, interview_turn_id, created_by_actor, state)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
            '9e000000-0000-4000-8000-000000000001', '3e000000-0000-4000-8000-000000000001',
            'user', 'user_confirmed')$$,
  'interview-turn associations are accepted');

-- Constraint: an association must point at SOME evidence…
select throws_ok(
  $$insert into public.associations (organization_id, invention_id, solution_id, created_by_actor)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
            '9e000000-0000-4000-8000-000000000001', 'user')$$,
  '23514', null, 'evidence-free associations remain rejected');
-- …and a region requires the source it was drawn on.
select throws_ok(
  $$insert into public.associations (organization_id, invention_id, solution_id, region, created_by_actor)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
            '9e000000-0000-4000-8000-000000000001',
            '{"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}'::jsonb, 'user')$$,
  '23514', null, 'a region without its source is rejected');
-- created_by_actor is a fixed set.
select throws_ok(
  $$insert into public.associations (organization_id, invention_id, solution_id, source_id, created_by_actor)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
            '9e000000-0000-4000-8000-000000000001', '6e000000-0000-4000-8000-000000000001', 'robot')$$,
  '23514', null, 'created_by_actor rejects values outside user/model');

-- Transcript artifacts are legal; junk types stay illegal.
select lives_ok(
  $$insert into public.extraction_artifacts (organization_id, invention_id, source_id, type, content, model_id)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
            '6e000000-0000-4000-8000-000000000001', 'transcript', 'Transcript (synthetic)', 'transcription')$$,
  'transcript artifacts are accepted (M3 A/V ingestion)');
select throws_ok(
  $$insert into public.extraction_artifacts (organization_id, invention_id, source_id, type, content)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
            '6e000000-0000-4000-8000-000000000001', 'keyframe_analysis', 'not a real type yet')$$,
  '23514', null, 'unknown artifact types remain rejected');

-- Extended ps_events kinds: merged/split/proposal_dismissed accepted; junk rejected.
select lives_ok(
  $$insert into public.ps_events (organization_id, invention_id, kind, actor, detail)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
            'merged', 'user:test', 'absorbed duplicate (synthetic)')$$,
  'merged events are accepted');
select lives_ok(
  $$insert into public.ps_events (organization_id, invention_id, kind, actor, detail)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
            'proposal_dismissed', 'user:test', '{"type":"proposed_edit_dismissed"}')$$,
  'proposal_dismissed events are accepted');
select throws_ok(
  $$insert into public.ps_events (organization_id, invention_id, kind, actor, detail)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
            'model_confirmed', 'model:test', 'never')$$,
  '23514', null, 'unknown event kinds remain rejected');

-- ---------------------------------------------------------------------------
-- Application roles: tenant isolation + no client write path for anchors.
-- ---------------------------------------------------------------------------
select tests.authenticate_as('a11ce000-0000-4000-8000-000000000001');

select is(
  (select count(*) from public.associations
    where id = '7e000000-0000-4000-8000-000000000001'),
  1::bigint, 'A sees own region-anchor association');
select is(
  (select region->>'x' from public.associations
    where id = '7e000000-0000-4000-8000-000000000001'),
  '0.25', 'A reads the region payload');

select throws_ok(
  $$insert into public.associations
      (organization_id, invention_id, solution_id, source_id, region, created_by_actor, state)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
            '9e000000-0000-4000-8000-000000000001', '6e000000-0000-4000-8000-000000000001',
            '{"x": 0, "y": 0, "w": 1, "h": 1}'::jsonb, 'user', 'user_confirmed')$$,
  '42501', null, 'A cannot insert associations directly (service-role only)');

-- Client-side anchor-state upgrade runs without effect (no update policy).
select lives_ok(
  $$update public.associations set state = 'user_confirmed'
     where id = '7e000000-0000-4000-8000-000000000001'$$,
  'A direct anchor-state upgrade runs without effect');
select is(
  (select count(*) from public.associations
    where id = '7e000000-0000-4000-8000-000000000001' and state = 'ai_proposed'),
  1::bigint, 'ai_proposed anchors cannot be confirmed client-side');

select tests.authenticate_as('b0b00000-0000-4000-8000-000000000001');
select is(
  (select count(*) from public.associations
    where organization_id = '0a600000-0000-4000-8000-00000000000a'),
  0::bigint, 'B cannot see org A associations (region anchors stay tenant-private)');
select is(
  (select count(*) from public.private_sources
    where derived_from_source_id is not null),
  0::bigint, 'B cannot see org A derived snapshot sources');

select * from finish();
rollback;
