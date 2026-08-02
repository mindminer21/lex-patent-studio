-- wepatent private application project — foundation migration.
-- Written for the PRIVATE application Supabase project only (PRD §5.8).
-- NOT applied to any remote project in this phase (approval-gated, PRD §17).

create extension if not exists pgcrypto;

-- The tenancy helpers below are `language sql` and reference
-- public.organization_memberships, which is created in migration 0002.
-- PostgreSQL validates SQL function bodies at CREATE time by default, so
-- body validation must be deferred to first execution here.
set check_function_bodies = off;

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
create type public.org_role as enum (
  'owner', 'admin', 'member', 'viewer', 'counsel_intake', 'counsel_attorney', 'platform_support'
);

create type public.fact_provenance as enum (
  'user_asserted', 'source_supported', 'needs_confirmation', 'disputed', 'counsel_reviewed'
);

create type public.fact_category as enum (
  'technical', 'contributor', 'timeline', 'ownership', 'business'
);

create type public.counsel_request_state as enum (
  'draft', 'submitted', 'conflict_review', 'declined', 'consultation_offered',
  'consultation_scheduled', 'engagement_offered', 'engagement_signed', 'converted_to_matter'
);

create type public.source_status as enum (
  'registered', 'uploaded', 'quarantined', 'scanned', 'extracted', 'rejected'
);

create type public.reservation_status as enum ('held', 'settled', 'released');

create type public.generation_job_status as enum (
  'queued', 'running', 'succeeded', 'failed', 'cancelled'
);

create type public.ledger_entry_kind as enum (
  'promo_credit', 'top_up', 'settlement', 'release', 'refund', 'adjustment'
);

-- ---------------------------------------------------------------------------
-- Tenancy helper functions (used by every RLS policy)
-- ---------------------------------------------------------------------------
create or replace function app.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.organization_memberships
  where user_id = (select auth.uid());
$$;

create or replace function app.has_org_role(target_org uuid, allowed text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.role::text = any (allowed)
  );
$$;

-- Immutability guard for append-only tables.
create or replace function app.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'rows in table % are immutable from application roles', tg_table_name;
end;
$$;
