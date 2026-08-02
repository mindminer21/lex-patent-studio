-- ---------------------------------------------------------------------------
-- Post-migration grants — TEST HARNESS ONLY.
--
-- On a real Supabase project these grants exist through the platform's
-- default privileges (postgres grants ALL on public tables to anon,
-- authenticated, and service_role; RLS does the actual enforcement).
-- The shimmed local server needs them applied explicitly so that the RLS
-- allow/deny matrix tests privilege through policies, not through a missing
-- GRANT.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
