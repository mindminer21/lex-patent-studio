<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# MULTI-AGENT COORDINATION — READ BEFORE ANY GIT OPERATION

**More than one AI agent works in this repository.** On 2026-08-04, 16 commits of
work (the patent-figure subsystem, three-pass drafting, and seven UX changes)
vanished from a working tree with no reflog trace; the source had to be pulled
back out of a live Vercel deployment. The cause was an ephemeral sandbox rolling
back its own disk — **not** another agent, which had no access to that machine.
The rules below stand anyway, because with several agents and several machines
touching one codebase the same damage is easy to cause on purpose.

**The real lesson of that incident:** work that exists on only one machine is one
disk event away from gone. Push to the shared remote often.

## Absolute prohibitions

Never run any of these in this repository, for any reason:

- `git reset --hard` to a commit that is not the current HEAD's ancestor-of-choice
- `git push --force` / `--force-with-lease` to any shared branch
- `git rebase`, `git commit --amend`, `git filter-branch`, or anything else that
  rewrites published history
- `git checkout <old-commit> -- .` or bulk-reverting the working tree
- deleting or recreating branches

If you believe history must be rewritten, **stop and ask the human.** There is no
deadline that justifies losing another day of work.

## Before you start any session

1. `git log --oneline -15` and `git status`.
2. If HEAD is not what you expect, or the tree contains work you do not recognize,
   **stop and ask** — do not "clean up," do not reset, do not assume the tree is
   stale. Another agent's completed work looks exactly like unfamiliar code.
3. `git branch --show-current`. Work only on the branch you were told to use.

## How work is divided

- Each agent works on its **own branch** off the current head of
  `track/wepatent-app-reconciled`, named `agent/<name>/<topic>`.
- Integration happens by **pull request or explicit human merge only**. Never
  merge or push into a branch another agent is using.
- If two agents must touch the same area, the human sequences them. Do not
  "fix" or "revert" the other agent's code because it looks wrong to you —
  report the concern instead.

## Live infrastructure — changing it affects real systems

This is a **deployed production application.** The following are live and shared;
never mutate them without explicit human authorization in the current session:

- **Supabase (4 projects).** Migrations 0001–0013 (wepatent private
  `jxehyxkcibiqluojeryy`) and 0001–0007 (Lex private `uudmapfdyhgslhjtmhhz`) are
  **already applied to live databases.** Migrations are append-only: add a new
  numbered file, never edit or renumber an existing one, never `DROP` a table or
  column that a prior migration created. The corpus projects hold ~24,700
  ingested documents with embeddings — do not truncate or re-ingest.
- **Vercel** (`prj_5qw3wWsWL2bFgO9nk63QPg4ztV4v`, team "Jeff and Majid"). Do not
  deploy, and do not change environment variables. Note the app reads
  **unprefixed** vars for the wepatent lane (`GEMINI_API_KEY`) and `LEX_*` for the
  Lex lane; setting one does not set the other.
- **Stripe** (test mode, account "ClaimScope"), **OpenAI**, and **Gemini** keys.
  Never print a key, never commit one, never spend without an approved cap.

## Invariants that must survive every change

These are enforced by tests and by database constraints, and several exist for
legal reasons documented in `docs/legal-ethics-risk-memo.md`. If a change of
yours requires weakening one, that is a signal the change is wrong.

1. AI-produced artifacts are `ai_proposed` until a human confirms, edits, or
   deletes them. **AI can never write a confirmed state.**
2. Uploaded and retrieved content is evidence, never instructions
   (prompt-injection resistance).
3. Every model call is metered: estimate → reservation → run → settlement.
   Generation tasks bill at provider cost × 2.0, analysis tasks × 1.5. Any change
   to those numbers must also update every customer-facing disclosure.
4. Nothing files, signs, or transmits anything to the USPTO. No output is ever
   labeled filing-ready. All outputs carry "working draft — counsel review
   required."
5. `counsel_request !== engagement`. No code path may infer representation from
   signup, payment, upload, or scheduling.
6. Tenant isolation: `organization_id` on every row, RLS enforced, cross-tenant
   tests passing.
7. The three-pass drafting flow (Pass 1 + illustrations brief → figures →
   Pass 2 reconciliation) and its delivery gate are the canonical drafting
   process in both products. A Pass-1-only package must never become deliverable.
8. Patent figures: the generative model draws **artwork only** and must produce no
   text; all reference numerals, lead lines, labels, and sheet geometry are
   composed deterministically in code and validated against the 50-rule module.

## Do not weaken verification

Current gates — keep them green and do not lower them:

| Suite | Count |
|---|---|
| wepatent unit | 623 |
| Lex unit | 505 (+8 skipped) |
| wepatent pgTAP | 269 |
| Lex pgTAP | 110 + 7 |
| wepatent E2E | 49 |
| Lex E2E | 16 |

Never delete a valid test, weaken an assertion, loosen a type, or skip a test to
make a build pass. If a test legitimately no longer applies, say so explicitly in
your report and explain why.

## Documentation is the source of truth

`docs/PRD-wepatent.md`, `docs/PRD-lex-patent-studio.md`,
`docs/PRD-wepatent-intake-studio.md`, `docs/PATENT-FIGURES.md`, and
`docs/legal-ethics-risk-memo.md` govern intent. Read the relevant ones before
changing behavior they describe, and update them in the same change when
behavior legitimately changes.
