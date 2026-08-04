-- Patent figures (migration 0012): tenancy, client-write denial,
-- append-only evidence, the numeral-registry uniqueness that makes
-- cross-view consistency mechanical, and the multiplier-aware usage-events
-- markup check.
--
-- Fixture rows are inserted as the superuser (service-role stand-in) inside
-- the rolled-back transaction, against the shared seed's orgs/inventions.
begin;
select plan(45);

-- ---------------------------------------------------------------------------
-- Schema shape
-- ---------------------------------------------------------------------------
select has_table('public', 'figure_sets', 'figure_sets exists');
select has_table('public', 'figures', 'figures exists');
select has_table('public', 'figure_reference_numerals', 'figure_reference_numerals exists');
select has_table('public', 'figure_annotations', 'figure_annotations exists');
select has_table('public', 'figure_sheets', 'figure_sheets exists');
select has_table('public', 'figure_validations', 'figure_validations exists');

select has_column('public', 'figure_sets', 'organization_id', 'figure_sets are tenant-scoped');
select has_column('public', 'figures', 'organization_id', 'figures are tenant-scoped');
select has_column('public', 'figure_reference_numerals', 'organization_id',
  'numeral registry is tenant-scoped');
select has_column('public', 'figure_annotations', 'organization_id',
  'annotations are tenant-scoped');
select has_column('public', 'figure_sheets', 'organization_id', 'sheets are tenant-scoped');
select has_column('public', 'figure_validations', 'organization_id',
  'validations are tenant-scoped');

select has_column('public', 'exports', 'figure_set_id',
  'exports link the drawing sheets that ride along');
select has_column('public', 'usage_events', 'markup_multiplier_bp',
  'usage events record the retail multiplier applied');
select has_column('public', 'usage_reservations', 'markup_multiplier_bp',
  'reservations record the multiplier they were priced at');

-- ---------------------------------------------------------------------------
-- Fixture: a figure set in org A with one figure, one numeral, one sheet.
-- ---------------------------------------------------------------------------
insert into public.figure_sets
  (id, organization_id, invention_id, state, rules_version, planner_version)
values
  ('f1600000-0000-4000-8000-00000000000a', '0a600000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-000000000001', 'ready', 'uspto-drawings-2026-08-04',
   'figures-planner-1.0.0');

insert into public.figures
  (id, organization_id, figure_set_id, figure_number, view_type, source_kind, title)
values
  ('f1610000-0000-4000-8000-00000000000a', '0a600000-0000-4000-8000-00000000000a',
   'f1600000-0000-4000-8000-00000000000a', 1, 'block_diagram', 'deterministic_diagram',
   'Block diagram (synthetic)');

insert into public.figure_reference_numerals
  (id, organization_id, figure_set_id, numeral, part_label)
values
  ('f1620000-0000-4000-8000-00000000000a', '0a600000-0000-4000-8000-00000000000a',
   'f1600000-0000-4000-8000-00000000000a', '10', 'intake manifold');

insert into public.figure_annotations
  (id, organization_id, figure_id, numeral, anchor_x, anchor_y, label_x, label_y)
values
  ('f1630000-0000-4000-8000-00000000000a', '0a600000-0000-4000-8000-00000000000a',
   'f1610000-0000-4000-8000-00000000000a', '10', 0.4, 0.5, 0.05, 0.5);

insert into public.figure_sheets
  (id, organization_id, figure_set_id, sheet_number, total_sheets, storage_path, checksum_sha256)
values
  ('f1640000-0000-4000-8000-00000000000a', '0a600000-0000-4000-8000-00000000000a',
   'f1600000-0000-4000-8000-00000000000a', 1, 1, 'figures/a/sheet-1.svg', 'deadbeef');

insert into public.figure_validations
  (id, organization_id, figure_set_id, rule_id, status, rules_version)
values
  ('f1650000-0000-4000-8000-00000000000a', '0a600000-0000-4000-8000-00000000000a',
   'f1600000-0000-4000-8000-00000000000a', 'REF-CROSS-VIEW-CONSISTENCY', 'pass',
   'uspto-drawings-2026-08-04');

-- ---------------------------------------------------------------------------
-- AI can never set a confirmed state (invariant 1): the default is
-- ai_proposed and the enum has no "approved"/"filing_ready" value.
-- ---------------------------------------------------------------------------
select is(
  (select ai_state::text from public.figure_sets
    where id = 'f1600000-0000-4000-8000-00000000000a'),
  'ai_proposed',
  'a new figure set is ai_proposed'
);
select is(
  (select ai_state::text from public.figures
    where id = 'f1610000-0000-4000-8000-00000000000a'),
  'ai_proposed',
  'a new figure is ai_proposed'
);
select throws_ok(
  $$update public.figure_sets set ai_state = 'filing_ready'
      where id = 'f1600000-0000-4000-8000-00000000000a'$$,
  '22P02',
  null,
  'there is no filing_ready state a figure set could be moved to'
);

-- ---------------------------------------------------------------------------
-- The numeral registry enforces cross-view consistency mechanically.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.figure_reference_numerals
      (organization_id, figure_set_id, numeral, part_label)
    values ('0a600000-0000-4000-8000-00000000000a',
            'f1600000-0000-4000-8000-00000000000a', '10', 'a completely different part')$$,
  '23505',
  null,
  'one numeral cannot designate two different parts'
);
select throws_ok(
  $$insert into public.figure_reference_numerals
      (organization_id, figure_set_id, numeral, part_label)
    values ('0a600000-0000-4000-8000-00000000000a',
            'f1600000-0000-4000-8000-00000000000a', '12', 'intake manifold')$$,
  '23505',
  null,
  'one part cannot carry two numerals'
);
select throws_ok(
  $$insert into public.figure_reference_numerals
      (organization_id, figure_set_id, numeral, part_label)
    values ('0a600000-0000-4000-8000-00000000000a',
            'f1600000-0000-4000-8000-00000000000a', '(14)', 'bracketed part')$$,
  '23514',
  null,
  'an enclosed reference character is rejected at the database'
);
select throws_ok(
  $$insert into public.figure_reference_numerals
      (organization_id, figure_set_id, numeral, part_label)
    values ('0a600000-0000-4000-8000-00000000000a',
            'f1600000-0000-4000-8000-00000000000a', '14''', 'primed part')$$,
  '23514',
  null,
  'a primed reference character is rejected at the database'
);
select lives_ok(
  $$insert into public.figure_reference_numerals
      (organization_id, figure_set_id, numeral, part_label)
    values ('0a600000-0000-4000-8000-00000000000a',
            'f1600000-0000-4000-8000-00000000000a', '16A', 'intervening clip')$$,
  'a suffixed reference character (16A) is accepted'
);

-- Partial-view suffixes must be a single capital letter (1.84(u)(2)).
select throws_ok(
  $$insert into public.figures
      (organization_id, figure_set_id, figure_number, view_type, source_kind, partial_suffix)
    values ('0a600000-0000-4000-8000-00000000000a',
            'f1600000-0000-4000-8000-00000000000a', 3, 'partial', 'deterministic_diagram', 'ab')$$,
  '23514',
  null,
  'a partial-view suffix must be one capital letter'
);

-- Sheet numbering cannot exceed the total.
select throws_ok(
  $$insert into public.figure_sheets
      (organization_id, figure_set_id, sheet_number, total_sheets, storage_path, checksum_sha256)
    values ('0a600000-0000-4000-8000-00000000000a',
            'f1600000-0000-4000-8000-00000000000a', 5, 2, 'x', 'y')$$,
  '23514',
  null,
  'sheet n of m cannot have n greater than m'
);

-- ---------------------------------------------------------------------------
-- Append-only evidence.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.figure_validations set status = 'pass'
      where id = 'f1650000-0000-4000-8000-00000000000a'$$,
  'P0001',
  null,
  'validation results cannot be amended'
);
select throws_ok(
  $$delete from public.figure_validations
      where id = 'f1650000-0000-4000-8000-00000000000a'$$,
  'P0001',
  null,
  'validation results cannot be deleted'
);
select throws_ok(
  $$update public.figure_sheets set checksum_sha256 = 'tampered'
      where id = 'f1640000-0000-4000-8000-00000000000a'$$,
  'P0001',
  null,
  'a composed sheet cannot be rewritten in place'
);

-- ---------------------------------------------------------------------------
-- Multiplier-aware markup check on usage_events.
-- ---------------------------------------------------------------------------
insert into public.usage_reservations
  (id, organization_id, idempotency_key, amount_cents, rate_version, status)
values
  ('f1660000-0000-4000-8000-00000000000a', '0a600000-0000-4000-8000-00000000000a',
   'figures-fixture-1', 200, 'rv-test', 'settled');
select is(
  (select markup_multiplier_bp from public.usage_reservations
    where id = 'f1660000-0000-4000-8000-00000000000a'),
  15000,
  'reservations default to the 1.50x platform multiplier'
);

-- 1.50x still settles exactly as before (regression).
select lives_ok(
  $$insert into public.usage_events
      (organization_id, reservation_id, model_id, rate_version,
       provider_cost_cents, customer_charge_cents, input_tokens, output_tokens)
    values ('0a600000-0000-4000-8000-00000000000a',
            'f1660000-0000-4000-8000-00000000000a', 'synthetic-model',
            'rv-test', 20, 30, 100, 100)$$,
  'a 1.50x usage event still settles at ceil(cost * 1.5)'
);
select throws_ok(
  $$insert into public.usage_events
      (organization_id, reservation_id, model_id, rate_version,
       provider_cost_cents, customer_charge_cents, input_tokens, output_tokens)
    values ('0a600000-0000-4000-8000-00000000000a',
            'f1660000-0000-4000-8000-00000000000a', 'synthetic-model',
            'rv-test', 20, 40, 100, 100)$$,
  '23514',
  null,
  'a 1.50x usage event cannot be charged at 2.0x'
);

-- 2.00x image generation settles at double, and only at double.
select lives_ok(
  $$insert into public.usage_events
      (organization_id, reservation_id, model_id, rate_version,
       provider_cost_cents, customer_charge_cents, input_tokens, output_tokens,
       markup_multiplier_bp)
    values ('0a600000-0000-4000-8000-00000000000a',
            'f1660000-0000-4000-8000-00000000000a', 'synthetic-model',
            'rv-test', 24, 48, 0, 0, 20000)$$,
  'an image-generation usage event settles at ceil(cost * 2.0)'
);
select throws_ok(
  $$insert into public.usage_events
      (organization_id, reservation_id, model_id, rate_version,
       provider_cost_cents, customer_charge_cents, input_tokens, output_tokens,
       markup_multiplier_bp)
    values ('0a600000-0000-4000-8000-00000000000a',
            'f1660000-0000-4000-8000-00000000000a', 'synthetic-model',
            'rv-test', 24, 36, 0, 0, 20000)$$,
  '23514',
  null,
  'an image-generation usage event cannot be undercharged at 1.5x'
);

-- ---------------------------------------------------------------------------
-- Tenancy: org B sees nothing of org A's figures, and no client role writes.
-- ---------------------------------------------------------------------------
select tests.authenticate_as('b0b00000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from public.figure_sets), 0,
  'org B cannot read org A figure sets'
);
select is(
  (select count(*)::int from public.figures), 0,
  'org B cannot read org A figures'
);
select is(
  (select count(*)::int from public.figure_reference_numerals), 0,
  'org B cannot read org A numeral registry'
);
select is(
  (select count(*)::int from public.figure_annotations), 0,
  'org B cannot read org A annotations'
);
select is(
  (select count(*)::int from public.figure_sheets), 0,
  'org B cannot read org A drawing sheets'
);
select is(
  (select count(*)::int from public.figure_validations), 0,
  'org B cannot read org A validation results'
);
select tests.clear_auth();

select tests.authenticate_as('a11ce000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from public.figure_sets), 1,
  'org A owner reads their own figure set'
);
select is(
  (select count(*)::int from public.figure_sheets), 1,
  'org A owner reads their own drawing sheets'
);
-- No insert/update/delete policy exists for client roles on any figure table.
select throws_ok(
  $$insert into public.figure_sets (organization_id, invention_id, rules_version)
    values ('0a600000-0000-4000-8000-00000000000a',
            '1a000000-0000-4000-8000-000000000001', 'x')$$,
  '42501',
  null,
  'a member cannot create a figure set directly'
);
-- RLS with no UPDATE policy does not raise; it matches zero rows. Assert the
-- effect, which is what actually matters: the client cannot change a figure.
select lives_ok(
  $$update public.figures set title = 'client edit'
      where id = 'f1610000-0000-4000-8000-00000000000a'$$,
  'a member UPDATE against figures matches no rows (no write policy exists)'
);
select is(
  (select title from public.figures where id = 'f1610000-0000-4000-8000-00000000000a'),
  'Block diagram (synthetic)',
  'the figure is unchanged by a client update attempt'
);
select throws_ok(
  $$insert into public.figure_reference_numerals
      (organization_id, figure_set_id, numeral, part_label)
    values ('0a600000-0000-4000-8000-00000000000a',
            'f1600000-0000-4000-8000-00000000000a', '20', 'client-added part')$$,
  '42501',
  null,
  'a member cannot write the numeral registry directly'
);
select tests.clear_auth();

select * from finish();
rollback;
