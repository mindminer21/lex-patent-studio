#!/usr/bin/env python3
"""Step 2: ingest the inventory into both production corpus projects.

  Lex corpus (full set)          — documents/versions/sections/license rows,
                                   citation edges, prosecution outcomes.
  wepatent corpus (US-gov only)  — primary law + authority feeds subset.

Idempotent: all ids are deterministic (uuid5 of natural keys) and every
insert is a PostgREST upsert keyed on the table's unique constraint, so a
rerun converges instead of duplicating.

Also writes $CORPUS_WORK/chunks.jsonl for the embedding step.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from corpuslib import (  # noqa: E402
    CORPUS_ROOT, EMBED_MODEL, RELEASE_LABEL, WORK_DIR, Rest, chunk_text, det_uuid,
    lex_corpus_conn, log, mgmt_sql, parse_date, sanitize, sha256_text,
    split_front_matter, wepatent_corpus_conn,
)

LEX_REF = "ldohfdzhcpddxovfqbhg"
WEP_REF = "zmlgetayqsbfjjzaplgh"

MAX_SECTIONS_PER_DOC = 400  # safety valve for pathological documents


def load_inventory() -> list[dict]:
    return [json.loads(l) for l in open(os.path.join(WORK_DIR, "inventory.jsonl"))]


def prepare_wepatent_ddl():
    """Additive, guarded DDL the wepatent corpus schema needs for this pipeline:
    FTS column (schema has none), idempotency unique indexes, releases table."""
    mgmt_sql(WEP_REF, """
      create table if not exists public.corpus_releases (
        id uuid primary key,
        release_label text not null unique,
        created_at timestamptz not null default now(),
        document_count integer not null default 0,
        notes text not null default ''
      );
      alter table public.corpus_releases enable row level security;
      alter table public.public_sections
        add column if not exists body_tsv tsvector
        generated always as (to_tsvector('english', coalesce(heading,'') || ' ' || body)) stored;
      create index if not exists public_sections_tsv_idx
        on public.public_sections using gin (body_tsv);
      create unique index if not exists public_sections_version_ref_uidx
        on public.public_sections (document_version_id, section_ref);
      create unique index if not exists public_embeddings_section_model_uidx
        on public.public_embeddings (section_id, model_id);
    """)
    log("wepatent DDL prepared (releases table, tsvector, unique indexes)")


class Buffers:
    def __init__(self, rest: Rest, spec: dict[str, tuple[str, bool]]):
        self.rest = rest
        self.spec = spec  # table -> (on_conflict, ignore_duplicates)
        self.rows: dict[str, list] = {t: [] for t in spec}
        self.sent: Counter = Counter()

    def add(self, table: str, row: dict, flush_at: int = 700):
        self.rows[table].append(row)
        if len(self.rows[table]) >= flush_at:
            # flush ALL tables in dependency order (documents before versions
            # before sections ...) so FK targets always land first
            self.flush()

    def flush(self, table: str | None = None):
        for t in ([table] if table else list(self.rows)):
            if not self.rows[t]:
                continue
            oc, ign = self.spec[t]
            self.rest.upsert(t, self.rows[t], on_conflict=oc, ignore_duplicates=ign,
                             batch=500)
            self.sent[t] += len(self.rows[t])
            self.rows[t] = []


def main():
    inv = load_inventory()
    limit = int(os.environ.get("INGEST_LIMIT", "0"))
    if limit:  # smoke-test mode: first N docs per layer
        by_layer: dict[str, list] = {}
        for d in inv:
            by_layer.setdefault(d["layer"], []).append(d)
        inv = [d for docs in by_layer.values() for d in docs[:limit]]
        log(f"SMOKE TEST: limited to {len(inv)} docs ({limit}/layer)")
    log(f"inventory: {len(inv)} documents")

    lex_url, lex_key = lex_corpus_conn()
    wep_url, wep_key = wepatent_corpus_conn()
    assert LEX_REF in lex_url and WEP_REF in wep_url, "project URL mismatch"
    lex = Rest(lex_url, lex_key, "lex-corpus")
    wep = Rest(wep_url, wep_key, "wepatent-corpus")

    prepare_wepatent_ddl()

    # --- releases ----------------------------------------------------------
    lex_release_id = det_uuid("lex", "release", RELEASE_LABEL)
    wep_release_id = det_uuid("wp", "release", RELEASE_LABEL)
    layer_counts = Counter(d["layer"] for d in inv)
    notes = json.dumps({
        "source": "hermes corpus export /tmp/corpus",
        "per_layer_documents": dict(layer_counts),
        "license_classes": dict(Counter(d["license_class"] for d in inv)),
    })
    # corpus_releases is append-only on lex (trigger): plain insert, ignore dup.
    lex.insert_ignore_conflict("corpus_releases", [{
        "id": lex_release_id, "release_label": RELEASE_LABEL,
        "document_count": len(inv), "notes": notes,
    }], on_conflict="release_label")
    wep_count = sum(1 for d in inv if d["wepatent_authority"])
    wep.upsert("corpus_releases", [{
        "id": wep_release_id, "release_label": RELEASE_LABEL,
        "document_count": wep_count, "notes": notes,
    }], on_conflict="release_label")
    log(f"release rows ready ({RELEASE_LABEL}); lex docs={len(inv)} wep docs={wep_count}")

    lexbuf = Buffers(lex, {
        "public_documents": ("external_key", False),
        "public_document_versions": ("document_id,edition", False),
        "public_sections": ("document_version_id,section_key", False),
        "license_provenance": ("id", False),
        "authority_effective_dates": ("id", False),
    })
    wepbuf = Buffers(wep, {
        "public_documents": ("authority,citation", False),
        "public_document_versions": ("document_id,version_label", False),
        "public_sections": ("document_version_id,section_ref", False),
        "license_provenance": ("id", False),
        "authority_effective_dates": ("id", False),
    })

    chunks_out = open(os.path.join(WORK_DIR, "chunks.jsonl"), "w")
    seen_checksums: set[str] = set()
    seen_keys: set[str] = set()
    wep_citations: set[tuple[str, str]] = set()
    dedup_skipped = 0
    lex_doc_ids: dict[str, str] = {}  # external_key -> lex doc uuid (for edges)
    section_count = 0

    for i, d in enumerate(inv):
        key = d["external_key"]
        if key in seen_keys:
            continue
        seen_keys.add(key)
        if d["checksum"] in seen_checksums and d["layer"] in ("canonical", "pinecone"):
            dedup_skipped += 1
            continue  # identical content already ingested from a higher-priority layer
        seen_checksums.add(d["checksum"])

        # body text
        body = d.get("inline_body") or ""
        if d.get("body_file"):
            raw = open(d["body_file"], encoding="utf-8", errors="replace").read()
            _meta, body = split_front_matter(raw)
        body = sanitize(body).strip()
        for fld in ("title", "citation"):
            d[fld] = sanitize(d[fld])
        chunks = chunk_text(body)[:MAX_SECTIONS_PER_DOC] if body else []

        doc_id = det_uuid("lex", "doc", key)
        ver_id = det_uuid("lex", "ver", key, d["checksum"])
        lex_doc_ids[key] = doc_id

        lexbuf.add("public_documents", {
            "id": doc_id, "external_key": key, "source_type": d["source_type"],
            "collection": d["collection"], "jurisdiction": d["jurisdiction"],
            "citation": d["citation"], "title": d["title"],
            "license_class": d["license_class"], "license_basis": d["license_basis"],
        })
        lexbuf.add("public_document_versions", {
            "id": ver_id, "document_id": doc_id, "edition": d["edition"],
            "effective_date": d["effective_date"],
            "provenance": f"{d['source_path']} <- {d['source_url']}"[:1000],
            "checksum_sha256": re.sub(r"[^0-9a-f]", "",
                                      d["checksum"].lower()).ljust(64, "0")[:64],
            "release_id": lex_release_id,
        })
        # historical feed snapshots: version rows only (provenance history)
        for ov in (d.get("extra") or {}).get("other_versions", []):
            lexbuf.add("public_document_versions", {
                "id": det_uuid("lex", "ver", key, ov["sha"]),
                "document_id": doc_id, "edition": ov["sha"][:12],
                "effective_date": parse_date(ov.get("retrieved_at")) or d["effective_date"],
                "provenance": ov.get("provenance", "")[:1000],
                "checksum_sha256": ov["sha"], "release_id": lex_release_id,
            })
        lexbuf.add("license_provenance", {
            "id": det_uuid("lex", "lic", key), "document_id": doc_id,
            "license_class": d["license_class"], "basis": d["license_basis"],
            "reviewed_by": "corpus-ingest 2026-08-02 (automated classification; "
                           "non-US-gov classes pending Jeff Schell review per PRD §20.9)",
            "terms_url": d["source_url"] or None,
            "attribution_required": d["license_class"] != "government_work",
            "redistribution_allowed": d["license_class"] == "government_work",
        })
        if d["effective_date_known"]:
            lexbuf.add("authority_effective_dates", {
                "id": det_uuid("lex", "eff", key), "document_id": doc_id,
                "effective_date": d["effective_date"],
                "note": f"{d['layer']}: edition {d['edition']}"[:500],
            })

        wp_ver_id = None
        if d["wepatent_authority"]:
            wp_doc_id = det_uuid("wp", "doc", key)
            wp_ver_id = det_uuid("wp", "ver", key, d["checksum"])
            citation = d["citation"]
            if (d["wepatent_authority"], citation) in wep_citations:
                citation = f"{citation} [{key}]"[:250]
            wep_citations.add((d["wepatent_authority"], citation))
            wepbuf.add("public_documents", {
                "id": wp_doc_id, "authority": d["wepatent_authority"],
                "citation": citation, "title": d["title"],
                "canonical_url": d["source_url"] or "about:blank",
            })
            wepbuf.add("public_document_versions", {
                "id": wp_ver_id, "document_id": wp_doc_id,
                "version_label": d["edition"][:120] or "current",
                "effective_date": d["effective_date"] if d["effective_date_known"] else None,
                "content_hash": d["checksum"],
            })
            wepbuf.add("license_provenance", {
                "id": det_uuid("wp", "lic", key), "document_id": wp_doc_id,
                "owner": "US Government (public authority)",
                "acquisition_method": "official public web/API snapshot via Hermes agent",
                "license_terms": d["license_basis"],
                "permitted_use": "retrieval grounding with citation; US gov work",
                "attribution_required": False,
            })
            if d["effective_date_known"]:
                wepbuf.add("authority_effective_dates", {
                    "id": det_uuid("wp", "eff", key), "document_id": wp_doc_id,
                    "effective_date": d["effective_date"],
                    "note": f"{d['layer']}: edition {d['edition']}"[:500],
                })

        for ordi, (heading, text) in enumerate(chunks):
            skey = f"s{ordi:04d}"
            lex_sec_id = det_uuid("lex", "sec", ver_id, skey)
            lexbuf.add("public_sections", {
                "id": lex_sec_id, "document_version_id": ver_id,
                "section_key": skey, "heading": (heading or d["title"])[:400],
                "body": text, "ordinal": ordi,
            }, flush_at=400)
            wp_sec_id = None
            if wp_ver_id:
                wp_sec_id = det_uuid("wp", "sec", wp_ver_id, skey)
                wepbuf.add("public_sections", {
                    "id": wp_sec_id, "document_version_id": wp_ver_id,
                    "section_ref": skey, "heading": (heading or d["title"])[:400],
                    "body": text,
                }, flush_at=400)
            chunks_out.write(json.dumps({
                "sha": sha256_text(text), "lex_section_id": lex_sec_id,
                "wp_section_id": wp_sec_id, "priority": d["embed_priority"],
                "layer": d["layer"], "chars": len(text), "text": text,
            }) + "\n")
            section_count += 1

        if (i + 1) % 2000 == 0:
            log(f"processed {i + 1}/{len(inv)} docs, {section_count} sections")

    lexbuf.flush()
    wepbuf.flush()
    chunks_out.close()
    log(f"documents done. dedup-skipped={dedup_skipped} sections={section_count}")
    log(f"lex rows sent: {dict(lexbuf.sent)}")
    log(f"wepatent rows sent: {dict(wepbuf.sent)}")

    if not limit:
        ingest_citation_edges(lex, lex_doc_ids, inv)
        ingest_prosecution_outcomes(lex)
        # Correct the release row (created before final counts were known).
        # corpus_releases is append-only by trigger; this one-time admin fix
        # temporarily disables the trigger rather than deleting history.
        safe_notes = notes.replace("'", "''")
        mgmt_sql(LEX_REF, f"""
          alter table corpus_releases disable trigger corpus_releases_no_update;
          update corpus_releases
             set document_count = {len(inv)}, notes = '{safe_notes}'
           where release_label = '{RELEASE_LABEL}';
          alter table corpus_releases enable trigger corpus_releases_no_update;
        """)
        log("release row finalized with real document count")

    json.dump({
        "lex_rows": dict(lexbuf.sent), "wepatent_rows": dict(wepbuf.sent),
        "sections": section_count, "dedup_skipped": dedup_skipped,
    }, open(os.path.join(WORK_DIR, "ingest-summary.json"), "w"), indent=2)


# ---------------------------------------------------------------------------
# Citation graph -> citation_edges (Lex only)
# ---------------------------------------------------------------------------
USC_RE = re.compile(r"35\s+U\.?S\.?C\.?\s*§*\s*(\d+[a-z]?)", re.I)
CFR_RE = re.compile(r"37\s+C\.?F\.?R\.?\s*§*\s*([\d]+\.[\d()a-z]+|[\d]+)", re.I)
MPEP_RE = re.compile(r"MPEP\s*§*\s*([\d]+(?:\.[\d]+)?(?:\([a-z0-9]+\))*)", re.I)


def graph_doc_to_key(path: str) -> str | None:
    m = re.search(r"patent-primary-law/(?:sources|current)/([^/]+)/([^/]+)/", path)
    if m:
        src, unit = m.groups()
        if src == "usc-title-35":
            return f"usc35-{unit}"
        if src == "ecfr-title-37":
            return f"cfr37-{unit}"
        if src in ("uspto-mpep", "uspto-post-mpep-overlay"):
            return f"mpep-{unit}"
    m = re.search(r"federal-register-uspto/documents/([^/]+)/", path)
    if m:
        return f"fr-{m.group(1)}"
    m = re.search(r"patent-authority-feeds/sources/([^/]+)/snapshots/", path)
    if m:
        return f"feed-{m.group(1)}"
    m = re.search(r"patent-authority-feeds/sources/[^/]+/artifacts/([0-9a-f]{16})", path)
    if m:
        return f"feedart-{m.group(1)}"
    return None


def ingest_citation_edges(lex: Rest, doc_ids: dict[str, str], inv: list[dict]):
    db = os.path.join(CORPUS_ROOT, "patent-citation-graph", "citations.sqlite3")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)

    # canonical filename -> external key (canonical docs use body-sha keys)
    canon_map = {}
    for d in inv:
        if d["layer"] == "canonical":
            canon_map[os.path.basename(d["source_path"])] = d["external_key"]

    # CAFC catalog case-name -> external key (prefer precedential entries)
    case_map: dict[str, str] = {}
    for d in inv:
        if d["layer"] == "cafc-catalog":
            nm = (d.get("extra") or {}).get("case_name_norm") or ""
            if nm and (nm not in case_map or
                       (d.get("extra") or {}).get("precedential_status") == "Precedential"):
                case_map.setdefault(nm, d["external_key"])
                if (d.get("extra") or {}).get("precedential_status") == "Precedential":
                    case_map[nm] = d["external_key"]

    def cited_key(atype: str, norm: str) -> str | None:
        def variants(unit: str) -> list[str]:
            # try the exact unit, then progressively strip (b)(1) suffixes
            out = [unit]
            stripped = re.sub(r"\([^)]*\)", "", unit).rstrip(".")
            if stripped != unit:
                out.append(stripped)
            return out

        if atype == "usc":
            m = USC_RE.search(norm)
            if m:
                for u in variants(m.group(1)):
                    if f"usc35-{u}" in doc_ids:
                        return f"usc35-{u}"
            return None
        if atype == "cfr":
            m = CFR_RE.search(norm)
            if m:
                for u in variants(m.group(1)):
                    if f"cfr37-{u}" in doc_ids:
                        return f"cfr37-{u}"
            return None
        if atype == "mpep":
            m = MPEP_RE.search(norm)
            if m:
                for u in variants(m.group(1)):
                    if f"mpep-{u}" in doc_ids:
                        return f"mpep-{u}"
            return None
        if atype == "case":
            return case_map.get(norm.upper().strip())
        return None  # patents not ingested as documents

    rows, seen, stats = [], set(), Counter()
    q = """select d.path, a.authority_type, a.normalized_citation
           from citations c join documents d on d.id=c.document_id
           join authorities a on a.id=c.authority_id"""
    for path, atype, norm in con.execute(q):
        stats["edges_total"] += 1
        ck = graph_doc_to_key(path)
        if not ck or ck not in doc_ids:
            stats["citing_unmatched"] += 1
            continue
        tk = cited_key(atype, norm or "")
        if not tk or tk not in doc_ids:
            stats[f"cited_unmatched_{atype}"] += 1
            continue
        if doc_ids[ck] == doc_ids[tk]:
            continue
        pair = (doc_ids[ck], doc_ids[tk])
        if pair in seen:
            continue
        seen.add(pair)
        rows.append({"id": det_uuid("lex", "edge", *pair),
                     "citing_document_id": pair[0], "cited_document_id": pair[1],
                     "treatment": "cites"})
        stats["edges_ingested"] += 1
    con.close()
    lex.insert_ignore_conflict("citation_edges",
                               rows, on_conflict="citing_document_id,cited_document_id,treatment")
    log(f"citation edges: {dict(stats)}")
    json.dump(dict(stats), open(os.path.join(WORK_DIR, "citation-stats.json"), "w"))


# ---------------------------------------------------------------------------
# Prosecution engine sqlite -> prosecution_outcomes (Lex only)
# ---------------------------------------------------------------------------
def map_outcome(app_outcome: str, events: list[tuple[str, str]]) -> str | None:
    o = (app_outcome or "").lower()
    etypes = " | ".join(e[0].lower() for e in events)
    dcodes = {e[1] for e in events if e[1]}
    if "rcex" in {c.lower() for c in dcodes} or "continued examination" in etypes:
        return "rce"
    if "appeal" in o or "examiner's answer" in o:
        return "appealed"
    if "notice of appeal" in etypes and "patented" not in o:
        return "appealed"
    if "patented" in o or "allowed" in o or "issue fee" in o or "expired" in o:
        return "allowed"  # expired patents were allowed first
    if "abandoned" in o:
        return "maintained"  # rejection stood; applicant abandoned
    return None


def ingest_prosecution_outcomes(lex: Rest):
    db = os.path.join(CORPUS_ROOT, "patent-prosecution-engine", "prosecution.sqlite3")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    apps = {}
    q = """select a.application_number, a.outcome, a.art_unit, a.disposition_date,
                  a.filing_date
           from applications a
           where exists (select 1 from events e
                         where e.application_number=a.application_number
                           and e.document_code in ('CTNF','CTFR'))"""
    for row in con.execute(q):
        apps[row[0]] = row
    rows = []
    for app_no, (num, outcome, art_unit, disp, filing) in apps.items():
        events = con.execute(
            "select event_type, document_code, event_date from events "
            "where application_number=? order by event_date", (app_no,)).fetchall()
        mapped = map_outcome(outcome, [(e[0] or "", e[1] or "") for e in events])
        if not mapped:
            continue
        observed = parse_date(disp) or parse_date(events[-1][2] if events else None) \
            or parse_date(filing) or "2026-07-24"
        rows.append({
            "id": det_uuid("lex", "pros", app_no),
            "application_reference": app_no,
            "rejection_statute": "unspecified",  # ODP file-wrapper seed lacks statute text
            "art_unit_signal": art_unit,
            "argument_pattern": "unclassified (ODP file-wrapper event sequence; "
                                "office-action text not in public seed)",
            "outcome": mapped, "observed_at": observed,
        })
    con.close()
    lex.upsert("prosecution_outcomes", rows, on_conflict="id")
    log(f"prosecution outcomes: {len(rows)} rows (from {len(apps)} apps with "
        "CTNF/CTFR rejection events)")


if __name__ == "__main__":
    main()
