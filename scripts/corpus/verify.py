#!/usr/bin/env python3
"""Step 4: verification — table counts and realistic retrieval probes.

Lex probes:
  1. FTS "written description genus claims" (license-gated via retrievable_documents)
  2. FTS "obviousness prima facie"
  3. MPEP § 2163 lookup by external_key
  4. 37 C.F.R. § 1.56 citation lookup
  5. license gate: EPO/WIPO docs present in raw tables, absent from
     retrievable_documents
  6. hybrid probe: FTS candidates re-ranked by embedding dot product

wepatent probes: counts, one FTS probe, one pgvector similarity probe,
MPEP lookup, and proof that no non-US-gov authority was ingested.

Writes $CORPUS_WORK/verify-results.json. Never fabricates: everything here
is the raw response of live queries.
"""

from __future__ import annotations

import json
import os
import sys

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from corpuslib import (  # noqa: E402
    EMBED_MODEL, WORK_DIR, log, mgmt_sql, openai_key,
)

LEX_REF = "ldohfdzhcpddxovfqbhg"
WEP_REF = "zmlgetayqsbfjjzaplgh"
RESULTS: dict = {"lex": {}, "wepatent": {}}


def embed_query(text: str) -> list[float]:
    r = requests.post(
        "https://api.openai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {openai_key()}"},
        json={"model": EMBED_MODEL, "input": [text]}, timeout=60)
    r.raise_for_status()
    return [round(x, 5) for x in r.json()["data"][0]["embedding"]]


def counts(ref: str, tables: list[str]) -> dict:
    q = "select " + ",".join(
        f"(select count(*) from {t}) as {t}" for t in tables)
    return mgmt_sql(ref, q)[0]


def lex_probes():
    t = ["public_documents", "public_document_versions", "public_sections",
         "public_embeddings", "license_provenance", "authority_effective_dates",
         "citation_edges", "prosecution_outcomes", "corpus_releases",
         "retrievable_documents"]
    RESULTS["lex"]["counts"] = counts(LEX_REF, t)
    RESULTS["lex"]["license_breakdown"] = mgmt_sql(LEX_REF, """
        select license_class::text, count(*),
               count(*) filter (where id in (select id from retrievable_documents))
               as retrievable
        from public_documents group by 1 order by 2 desc""")
    RESULTS["lex"]["embedded_vs_fts_only"] = mgmt_sql(LEX_REF, f"""
        select count(*) as sections_total,
               count(*) filter (where exists (select 1 from public_embeddings e
                 where e.section_id=s.id and e.model='{EMBED_MODEL}')) as embedded
        from public_sections s""")[0]

    def fts(query):
        return mgmt_sql(LEX_REF, f"""
          select d.external_key, d.citation, s.heading,
                 ts_rank(s.body_tsv, websearch_to_tsquery('english', '{query}')) rank
          from public_sections s
          join public_document_versions v on v.id = s.document_version_id
          join retrievable_documents d on d.id = v.document_id
          where s.body_tsv @@ websearch_to_tsquery('english', '{query}')
          order by rank desc limit 5""")

    RESULTS["lex"]["probe1_written_description_genus"] = fts("written description genus claims")
    RESULTS["lex"]["probe2_obviousness_prima_facie"] = fts("obviousness prima facie")
    RESULTS["lex"]["probe3_mpep_2163"] = mgmt_sql(LEX_REF, """
        select d.external_key, d.title, d.license_class::text,
               (select count(*) from public_sections s
                join public_document_versions v on v.id=s.document_version_id
                where v.document_id=d.id) sections,
               d.id in (select id from retrievable_documents) as retrievable
        from public_documents d where d.external_key = 'mpep-2163'""")
    RESULTS["lex"]["probe4_cfr_156"] = mgmt_sql(LEX_REF, """
        select external_key, citation, title,
               id in (select id from retrievable_documents) as retrievable
        from public_documents where citation = '37 C.F.R. § 1.56'""")
    RESULTS["lex"]["probe5_license_gate"] = mgmt_sql(LEX_REF, """
        select
          (select count(*) from public_documents where license_class='internal_only') gated_docs,
          (select count(*) from retrievable_documents where license_class='internal_only') gated_in_view,
          (select count(*) from public_documents where jurisdiction in ('EP','WO')) intl_docs,
          (select count(*) from retrievable_documents where jurisdiction in ('EP','WO')) intl_in_view""")
    RESULTS["lex"]["probe5_epo_example"] = mgmt_sql(LEX_REF, """
        select d.external_key, d.title, d.license_class::text,
               d.id in (select id from retrievable_documents) as in_retrievable_view,
               (select count(*) from public_sections s
                join public_document_versions v on v.id=s.document_version_id
                where v.document_id=d.id) sections_in_raw_tables
        from public_documents d
        where d.external_key = 'feed-epo-guidelines-epc-2026'""")

    vec = embed_query("prima facie obviousness rationale for combining references")
    lit = "array[" + ",".join(repr(x) for x in vec) + "]::real[]"
    RESULTS["lex"]["probe6_hybrid_fts_plus_vector"] = mgmt_sql(LEX_REF, f"""
      with qv as (select {lit} as v),
      cand as (
        select s.id, s.heading, d.external_key, e.embedding
        from public_sections s
        join public_document_versions v on v.id = s.document_version_id
        join retrievable_documents d on d.id = v.document_id
        join public_embeddings e on e.section_id = s.id and e.model = '{EMBED_MODEL}'
        where s.body_tsv @@ websearch_to_tsquery('english', 'obviousness prima facie')
        limit 200)
      select c.external_key, left(c.heading, 70) heading,
             round((select sum(x*y) from unnest(c.embedding, (select v from qv))
                    as t(x, y))::numeric, 4) as cosine
      from cand c order by cosine desc nulls last limit 5""")


def wepatent_probes():
    t = ["public_documents", "public_document_versions", "public_sections",
         "public_embeddings", "license_provenance", "authority_effective_dates",
         "corpus_releases"]
    RESULTS["wepatent"]["counts"] = counts(WEP_REF, t)
    RESULTS["wepatent"]["authority_breakdown"] = mgmt_sql(
        WEP_REF, "select authority, count(*) from public_documents group by 1 order by 2 desc")
    RESULTS["wepatent"]["embedded_vs_fts_only"] = mgmt_sql(WEP_REF, """
        select count(*) as sections_total,
               count(*) filter (where exists (select 1 from public_embeddings e
                 where e.section_id=s.id)) as embedded
        from public_sections s""")[0]
    RESULTS["wepatent"]["no_non_usgov_sources"] = mgmt_sql(WEP_REF, """
        select count(*) as non_usgov_urls from public_documents
        where canonical_url ~* '//([a-z0-9.-]*\\.)?(epo\\.org|wipo\\.int)/'""")[0]
    RESULTS["wepatent"]["probe_mpep_2163"] = mgmt_sql(WEP_REF, """
        select authority, citation, title from public_documents
        where authority='mpep' and citation='MPEP § 2163'""")
    RESULTS["wepatent"]["probe_fts_written_description"] = mgmt_sql(WEP_REF, """
        select d.citation, left(s.heading, 60) heading,
               ts_rank(s.body_tsv, websearch_to_tsquery('english',
                 'written description genus claims')) rank
        from public_sections s
        join public_document_versions v on v.id = s.document_version_id
        join public_documents d on d.id = v.document_id
        where s.body_tsv @@ websearch_to_tsquery('english', 'written description genus claims')
        order by rank desc limit 5""")
    vec = embed_query("duty of disclosure and information material to patentability")
    RESULTS["wepatent"]["probe_vector_duty_of_disclosure"] = mgmt_sql(WEP_REF, f"""
        select d.citation, left(s.heading, 60) heading,
               round((e.embedding <=> '{json.dumps(vec)}'::vector)::numeric, 4) as dist
        from public_embeddings e
        join public_sections s on s.id = e.section_id
        join public_document_versions v on v.id = s.document_version_id
        join public_documents d on d.id = v.document_id
        order by e.embedding <=> '{json.dumps(vec)}'::vector limit 5""")


def main():
    lex_probes()
    wepatent_probes()
    out = os.path.join(WORK_DIR, "verify-results.json")
    json.dump(RESULTS, open(out, "w"), indent=2, default=str)
    log(json.dumps(RESULTS, indent=2, default=str))


if __name__ == "__main__":
    main()
