-- 0008: MFA enrollment flag for counsel administrators (FR-1).
--
-- MFA is required for counsel roles. Enrollment itself happens in Supabase
-- Auth (AAL2 factors); this flag mirrors enrollment for the authorization
-- guard in requireCounsel and is written only by trusted operator process
-- (service role) — no user-facing policy allows writes.

alter table public.counsel_assignments
  add column if not exists mfa_enrolled boolean not null default false;

comment on column public.counsel_assignments.mfa_enrolled is
  'FR-1: counsel administrators must have MFA enrolled; enforced server-side in production mode.';
