-- Lex Patent Studio — private application project
-- Migration 0006: export artifact storage (FR-8).
--
-- Production uploads DOCX/PDF artifacts to private Supabase Storage
-- (approval-gated credentials) and records storage_path. Until storage is
-- enabled — and as the durable record of exactly what was exported — the
-- immutable bytes and checksums live here. Version-locked: re-export of the
-- same document version returns these bytes; they are never regenerated.

alter table exports
  add column docx_sha256 text check (docx_sha256 is null or docx_sha256 ~ '^[0-9a-f]{64}$'),
  add column pdf_sha256 text check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  add column docx_bytes bytea,
  add column pdf_bytes bytea,
  add column file_name text,
  add column pdf_file_name text;

create trigger exports_immutable
  before update or delete on exports
  for each row execute function app_forbid_mutation();
