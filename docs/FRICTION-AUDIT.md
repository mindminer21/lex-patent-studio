# Friction audit — human steps and inputs in the wepatent authenticated app

**Date:** 2026-08-04 · **Scope:** dashboard → intake → studio → interview →
export → get-help → billing → settings (wepatent namespace only).

**Design rule (Jeff, 2026-08-04, app-wide):** *Minimize human steps and
inputs throughout the app.* Specifically directed: the invention/working
title must NOT have a Save button — the inventor simply edits a text field
and it auto-saves.

**Status (2026-08-04, round 2): all seven CANDIDATEs are decided and
implemented.** Jeff's decisions and what shipped for each are in §(c)
below. Nothing in the KEEP list was touched.

Every interactive human step/input in the main flows is listed below and
classified:

- **(a) REMOVED** — eliminated in this change set.
- **(b) KEEP** — legally/compliance required: clickwrap acknowledgements,
  `ai_proposed` confirmations for substantive ledger content, cost-estimate
  consent before model spend, and counsel gates exist for UPL/ethics
  reasons (docs/legal-ethics-risk-memo.md) and are not removable friction.
- **(c) CANDIDATE** — plausibly removable ceremony; **all decided by Jeff
  on 2026-08-04 and implemented.**

## (a) REMOVED in round 1 (2026-08-04)

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

## (c) CANDIDATE — Jeff's decisions (2026-08-04) and what shipped

| # | Flow | Step | Jeff's decision | Implemented | Status |
|---|------|------|-----------------|-------------|--------|
| 1 | Dashboard → intake | The path-chooser page (`/inventions/start`) is an extra click | **DECLINED as written.** Do NOT move the Path A/B buttons onto the dashboard; "New invention" stays one clear CTA into the chooser. Make the chooser itself as lean as possible: one line of framing max, two buttons, plus the de-emphasized classic-form link | `inventions/start/page.tsx`: per-card "Path A/Path B" kickers and explanatory paragraphs removed; one framing line ("Two ways in — you can do both…"), two buttons, boundary + counsel notices retained. Dashboard unchanged | done |
| 2 | Classic form intake | "Save draft" button on every stage | **YES.** Autosave stage data (debounce ~800 ms + on blur + on stage navigation); remove the button; same inline status pattern as the working title; server-side validation unchanged; partial/invalid drafts must still save safely as draft state | `IntakeStageForm.tsx` (debounce + blur + stage-nav interception + `pagehide` keepalive flush; aria-live "Saving…/Draft saved/error + Retry") → `POST /api/intake/draft` → `services/intake-draft.ts`. The endpoint NEVER validates: it calls `saveStageDraft`, which also clears the stage's `completed` flag, so a draft can never pass for a validated stage or reach submission. `completeStage` + the review attestation are untouched, and the review stage is deliberately NOT autosaved (KEEP #2) | done |
| 3 | Classic form intake | Whole guided form vs. studio/interview | **YES, de-emphasize (do not delete).** Reachable but visually secondary everywhere; small text link on the chooser; no prominent buttons/cards; not featured in nav. Route and functionality intact | The link moved out of the Path B card to a standalone `hint` line ("Prefer a fixed form? Use the classic form intake"). Audited: no other button/card/nav entry points at `/inventions/new`. Route, stages, validation, and submission unchanged. (Supersedes the M3 "guided-form retirement" open decision: **de-emphasized, not retired**) | done |
| 4 | Export | Six section checkboxes + optional draft-version select | **YES.** Default to ALL sections, collapse behind a closed "Customize sections" disclosure, one-click export from the default state; keep export manifest/version-locking semantics exactly as-is | `export/page.tsx`: native `<details>` disclosure, closed by default; checkboxes still submit from inside it, so the default export is unchanged. Draft-version default deliberately left at "No draft — record only" so no existing export's contents change. Manifest, checksums, immutable draft-version references, and the counsel-review notice untouched | done |
| 5 | Onboarding | Organization name + "Create organization" before anything else | **YES.** Auto-create on first sign-in with a changeable placeholder name; remove the blocking dashboard step; org name editable in Settings via an AUTOSAVING inline field; membership/role creation, default retention, and audit events identical; cross-tenant isolation tests unchanged | `ensurePersonalOrganization` (idempotent) called from `signInAction`, with the dashboard as a safety net for pre-existing sessions. **Placeholder name: derived from the email local-part** — "jeff@…" → "Jeff's workspace" (chosen over "My workspace" as the more human option); purely numeric segments dropped; falls back to "My workspace". Same transactional `createOrganizationForUser` (owner membership, default retention, wallet + promo ledger entry, seeded synthetic record, `organization.created` audit event). Rename: `OrganizationNameField` → `PUT /api/settings/organization` → `updateOrganizationName` (owner-only `org.manage`, 2–120 bounds, `organization.renamed` audit). No schema change | done |
| 6 | Studio | Upload "Kind" select + "Note" field rendered above the file input | **YES.** Default kind from the detected file class; move Kind + Note into a collapsed "Add details" disclosure; upload proceeds immediately on selection with the auto-derived kind | `deriveUploadKind` in `domain/uploads.ts`: image → `image`; PDF/DOCX/PPTX/XLSX/TXT/MD/SVG → `document`; STL/STEP/OBJ/3MF → `model`; MP3/WAV/M4A → `audio`; filing-receipt surface → `filing_receipt`; anything else (incl. video) → `other`. Uses the same allowlist lookup as the validator, so rejected types never get a confident kind. Kind + Note moved into a closed `<details>`; the derived kind is stated back in the success message ("Uploaded photo.png as image") rather than applied silently; explicit override remains available | done |
| 7 | Billing | Top-up amount is a select of fixed amounts | **YES, plus one-click top-up.** Remember the last amount; one-click off-session PaymentIntent on a saved payment method credited via the `payment_intent.succeeded` webhook; Checkout must SAVE the payment method; SCA failures surfaced honestly with a Checkout link — never silently failed or faked; keep idempotency keys, immutable ledger entries, reservation semantics, test-mode only | Last amount derived from the immutable ledger (`lastTopUpAmountCents`) — no new state, no migration. `BillingPort.getDefaultPaymentMethod` + `createOffSessionTopUp` in BOTH adapters; Checkout sets `payment_intent_data[setup_future_usage]=off_session` (+ `customer_creation=always`) so the card is saved on the first top-up. The wallet is credited ONLY by the verified webhook → dedupe → outbox → immutable ledger path (`payment_intent.succeeded` added alongside `checkout.session.completed`, same stripe-reference credit-once guard); a fresh `Idempotency-Key` per attempt. SCA (`HTTP 402 authentication_required`, or any non-succeeded intent status) → "Nothing was charged" + a button completing the same amount through Checkout. Declines reported as declines. Raw Stripe bodies never leave the server; audit events carry amount + outcome only | done |

## Summary

- **REMOVED (round 1):** 4 steps (working-title Save button → autosave with
  AI-proposal accept-on-blur; studio upload button; filing-receipt upload
  button; retention Update button).
- **REMOVED (round 2, Jeff's decisions above):** the blocking organization
  -creation step; the guided form's "Save draft" button; the export section
  checkboxes as a required decision; the upload Kind/Note pre-step; the
  Checkout detour for repeat top-ups; the chooser's excess framing.
- **KEEP (compliance/consent):** 15 step groups — clickwrap, attestations,
  `ai_proposed` confirmations, spend consent, counsel gates, destructive
  purge, access management, auth. **Unchanged.**

No clickwrap, spend-consent, or ledger-confirmation semantics were touched
in either round. Every top-up is still an explicit, amount-labeled action
the user takes — one-click removes the Checkout detour, not the consent.

---

## Round 3 addendum — patent figures (2026-08-04)

The figures subsystem adds **no required human step**. Per the app-wide
design rule:

- **Generation is automatic.** A new draft version enqueues the pipeline
  with zero user steps (gated by `FIGURES_AUTO_GENERATE`, off until Jeff
  approves; see `docs/PATENT-FIGURES.md` §7.4). A manual "Generate figures"
  button exists but is never required.
- **Acceptance is one action.** A single "Accept figures" button. No wizard,
  no per-figure confirmation, no multi-step review.
- **Renaming a part is one inline field.** No modal, and one edit propagates
  to every view because the drawings store the numeral, not the label.
- **No cost consent step was added for the free paths.** Deterministic
  diagrams and model-derived figures cost nothing, so they carry no estimate
  gate. The estimate/reservation gate applies only when an image model would
  actually be called — that gate is (b) KEEP, for the same
  cost-transparency reason as every other model touch.

**One new required input, and it is (b) KEEP:** accepting a figure set that
has failed formality checks requires a recorded reason. That mirrors the
existing dismissal-reason pattern for approving over failed checks and
exists so the record shows a person decided, not that a machine passed it.
