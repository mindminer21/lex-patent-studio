# Automatic MPEP-compliant patent figures

Status: **shipped behind flags; the generative layer is OFF by default.**
Owner approval is required before any image-generation traffic or automatic
triggering reaches customers. The exact steps are in §7.

Nothing in this subsystem files, signs, or transmits anything. No figure it
produces is filing-ready, and the validator reports **mechanical formality
checks**, never a guarantee of USPTO acceptance.

---

## 1. Architecture — why it is a hybrid

A generative image model cannot be trusted with the parts of a patent
drawing that must be exact: legible numerals, reference characters that do
not cross lines, the same numeral on the same part across views, lead lines
that never cross each other, exact margins and sheet geometry, and pure
black-on-white line art. Every one of those is a hard USPTO requirement, so
**we do not ask the model to draw them.**

| Layer | What it owns | Where |
|---|---|---|
| **1 — Generative line art** | ONLY the drawing of the subject. Pure black line art, no text, no numerals, no labels, no color, no gradients. | `src/lib/server/adapters/production/gemini-image.ts`, prompt in `figures/gemini-contract.ts` |
| **2 — Deterministic vector composition** | Reference numerals, lead lines, `FIG. N`, sheet numbering, margins/sight, `Prior Art` legends, section arrows, crosshairs, indicia. Plain code, no model. | `figures/compose.ts`, `figures/diagrams.ts`, `figures/geometry.ts`, `figures/numerals.ts` |
| **3 — Compliance validator** | Machine-checks the composed output against the rule set and reports violations. | `figures/rules.ts`, `figures/validate.ts` |

Block diagrams, flowcharts, waveform groups and formula figures are
generated **entirely in Layer 2 from structured data** — no image model at
all, because they are exactly renderable and a model would only add error.

The shared core (`src/lib/server/figures/**`) is product-neutral: it does
not import from `@/lib/wepatent/**` or `@/lib/domain/**` and never touches
adapters, sessions or storage. Lex Patent Studio can consume it unchanged
(see §8).

### The four generation paths, ranked by fidelity

1. **`deterministic_diagram`** — exact, free, always available. Block
   diagrams from the component graph, flowcharts from literal numbered
   method steps, waveform groups, formula figures.
2. **`from_uploaded_model`** — exact. Reuses the shipped M2/M3 STL/OBJ
   parsers and `projectMesh`; silhouette and crease edges are extracted into
   vector primitives (`figures/mesh-lineart.ts`). The geometry is the user's
   own, so nothing is invented.
3. **`from_uploaded_image`** — highest-fidelity generative path. An uploaded
   photo or sketch conditions the model. Requires the drawing model.
4. **`generated_line_art`** — from a textual subject description. Requires
   the drawing model. Lowest confidence; see §5.

---

## 2. The rule set

`src/lib/server/figures/rules.ts`, versioned as `RULES_VERSION`
(`uspto-drawings-2026-08-04`). Every rule carries an id, a human-readable
description, a citation, and — where mechanically decidable — a checker that
runs against the **composed output** (the positions, sizes and rotations the
composer actually emitted), not against the intent that produced it.

Rules that a machine cannot decide return `needs_human_review` **with the
reason**. They are never silently passed.

Coverage by area, with the primary citation:

- **Media** — `MEDIA-COLOR` 1.84(a)(2), `MEDIA-GREYSCALE` 1.84(b),
  `MEDIA-SOLID-BLACK` 1.84(m), `MEDIA-REPRODUCTION` 1.84(l),
  `MEDIA-SHADING-CONVENTION` 1.84(m).
- **Sheet geometry** — `SHEET-SIZE`/`SHEET-UNIFORM` 1.84(f),
  `SHEET-MARGINS`/`SHEET-SIGHT`/`SHEET-NO-FRAME` 1.84(g),
  `SHEET-ORIENTATION` 1.84(f),(i), `SHEET-CROSSHAIRS` 1.84(h).
- **Views** — `VIEW-NO-OVERLAP`/`VIEW-SAME-DIRECTION`/`VIEW-SEPARATION`
  1.84(h)(1), `VIEW-FRONT-PAGE` 1.84(j),
  `VIEW-SECTION-HATCH-ANGLE`/`-DISTINCT`/`-CONSISTENT` 1.84(h)(3),
  `VIEW-SECTION-PLANE` 1.84(h)(2).
- **Line types** — `LINE-TYPES`, `LINE-QUALITY` 1.84(l).
- **Reference characters** — `REF-MIN-HEIGHT` 1.84(p)(3),
  `REF-NOT-ENCLOSED`/`REF-ORIENTATION` 1.84(p)(1),
  `REF-NO-LINE-CROSSING` 1.84(p)(3),(q),
  `REF-UNDERLINE-ON-SURFACE` 1.84(q),
  `REF-CROSS-VIEW-CONSISTENCY` 1.84(p)(4),
  `REF-NUMBERING-CONVENTION` MPEP 608.02,
  `REF-SPEC-TWO-WAY` 1.84(p)(5),
  `LEAD-ONE-PER-CHARACTER`/`LEAD-NO-CROSSING`/`LEAD-NOT-TOUCHING`/`LEAD-ORIGIN-ADJACENT`
  1.84(q), `ARROW-DISTINGUISHABLE` 1.84(r).
- **Numbering and labels** — `SHEETNUM-FORMAT`/`-IN-SIGHT`/`-LARGER`
  1.84(t), `VIEWNUM-SEQUENTIAL`/`-PREFIX`/`-LARGER` 1.84(u),
  `VIEWNUM-SINGLE-VIEW` 1.84(u)(1), `VIEWNUM-PARTIAL` 1.84(u)(2),
  `PRIOR-ART-LEGEND` MPEP 608.02(g), `LEGEND-BREVITY` 1.84(o),
  `COPYRIGHT-NOTICE` 1.84(s), `INDICIA-PLACEMENT` 1.84(c).
- **Symbols** — `SYMBOL-LEGEND` 1.84(n), `FLOWCHART-SHAPES` MPEP 608.02.
- **Graphic forms** — `FORMULA-SEPARATE-FIGURE`, `WAVEFORM-GROUP` 1.84(i).
- **Design patents** — `DESIGN-VIEW-SET`, `DESIGN-SHADING-REQUIRED`
  MPEP 1503.02; `DESIGN-BROKEN-LINES` is `needs_human_review` because
  whether matter is claimed ornamental subject matter or unclaimed
  environment is a legal judgment the record cannot settle.
- **General** — `CLEAN-RENDER` 1.84(a),(e); `PLACEMENT-SOLVED` is an
  implementation guarantee that escalates rather than emitting a violating
  placement.

Every mechanically checked rule has a **passing and a failing fixture** in
`tests/figure-rules.test.ts`, enforced at runtime by a coverage guard that
records which rules were seen in which direction.

### Deferred rules, and why

- **`DESIGN-BROKEN-LINES`** — not mechanically decidable (above).
- **Color petitions** — out of scope by design. Any color in output is a
  failure, never a path to a petition.
- **Photographs under 1.84(b)(2)** — not supported. The pipeline produces
  line art only; a photograph would fail `MEDIA-GREYSCALE`.
- **Model-assisted planning** — the planner is deterministic (§4). The
  validated JSON contract a model planner would have to satisfy already
  exists (`plannerOutputSchema`), so the seam is typed and enforced.

---

## 3. The numeral registry

`figure_reference_numerals` is the single source of truth that makes
37 CFR 1.84(p)(4) mechanical rather than aspirational. It is unique on
**both** `(figure_set_id, numeral)` and `(figure_set_id, part_label)`:

- one numeral can never designate two parts;
- one part can never carry two numerals.

Views store only the numeral, never the label — which is why renaming a part
is a single row edit that every view picks up at once.

Allocation follows MPEP practice: begin at 10, step by 2, leaving odd
numbers free for later insertions; suffix letters (`16A`, `16B`) for
intervening parts; primed numerals are rejected. **An existing part is never
renumbered** — a proposed renumbering is reported as a conflict, not applied.

---

## 4. The planner and the honesty bar

`src/lib/server/figures/planner.ts` is **deterministic and record-driven**.
Every figure it proposes is a projection of rows that already exist:
components, solution↔component associations from the P/S ledger, uploaded
sources, and method steps *literally present* in the draft text (read by
structure — numbered lines under a method heading — never by asking a model
what the steps are).

It cannot hallucinate a part because it has no generative step in which to
do so. Concretely:

- With components but **no association evidence**, it draws the boxes and
  **no arrows**. An invented arrow is invented structure.
- With **nothing in the record**, it produces zero figures and one
  `needs_input` question, not a plausible-looking drawing.
- With a 3D source it cannot parse, it asks for a re-upload.
- With the drawing model unavailable, image-derived views become
  `needs_input` with the question we need answered.

**Why the model planner is deferred.** The brief specifies an Advanced text
model with structured output for Stage 1. We shipped the deterministic
planner as the default instead, because the planner is exactly where §8's
"single most important quality rule" bites: a model choosing which parts
appear in which figure is a model inventing structure. Deterministic
planning is exact, free, and cannot fabricate. The schema contract is in
place so a model planner can be added behind it later without changing
anything downstream — its output would have to satisfy the same validation
the deterministic planner self-checks against today.

Prompt injection: every string reaching the planner is untrusted evidence.
Planted instructions become part labels or are ignored; they cannot change
the figure list, the numeral registry, or any state. Adversarial fixtures
cover this in `tests/figure-planner.test.ts` and in the E2E journey.

---

## 5. Where the generative layer is unreliable, and what we do about it

Layer 1 is the least trustworthy component in the system. Every failure mode
produces a **question**, never a drawing:

| Failure | Detected by | Outcome |
|---|---|---|
| Model refuses / safety block | adapter | figure `needs_input`, **zero billed** |
| Color in the output | `checkRasterHygiene` | regenerate once, then `needs_input`; the spend is reported |
| Greyscale / photographic tone | `checkRasterHygiene` | same |
| Solid black area fills | `checkRasterHygiene` | same |
| **Text rendered in the image** | glyph heuristic | **hard failure** — Layer 2 owns all text |
| Timeout / 429 / 5xx | adapter | bounded retry, then a gateway error; nothing is drawn |
| Provider disabled or unkeyed | adapter | figure `needs_input` with the honest reason |

**On text detection specifically.** `detectTextLikeGlyphs` is a
connected-component **glyph heuristic, not OCR**. It flags small, dense,
similarly-sized blobs sharing a baseline — the visual signature of rendered
characters — and only reports a hit when at least three appear together. It
is deliberately biased toward false positives: a false positive costs one
regenerate, a false negative puts model-rendered text into a patent drawing.
It is reported as evidence, never as a guarantee.

**A rejected image still cost money.** We report that cost rather than
hiding it. The estimate's high bound assumes one regenerate per figure, and
that ceiling is what gets reserved.

---

## 6. Cost model

| Item | Provider cost | Multiplier | Customer |
|---|---|---|---|
| Planning, composition, validation | none (deterministic code) | — | **free** |
| Model-derived figures (STL/OBJ) | none | — | **free** |
| Gemini 3 Pro Image, per accepted image | 24¢ | **2.0** | 48¢ |
| Text models (drafting, interview, interpretation) | per registry | 1.5 | unchanged |

The multiplier catalog is `src/lib/wepatent/domain/markup.ts`. Provider
*rates* stay server-side; the *markup* is published, so it lives where
marketing pages can import it. Every price-registry entry names a billing
category and resolves its multiplier through that catalog — which is what
makes the disclosure-consistency test meaningful.

Published sentence, derived from the catalog:
**`provider cost × 1.5 (× 2.0 for image generation)`**

Every settled usage event records provider cost, the **multiplier applied**
(as `markup_multiplier_bp`), the rate version, and the customer charge. The
database CHECK re-derives the charge from those, so an event can never claim
a multiplier it did not use.

### Defaults and caps

| Setting | Default | Meaning |
|---|---|---|
| `FIGURE_SET_BUDGET_CENTS` | `300` ($3.00) | per-draft ceiling; a run whose estimate exceeds it **pauses** |
| `FIGURES_ORG_DAILY_CAP_CENTS` | `2000` ($20.00) | org-wide daily figure spend; derived from the immutable usage-event log |
| `FIGURES_GEMINI_ENABLED` | `0` | drawing model off |
| `FIGURES_AUTO_GENERATE` | `0` | automatic triggering off |

A cap **pauses with a visible reason** ("figure generation paused — raise the
cap to continue"); it never spends silently and never fails silently.

**Regeneration of an unchanged record is an exact no-op.** The planner input
is content-hashed (record + rules/planner/composer/prompt versions) and
compared before any provider call. That is stronger than a timed debounce: a
60-second window would still re-spend on the 61st second. The carried-forward
numeral registry is excluded from the hash — it is an output fed back in, and
including it would defeat the no-op.

Retries never double-charge: the job's idempotency key flows into the same
reservation deduplication the drafting path already uses.

---

## 7. What the owner must approve, and the exact enabling steps

Four separate gates. Each is a deliberate decision.

### 7.1 Enable the drawing model (image generation)

1. Create a Google AI Studio / Gemini API key with billing attached.
2. Confirm the per-image rate. The registry entry is **24¢ per image**
   (`2026-08-01.google.gemini-3-pro-image` in
   `src/lib/server/adapters/production/model-gateway.ts`). **Re-check
   Google's published price before enabling live traffic** and update the
   entry with a new `effectiveFrom` if it has moved — do not edit the
   existing rate version in place.
3. Set both variables in the Vercel project (Production scope):
   ```
   GEMINI_API_KEY=<the key>          # server-side only, never NEXT_PUBLIC_
   FIGURES_GEMINI_ENABLED=1
   ```
   **Both** are required. The key alone does nothing; the flag alone does
   nothing. With either missing the adapter refuses and the product says
   "line art unavailable" rather than drawing something.
4. Redeploy.
5. Verify on one synthetic record: the Figures tab should no longer show the
   "Generated line art is not enabled" note, and an image-derived figure
   should produce a raster rather than a `needs_input` question.

To turn it off again: set `FIGURES_GEMINI_ENABLED=0` (or use the existing
`MODEL_GATEWAY_KILL_SWITCH=1`, which refuses every model run including this
one) and redeploy.

### 7.2 Approve the 2.0 generation markup for customer traffic

Already implemented and disclosed. Since 2026-08-04 the 2.0 rate is not an
image-only rate: it applies to **every generation task** in both products
(Jeff's directive). Confirm the published copy is what you want customers to
see — the wepatent billing, pricing, and AI-disclosure pages, the Lex
`/pricing`, `/models`, `/professionals`, `/legal/terms` and root landing
pages, and FR-6 / FR-9 in the two PRDs all now read
`provider cost × 2.0 for generation tasks, × 1.5 for analysis tasks`,
derived from `src/lib/shared/billing/markup.ts`. Changing either multiplier
is a pricing change.

### 7.2a Choosing the image model — a config decision, not a code change

**Jeff's directive (2026-08-04):** *"Make the default model for image
generation nano banana 2, or if it is better output, use gemini pro 3."*

**Nano Banana 2 (Gemini 3 Pro Image) is the configured default.** It stays
the default because it is the model the Layer-1 prompt contract
(`patent-line-art-v1`) was written and unit-tested against — **not** because
it has been shown to draw better than the alternative.

**We have no evidence that either model produces better patent line art.**
No comparison has been run. This document does not claim one is better, and
neither does the registry: `IMAGE_MODEL_REGISTRY` is asserted in
`tests/image-model-selection.test.ts` to contain no "better/superior/best"
claim about either entry.

#### The selection mechanism

`src/lib/server/figures/image-models.ts` is a registry of the image models
the pipeline may call. Selecting one is an environment change:

```
FIGURES_IMAGE_MODEL=gemini-3-pro-image      # default, Nano Banana 2
FIGURES_IMAGE_MODEL=gemini-2.5-flash-image  # the alternative
```

Unset or blank selects the default. An id that is **not** in the registry is
**refused** — the pipeline reports line art unavailable rather than sending
spend to an unpriced model. A typo cannot silently change what you are
billed for.

Each entry carries its **own effective-dated price entry** in
`PROVIDER_PRICE_REGISTRY` (24¢/image for Nano Banana 2, 4¢/image for Gemini
2.5 Flash Image at implementation time — re-check both before live traffic),
and **both bill at the same 2.0 generation multiplier**, because the
multiplier is a property of the task, not the model. `unpricedImageModels()`
returns the registry entries that lack a price; the test suite asserts it is
empty, so a selectable-but-unpriced model fails the build.

#### How to compare output quality

Both models go through the **same Layer-1 hygiene gate** (§2, §5) — the
raster check that rejects any returned image with colour, with solid black
filled areas, or with **any text, numerals, or letters** on it. Neither
model can lower that bar, so a comparison is a comparison of *how often each
one clears it* and *how usable the geometry is once it does*, never of
whether the output is admissible.

To run one:

1. Pick a fixed set of ~10 records that exercise the four view types the
   generative path handles (perspective, plan, elevation, section). Use the
   same records for both models — the prompt is model-independent, so the
   only variable is the model.
2. Run the pipeline with `FIGURES_IMAGE_MODEL` set to each id in turn, with
   `FIGURE_SET_BUDGET_CENTS` raised enough that no run pauses mid-comparison.
3. Read the **raster report** stored on each figure and compare, per model:
   - **hygiene-gate pass rate on first attempt** — how many images came back
     clean without a regenerate. This is the number that drives real cost,
     because a rejected image is billed and discarded.
   - **which rule failed** when one failed: text on the image, colour, or
     solid black. A model that fails on text is a different problem from one
     that fails on fills.
   - **line-weight uniformity and stroke continuity**, from the composed
     sheet — Layer 2 places numerals and lead lines against that geometry,
     so broken or feathered strokes cost more downstream than they look.
4. Compare **effective cost per accepted image**: provider cost × attempts
   ÷ accepted, not the headline per-image rate. A cheaper model that needs
   two attempts is not cheaper.
5. Have a person look at the composed sheets. The hygiene gate is
   mechanical; whether a drawing actually *reads* as the disclosed subject
   is not.

Record the result in `docs/LEDGER-wepatent.md` before changing the default.
Until that comparison exists, the default stands on the prompt-contract
argument alone, and this document says so.

### 7.3 Approve the caps

Confirm `FIGURE_SET_BUDGET_CENTS` and `FIGURES_ORG_DAILY_CAP_CENTS` (§6).
At the defaults, a single draft can generate at most about six accepted
images before pausing.

### 7.4 Turn on automatic triggering for existing customers

```
FIGURES_AUTO_GENERATE=1
```
With this off (the default) figures are still fully available — the studio's
explicit "Generate figures" action runs the same pipeline. With it on, a new
draft version enqueues `figure_plan` automatically with zero user steps, per
the app-wide design rule.

Recommended order: 7.3 → 7.1 on a synthetic record → observe cost → 7.4.

---

## 8. Lex Patent Studio

The shared core is factored and product-neutral; it needs no changes to be
consumed by the professional lane. What remains for Lex:

- a `figure_generation` workflow in the Lex `run` orchestrator, assigned
  **Tier B (draft-for-review)**;
- figure sets entering the Lex review queue, with the existing recorded
  dismissal-reason pattern when approving over failed checks (the wepatent
  surface already requires a reason; Lex should reuse its own component);
- the design-patent rule subset is already implemented and tested
  (`DESIGN-VIEW-SET`, `DESIGN-SHADING-REQUIRED`, `DESIGN-BROKEN-LINES`) and
  activates via `ValidationContext.designPatent`;
- Lex's figure-audit concept should consume `figure_reference_numerals` plus
  `REF-SPEC-TWO-WAY`, which already implements the check in both directions;
- a mirrored migration under `supabase/lex/migrations/`.

**Lex-lane pricing copy is untouched and still accurate**: there is no image
generation in that lane yet, so `provider cost × 1.50` remains correct on
`/pricing`, `/models`, `/professionals`, `/legal/terms`, the root landing
page, and the Lex app surfaces. **When Lex adopts figures, those files must
be switched to the derived disclosure at the same time** — the
disclosure-consistency test in `tests/markup.test.ts` guards the wepatent
surfaces and should be extended to cover the Lex ones in that change.

---

## 9. Data model

Migration `supabase/wepatent/migrations/0012_patent_figures.sql`, applied
live to the wepatent private project and verified post-apply.

- `figure_sets`, `figures`, `figure_reference_numerals`,
  `figure_annotations`, `figure_sheets`, `figure_validations` — all
  `organization_id` + RLS, member-select, **no client write policy**.
- `figure_validations` and `figure_sheets` are **append-only** via
  `app.reject_mutation()`. A validation result is evidence about a specific
  composed output at a specific rules version; amending one would destroy
  the record of what we actually told the customer.
- CHECK constraints hold the formal rules the database can hold: numerals
  match `^[1-9][0-9]*[A-Z]?$` (no brackets, no primes), partial suffixes are
  a single capital letter, sheet *n* never exceeds total *m*.
- `app_jobs.kind` extended with `figure_plan`, `figure_generate`,
  `figure_compose`, `figure_validate`. Today `figure_plan` runs the whole
  pipeline as one durable job; the other three are reserved for a future
  split and have **no executor**, so enqueueing one is refused rather than
  silently dropped.
- `exports.figure_set_id` links the drawing sheets that ride along.
- `usage_events.markup_multiplier_bp` and
  `usage_reservations.markup_multiplier_bp` (basis points, default 15000).
  The old hard-coded `ceil(cost * 1.5)` CHECK is now multiplier-aware;
  historical rows default to 15000, so the new constraint is identical to
  the old one for all existing data.

pgTAP: `supabase/wepatent/tests/08_patent_figures.sql` (45 assertions).

---

## 10. Artifacts

Per sheet: an **SVG** at true physical dimensions (1 user unit = 1 mm),
stored through the existing storage port with a SHA-256 checksum. Plus a
combined **PDF** rendered by `figures/pdf.ts` from the *same* composition
metadata the validator checks, so the two renderings cannot drift apart.
Both are pure JS (pdf-lib, node:zlib) — no native binaries, no headless
browser, serverless-safe.

No new dependencies were added: PNG decoding, PNG encoding, SVG emission and
PDF output are all built on what was already in the tree.

---

## 11. Local / dev mode

`LocalModelGateway.generateLineArt` returns **deterministic synthetic line
art** (`figures/synthetic.ts`) so the entire pipeline — plan, generate,
compose, validate, attach, review, export — runs with no Google credential
and zero spend.

It is an obviously schematic placeholder, seeded from the subject text so it
is stable across runs. It obeys the same constraints real Layer-1 output
must obey (pure black on white, thin uniform lines, no solid fills, **no
text**), so the raster-hygiene gate and the validator are genuinely
exercised.

It is labeled as synthetic in three places: the figure title, the figure-set
provenance (`model_id = local-synthetic-line-art`), and **a legend drawn on
the sheet itself**, so an exported drawing can never be mistaken for real
art.
