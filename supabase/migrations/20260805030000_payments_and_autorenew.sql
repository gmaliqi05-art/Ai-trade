-- PAGESAT E ABONUESVE + RINOVIMI AUTOMATIK (5 gusht 2026)
--
-- Deri tani e vetmja gjurmë e një pagese ishte 'subscription_events' — ngjarja e papërpunuar e
-- Stripe-it, e ruajtur si jsonb. Ajo është e mirë për auditim dhe idempotencë, por e papërdorshme
-- si raport: për të parë sa pagoi kush, duhet gërmuar brenda payload-it të çdo rreshti.
--
-- Prandaj shtohet 'payments': një rresht për çdo faturë, me shumën, planin dhe statusin të nxjerra
-- në kolona. Burimi mbetet po ai — webhook-u i Stripe — thjesht i shkruar në formë të lexueshme.
--
-- Bashkë me të, dy fusha te 'profiles' që u munguan:
--   auto_renew      — a do të rinovohet abonimi vetë kur t'i vijë koha (pasqyron
--                     'cancel_at_period_end' te Stripe, që përdoruesi ta ndalë vetë nga Cilësimet)
--   welcome_seen_at — që mirëseardhja pas pagesës së parë të shfaqet NJË herë, jo në çdo hyrje

-- ---------- 1) PAGESAT ----------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,

  -- Identifikuesit te Stripe. 'stripe_invoice_id' është unik → webhook-u mund të riprovojë pa
  -- krijuar dublikatë (Stripe e ridërgon të njëjtën ngjarje kur përgjigja vonon).
  stripe_invoice_id      text unique,
  stripe_customer_id     text,
  stripe_subscription_id text,
  stripe_session_id      text,

  plan        text not null default '',          -- monthly | yearly
  amount_cents integer not null default 0,       -- gjithmonë në cent, si te Stripe
  currency    text not null default 'eur',
  -- paid = e arkëtuar · failed = karta u refuzua · refunded = u kthye
  status      text not null default 'paid',
  paid_at       timestamptz,
  period_start  timestamptz,
  period_end    timestamptz,
  receipt_url   text,
  invoice_url   text,
  created_at    timestamptz not null default now()
);

create index if not exists payments_user_idx    on public.payments (user_id, paid_at desc);
create index if not exists payments_paid_at_idx on public.payments (paid_at desc);

alter table public.payments enable row level security;

-- Përdoruesi i sheh VETËM pagesat e veta; admini i sheh të gjitha. Shkrimi bëhet nga webhook-u me
-- service-role, i cili e anashkalon RLS-në — ndaj asnjë politikë shkrimi nuk jepet me qëllim.
drop policy if exists payments_read_own on public.payments;
create policy payments_read_own on public.payments for select to authenticated
  using (user_id = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

-- ---------- 2) FUSHAT E PROFILIT ----------
alter table public.profiles add column if not exists auto_renew      boolean not null default true;
alter table public.profiles add column if not exists welcome_seen_at timestamptz;

comment on column public.profiles.auto_renew is
  'Pasqyron të kundërtën e cancel_at_period_end te Stripe: true = abonimi rinovohet vetë.';
comment on column public.profiles.welcome_seen_at is
  'Kur u pa mirëseardhja pas aktivizimit. NULL = ende nuk është parë.';

-- ---------- 3) RAPORTI PËR ADMININ ----------
-- Një rresht për pagesë, me përdoruesin dhe gjendjen e abonimit të tij krahas. Email-i vjen nga
-- auth.users, i palexueshëm nga klienti, prandaj kalon përmes kësaj RPC-je me portë admini.
create or replace function public.admin_payments(p_days integer default 90, p_status text default null)
returns table (
  id uuid, user_id uuid, email text, full_name text,
  plan text, amount_cents integer, currency text, status text,
  paid_at timestamptz, period_end timestamptz,
  receipt_url text, invoice_url text, stripe_invoice_id text,
  sub_tier text, sub_status text, sub_expires_at timestamptz, auto_renew boolean
)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'forbidden';
  end if;
  return query
  select pay.id, pay.user_id, u.email::text, p.full_name,
         pay.plan, pay.amount_cents, pay.currency, pay.status,
         pay.paid_at, pay.period_end,
         pay.receipt_url, pay.invoice_url, pay.stripe_invoice_id,
         p.subscription_tier, p.subscription_status, p.subscription_expires_at,
         coalesce(p.auto_renew, true)
  from public.payments pay
  left join public.profiles p on p.id = pay.user_id
  left join auth.users u      on u.id = pay.user_id
  where coalesce(pay.paid_at, pay.created_at) >= now() - make_interval(days => greatest(p_days, 1))
    and (p_status is null or p_status = '' or pay.status = p_status)
  order by coalesce(pay.paid_at, pay.created_at) desc
  limit 500;
end;
$$;

-- Totalet e dritares. Të ardhurat numërohen VETËM nga pagesat e arkëtuara — një faturë e dështuar
-- nuk është para, sado herë të jetë provuar.
create or replace function public.admin_payments_summary(p_days integer default 90)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
    raise exception 'forbidden';
  end if;
  select jsonb_build_object(
    'days', greatest(p_days, 1),
    'paid_count',   count(*) filter (where status = 'paid'),
    'paid_cents',   coalesce(sum(amount_cents) filter (where status = 'paid'), 0),
    'failed_count', count(*) filter (where status = 'failed'),
    'refunded_cents', coalesce(sum(amount_cents) filter (where status = 'refunded'), 0),
    'payers',       count(distinct user_id) filter (where status = 'paid'),
    'monthly_count', count(*) filter (where status = 'paid' and plan = 'monthly'),
    'yearly_count',  count(*) filter (where status = 'paid' and plan = 'yearly'),
    -- Rinovimi: sa nga abonuesit aktivë e kanë lënë të ndezur.
    'auto_on',  (select count(*) from public.profiles where subscription_expires_at > now() and coalesce(auto_renew,true)),
    'auto_off', (select count(*) from public.profiles where subscription_expires_at > now() and coalesce(auto_renew,true) = false)
  ) into v
  from public.payments
  where coalesce(paid_at, created_at) >= now() - make_interval(days => greatest(p_days, 1));
  return v;
end;
$$;

revoke all on function public.admin_payments(integer, text) from public, anon;
revoke all on function public.admin_payments_summary(integer) from public, anon;
grant execute on function public.admin_payments(integer, text) to authenticated;
grant execute on function public.admin_payments_summary(integer) to authenticated;
