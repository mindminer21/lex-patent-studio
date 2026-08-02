# wepatent runbooks

## 1. Local development and verification

```bash
npm ci
npm run dev                    # local mode: credential-free, synthetic data
npm run lint && npm run typecheck
npm test                       # vitest unit/integration
npm run build
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run test:e2e
npm run audit:prod             # production dependency audit (0 findings expected)
npm run scan:secrets           # credential-pattern scan over tracked files
./scripts/test-rls.sh          # RLS pgTAP matrix on a throwaway PostgreSQL 16
npm run verify                 # the full chain
```

Local mode facts: in-memory data (resets on restart), synthetic promo wallet credit,
simulated Stripe checkout/portal that drive the real webhook pipeline, deterministic
synthetic model gateway, counsel-lane seed identities
(`counsel-intake@wepatent.local`, `counsel-attorney@wepatent.local`).

## 2. Production activation (every step approval-gated — PRD §17)

1. **Supabase**: create the private application project AND a separate corpus project.
   Apply `supabase/migrations/*` to the private project and `supabase/corpus/migrations/*`
   to the corpus project. Create the private storage bucket `wepatent-private`.
   Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `CORPUS_SUPABASE_URL`, `CORPUS_SUPABASE_SERVICE_ROLE_KEY`. Run `npx supabase test db`
   against the live stack.
2. **Stripe**: create the account, the products/prices for the FR-6 plan table, and a webhook
   endpoint pointing at `/api/webhooks/stripe`. Set `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`. Subscription checkout also needs the plan→price map passed to
   `StripeBillingAdapter` (`subscriptionPriceIds`).
3. **Model providers**: create OpenAI/Anthropic/xAI accounts under no-training terms
   (legal memo §3); set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`. Confirm the
   effective-dated rates in `PROVIDER_PRICE_REGISTRY` against real provider pricing.
4. Set `APP_MODE=production`, a real `SESSION_SECRET`, `IP_HASH_SALT`, and
   `NEXT_PUBLIC_APP_URL`. Boot fails fast listing anything missing; it also refuses
   local-synthetic secrets and identical private/corpus URLs.
5. **Counsel lane**: write `counsel_assignments` rows via trusted operator process only;
   set `mfa_enrolled=true` only after real Supabase Auth MFA enrollment.
6. Deploy, then re-run the release gates against the deployment (PRD §13).

## 3. Incident controls

| Situation | Action |
|---|---|
| Provider misbehavior / runaway cost | Set `MODEL_GATEWAY_KILL_SWITCH=1` and redeploy/restart — every run is refused at the gateway; reservations release on failure, so no charges occur. |
| One provider degraded | Nothing to do: the per-provider circuit breaker opens after consecutive failures and half-open probes recover automatically. |
| Stripe webhook flood/replay | Signature + timestamp tolerance rejects stale replays; event-id PK dedupes; `billing_outbox` rows with `status='failed'` (attempts ≥ 5) are the retry queue — inspect and re-run `drainBillingOutbox()`. |
| Suspected cross-tenant issue | Check `authz.denied` counter and `api.*` warn logs (correlation IDs); re-run `./scripts/test-rls.sh`; RLS denials in production appear as empty results, never foreign rows. |
| Support needs customer context | Break-glass: set `BREAK_GLASS_ENABLED=1` server-side for the incident, use `breakGlassOrgSnapshot` (metadata only), unset afterwards. Both uses and refused attempts land in `audit_events`. |
| Customer deletion request | Owner soft-deletes the record (or Settings), then Settings → "Run retention purge now" after the window, or lower the retention window first. Purge evidence stays in `audit_events`. |

## 4. Job operations

- Jobs are idempotent by (organization, kind, key); a failed job re-enqueues under the same key
  and can never double-charge (reservation dedupe).
- Job state: `GET /api/jobs/:id`. Logs carry the job id as correlation id;
  `job.failed` log events hold the internal detail that the stored generic summary omits.
- Local runner executes in-process; production swaps the scheduler for a real queue behind the
  same DataPort job records (approval-gated infrastructure).
