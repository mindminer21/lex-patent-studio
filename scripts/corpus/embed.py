#!/usr/bin/env python3
"""Step 3: embeddings (OpenAI text-embedding-3-small, 1536-d).

Reads $CORPUS_WORK/chunks.jsonl (written by ingest.py), prints a token/cost
estimate, then embeds in priority order:
  1 patent-public-pinecone, 2 primary law, 3 canonical, 4 authority feeds,
  5 Federal Register catalog abstracts.  (priority 99 = FTS-only by design.)

Wall time is capped (EMBED_MINUTES, default 50). Whatever is not embedded
stays FTS-only; run embed-backfill.py later for the remainder.

Vectors are written to BOTH projects:
  lex      public_embeddings.embedding  real[]        (rounded to 5 dp)
  wepatent public_embeddings.embedding  vector(1536)

Resume-safe: embedded chunk shas are appended to embed-done.log.
"""

from __future__ import annotations

import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from corpuslib import (  # noqa: E402
    EMBED_MODEL, WORK_DIR, Rest, det_uuid, lex_corpus_conn, log, openai_key,
    wepatent_corpus_conn,
)

PRICE_PER_MTOK = 0.02  # USD, text-embedding-3-small
BATCH_INPUTS = 128
MINUTES = float(os.environ.get("EMBED_MINUTES", "50"))
DONE_FILE = os.path.join(WORK_DIR, "embed-done.log")


def openai_embed(session: requests.Session, texts: list[str]) -> tuple[list, int]:
    for attempt in range(8):
        r = session.post(
            "https://api.openai.com/v1/embeddings",
            json={"model": EMBED_MODEL, "input": texts},
            timeout=120,
        )
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(min(2 ** attempt, 30))
            continue
        r.raise_for_status()
        data = r.json()
        vecs = [d["embedding"] for d in sorted(data["data"], key=lambda d: d["index"])]
        return vecs, data.get("usage", {}).get("prompt_tokens", 0)
    raise RuntimeError("OpenAI embeddings failed after retries")


def main():
    if not os.environ.get("LEX_PROVIDER_SPEND_APPROVED_OVERRIDE"):
        # spend approval comes from the production env flag
        from corpuslib import read_env, LEX_ENV
        assert read_env(LEX_ENV).get("LEX_PROVIDER_SPEND_APPROVED", "").lower() in (
            "1", "true", "yes"), "provider spend not approved"

    # group chunks by sha (identical text shared across projects/docs)
    groups: dict[str, dict] = {}
    order: list[str] = []
    total_chars = 0
    for line in open(os.path.join(WORK_DIR, "chunks.jsonl")):
        c = json.loads(line)
        if c["priority"] >= 99:
            continue
        g = groups.get(c["sha"])
        if g is None:
            g = {"text": c["text"], "priority": c["priority"], "lex": [], "wp": []}
            groups[c["sha"]] = g
            order.append(c["sha"])
            total_chars += c["chars"]
        g["priority"] = min(g["priority"], c["priority"])
        g["lex"].append(c["lex_section_id"])
        if c["wp_section_id"]:
            g["wp"].append(c["wp_section_id"])

    done: set[str] = set()
    if os.path.exists(DONE_FILE):
        done = set(l.strip() for l in open(DONE_FILE))
    todo = [s for s in sorted(order, key=lambda s: groups[s]["priority"]) if s not in done]
    est_tokens = total_chars / 4
    log(f"{len(groups)} unique chunks ({len(todo)} to embed), "
        f"~{est_tokens/1e6:.1f}M tokens estimated, "
        f"~${est_tokens/1e6*PRICE_PER_MTOK:.2f} estimated cost, "
        f"wall-time cap {MINUTES:.0f} min")

    lex_url, lex_key = lex_corpus_conn()
    wep_url, wep_key = wepatent_corpus_conn()
    lex = Rest(lex_url, lex_key, "lex-corpus")
    wep = Rest(wep_url, wep_key, "wepatent-corpus")
    oai = requests.Session()
    oai.headers["Authorization"] = f"Bearer {openai_key()}"

    deadline = time.time() + MINUTES * 60
    spent_tokens = 0
    embedded = 0
    done_f = open(DONE_FILE, "a")
    pool = ThreadPoolExecutor(max_workers=4)
    pending = []
    by_prio: dict[int, int] = {}

    def insert_rows(lex_rows, wep_rows, shas):
        if lex_rows:
            lex.upsert("public_embeddings", lex_rows, on_conflict="section_id,model",
                       batch=150)
        if wep_rows:
            wep.upsert("public_embeddings", wep_rows, on_conflict="section_id,model_id",
                       batch=150)
        for s in shas:
            done_f.write(s + "\n")
        done_f.flush()

    i = 0
    while i < len(todo):
        if time.time() > deadline:
            log("wall-time cap reached; remainder stays FTS-only (run embed-backfill.py)")
            break
        batch = todo[i : i + BATCH_INPUTS]
        i += len(batch)
        texts = [groups[s]["text"][:30000] for s in batch]
        vecs, toks = openai_embed(oai, texts)
        spent_tokens += toks
        lex_rows, wep_rows = [], []
        for sha, vec in zip(batch, vecs):
            g = groups[sha]
            by_prio[g["priority"]] = by_prio.get(g["priority"], 0) + 1
            rounded = [round(x, 5) for x in vec]
            vec_str = "[" + ",".join(repr(x) for x in rounded) + "]"
            for sid in g["lex"]:
                lex_rows.append({"id": det_uuid("lex", "emb", sid, EMBED_MODEL),
                                 "section_id": sid, "model": EMBED_MODEL,
                                 "embedding": rounded})
            for sid in g["wp"]:
                wep_rows.append({"id": det_uuid("wp", "emb", sid, EMBED_MODEL),
                                 "section_id": sid, "model_id": EMBED_MODEL,
                                 "embedding": vec_str})
        pending.append(pool.submit(insert_rows, lex_rows, wep_rows, batch))
        pending = [f for f in pending if not f.done() or f.result() or True]
        while len([f for f in pending if not f.done()]) > 6:
            time.sleep(0.5)
        embedded += len(batch)
        if embedded % (BATCH_INPUTS * 20) < BATCH_INPUTS:
            log(f"embedded {embedded}/{len(todo)} chunks, {spent_tokens/1e6:.2f}M tokens, "
                f"${spent_tokens/1e6*PRICE_PER_MTOK:.3f}")

    for f in pending:
        f.result()  # surface insert errors
    pool.shutdown()
    done_f.close()
    cost = spent_tokens / 1e6 * PRICE_PER_MTOK
    summary = {
        "embedded_chunks": embedded, "remaining_chunks": len(todo) - embedded,
        "unique_chunks_total": len(groups), "tokens": spent_tokens,
        "cost_usd": round(cost, 4), "model": EMBED_MODEL,
        "by_priority": by_prio,
    }
    # merge with a previous partial run if present
    prev_path = os.path.join(WORK_DIR, "embed-summary.json")
    if os.path.exists(prev_path):
        prev = json.load(open(prev_path))
        summary["tokens"] += prev.get("tokens", 0)
        summary["cost_usd"] = round(summary["tokens"] / 1e6 * PRICE_PER_MTOK, 4)
        summary["embedded_chunks"] += prev.get("embedded_chunks", 0)
    json.dump(summary, open(prev_path, "w"), indent=2)
    log(json.dumps(summary))


if __name__ == "__main__":
    main()
