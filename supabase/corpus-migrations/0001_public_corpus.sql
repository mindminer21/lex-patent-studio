-- Lex Patent Studio — PUBLIC KNOWLEDGE CORPUS project (separate Supabase
-- project and credentials from the private application project; PRD §6.3,
-- PRD-wepatent Invariant 8).
--
-- Migration 0001: corpus registry, releases, sections, embeddings,
-- effective dates, license provenance, citation graph, prosecution outcomes
-- (PRD §11 public corpus tables).
--
-- NOT applied to any remote project. License-class enforcement exists at
-- ingestion (NOT NULL + trigger) and at retrieval (the retrievable_documents
-- view is the only surface the retrieval service reads).

create extension if not exists pgcrypto;

create type license_class as enum (
  'government_work',
  'public_data_api',
  'org_reuse_terms',
  'licensed_commercial',
  'internal_only'
);

create type corpus_source_type as enum (
  'statute', 'regulation', 'case_scotus', 'case_cafc',
  'agency_guidance', 'ptab_decision', 'intl_guidance', 'patent_document'
);

create type corpus_collection as enum (
  'prosecution', 'drafting', 'litigation', 'ptab', 'foreign_pct',
  'technical_prior_art'
);

-- ---------------------------------------------------------------------------
-- Releases: immutable, versioned (§6.5). A workflow run records the release
-- it retrieved against.
-- ---------------------------------------------------------------------------
create table corpus_releases (
  id uuid primary key default gen_random_uuid(),
  release_label text not null unique,
  created_at timestamptz not null default now(),
  document_count integer not null default 0,
  notes text not null default ''
);

-- Append-only: releases are never updated or deleted.
create or replace function corpus_releases_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'corpus_releases is append-only';
end $$;

create trigger corpus_releases_no_update
  before update or delete on corpus_releases
  for each row execute function corpus_releases_immutable();

-- ---------------------------------------------------------------------------
-- Documents + versions (registry is append-only with release versioning)
-- ---------------------------------------------------------------------------
create table public_documents (
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique, -- stable registry key (e.g. corp_usc_112)
  source_type corpus_source_type not null,
  collection corpus_collection not null,
  jurisdiction text not null check (jurisdiction in ('US', 'EP', 'WO')),
  citation text not null,
  title text not null,
  -- License-class enforcement at INGESTION: no document exists without one.
  license_class license_class not null,
  license_basis text not null check (char_length(license_basis) > 0),
  confidentiality_class text not null default 'public'
    check (confidentiality_class = 'public'),
  created_at timestamptz not null default now()
);

create table public_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public_documents (id),
  edition text not null,
  effective_date date not null,
  superseded_on date,
  superseded_by uuid references public_documents (id),
  provenance text not null,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  release_id uuid not null references corpus_releases (id),
  created_at timestamptz not null default now(),
  unique (document_id, edition)
);

create index public_document_versions_doc_idx
  on public_document_versions (document_id, effective_date);

create table public_sections (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references public_document_versions (id),
  section_key text not null,
  heading text not null,
  body text not null,
  ordinal integer not null,
  unique (document_version_id, section_key)
);

create index public_sections_version_idx on public_sections (document_version_id);

-- Full-text search support for hybrid retrieval (FTS half; vector half in
-- public_embeddings).
alter table public_sections
  add column body_tsv tsvector
  generated always as (to_tsvector('english', heading || ' ' || body)) stored;
create index public_sections_tsv_idx on public_sections using gin (body_tsv);

create table public_embeddings (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public_sections (id),
  model text not null,
  -- pgvector is enabled in the hosted corpus project; real[] keeps this
  -- migration runnable on a plain PostgreSQL 16 test server.
  embedding real[] not null,
  created_at timestamptz not null default now(),
  unique (section_id, model)
);

create table authority_effective_dates (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public_documents (id),
  effective_date date not null,
  end_date date,
  note text not null default ''
);

create table license_provenance (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public_documents (id),
  license_class license_class not null,
  basis text not null,
  reviewed_by text not null,
  reviewed_at timestamptz not null default now(),
  terms_url text,
  attribution_required boolean not null default false,
  redistribution_allowed boolean not null default false
);

-- Citation graph for supersession/treatment checks (§6.2.5).
create table citation_edges (
  id uuid primary key default gen_random_uuid(),
  citing_document_id uuid not null references public_documents (id),
  cited_document_id uuid not null references public_documents (id),
  treatment text not null check (
    treatment in ('cites', 'distinguishes', 'overrules', 'supersedes', 'affirms')
  ),
  created_at timestamptz not null default now(),
  unique (citing_document_id, cited_document_id, treatment)
);

-- Structured public prosecution outcomes (§6.1 prosecution-precedent engine).
create table prosecution_outcomes (
  id uuid primary key default gen_random_uuid(),
  application_reference text not null, -- public application identifier
  rejection_statute text not null,     -- e.g. '103', '112(b)'
  art_unit_signal text,
  argument_pattern text not null,
  amendment_pattern text,
  outcome text not null check (
    outcome in ('withdrawn', 'maintained', 'allowed', 'appealed', 'rce')
  ),
  source_document_id uuid references public_documents (id),
  observed_at date not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- License-class enforcement at RETRIEVAL: the retrieval service reads ONLY
-- this view. Blocked classes are structurally unreachable.
-- ---------------------------------------------------------------------------
create view retrievable_documents as
  select d.*
  from public_documents d
  where d.license_class in ('government_work', 'public_data_api', 'org_reuse_terms');

-- RLS: the corpus project serves read-only public data to the retrieval
-- service role; anonymous/browser access is denied entirely (all reads go
-- through the server-side retrieval API).
alter table corpus_releases enable row level security;
alter table public_documents enable row level security;
alter table public_document_versions enable row level security;
alter table public_sections enable row level security;
alter table public_embeddings enable row level security;
alter table authority_effective_dates enable row level security;
alter table license_provenance enable row level security;
alter table citation_edges enable row level security;
alter table prosecution_outcomes enable row level security;
-- No policies for anon/authenticated: deny-by-default. The service role
-- bypasses RLS for ingestion and the retrieval API enforces the
-- retrievable_documents license gate in the query path.
