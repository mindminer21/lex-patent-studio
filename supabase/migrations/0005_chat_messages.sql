-- Lex Patent Studio — private application project
-- Migration 0005: grounded chat messages (§8.2 /chat).
--
-- Matter-isolated conversation threads. Replies are retrieval-grounded with
-- citations (Invariants 13–14 apply to chat), authored server-side; clients
-- never write directly (no write policies — service role only).

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  matter_id uuid not null references matters (id) on delete cascade,
  author text not null check (author in ('user', 'lex')),
  author_user_id text not null,
  body text not null check (char_length(body) between 1 and 6000),
  citations jsonb not null default '[]'::jsonb,
  as_of_date date,
  corpus_release text,
  created_at timestamptz not null default now()
);

create index chat_messages_org_matter_idx
  on chat_messages (organization_id, matter_id, created_at);

alter table chat_messages enable row level security;

-- Matter visibility mirrors the rest of the matter-scoped tables.
create policy chat_messages_select on chat_messages
  for select to authenticated
  using (app_is_org_member(organization_id) and app_can_view_matter(organization_id, matter_id));
