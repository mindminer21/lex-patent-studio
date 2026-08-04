-- Three-pass drafting (Lex migration 0007). The SAME flow as wepatent, so
-- deliberately the same assertions: schema shape, tenancy + matter ACL,
-- client-write denial, append-only transitions, and the delivery gate
-- expressed as database constraints.
--
-- The application enforces the same rules through the shared
-- src/lib/shared/drafting/delivery-gate.ts. Having them here too means no
-- code path in either product can store a deliverable-looking row that is
-- not one.
begin;
select plan(29);

-- ---------------------------------------------------------------------------
-- Schema shape
-- ---------------------------------------------------------------------------
select has_table('public', 'draft_sets', 'draft_sets exists');
select has_table('public', 'draft_set_transitions', 'draft_set_transitions exists');
select has_column('public', 'draft_sets', 'matter_id', 'a Lex draft set hangs off a matter');
select has_column('public', 'draft_sets', 'tier', 'a Lex draft set carries its work tier');
select has_column('public', 'draft_sets', 'review_item_id',
  'a completed set links the review item it produced');
select has_column('public', 'draft_sets', 'illustrations_brief',
  'the Pass-1 illustrations brief is persisted on the set');
select has_column('public', 'draft_sets', 'pass_1_document_version_id',
  'the first-pass version stays inspectable');
select has_column('public', 'draft_sets', 'pass_2_document_version_id',
  'the second pass is a NEW version, never an in-place mutation');
select has_column('public', 'draft_sets', 'reconciled',
  'the two-way 608.02 result gates readiness');
select has_column('public', 'document_versions', 'draft_pass',
  'a document version records which pass produced it');
select has_column('public', 'exports', 'draft_set_id',
  'an export links the draft set it delivered');
select has_type('public', 'draft_pass_state', 'the pass state enum exists');
select is(
  (select count(*)::int from unnest(enum_range(null::draft_pass_state))),
  8,
  'all eight pass states are representable — same machine as wepatent'
);

-- ---------------------------------------------------------------------------
-- Fixture: a draft set on matter A1, mid-Pass-1.
-- ---------------------------------------------------------------------------
insert into public.draft_sets (id, organization_id, matter_id, state, illustrations_brief)
values (
  'd7000000-0000-4000-8000-00000000000a',
  '0a000000-0000-4000-8000-00000000000a',
  '1a000000-0000-4000-8000-000000000001',
  'pass_1_drafting',
  '{"version":"illustrations-brief-1.0.0","figures":[],"numerals":[]}'::jsonb
);

insert into public.draft_set_transitions
  (organization_id, draft_set_id, from_state, to_state, actor, reason)
values (
  '0a000000-0000-4000-8000-00000000000a',
  'd7000000-0000-4000-8000-00000000000a',
  null, 'pass_1_drafting', 'system', 'Set created; Pass 1 queued.'
);

select is(
  (select tier::text from public.draft_sets
    where id = 'd7000000-0000-4000-8000-00000000000a'),
  'B',
  'Lex drafting is Tier B — draft for review'
);

-- ---------------------------------------------------------------------------
-- Tier floor: promotion allowed, demotion refused (Invariant 15)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$update public.draft_sets set tier = 'C'
      where id = 'd7000000-0000-4000-8000-00000000000a'$$,
  'a draft set may be promoted to Tier C'
);
select throws_ok(
  $$update public.draft_sets set tier = 'A'
      where id = 'd7000000-0000-4000-8000-00000000000a'$$,
  '23514',
  null,
  'a draft set may never be demoted below the Tier B floor'
);
update public.draft_sets set tier = 'B'
  where id = 'd7000000-0000-4000-8000-00000000000a';

-- ---------------------------------------------------------------------------
-- THE DELIVERY GATE, as constraints
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.draft_sets set state = 'ready_for_review'
      where id = 'd7000000-0000-4000-8000-00000000000a'$$,
  '23514',
  null,
  'a set with no second-pass version cannot be marked ready for review'
);

select throws_ok(
  $$update public.draft_sets
      set state = 'ready_for_review',
          pass_2_document_version_id = (select id from public.document_versions limit 1),
          reconciled = false
      where id = 'd7000000-0000-4000-8000-00000000000a'$$,
  '23514',
  null,
  'an unreconciled set cannot be marked ready for review'
);

select throws_ok(
  $$update public.draft_sets
      set accepted_by = 'a0000000-0000-4000-8000-000000000002',
          accepted_at = now()
      where id = 'd7000000-0000-4000-8000-00000000000a'$$,
  '23514',
  null,
  'a set that is not ready for review cannot be accepted'
);

-- ---------------------------------------------------------------------------
-- Interruptions must name the stage they paused
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.draft_sets set state = 'paused_budget', interrupted_stage = null
      where id = 'd7000000-0000-4000-8000-00000000000a'$$,
  '23514',
  null,
  'a budget pause must record the stage it interrupted'
);
select lives_ok(
  $$update public.draft_sets
      set state = 'paused_budget', interrupted_stage = 'pass_2_revising'
      where id = 'd7000000-0000-4000-8000-00000000000a'$$,
  'a budget pause that names its stage is accepted'
);
update public.draft_sets set state = 'pass_1_drafting', interrupted_stage = null
  where id = 'd7000000-0000-4000-8000-00000000000a';

-- ---------------------------------------------------------------------------
-- Only one active set per matter
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.draft_sets (organization_id, matter_id, state)
    values ('0a000000-0000-4000-8000-00000000000a',
            '1a000000-0000-4000-8000-000000000001', 'pass_1_drafting')$$,
  '23505',
  null,
  'a second active draft set for the same matter is refused'
);

-- ---------------------------------------------------------------------------
-- Transitions are append-only evidence
-- ---------------------------------------------------------------------------
select throws_like(
  $$update public.draft_set_transitions set reason = 'rewritten'
      where draft_set_id = 'd7000000-0000-4000-8000-00000000000a'$$,
  '%append-only%',
  'a recorded transition cannot be edited'
);
select throws_like(
  $$delete from public.draft_set_transitions
      where draft_set_id = 'd7000000-0000-4000-8000-00000000000a'$$,
  '%append-only%',
  'a recorded transition cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- RLS: tenancy, matter ACL, and client-write denial
-- ---------------------------------------------------------------------------
select ok(
  (select relrowsecurity from pg_class where oid = 'public.draft_sets'::regclass),
  'RLS is enabled on draft_sets'
);

-- A practitioner in org A with access to matter A1 can read it.
select tests.authenticate_as('a0000000-0000-4000-8000-000000000002');
select is(
  (select count(*)::int from public.draft_sets
    where id = 'd7000000-0000-4000-8000-00000000000a'),
  1,
  'a practitioner with matter access can read the draft set'
);
select throws_ok(
  $$insert into public.draft_sets (organization_id, matter_id, state)
    values ('0a000000-0000-4000-8000-00000000000a',
            '1a000000-0000-4000-8000-000000000002', 'ready_for_review')$$,
  '42501',
  null,
  'a practitioner cannot create a draft set directly'
);
select tests.clear_auth();

-- A member of a DIFFERENT org sees nothing.
select tests.authenticate_as('b0000000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from public.draft_sets
    where id = 'd7000000-0000-4000-8000-00000000000a'),
  0,
  'a member of org B cannot read org A draft sets'
);
select is(
  (select count(*)::int from public.draft_set_transitions
    where draft_set_id = 'd7000000-0000-4000-8000-00000000000a'),
  0,
  'a member of org B cannot read org A draft-set transitions'
);
select tests.clear_auth();

select * from finish();
rollback;
