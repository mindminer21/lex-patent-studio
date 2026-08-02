-- PUBLIC CORPUS PROJECT ONLY (PRD §5.8, §9).
--
-- This migration belongs to the SEPARATE public patent/legal-authority
-- Supabase project. It must never be applied to the private application
-- project, and the two projects must never share credentials. There is no
-- tenant data here; everything is public-authority material with license
-- provenance (legal-ethics memo §6: public ≠ public domain).

create extension if not exists vector;

create table public.public_documents (
  id uuid primary key default gen_random_uuid(),
  authority text not null check (authority in ('uscode', 'cfr', 'mpep', 'federal_register', 'case', 'patent', 'other')),
  citation text not null,
  title text not null,
  canonical_url text not null,
  created_at timestamptz not null default now(),
  unique (authority, citation)
);

create table public.public_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.public_documents (id) on delete cascade,
  version_label text not null,
  effective_date date,
  retrieved_at timestamptz not null default now(),
  content_hash text not null,
  unique (document_id, version_label)
);

create table public.public_sections (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references public.public_document_versions (id) on delete cascade,
  section_ref text not null,
  heading text not null default '',
  body text not null,
  created_at timestamptz not null default now()
);
create index on public.public_sections (document_version_id);

create table public.public_embeddings (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.public_sections (id) on delete cascade,
  embedding vector(1536) not null,
  model_id text not null,
  created_at timestamptz not null default now()
);

create table public.authority_effective_dates (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.public_documents (id) on delete cascade,
  effective_date date not null,
  note text not null default ''
);

create table public.license_provenance (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.public_documents (id) on delete cascade,
  owner text not null,
  acquisition_method text not null,
  license_terms text not null,
  permitted_use text not null,
  excerpt_limit text not null default '',
  attribution_required boolean not null default false,
  expires_at date,
  deletion_duty text not null default '',
  recorded_at timestamptz not null default now()
);

-- Read-only via service credentials from the application's worker plane;
-- RLS enabled with no anon policies.
alter table public.public_documents enable row level security;
alter table public.public_document_versions enable row level security;
alter table public.public_sections enable row level security;
alter table public.public_embeddings enable row level security;
alter table public.authority_effective_dates enable row level security;
alter table public.license_provenance enable row level security;
