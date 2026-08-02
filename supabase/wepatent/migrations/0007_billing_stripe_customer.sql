-- 0007: Stripe customer mapping for the Customer Portal seam (FR-6).
--
-- The organization's Stripe customer id is learned from the first
-- checkout.session.completed webhook and is required to open a Customer
-- Portal session. Server-only trusted logic writes it; members may read
-- their own wallet row under the existing wallet_accounts policies.

alter table public.wallet_accounts
  add column if not exists stripe_customer_id text;

comment on column public.wallet_accounts.stripe_customer_id is
  'Stripe customer id for this organization (set by webhook processing; server-only writes).';
