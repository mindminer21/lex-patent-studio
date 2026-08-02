-- Lex Patent Studio — private application project
-- Migration 0004: playbook hash chain columns (PRD §5.4, §11
-- "playbook_entries (tenant-isolated, hash-chained approvals)").
--
-- Aligns the SQL schema with the domain model in src/lib/domain/styles.ts:
-- each entry commits to its predecessor's entry hash, so tampering,
-- reordering, or splicing is detectable on read. The table remains
-- append-only via the existing playbook_entries_immutable trigger.

alter table playbook_entries
  add column category text not null default 'approved_argument'
    check (category in ('approved_argument', 'claim_structure', 'examiner_note')),
  add column prev_entry_hash text not null default 'genesis'
    check (char_length(prev_entry_hash) > 0),
  add column entry_hash text not null default ''
    check (entry_hash = '' or entry_hash ~ '^[0-9a-f]{64}$');

comment on column playbook_entries.prev_entry_hash is
  'Chain link: entry hash of the tenant''s previous entry, or ''genesis''.';
comment on column playbook_entries.entry_hash is
  'sha256(prev_entry_hash || content_sha256 || reviewer || role || published_at).';

-- Style profiles: kind + platform-default flag per the domain model.
alter table style_profiles
  add column kind text not null default 'application_drafting'
    check (kind in ('application_drafting', 'search_report', 'oa_response')),
  add column platform_default boolean not null default false;

-- Exactly one platform-default profile per tenant.
create unique index style_profiles_platform_default_idx
  on style_profiles (organization_id)
  where platform_default;
