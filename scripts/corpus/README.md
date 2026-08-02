# Corpus ingestion pipeline

Ingests the Hermes patent corpus export (`/tmp/corpus`) into the two
production **corpus** Supabase projects (never the private app projects):

| Project | Ref | Gets |
|---|---|---|
| Lex corpus | `ldohfdzhcpddxovfqbhg` | full set (license-gated retrieval via `retrievable_documents`) |
| wepatent corpus | `zmlgetayqsbfjjzaplgh` | US-government-work subset only (primary law + authority feeds) |

Release label: `2026-08-02-initial`.

## Scripts (run in order)

1. `inventory.py` — walks `/tmp/corpus`, classifies every document
   (layer, jurisdiction, license class, effective date), enforces the
   PRD §6.4 license boundary (skips anything whose provenance points at
   Practical Law / recovered CLE / playbook / client-matter / NITA
   material), writes `$CORPUS_WORK/inventory.jsonl` + `skipped.jsonl`.
2. `ingest.py` — upserts documents → versions → sections (+ license
   provenance, effective dates) into both projects; loads
   `citation_edges` from `patent-citation-graph/citations.sqlite3` and
   `prosecution_outcomes` from
   `patent-prosecution-engine/prosecution.sqlite3` (Lex only). Writes
   `$CORPUS_WORK/chunks.jsonl` for the embed step.
   `INGEST_LIMIT=3` runs a smoke test (3 docs/layer).
3. `embed.py` — OpenAI `text-embedding-3-small` (1536-d), priority order:
   pinecone staging → primary law → canonical → authority feeds → FR
   abstracts. Prints token/cost estimate first; wall-time capped via
   `EMBED_MINUTES` (default 50). Remainder stays FTS-only.
4. `verify.py` — live table counts + retrieval probes (FTS, hybrid
   vector, license-gate proof). Writes `$CORPUS_WORK/verify-results.json`.

Backfill for whatever the cap left FTS-only:

```bash
BACKFILL_MINUTES=60 python3 scripts/corpus/embed-backfill.py lex
BACKFILL_MINUTES=60 python3 scripts/corpus/embed-backfill.py wepatent
# rerun until it prints "backfill complete"; resumable at any time
```

## Idempotency

Every row id is a deterministic `uuid5` of its natural key and every
insert is a PostgREST upsert against the table's unique constraint, so
reruns converge instead of duplicating. Content is keyed on source
checksums (a changed source produces a new version row).

## Credentials (never committed, never printed)

- `/tmp/deliver/lex.env.production`, `/tmp/deliver/wepatent.env.production`
- `/root/launch-secrets/lex-corpus.apikeys.json` (Lex corpus service key)
- `/root/launch-secrets/openai.key`, `/root/.supabase-pat`
- Override any path via env vars in `corpuslib.py`.

## License boundary (hard rules)

- `government_work` (MPEP, 35 USC, 37 CFR, Federal Register, PTAB/CAFC/
  SCOTUS, USPTO data) → retrievable.
- EPO / WIPO / Hague / legacy non-gov reference → ingested into Lex as
  `internal_only`, **structurally excluded** from `retrievable_documents`
  pending source-registry approval (PRD §20.9); never sent to wepatent.
- Practical Law / recovered CLE / NITA / playbook / client-matter
  provenance → never ingested anywhere (see `skipped.jsonl`).

See `docs/CORPUS-INGESTION.md` for the full run report.
