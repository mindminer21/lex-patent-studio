"""Shared helpers for the patent corpus ingestion pipeline.

Targets two production Supabase corpus projects:
  - Lex Patent Studio public corpus  (full set, license-gated retrieval view)
  - wepatent public corpus           (US-government-work subset only)

All secrets are read from files at runtime and never logged.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import uuid
from dataclasses import dataclass, field

import requests

CORPUS_ROOT = os.environ.get("CORPUS_ROOT", "/tmp/corpus")
WORK_DIR = os.environ.get("CORPUS_WORK", "/tmp/corpus-work")
RELEASE_LABEL = "2026-08-02-initial"
EMBED_MODEL = "text-embedding-3-small"
EMBED_DIM = 1536

LEX_ENV = os.environ.get("LEX_ENV_FILE", "/tmp/deliver/lex.env.production")
WEPATENT_ENV = os.environ.get("WEPATENT_ENV_FILE", "/tmp/deliver/wepatent.env.production")
LEX_CORPUS_APIKEYS = os.environ.get(
    "LEX_CORPUS_APIKEYS", "/root/launch-secrets/lex-corpus.apikeys.json"
)
OPENAI_KEY_FILE = os.environ.get("OPENAI_KEY_FILE", "/root/launch-secrets/openai.key")
SUPABASE_PAT_FILE = os.environ.get("SUPABASE_PAT_FILE", "/root/.supabase-pat")

UUID_NS = uuid.uuid5(uuid.NAMESPACE_URL, "schellip-patent-corpus")


def det_uuid(*parts: str) -> str:
    """Deterministic UUID so reruns upsert instead of duplicating."""
    return str(uuid.uuid5(UUID_NS, "\x1f".join(parts)))


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def read_env(path: str) -> dict:
    out = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k] = v.strip().strip('"')
    return out


def lex_corpus_conn() -> tuple[str, str]:
    """(rest_url, service_key) for the Lex corpus project."""
    env = read_env(LEX_ENV)
    url = env["LEX_CORPUS_SUPABASE_URL"].rstrip("/")
    keys = json.load(open(LEX_CORPUS_APIKEYS))
    key = None
    for k in keys:
        if k.get("type") == "secret":  # sb_secret_* service key
            key = k["api_key"]
    if key is None:
        for k in keys:
            if "service" in (k.get("name") or "").lower() or "service" in (
                k.get("description") or ""
            ).lower():
                key = k["api_key"]
    if key is None:
        raise RuntimeError("no service key found for lex corpus project")
    return url, key


def wepatent_corpus_conn() -> tuple[str, str]:
    env = read_env(WEPATENT_ENV)
    return env["CORPUS_SUPABASE_URL"].rstrip("/"), env["CORPUS_SUPABASE_SERVICE_ROLE_KEY"]


def openai_key() -> str:
    return open(OPENAI_KEY_FILE).read().strip()


def supabase_pat() -> str:
    return open(SUPABASE_PAT_FILE).read().strip()


# ---------------------------------------------------------------------------
# REST client (PostgREST) with batching and retry
# ---------------------------------------------------------------------------
class Rest:
    def __init__(self, base_url: str, key: str, label: str):
        self.base = base_url + "/rest/v1"
        self.label = label
        self.s = requests.Session()
        self.s.headers.update(
            {
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            }
        )

    def _req(self, method, path, *, retries=5, **kw):
        last = None
        for attempt in range(retries):
            try:
                r = self.s.request(method, self.base + path, timeout=180, **kw)
            except requests.RequestException as e:
                last = e
                time.sleep(2**attempt)
                continue
            if r.status_code >= 500:
                last = RuntimeError(f"{self.label} {path} -> {r.status_code}: {r.text[:200]}")
                time.sleep(2**attempt)
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"{self.label} {path} -> {r.status_code}: {r.text[:400]}")
            return r
        raise RuntimeError(f"{self.label} {path} failed after {retries} tries: {last}")

    def upsert(self, table: str, rows: list[dict], on_conflict: str | None = None,
               batch: int = 500, ignore_duplicates: bool = False):
        """Idempotent bulk insert. Rows carry deterministic ids."""
        if not rows:
            return 0
        resolution = "ignore-duplicates" if ignore_duplicates else "merge-duplicates"
        headers = {"Prefer": f"return=minimal,resolution={resolution}"}
        qs = f"?on_conflict={on_conflict}" if on_conflict else ""
        n = 0
        for i in range(0, len(rows), batch):
            chunk = rows[i : i + batch]
            self._req("POST", f"/{table}{qs}", headers=headers, data=json.dumps(chunk))
            n += len(chunk)
        return n

    def insert_ignore_conflict(self, table: str, rows: list[dict], on_conflict: str,
                               batch: int = 500):
        return self.upsert(table, rows, on_conflict=on_conflict, batch=batch,
                           ignore_duplicates=True)

    def count(self, table: str, filters: str = "") -> int:
        r = self._req(
            "HEAD", f"/{table}?select=id{('&' + filters) if filters else ''}",
            headers={"Prefer": "count=exact"},
        )
        return int(r.headers["Content-Range"].split("/")[-1])

    def select(self, table: str, query: str) -> list:
        return self._req("GET", f"/{table}?{query}").json()


def mgmt_sql(project_ref: str, query: str) -> list:
    """Run SQL via the Supabase management API (DDL or complex queries)."""
    pat = supabase_pat()
    for attempt in range(5):
        r = requests.post(
            f"https://api.supabase.com/v1/projects/{project_ref}/database/query",
            headers={"Authorization": f"Bearer {pat}", "Content-Type": "application/json"},
            json={"query": query},
            timeout=180,
        )
        if r.status_code >= 500:
            time.sleep(2**attempt)
            continue
        if r.status_code >= 400:
            raise RuntimeError(f"mgmt sql {project_ref} -> {r.status_code}: {r.text[:400]}")
        return r.json()
    raise RuntimeError(f"mgmt sql {project_ref} failed after retries")


# ---------------------------------------------------------------------------
# Markdown front matter + chunking
# ---------------------------------------------------------------------------
FRONT_RE = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)


def split_front_matter(text: str) -> tuple[dict, str]:
    m = FRONT_RE.match(text)
    if not m:
        return {}, text
    try:
        import yaml

        meta = yaml.safe_load(m.group(1)) or {}
        if not isinstance(meta, dict):
            meta = {}
    except Exception:
        meta = {}
    return meta, text[m.end():]


CONTROL_RE = re.compile(r"[\x00\x01-\x08\x0b\x0c\x0e-\x1f\x7f]")


def sanitize(text: str) -> str:
    """PostgreSQL text cannot contain NUL; strip control chars except \\n\\t."""
    return CONTROL_RE.sub("", text or "")


DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")


def parse_date(value, fallback: str | None = None) -> str | None:
    """Return YYYY-MM-DD or fallback."""
    if value:
        m = DATE_RE.match(str(value))
        if m:
            return m.group(0)
    return fallback


def chunk_text(body: str, target: int = 2800, hard_max: int = 8000) -> list[tuple[str, str]]:
    """Split markdown into (heading, chunk) pairs on paragraph boundaries.

    Chunks aim for `target` chars and never exceed `hard_max` (keeps the
    generated tsvector columns well under PostgreSQL's 1MB tsvector limit and
    keeps embedding inputs a sane size).
    """
    body = body.strip()
    if not body:
        return []
    paras = re.split(r"\n{2,}", body)
    chunks: list[tuple[str, str]] = []
    cur: list[str] = []
    cur_len = 0
    heading = ""
    cur_heading = ""
    for p in paras:
        p = p.strip()
        if not p:
            continue
        hm = re.match(r"#{1,6}\s+(.{1,180})", p)
        if hm:
            heading = hm.group(1).strip()
        while len(p) > hard_max:  # pathological long paragraph: hard split
            if cur:
                chunks.append((cur_heading, "\n\n".join(cur)))
                cur, cur_len = [], 0
            chunks.append((heading, p[:hard_max]))
            p = p[hard_max:]
        if cur_len + len(p) + 2 > target and cur:
            chunks.append((cur_heading, "\n\n".join(cur)))
            cur, cur_len = [], 0
        if not cur:
            cur_heading = heading
        cur.append(p)
        cur_len += len(p) + 2
    if cur:
        chunks.append((cur_heading, "\n\n".join(cur)))
    return chunks


# ---------------------------------------------------------------------------
# License boundary (PRD-lex-patent-studio §6.4)
# ---------------------------------------------------------------------------
US_GOV_URL_RE = re.compile(
    r"https?://([a-z0-9.-]*\.)?(uspto\.gov|ecfr\.gov|uscode\.house\.gov|govinfo\.gov|"
    r"federalregister\.gov|cafc\.uscourts\.gov|supremecourt\.gov|usitc\.gov|"
    r"regulations\.gov|loc\.gov|copyright\.gov|archives\.gov)(/|$)",
    re.I,
)

# Provenance markers for the license-suspect classes that must never be
# ingested (Practical Law, recovered CLE, attorney playbooks, client matters,
# NITA course materials).
SUSPECT_RE = re.compile(
    r"practical-law|practical_law|recovered-cle|recovered_cle|(^|[/_-])cle([/_.-]|$)|"
    r"playbook|client-matter|client_matter|client-matters|matter-index|"
    r"(^|[/_-])nita([/_.-]|$)",
    re.I,
)


def is_suspect(*strings: str) -> bool:
    return any(s and SUSPECT_RE.search(s) for s in strings)


@dataclass
class Doc:
    """One logical document destined for public_documents (+ version + sections)."""

    external_key: str
    layer: str  # primary-law | pinecone | canonical | feeds | fr-catalog | cafc-catalog
    title: str
    citation: str
    jurisdiction: str  # US | EP | WO
    license_class: str  # lex enum value
    license_basis: str
    source_type: str  # lex corpus_source_type
    collection: str  # lex corpus_collection
    wepatent_authority: str | None  # wepatent authority value, None => lex only
    source_url: str
    source_path: str
    checksum: str
    edition: str
    effective_date: str  # YYYY-MM-DD (lex NOT NULL)
    effective_date_known: bool
    body_file: str | None  # path to markdown to chunk; None => metadata-only
    inline_body: str | None = None  # small body provided inline (catalog rows)
    embed_priority: int = 99  # 1 pinecone, 2 primary law, 3 canonical, 4 feeds
    extra: dict = field(default_factory=dict)

    def retrievable(self) -> bool:
        return self.license_class in ("government_work", "public_data_api", "org_reuse_terms")


def log(*a):
    print(time.strftime("[%H:%M:%S]"), *a, flush=True)
    sys.stdout.flush()
