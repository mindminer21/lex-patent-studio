-- Three-pass drafting (migration 0013): tenancy, client-write denial,
-- append-only transitions, and — the reason this file exists — the DELIVERY
-- GATE expressed as database constraints.
--
-- The application enforces the same rules through
-- src/lib/shared/drafting/delivery-gate.ts. Having them here too means no
-- code path, including a future one, can store a deliverable-looking row
-- that is not one.
--
-- Fixture rows are inserted as the superuser (service-role stand-in) inside
-- the rolled-back transaction, against the shared seed's orgs/inventions.
begin;
select plan(43);

-- ---------------------------------------------------------------------------
-- Schema shape
-- ---------------------------------------------------------------------------
select has_table('public', 'draft_sets', 'draft_sets exists');
select has_table('public', 'draft_set_transitions', 'draft_set_transitions exists');

select has_column('public', 'draft_sets', 'organization_id', 'draft sets are tenant-scoped');
select has_column('public', 'draft_set_transitions', 'organization_id',
  'draft-set transitions are tenant-scoped');
select has_column('public', 'draft_sets', 'illustrations_brief',
  'the Pass-1 illustrations brief is persisted on the set');
select has_column('public', 'draft_sets', 'pass_1_version_id',
  'the first-pass version stays inspectable');
select has_column('public', 'draft_sets', 'pass_2_version_id',
  'the second pass is a NEW version, never an in-place mutation');
select has_column('public', 'draft_sets', 'reconciled',
  'the two-way 608.02 result gates readiness');
select has_column('public', 'draft_sets', 'interrupted_stage',
  'an interruption records the stage it paused');
select has_column('public', 'draft_sets', 'accepted_by',
  'human acceptance is recorded on the set');

select has_column('public', 'figure_sets', 'draft_set_id',
  'a figure set knows which draft set it belongs to');
select has_column('public', 'figure_sets', 'built_from_brief',
  'a figure set records whether it was planned from the brief');
select has_column('public', 'draft_versions', 'draft_pass',
  'a draft version records which pass produced it');
select has_column('public', 'draft_versions', 'draft_set_id',
  'a draft version links back to its draft set');
select has_column('public', 'exports', 'draft_set_id',
  'an export links the draft set it delivered');

select has_type('public', 'draft_pass_state', 'the pass state enum exists');
select has_type('public', 'draft_pass_stage', 'the resumable-stage enum exists');

-- Every state in the shared state machine has a database value.
select is(
  (select count(*)::int from unnest(enum_range(null::public.draft_pass_state))),
  8,
  'all eight pass states are representable'
);

-- The two new job kinds are accepted by app_jobs.
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'app_jobs_kind_check')
    like '%draft_pass_1%',
  'app_jobs accepts the draft_pass_1 job kind'
);
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'app_jobs_kind_check')
    like '%draft_pass_2%',
  'app_jobs accepts the draft_pass_2 job kind'
);

-- ---------------------------------------------------------------------------
-- Fixture: a draft set in org A, mid-Pass-1.
-- ---------------------------------------------------------------------------
insert into public.draft_sets (id, organization_id, invention_id, state, illustrations_brief)
values (
  'd5300000-0000-4000-8000-00000000000a',
  '0a600000-0000-4000-8000-00000000000a',
  (select id from public.inventions
    where organization_id = '0a600000-0000-4000-8000-00000000000a' limit 1),
  'pass_1_drafting',
  '{"version":"illustrations-brief-1.0.0","figures":[],"numerals":[]}'::jsonb
);

insert into public.draft_set_transitions
  (organization_id, draft_set_id, from_state, to_state, actor, reason)
values (
  '0a600000-0000-4000-8000-00000000000a',
  'd5300000-0000-4000-8000-00000000000a',
  null, 'pass_1_drafting', 'system', 'Set created; Pass 1 queued.'
);

select is(
  (select state::text from public.draft_sets
    where id = 'd5300000-0000-4000-8000-00000000000a'),
  'pass_1_drafting',
  'a new set starts in Pass 1'
);

-- ---------------------------------------------------------------------------
-- THE DELIVERY GATE, as constraints
-- ---------------------------------------------------------------------------

-- A Pass-1-only set can never be stored as ready for review.
select throws_ok(
  $$update public.draft_sets set state = 'ready_for_review'
      where id = 'd5300000-0000-4000-8000-00000000000a'$$,
  '23514',
  null,
  'a set with no second-pass version cannot be marked ready for review'
);

-- Nor can one with a second pass but no passing reconciliation.
select throws_ok(
  $$update public.draft_sets
      set state = 'ready_for_review',
          pass_2_version_id = (select id from public.draft_versions limit 1),
          figure_set_id = null,
          reconciled = true
      where id = 'd5300000-0000-4000-8000-00000000000a'$$,
  '23514',
  null,
  'a set with no figure set cannot be marked ready for review'
);

select throws_ok(
  $$update public.draft_sets
      set state = 'ready_for_review',
          pass_2_version_id = (select id from public.draft_versions limit 1),
          figure_set_id = (select id from public.figure_sets limit 1),
          reconciled = false
      where id = 'd5300000-0000-4000-8000-00000000000a'$$,
  '23514',
  null,
  'an unreconciled set cannot be marked ready for review'
);

-- Acceptance may not be recorded on a set that has not reached readiness.
select throws_ok(
  $$update public.draft_sets
      set accepted_by = (select id from auth.users limit 1),
          accepted_at = now()
      where id = 'd5300000-0000-4000-8000-00000000000a'$$,
  '23514',
  null,
  'a set that is not ready for review cannot be accepted'
);

-- Acceptance is recorded whole or not at all.
select throws_ok(
  $$insert into public.draft_sets (organization_id, invention_id, state, accepted_at)
    values ('0a600000-0000-4000-8000-00000000000a',
            (select id from public.inventions
              where organization_id = '0a600000-0000-4000-8000-00000000000a' limit 1),
            'ready_for_review', now())$$,
  '23514',
  null,
  'an acceptance timestamp without an accepting user is refused'
);

-- ---------------------------------------------------------------------------
-- Interruptions must name the stage they paused
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.draft_sets set state = 'paused_budget', interrupted_stage = null
      where id = 'd5300000-0000-4000-8000-00000000000a'$$,
  '23514',
  null,
  'a budget pause must record the stage it interrupted'
);

select lives_ok(
  $$update public.draft_sets
      set state = 'paused_budget', interrupted_stage = 'pass_2_revising',
          status_detail = 'Figure budget cap reached.'
      where id = 'd5300000-0000-4000-8000-00000000000a'$$,
  'a budget pause that names its stage is accepted'
);

select throws_ok(
  $$update public.draft_sets set state = 'pass_1_drafting'
      where id = 'd5300000-0000-4000-8000-00000000000a'$$,
  '23514',
  null,
  'a non-interruption state cannot claim an interrupted stage'
);

select lives_ok(
  $$update public.draft_sets
      set state = 'pass_1_drafting', interrupted_stage = null, status_detail = ''
      where id = 'd5300000-0000-4000-8000-00000000000a'$$,
  'clearing the interruption clears the stage'
);

-- ---------------------------------------------------------------------------
-- A version records which pass produced it
-- ---------------------------------------------------------------------------
-- draft_versions are already append-only (migration 0003), so the pass
-- column is asserted through its CHECK definition rather than by attempting
-- an update the immutability trigger would reject first.
select ok(
  (select pg_get_constraintdef(c.oid)
     from pg_constraint c
     join pg_attribute a
       on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.draft_versions'::regclass
      and c.contype = 'c'
      and a.attname = 'draft_pass') like '%1, 2%',
  'a draft version belongs to pass 1 or pass 2 — there is no third pass'
);

-- ---------------------------------------------------------------------------
-- Only one active set per invention
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.draft_sets (organization_id, invention_id, state)
    values ('0a600000-0000-4000-8000-00000000000a',
            (select id from public.inventions
              where organization_id = '0a600000-0000-4000-8000-00000000000a' limit 1),
            'pass_1_drafting')$$,
  '23505',
  null,
  'a second active draft set for the same invention is refused'
);

-- ---------------------------------------------------------------------------
-- Transitions are append-only evidence
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.draft_set_transitions set reason = 'rewritten'
      where draft_set_id = 'd5300000-0000-4000-8000-00000000000a'$$,
  'P0001',
  null,
  'a recorded transition cannot be edited'
);

select throws_ok(
  $$delete from public.draft_set_transitions
      where draft_set_id = 'd5300000-0000-4000-8000-00000000000a'$$,
  'P0001',
  null,
  'a recorded transition cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- RLS: tenancy and client-write denial
-- ---------------------------------------------------------------------------
select ok(
  (select relrowsecurity from pg_class where oid = 'public.draft_sets'::regclass),
  'RLS is enabled on draft_sets'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.draft_set_transitions'::regclass),
  'RLS is enabled on draft_set_transitions'
);

select tests.authenticate_as('a11ce000-0000-4000-8000-000000000001');

select is(
  (select count(*)::int from public.draft_sets
    where id = 'd5300000-0000-4000-8000-00000000000a'),
  1,
  'a member of org A can read org A draft sets'
);
select is(
  (select count(*)::int from public.draft_set_transitions
    where draft_set_id = 'd5300000-0000-4000-8000-00000000000a'),
  1,
  'a member of org A can read org A draft-set transitions'
);

select throws_ok(
  $$insert into public.draft_sets (organization_id, invention_id, state)
    values ('0a600000-0000-4000-8000-00000000000a',
            (select id from public.inventions limit 1), 'ready_for_review')$$,
  '42501',
  null,
  'a member cannot create a draft set directly — only trusted server logic writes'
);

-- There is no UPDATE policy, so a client update matches no rows at all:
-- the state is unchanged rather than an error being raised.
update public.draft_sets set state = 'ready_for_review'
  where id = 'd5300000-0000-4000-8000-00000000000a';
select is(
  (select state::text from public.draft_sets
    where id = 'd5300000-0000-4000-8000-00000000000a'),
  'pass_1_drafting',
  'a member cannot move a draft set to ready for review from the client'
);

select throws_ok(
  $$insert into public.draft_set_transitions
      (organization_id, draft_set_id, to_state, actor)
    values ('0a600000-0000-4000-8000-00000000000a',
            'd5300000-0000-4000-8000-00000000000a', 'ready_for_review', 'client')$$,
  '42501',
  null,
  'a member cannot forge a transition record'
);

select tests.clear_auth();

-- A member of a DIFFERENT org sees nothing.
select tests.authenticate_as('b0b00000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from public.draft_sets
    where id = 'd5300000-0000-4000-8000-00000000000a'),
  0,
  'a member of org B cannot read org A draft sets'
);
select is(
  (select count(*)::int from public.draft_set_transitions
    where draft_set_id = 'd5300000-0000-4000-8000-00000000000a'),
  0,
  'a member of org B cannot read org A draft-set transitions'
);
select tests.clear_auth();

select * from finish();
rollback;
