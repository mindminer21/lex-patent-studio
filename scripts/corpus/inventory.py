#!/usr/bin/env python3
"""Step 1: walk /tmp/corpus, classify every document, write inventory JSONL.

Outputs (in $CORPUS_WORK):
  inventory.jsonl  — one Doc per line (documents to ingest)
  skipped.jsonl    — everything excluded, with reasons (license quarantine etc.)
  inventory-summary.json

License boundary (PRD-lex-patent-studio §6.4):
  * anything whose provenance points at Practical Law / recovered CLE /
    playbook / client-matter / NITA course material is SKIPPED entirely;
  * US-government works -> license_class government_work (retrievable);
  * EPO / WIPO / Hague and other non-US-gov -> internal_only (ingested for
    Lex but structurally excluded from retrievable_documents pending §20.9
    source-registry approval; never sent to wepatent).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from collections import Counter
from dataclasses import asdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from corpuslib import (  # noqa: E402
    CORPUS_ROOT, WORK_DIR, Doc, US_GOV_URL_RE, is_suspect, log, parse_date,
    sha256_text, split_front_matter,
)

os.makedirs(WORK_DIR, exist_ok=True)
DOCS: list[Doc] = []
SKIPPED: list[dict] = []


def skip(path: str, reason: str, layer: str):
    SKIPPED.append({"path": path, "reason": reason, "layer": layer})


def file_sha(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# 1. patent-primary-law (current/ units; sources|history|raw are re-derivable)
# ---------------------------------------------------------------------------
def mpep_edition_date(ed: str) -> str | None:
    m = re.match(r"R-(\d{2})\.(\d{4})", str(ed) or "")
    return f"{m.group(2)}-{m.group(1)}-01" if m else None


def build_primary_law():
    root = os.path.join(CORPUS_ROOT, "patent-primary-law", "current")
    n = 0
    for source in sorted(os.listdir(root)):
        for unit in sorted(os.listdir(os.path.join(root, source))):
            p = os.path.join(root, source, unit, "document.md")
            if not os.path.exists(p):
                skip(os.path.join(root, source, unit), "no document.md", "primary-law")
                continue
            meta, _body = split_front_matter(open(p, encoding="utf-8").read())
            title = str(meta.get("title") or unit)
            retrieved = parse_date(meta.get("source_retrieved_at"), "2026-07-24")
            eff_raw = meta.get("effective_date")
            if source == "usc-title-35":
                key, cite = f"usc35-{unit}", f"35 U.S.C. § {unit}"
                stype, wpauth = "statute", "uscode"
                eff, known = parse_date(eff_raw), bool(parse_date(eff_raw))
            elif source == "ecfr-title-37":
                key, cite = f"cfr37-{unit}", f"37 C.F.R. § {unit}"
                stype, wpauth = "regulation", "cfr"
                eff, known = parse_date(eff_raw), bool(parse_date(eff_raw))
            elif source == "uspto-mpep":
                key, cite = f"mpep-{unit}", f"MPEP § {unit}"
                stype, wpauth = "agency_guidance", "mpep"
                eff, known = mpep_edition_date(eff_raw) or parse_date(eff_raw), True
                if not eff:
                    eff, known = retrieved, False
            else:  # uspto-post-mpep-overlay
                key, cite = f"mpep-{unit}", f"USPTO Post-MPEP Subsequent Publications ({unit})"
                stype, wpauth = "agency_guidance", "mpep"
                eff, known = parse_date(eff_raw), bool(parse_date(eff_raw))
            if not eff:
                eff, known = retrieved, False
            DOCS.append(Doc(
                external_key=key, layer="primary-law", title=title, citation=cite,
                jurisdiction="US", license_class="government_work",
                license_basis="17 U.S.C. § 105 US government work: "
                              + str(meta.get("license") or "official-public-law"),
                source_type=stype, collection="prosecution", wepatent_authority=wpauth,
                source_url=str(meta.get("source_url") or ""), source_path=p,
                checksum=str(meta.get("content_sha256") or file_sha(p)),
                edition=str(eff_raw or "current"), effective_date=eff,
                effective_date_known=known, body_file=p, embed_priority=2,
                extra={"supersession_warning": meta.get("supersession_warning")},
            ))
            n += 1
    log(f"primary-law: {n} units")


# ---------------------------------------------------------------------------
# 2. patent-public-pinecone (curated staging; embed first)
# ---------------------------------------------------------------------------
def classify_authority(authority: str, source_url: str) -> tuple[str, str, str]:
    """-> (jurisdiction, license_class, basis)."""
    a = (authority or "").upper()
    if a.startswith("EPO"):
        return ("EP", "internal_only",
                "EPO publication; reuse terms pending source-registry approval (PRD §20.9)")
    if a.startswith("WIPO") or "HAGUE" in a:
        return ("WO", "internal_only",
                "WIPO/Hague publication; reuse terms pending source-registry approval (PRD §20.9)")
    if US_GOV_URL_RE.search(source_url or "") or a.startswith(("USPTO", "US", "U.S.")):
        return ("US", "government_work", "17 U.S.C. § 105 US government work")
    return ("US", "internal_only", "unclassified non-US-gov source; pending review (PRD §20.9)")


def build_pinecone():
    root = os.path.join(CORPUS_ROOT, "patent-public-pinecone")
    manifest = json.load(open(os.path.join(root, "manifest.json")))
    by_dest = {os.path.basename(r["destination"]): r for r in manifest.get("records", [])}
    n = 0
    for sub in ("authorities", "case-law"):
        d = os.path.join(root, sub)
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".md"):
                skip(os.path.join(d, fn), "not markdown", "pinecone")
                continue
            p = os.path.join(d, fn)
            if is_suspect(fn, p):
                skip(p, "license-suspect filename", "pinecone")
                continue
            raw = open(p, encoding="utf-8").read()
            meta, body = split_front_matter(raw)
            rec = by_dest.get(fn, {})
            title = str(meta.get("title") or fn[:-3])
            url = str(meta.get("source_url") or rec.get("source_url") or "")
            if sub == "case-law":
                jur, lic, basis = ("US", "org_reuse_terms",
                                   "internally generated research memo over public judicial "
                                   "records (Hermes agent output; org-owned)")
                stype, coll = "case_cafc", "litigation"
            else:
                jur, lic, basis = classify_authority(
                    str(meta.get("authority") or rec.get("authority") or ""), url)
                stype = "intl_guidance" if jur in ("EP", "WO") else "agency_guidance"
                coll = "foreign_pct" if jur in ("EP", "WO") else "prosecution"
            eff = parse_date(meta.get("effective_date_hint")) or \
                parse_date(meta.get("fetched_at")) or parse_date(meta.get("retrieved_at"))
            DOCS.append(Doc(
                external_key=f"pine-{fn[:-3]}"[:120], layer="pinecone", title=title,
                citation=title[:200], jurisdiction=jur, license_class=lic,
                license_basis=basis, source_type=stype, collection=coll,
                wepatent_authority=None, source_url=url, source_path=p,
                checksum=str(meta.get("normalized_sha256") or sha256_text(body)),
                edition=str(meta.get("fetched_at") or meta.get("retrieved_at") or "current")[:32],
                effective_date=eff or "2026-07-16", effective_date_known=bool(eff),
                body_file=p, embed_priority=1,
            ))
            n += 1
    log(f"pinecone: {n} docs")


# ---------------------------------------------------------------------------
# 3. patent-canonical (deduplicated practice collections; license filter!)
# ---------------------------------------------------------------------------
COLL_MAP = {
    "drafting-craft": "drafting", "general-trial-advocacy": "litigation",
    "patent-litigation": "litigation", "patent-prosecution": "prosecution",
    "pct-epo-foreign": "foreign_pct", "primary-law": "prosecution",
    "ptab": "ptab", "technical-prior-art": "technical_prior_art",
}

ALLOWED_SOURCES = {"official-authorities", "public-case-law", "legacy-patent-assistant"}


def build_canonical():
    root = os.path.join(CORPUS_ROOT, "patent-canonical")
    manifest = json.load(open(os.path.join(root, "manifest.json")))
    n = 0
    for rec in manifest["records"]:
        fn = os.path.basename(rec["canonical_path"])
        coll_src = rec["collection"]
        p = os.path.join(root, "collections", coll_src, fn)
        if coll_src == "quarantine":
            skip(p, f"manifest quarantine: {rec.get('quarantine_reason')}", "canonical")
            continue
        # License boundary: provenance-based exclusion, including aliases.
        prov_strings = [rec.get("source_name", ""), rec.get("source_path", ""), fn,
                        str(rec.get("title", ""))]
        for a in rec.get("aliases", []):
            prov_strings += [a.get("source_name", ""), a.get("source_path", "")]
        if rec["source_name"] not in ALLOWED_SOURCES or is_suspect(*prov_strings):
            skip(p, f"license-suspect provenance ({rec['source_name']})", "canonical")
            continue
        if not os.path.exists(p):
            skip(p, "canonical file missing from export", "canonical")
            continue
        url = str(rec.get("source_url") or "")
        src = rec["source_name"]
        if src == "official-authorities" or US_GOV_URL_RE.search(url):
            jur, lic, basis = "US", "government_work", "17 U.S.C. § 105 US government work"
        elif src == "public-case-law":
            jur, lic, basis = ("US", "org_reuse_terms",
                               "internally generated research memo over public judicial records")
        else:  # legacy internal reference material, not clearly US-gov
            jur = str(rec.get("jurisdiction") or "US")
            jur = jur if jur in ("US", "EP", "WO") else "US"
            lic = "internal_only"
            basis = ("legacy internal reference corpus (source-specific-internal-use); "
                     "NOT retrievable pending license review (PRD §20.9)")
        eff = parse_date(rec.get("effective_date"))
        DOCS.append(Doc(
            external_key=f"canon-{rec['canonical_id'][:16]}", layer="canonical",
            title=str(rec.get("title") or fn[:-3])[:300],
            citation=str(rec.get("title") or fn[:-3])[:200], jurisdiction=jur,
            license_class=lic, license_basis=basis, source_type="agency_guidance",
            collection=COLL_MAP.get(coll_src, "prosecution"), wepatent_authority=None,
            source_url=url, source_path=p, checksum=rec["body_sha256"],
            edition="canonical-2026-07-24", effective_date=eff or "2026-07-24",
            effective_date_known=bool(eff), body_file=p, embed_priority=3,
            extra={"quality_score": rec.get("quality_score"),
                   "aliases": len(rec.get("aliases", []))},
        ))
        n += 1
    log(f"canonical: {n} docs ({len(SKIPPED)} skipped so far)")


# ---------------------------------------------------------------------------
# 4. patent-authority-feeds (snapshot sources + linked artifacts + catalogs)
# ---------------------------------------------------------------------------
def feed_source_class(source_id: str) -> tuple[str, str, str, str, str | None]:
    """-> (jurisdiction, license_class, source_type, collection, wepatent_authority)"""
    if source_id.startswith("epo-"):
        return "EP", "internal_only", "intl_guidance", "foreign_pct", None
    if source_id.startswith("wipo-"):
        return "WO", "internal_only", "intl_guidance", "foreign_pct", None
    if source_id.startswith("ptab-"):
        return "US", "government_work", "agency_guidance", "ptab", "other"
    if source_id.startswith("cafc-"):
        return "US", "government_work", "case_cafc", "litigation", "case"
    if source_id.startswith("scotus-"):
        return "US", "government_work", "case_scotus", "litigation", "case"
    if "hague" in source_id:  # uspto-hague-design-faq: USPTO page on Hague topic
        return "US", "government_work", "agency_guidance", "foreign_pct", "other"
    return "US", "government_work", "agency_guidance", "prosecution", "other"


def build_feeds():
    root = os.path.join(CORPUS_ROOT, "patent-authority-feeds", "sources")
    n_src = n_art = 0
    for source_id in sorted(os.listdir(root)):
        sdir = os.path.join(root, source_id)
        cur = json.load(open(os.path.join(sdir, "current.json")))
        jur, lic, stype, coll, wp = feed_source_class(source_id)
        basis = ("17 U.S.C. § 105 US government work" if lic == "government_work" else
                 f"{cur.get('authority', source_id)} publication; reuse terms pending "
                 "source-registry approval (PRD §20.9)")
        cur_sha = cur["sha256"]
        snapdir = os.path.join(sdir, "snapshots")
        others = []
        for sha in sorted(os.listdir(snapdir)):
            mp = os.path.join(snapdir, sha, "metadata.json")
            if sha == cur_sha or not os.path.exists(mp):
                continue
            m = json.load(open(mp))
            others.append({"sha": sha, "retrieved_at": m.get("retrieved_at"),
                           "provenance": os.path.join(snapdir, sha, "document.md")})
        body = os.path.join(snapdir, cur_sha, "document.md")
        if not os.path.exists(body):
            skip(sdir, "current snapshot missing document.md", "feeds")
            continue
        eff = parse_date(cur.get("last_modified")) or parse_date(cur.get("retrieved_at"))
        DOCS.append(Doc(
            external_key=f"feed-{source_id}", layer="feeds",
            title=f"{cur.get('authority', '')} — {source_id}".strip(" —"),
            citation=source_id, jurisdiction=jur, license_class=lic, license_basis=basis,
            source_type=stype, collection=coll, wepatent_authority=wp,
            source_url=str(cur.get("canonical_url") or ""), source_path=body,
            checksum=cur_sha, edition=cur_sha[:12],
            effective_date=eff or "2026-08-02",
            effective_date_known=bool(parse_date(cur.get("last_modified"))),
            body_file=body, embed_priority=4,
            extra={"other_versions": others,
                   "supersession_warning": cur.get("supersession_warning")},
        ))
        n_src += 1
        # Linked artifacts (individual decisions, guides, PDFs with extracted text)
        amf = os.path.join(sdir, "artifact-manifest.json")
        if not os.path.exists(amf):
            continue
        try:
            arts = json.load(open(amf))
        except Exception:
            skip(amf, "unparseable artifact manifest", "feeds")
            continue
        by_url: dict[str, list[dict]] = {}
        for a in arts:
            if a.get("sha256") and a.get("canonical_url"):
                by_url.setdefault(a["canonical_url"], []).append(a)
        for url, versions in sorted(by_url.items()):
            versions.sort(key=lambda a: a.get("retrieved_at") or "", reverse=True)
            latest = None
            for v in versions:
                bp = os.path.join(sdir, "artifacts", v["sha256"], "document.md")
                if os.path.exists(bp):
                    latest = (v, bp)
                    break
            if latest is None:
                skip(url, "artifact has no extracted document.md", "feeds")
                continue
            v, bp = latest
            if is_suspect(url):
                skip(url, "license-suspect artifact url", "feeds")
                continue
            ajur, alic, abasis = classify_authority("", url)
            if alic == "internal_only" and lic == "internal_only":
                ajur = jur  # keep parent's EP/WO jurisdiction
            astype = "ptab_decision" if source_id == "ptab-precedential-informative" else stype
            title = url.rstrip("/").split("/")[-1][:200] or url[:200]
            DOCS.append(Doc(
                external_key=f"feedart-{v['sha256'][:16]}", layer="feeds",
                title=f"{source_id} artifact: {title}", citation=title,
                jurisdiction=ajur, license_class=alic, license_basis=abasis,
                source_type=astype, collection=coll,
                wepatent_authority=(wp if alic == "government_work" else None),
                source_url=url, source_path=bp, checksum=v["sha256"],
                edition=v["sha256"][:12],
                effective_date=parse_date(v.get("retrieved_at")) or "2026-08-02",
                effective_date_known=False, body_file=bp, embed_priority=4,
                extra={"parent_source": source_id},
            ))
            n_art += 1
    log(f"feeds: {n_src} sources, {n_art} artifacts")


def build_federal_register():
    root = os.path.join(CORPUS_ROOT, "patent-authority-feeds", "federal-register-uspto")
    n_full = n_cat = 0
    for line in open(os.path.join(root, "catalog.jsonl"), encoding="utf-8"):
        rec = json.loads(line)
        dn = rec.get("document_number")
        if not dn:
            continue
        body = os.path.join(root, "documents", dn, "document.md")
        full = os.path.exists(body)
        rtype = str(rec.get("type") or "Notice")
        stype = "regulation" if "Rule" in rtype else "agency_guidance"
        eff = parse_date(rec.get("publication_date"))
        title = str(rec.get("title") or dn)
        checksum = file_sha(body) if full else sha256_text(json.dumps(rec, sort_keys=True))
        DOCS.append(Doc(
            external_key=f"fr-{dn}", layer="fr", title=title[:300],
            citation=f"{eff or ''} Fed. Reg. {dn} ({rtype})".strip(),
            jurisdiction="US", license_class="government_work",
            license_basis="Federal Register document; 17 U.S.C. § 105 US government work",
            source_type=stype, collection="prosecution",
            wepatent_authority="federal_register",
            source_url=str(rec.get("html_url") or ""), source_path=body if full else
            os.path.join(root, "catalog.jsonl"), checksum=checksum,
            edition="full-text" if full else "catalog-abstract",
            effective_date=eff or "2026-08-02", effective_date_known=bool(eff),
            body_file=body if full else None,
            inline_body=None if full else
            f"{title}\n\n{rec.get('abstract') or ''}".strip(),
            embed_priority=4 if full else 5,
        ))
        n_full += int(full)
        n_cat += int(not full)
    log(f"federal-register: {n_full} full-text, {n_cat} catalog-abstract")


def build_cafc_catalog():
    root = os.path.join(CORPUS_ROOT, "patent-authority-feeds", "federal-circuit-catalog")
    n = 0
    seen = set()
    for line in open(os.path.join(root, "catalog.jsonl"), encoding="utf-8"):
        rec = json.loads(line)
        key_raw = f"{rec.get('appeal_number')}|{rec.get('document_type')}|" \
                  f"{rec.get('release_date')}|{rec.get('case_name')}"
        h = sha256_text(key_raw)
        if h in seen:
            continue
        seen.add(h)
        name = str(rec.get("case_name") or "").split("[")[0].strip()
        eff = parse_date(rec.get("release_date"))
        DOCS.append(Doc(
            external_key=f"cafc-{h[:20]}", layer="cafc-catalog",
            title=f"{name} ({rec.get('document_type')}, {rec.get('status')})"[:300],
            citation=f"{name}, No. {rec.get('appeal_number')} (Fed. Cir. "
                     f"{rec.get('release_date')})"[:250],
            jurisdiction="US", license_class="government_work",
            license_basis="Federal court opinion/order; public judicial record",
            source_type="case_cafc", collection="litigation", wepatent_authority="case",
            source_url=str(rec.get("pdf_url") or ""),
            source_path=os.path.join(root, "catalog.jsonl"),
            checksum=sha256_text(json.dumps(rec, sort_keys=True)),
            edition="catalog-entry", effective_date=eff or "2026-08-02",
            effective_date_known=bool(eff), body_file=None,
            inline_body=f"{rec.get('case_name')}\nAppeal No. {rec.get('appeal_number')} "
                        f"from {rec.get('origin')}\n{rec.get('document_type')} — "
                        f"{rec.get('status')} — released {rec.get('release_date')}\n"
                        f"{rec.get('supersession_warning') or ''}",
            embed_priority=99,  # FTS-only by design; backfill script can embed later
            extra={"appeal_number": rec.get("appeal_number"),
                   "precedential_status": rec.get("status"),
                   "case_name_norm": name.upper()},
        ))
        n += 1
    log(f"cafc-catalog: {n} entries")


def main():
    build_primary_law()
    build_pinecone()
    build_canonical()
    build_feeds()
    build_federal_register()
    build_cafc_catalog()

    # global binary/rederivable skips (recorded once, not per-file)
    skip(os.path.join(CORPUS_ROOT, "patent-primary-law", "sources|history|raw"),
         "re-derivable staging copies of current/ units (raw PDFs noted)", "primary-law")
    skip(os.path.join(CORPUS_ROOT, "patent-authority-feeds", "sources/*/snapshots/*/raw.html"),
         "raw HTML; extracted document.md ingested instead", "feeds")
    skip(os.path.join(CORPUS_ROOT, "patent-prosecution-engine", "public-seed/*.json"),
         "raw ODP seed pages; normalized prosecution.sqlite3 is ingested", "prosecution")

    with open(os.path.join(WORK_DIR, "inventory.jsonl"), "w") as f:
        for d in DOCS:
            f.write(json.dumps(asdict(d)) + "\n")
    with open(os.path.join(WORK_DIR, "skipped.jsonl"), "w") as f:
        for s in SKIPPED:
            f.write(json.dumps(s) + "\n")

    summary = {
        "total_documents": len(DOCS),
        "by_layer": dict(Counter(d.layer for d in DOCS)),
        "by_license_class": dict(Counter(d.license_class for d in DOCS)),
        "retrievable": sum(1 for d in DOCS if d.retrievable()),
        "gated_not_retrievable": sum(1 for d in DOCS if not d.retrievable()),
        "wepatent_eligible": sum(1 for d in DOCS if d.wepatent_authority),
        "by_jurisdiction": dict(Counter(d.jurisdiction for d in DOCS)),
        "skipped": len(SKIPPED),
        "skipped_by_reason": dict(Counter(s["reason"].split(":")[0] for s in SKIPPED)),
    }
    json.dump(summary, open(os.path.join(WORK_DIR, "inventory-summary.json"), "w"), indent=2)
    log(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
