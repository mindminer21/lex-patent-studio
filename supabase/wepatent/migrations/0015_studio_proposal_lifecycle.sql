-- Lost Studio proposal lifecycle migration, reconstructed from the live
-- schema contract. This is additive at the domain level: it extends the
-- append-only event vocabulary without changing or deleting event rows.

alter table public.ps_events drop constraint if exists ps_events_kind_check;
alter table public.ps_events add constraint ps_events_kind_check
  check (kind in (
    'proposed',
    'confirmed',
    'edited',
    'deleted',
    'ai_proposal_rejected',
    'linked',
    'unlinked',
    'title_proposed',
    'title_edited',
    'title_confirmed',
    'merged',
    'split',
    'proposal_dismissed',
    'ai_proposal_archived',
    'ai_proposal_restored',
    'proposal_feedback'
  ));
