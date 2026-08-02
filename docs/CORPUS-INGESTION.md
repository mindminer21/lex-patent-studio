# Corpus ingestion report — release `2026-08-02-initial`

Executed 2026-08-02 against the two production **corpus** Supabase projects
(pipeline: `scripts/corpus/`, run order: `inventory.py` → `ingest.py` →
`embed.py` → `embed-backfill.py` → `verify.py`). All numbers below are from
live post-ingest queries (`/tmp/corpus-work/verify-results.json`).

| Project | Ref | Scope |
|---|---|---|
| Lex corpus | `ldohfdzhcpddxovfqbhg` | full set, license-gated retrieval |
| wepatent corpus | `zmlgetayqsbfjjzaplgh` | US-government-work subset (primary law + authority feeds, PRD-wepatent §7.4) |

## 1. Inventory (source: Hermes export `/tmp/corpus`)

24,826 documents classified; 24,780 ingested to Lex after de-duplication
(44 duplicate artifact keys across feed sources + 2 exact-content duplicates
between the pinecone staging layer and patent-canonical).

| Layer | Documents | Notes |
|---|---:|---|
| patent-primary-law | 3,492 | section-level MPEP (1,991), 37 CFR (1,331), 35 USC (168), post-MPEP overlay (2) |
| patent-public-pinecone | 23 | curated staging (21 authorities + case-law research; 2 deduped vs canonical) |
| patent-canonical | 183 | after license filtering (see §3) |
| patent-authority-feeds | 388 | 26 snapshot sources + 362 linked artifacts (current snapshots chunked; 60 historical snapshots kept as version rows) |
| federal-register-uspto | 1,947 | 175 full-text + 1,772 catalog entries (title+abstract as searchable section) |
| federal-circuit-catalog | 18,793 | 2004–present official catalog (case metadata section per entry) |
| citation graph | — | mapped to `citation_edges` (Lex) |
| prosecution engine | — | mapped to `prosecution_outcomes` (Lex) |

Skipped (`/tmp/corpus-work/skipped.jsonl`): 213 canonical quarantine records,
**17 Practical Law** records and **81 legacy CLE/NITA/trial-course-provenance**
records (license boundary, PRD §6.4 — the canonical manifest did carry
Practical Law records despite the export intent; they were detected via
manifest provenance + aliases and never ingested), plus re-derivable
artifacts (raw HTML — extracted `document.md` ingested instead; raw ODP seed
JSON — normalized SQLite ingested instead; primary-law staging copies).
No ITC feed existed in the export (README mentions ITC; no `sources/itc-*`).

## 2. What was ingested where (live counts)

**Lex corpus (ldohfdzhcpddxovfqbhg)**

| Table | Rows |
|---|---:|
| corpus_releases | 1 (`2026-08-02-initial`, document_count 24,780) |
| public_documents | 24,780 |
| public_document_versions | 24,840 |
| public_sections | 46,383 (FTS via generated `body_tsv`) |
| public_embeddings | 46,383 (**100% embedded — nothing FTS-only**) |
| license_provenance | 24,780 |
| authority_effective_dates | 24,085 |
| citation_edges | 16,725 |
| prosecution_outcomes | 729 |
| retrievable_documents (view) | 24,290 |

**wepatent corpus (zmlgetayqsbfjjzaplgh)**

| Table | Rows |
|---|---:|
| corpus_releases | 1 (added table; see §6) |
| public_documents | 24,258 (case 18,797 · mpep 1,993 · federal_register 1,947 · cfr 1,331 · uscode 168 · other 22) |
| public_document_versions | 24,258 |
| public_sections | 33,105 (tsvector column + GIN index added, see §6) |
| public_embeddings | 33,105 (**100% embedded**) |
| license_provenance | 24,258 |
| authority_effective_dates | 24,064 |

## 3. License-class breakdown (Lex)

| license_class | Docs | Retrievable via view |
|---|---:|---:|
| government_work | 24,288 | 24,288 |
| org_reuse_terms (internally generated case-law research memos) | 2 | 2 |
| internal_only (gated) | 490 | **0** |

Gated (`internal_only`, structurally excluded from `retrievable_documents`,
pending PRD §20.9 source-registry approval): 352 WIPO/Hague docs, 28 EPO docs
(incl. `feed-epo-guidelines-epc-2026`, EPC/PCT Guidelines, Board of Appeal
case law), and 144 US-jurisdiction legacy reference docs that are not clearly
US-gov works (e.g. Slusky book excerpts, LexisNexis/Finnegan practice
articles, generic templates). wepatent received **none** of these
(0 documents with epo.org/wipo.int URLs — verified).

## 4. Embeddings + cost (spend approved via LEX_PROVIDER_SPEND_APPROVED)

Model `text-embedding-3-small` @ 1536-d (matches wepatent `vector(1536)`;
Lex stores `real[]`). Estimate printed before run: ~16.9M tokens ≈ $0.34.

Actual:

| Run | Sections | Tokens | Cost |
|---|---:|---:|---:|
| embed.py (priorities: pinecone → primary law → canonical → feeds → FR) | 25,335 unique chunks → 27,590 section rows × 2 projects | 13,535,142 | $0.2707 |
| embed-backfill.py lex (CAFC catalog remainder) | 18,795 | 1,769,000 | $0.0354 |
| embed-backfill.py wepatent (CAFC catalog remainder) | 18,793 | 1,767,000 | $0.0353 |
| **Total** | all 46,383 lex + 33,105 wepatent sections | **≈17.07M** | **≈$0.34** |

Wall time ≈ 15 minutes (well under the 45–60 min cap), so the planned
FTS-only remainder was instead completed by running the committed backfill
script — which also validated it end-to-end. **Backfill status: nothing left
to backfill**; `embed-backfill.py` remains available for future additions
(usage in `scripts/corpus/README.md`).

## 5. Verification (live probes, `verify.py`)

- **FTS "written description genus claims"** (license-gated join through
  `retrievable_documents`): top hits MPEP § 2163 (rank 0.957) and § 2161. ✓
- **FTS "obviousness prima facie"**: MPEP § 2142 *Legal Concept of Prima
  Facie Obviousness* (0.924), § 2144, § 1504.03. ✓
- **MPEP § 2163 lookup** by `external_key`: found, government_work,
  48 sections, retrievable=true. Same lookup works on wepatent. ✓
- **37 C.F.R. § 1.56 citation lookup**: found, retrievable=true. ✓
- **License gate**: 490 `internal_only` docs in `public_documents`, **0** in
  `retrievable_documents`; 346 EP/WO docs, **0** in view.
  `feed-epo-guidelines-epc-2026` present with 400 sections in raw tables,
  `in_retrievable_view=false`. ✓
- **Hybrid probe (Lex)**: FTS candidates re-ranked by embedding dot product
  for "prima facie obviousness rationale for combining references" → MPEP
  § 2145, § 2143, § 2143.01 (cosine 0.65–0.59). ✓
- **wepatent vector probe** (pgvector `<=>`) for "duty of disclosure and
  information material to patentability" → MPEP § 2001.04, § 2001,
  37 C.F.R. § 1.56 (dist 0.18–0.21). ✓
- **wepatent purity**: 0 documents from epo.org/wipo.int. ✓

## 6. Schema/infra changes made (additive, guarded)

- wepatent corpus: added `corpus_releases` table (schema had none; needed to
  record the release), generated `body_tsv` tsvector column + GIN index on
  `public_sections` (schema had no FTS), and unique indexes on
  `public_sections(document_version_id, section_ref)` and
  `public_embeddings(section_id, model_id)` for idempotent upserts.
- Lex corpus: one-time trigger-guarded correction of the release row's
  `document_count` (the append-only trigger otherwise freezes the count
  recorded before ingestion finished).

## 7. Mapping decisions worth knowing

- `prosecution_outcomes` (729 rows): ODP file-wrapper seed contains event
  sequences but no office-action text, so `rejection_statute='unspecified'`
  and `argument_pattern='unclassified (…)'` — honest placeholders, outcomes
  mapped from disposition (`allowed` / `maintained` / `appealed` / `rce`)
  for the 836 applications with CTNF/CTFR events (107 had indeterminate
  dispositions and were skipped).
- `citation_edges` (16,725, treatment `cites`): from
  `citations.sqlite3` (74,661 raw edges). 43,587 citing docs unmatched —
  they are quarantined/excluded canonical files or historical snapshots not
  ingested; 6,862 cited *cases* unmatched (pre-2004 or non-CAFC citations);
  38 cited patents skipped (patent documents not in corpus); residual
  USC/CFR/MPEP unmatched are cites to units outside Title 35/37 exports.
- Historical feed snapshots are version rows (provenance + checksum) without
  sections; only current snapshots are chunked.
- MPEP effective dates derive from the revision token (e.g. `R-01.2024` →
  2024-01-01); every MPEP unit carries the export's supersession warning in
  its provenance, and the post-MPEP overlay is ingested as two `mpep-overlay-*`
  documents.

## 8. Decisions needed from Jeff

1. **EPO/WIPO/Hague retrievability (PRD §20.9)**: 380 international authority
   docs (EPO Guidelines 2026, EPO BoA case law, WIPO PCT/Hague texts) are
   ingested and embedded but gated `internal_only`. Approving them in the
   source registry = flipping their `license_class` to `org_reuse_terms`
   (one UPDATE per document via `license_provenance` review); no re-ingest
   needed.
2. **144 gated legacy US docs**: mostly commercial-book/article excerpts
   (Slusky, LexisNexis, Finnegan) — review whether to approve, keep gated, or
   purge.
3. **Practical Law leakage in the canonical layer**: 17 active + 1 quarantined
   Practical Law records and 81 CLE/NITA-provenance records were present in
   the export's canonical manifest. They were **not ingested**, but the export
   itself still contains the files — consider re-exporting patent-canonical
   with the license filter applied at source.
4. ITC feed absent from the export despite the feeds README mentioning it —
   re-export if ITC grounding is wanted.
