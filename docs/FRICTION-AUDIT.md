# Friction audit — human steps and inputs in the wepatent authenticated app

**Date:** 2026-08-04 · **Scope:** dashboard → intake → studio → interview →
export → get-help → billing → settings (wepatent namespace only).

**Design rule (Jeff, 2026-08-04, app-wide):** *Minimize human steps and
inputs throughout the app.* Specifically directed: the invention/working
title must NOT have a Save button — the inventor simply edits a text field
and it auto-saves.

Every interactive human step/input in the main flows is listed below and
classified:

- **(a) REMOVED** — eliminated in this change set.
- **(b) KEEP** — legally/compliance required: clickwrap acknowledgements,
  `ai_proposed` confirmations for substantive ledger content, cost-estimate
  consent before model spend, and counsel gates exist for UPL/ethics
  reasons (docs/legal-ethics-risk-memo.md) and are not removable friction.
- **(c) CANDIDATE** — plausibly removable ceremony; needs Jeff's decision.

## (a) REMOVED in this change set

| # | Flow | Step removed | Replacement |
|---|------|--------------|-------------|
| 1 | Studio | Working title "Save title" button (inside a collapsed `<details>`) | Inline auto-saving field: debounced save ~800 ms after typing stops + save on blur; Escape reverts; aria-live "Saving…/Saved/error + Retry" status. An untouched AI-proposed title is pre-filled with `ai_proposed` styling and the hint "AI-proposed — edit or click away to keep"; blurring without edits accepts it (`user_confirmed` + `title_confirmed`), editing then blurring saves as `user_edited` + `title_edited` — provenance preserved in `working_titles` + `ps_events`. |
| 2 | Studio | "Upload to quarantine" button | Selecting a file starts the validated upload immediately (same FR-4 sign → PUT → quarantine → scan pipeline; kind/note remain optional metadata set before choosing the file). Matches the interview-attachment pattern that already auto-uploads. |
| 3 | Get help | "Upload filing receipt" button | Selecting the receipt file starts the upload (same pipeline, `kind=filing_receipt`). |
| 4 | Settings | "Update retention" button | Auto-saving retention field (debounce + blur, Escape reverts, aria-live status). Still owner-only (`org.manage`), bounds-checked 30–3650 days, and audited on every change — only the click was removed, none of the guardrails. |

Also conforming already (removed in earlier rounds, kept removed): no
naming step at record creation (neutral placeholder + AI-proposed title),
no in-app conflict-intake form, interview attachments auto-upload on
selection.

## (b) KEEP — legally/compliance required (do not remove)

| # | Flow | Step | Why it must stay |
|---|------|------|------------------|
| 1 | Onboarding | Clickwrap: 4 explicit acknowledgements + Continue (server-enforced, versioned re-acceptance) | UPL/ethics clickwrap; the record of explicit assent is the point. |
| 2 | Intake (classic form) | Review-stage accuracy acknowledgement checkbox + "Submit to invention record" | User attestation that facts are accurate; facts enter as `user_asserted` provenance. |
| 3 | Intake (classic form) | "No disclosure events yet" / "No source documents yet" checkboxes | Honest negative attestations recorded for counsel; absence of data must be explicit, not inferred. |
| 4 | Studio | "Interpret N file(s)" button with cost estimate shown first | Cost-estimate consent before model spend (FR-INT-10). |
| 5 | Studio | "Distill with AI" / "Re-distill with new material" button with cost estimate | Spend consent; also a substantive AI run over the whole record. |
| 6 | Studio + interview | Confirm / Edit / Reject on `ai_proposed` items; bulk accept/reject; "Apply as my edit"/"Dismiss" for proposed edits; "Confirm anchor" in the region viewer | Invariant 13: only a human action can upgrade AI output out of `ai_proposed`. Core UPL/ethics boundary — AI never self-approves substantive ledger content. |
| 7 | Interview | "Start the interview" / "Send answer" / raise-cap form | Each answered turn runs metered model passes; starting and answering are spend consent; the cap raise is explicit spend authorization. |
| 8 | Interview | "Skip" / "I don't know" buttons | Honest enablement signals recorded for counsel; must be deliberate. |
| 9 | Export | "Create version-locked export" button | Creates an immutable, checksummed counsel package (and a render job); a deliberate versioning act. |
| 10 | Get help | Counsel-request state-machine actions (submit conflict intake, schedule consultation, record signed engagement, …) | Counsel gates: representation requires conflict review, attorney acceptance, signed engagement. States cannot be skipped or automated. |
| 11 | Get help | External USPTO / attorney-scheduling links with adjacent compliance copy | Pro-se and no-attorney-client-relationship boundaries (legal-ethics memo §2); the copy must stay next to the action. |
| 12 | Billing | Top-up amount select + "Continue to checkout"; "Open customer portal" | Real-money spend consent through Stripe; never auto-charge. |
| 13 | Settings | "Run retention purge now" button | Irreversible permanent deletion of content; must remain an explicit, deliberate action. |
| 14 | Settings | Invite member (email + role + "Create invitation"); "Revoke" | Grants/revokes tenant access; explicit security actions with one-time tokens. |
| 15 | Sign-in | Email (+ optional name) + Continue | Authentication; identity is required input. |

## (c) CANDIDATE — needs Jeff's decision

| # | Flow | Step | Proposal | Trade-off |
|---|------|------|----------|-----------|
| 1 | Dashboard → intake | The path-chooser page (`/inventions/start`) is an extra click: "New invention" → choose Path A/B | Put "Upload files" and "Answer questions" buttons directly on the dashboard (each creates the record on first commit and deep-links to studio/interview), or land in the studio with an always-visible upload zone + interview link | Loses the one place that explains the two composable paths; first-time orientation value vs. one click saved for every record. |
| 2 | Classic form intake | "Save draft" button on every stage | Autosave stage data on field blur / debounce (the same pattern as the title field); keep "Save and continue" as the validation + navigation step | Stage data is multi-field; partial autosave of an invalid stage needs a clear "draft, not yet validated" state. |
| 3 | Classic form intake | Whole guided form vs. studio/interview | Retire or de-emphasize the classic form (already an M3 open decision, LEDGER M3 traceability table) — the interview + studio cover the same ledgers with fewer required inputs | Removes a working intake path some users may prefer; usage data does not exist yet. Reserved to Jeff per the M3 decision note. |
| 4 | Export | Six section checkboxes (all default-checked) + optional draft-version select | Collapse behind a "Customize sections" disclosure; default = everything + latest draft version, so the common case is one click | Counsel packages are consequential; hiding the composition may surprise power users. Checkboxes are not compliance-required (the counsel-review notice is embedded regardless of selection). |
| 5 | Onboarding | Organization name + "Create organization" before anything else | Auto-create a personal organization (e.g. named after the user), rename later in Settings | Org name lands on invitations/billing; auto-naming may leak a placeholder into real artifacts. |
| 6 | Studio | Upload "Kind" select + "Note" field (optional, but rendered above the file input) | Default kind by detected file class (image/document/3D/audio/video) and move kind/note into an "optional details" disclosure | Kind feeds counsel-package organization; silently-defaulted kinds may be wrong more often than user-picked ones. |
| 7 | Billing | Top-up amount is a select of fixed amounts | Remember the last top-up amount as the default | Trivial win; still an explicit checkout (spend consent untouched). |

## Summary

- **REMOVED now:** 4 steps (working-title Save button → autosave with
  AI-proposal accept-on-blur; studio upload button; filing-receipt upload
  button; retention Update button).
- **KEEP (compliance/consent):** 15 step groups — clickwrap, attestations,
  `ai_proposed` confirmations, spend consent, counsel gates, destructive
  purge, access management, auth.
- **CANDIDATE (Jeff to decide):** 7 items, listed above.

No clickwrap, spend-consent, or ledger-confirmation semantics were touched.
