-- Public-corpus project: license-class enforcement and release immutability
-- (PRD §6.4, §6.5, FR-5). Runs against the corpus test database.
begin;
select plan(7);

-- Fixture: one clear and one blocked registry entry.
insert into corpus_releases (id, release_label, document_count)
  values ('90000000-0000-4000-8000-000000000001', 'corpus-test-1', 2);

insert into public_documents
  (id, external_key, source_type, collection, jurisdiction, citation, title,
   license_class, license_basis) values
  ('91000000-0000-4000-8000-000000000001', 'corp_test_statute', 'statute',
   'drafting', 'US', '35 U.S.C. § 112 (synthetic)', 'Synthetic statute',
   'government_work', '17 U.S.C. § 105'),
  ('91000000-0000-4000-8000-000000000002', 'corp_test_treatise', 'agency_guidance',
   'drafting', 'US', 'Treatise ch. 4 (synthetic)', 'Blocked commercial treatise',
   'licensed_commercial', 'Internal license only — do not port');

-- License gate: the retrieval surface excludes blocked classes structurally.
select is((select count(*) from retrievable_documents), 1::bigint,
  'retrievable_documents exposes only commercial-clear entries');
select is((select count(*) from retrievable_documents where license_class = 'licensed_commercial'),
  0::bigint, 'licensed_commercial is unreachable through the retrieval view');

-- Ingestion refuses documents without a license basis.
select throws_ok(
  $$insert into public_documents
      (external_key, source_type, collection, jurisdiction, citation, title,
       license_class, license_basis)
    values ('corp_test_nobasis', 'statute', 'drafting', 'US', 'X', 'X',
            'government_work', '')$$,
  '23514', null, 'ingestion refuses an empty license basis');

-- Confidentiality class is locked to public in the corpus project.
select throws_ok(
  $$insert into public_documents
      (external_key, source_type, collection, jurisdiction, citation, title,
       license_class, license_basis, confidentiality_class)
    values ('corp_test_conf', 'statute', 'drafting', 'US', 'X', 'X',
            'government_work', 'basis', 'confidential')$$,
  '23514', null, 'non-public confidentiality class is rejected');

-- Corpus releases are immutable (§6.5).
select throws_like(
  $$update corpus_releases set notes = 'tampered'
    where id = '90000000-0000-4000-8000-000000000001'$$,
  '%append-only%', 'corpus releases cannot be updated');
select throws_like(
  $$delete from corpus_releases
    where id = '90000000-0000-4000-8000-000000000001'$$,
  '%append-only%', 'corpus releases cannot be deleted');

-- Version checksum shape is enforced.
select throws_ok(
  $$insert into public_document_versions
      (document_id, edition, effective_date, provenance, checksum_sha256, release_id)
    values ('91000000-0000-4000-8000-000000000001', 'ed1', '2026-01-01',
            'synthetic', 'not-a-sha', '90000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'malformed content checksum is rejected');

select * from finish();
rollback;
