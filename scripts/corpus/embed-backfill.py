#!/usr/bin/env python3
"""Backfill embeddings for sections ingested FTS-only.

Standalone and resumable: needs no local state from the original ingest run.
It pages through sections that have no embedding row (via the Supabase
management API), embeds them with text-embedding-3-small, and upserts vectors
through PostgREST. Safe to stop and restart at any time.

Usage:
  python3 scripts/corpus/embed-backfill.py lex        # Lex corpus project
  python3 scripts/corpus/embed-backfill.py wepatent   # wepatent corpus project
  BACKFILL_MINUTES=60 python3 scripts/corpus/embed-backfill.py lex

Requires: /tmp/deliver/*.env.production, /root/launch-secrets/openai.key,
/root/.supabase-pat (or override paths via env, see corpuslib.py).
"""

from __future__ import annotations

import os
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from corpuslib import (  # noqa: E402
    EMBED_MODEL, Rest, det_uuid, lex_corpus_conn, log, mgmt_sql, openai_key,
    wepatent_corpus_conn,
)
from embed import openai_embed, PRICE_PER_MTOK  # noqa: E402

PROJECTS = {
    "lex": {"ref": "ldohfdzhcpddxovfqbhg", "conn": lex_corpus_conn,
            "model_col": "model", "vector": False, "ns": "lex"},
    "wepatent": {"ref": "zmlgetayqsbfjjzaplgh", "conn": wepatent_corpus_conn,
                 "model_col": "model_id", "vector": True, "ns": "wp"},
}
PAGE = 256
MINUTES = float(os.environ.get("BACKFILL_MINUTES", "55"))


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "lex"
    p = PROJECTS[which]
    url, key = p["conn"]()
    rest = Rest(url, key, f"{which}-corpus")
    oai = requests.Session()
    oai.headers["Authorization"] = f"Bearer {openai_key()}"

    deadline = time.time() + MINUTES * 60
    tokens = 0
    n = 0
    while time.time() < deadline:
        rows = mgmt_sql(p["ref"], f"""
            select s.id, left(s.heading || E'\\n' || s.body, 30000) as txt
            from public_sections s
            where not exists (select 1 from public_embeddings e
                              where e.section_id = s.id
                                and e.{p['model_col']} = '{EMBED_MODEL}')
            order by s.id limit {PAGE}""")
        if not rows:
            log("backfill complete: no sections without embeddings")
            break
        vecs, toks = openai_embed(oai, [r["txt"] for r in rows])
        tokens += toks
        out = []
        for r, v in zip(rows, vecs):
            rounded = [round(x, 5) for x in v]
            emb = ("[" + ",".join(repr(x) for x in rounded) + "]") if p["vector"] else rounded
            out.append({"id": det_uuid(p["ns"], "emb", r["id"], EMBED_MODEL),
                        "section_id": r["id"], p["model_col"]: EMBED_MODEL,
                        "embedding": emb})
        rest.upsert("public_embeddings", out,
                    on_conflict=f"section_id,{p['model_col']}", batch=128)
        n += len(rows)
        if n % (PAGE * 10) == 0:
            log(f"{which}: backfilled {n} sections, {tokens/1e6:.2f}M tokens "
                f"(${tokens/1e6*PRICE_PER_MTOK:.3f})")
    log(f"{which}: DONE this run — {n} sections, {tokens/1e6:.3f}M tokens, "
        f"${tokens/1e6*PRICE_PER_MTOK:.4f}")


if __name__ == "__main__":
    main()
