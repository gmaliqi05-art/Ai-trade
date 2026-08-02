-- MODELET E EMAIL-EVE — të redaktueshme nga Admini (2 gusht 2026)
--
-- Deri tani tekstet ishin të ngurta brenda funksionit 'send-email'. Tani secili model
-- ruhet në bazë dhe pronari mund ta shohë, ndryshojë, shtojë ose fshijë pa rilëshim.
--
-- Trupi shkruhet me një gjuhë të thjeshtë (jo HTML), që edhe pa njohuri teknike të mos
-- prishet asgjë:
--   • rreshtat bosh ndajnë paragrafët
--   • **tekst i trashë**
--   • [code]{{code}}[/code]              → kutia e madhe e kodit
--   • [button]Etiketa|{{link}}[/button]  → butoni i artë
--   • [rows]Emri|Vlera(një për rresht)[/rows] → tabela e detajeve
--   • {{variabla}}                       → zëvendësohen nga sistemi
--
-- TEKSTET e email-eve janë në ANGLISHT (klientë ndërkombëtarë). Emrat e modeleve
-- mbeten shqip, sepse i sheh vetëm Admini brenda panelit.

-- ---------- Marka & pamja e përbashkët ----------
alter table public.email_config
  add column if not exists brand_name  text not null default 'GoldSniperFX',
  add column if not exists logo_url     text not null default '',
  add column if not exists legal_note   text not null default
    'Trading in financial markets carries a high level of risk and may result in the loss of your capital. GoldSniperFX provides analysis, signals and technology tools for informational and educational purposes — this is not investment advice and no profit is guaranteed. Past performance does not guarantee future results. You remain fully responsible for your own trading decisions.',
  add column if not exists footer_note  text not null default 'Created by MarGroup DE';

update public.email_config
   set from_name = 'GoldSniperFX'
 where id = 1 and from_name in ('GoldSniper', '');

-- ---------- Modelet ----------
create table if not exists public.email_templates (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  name       text not null,
  subject    text not null,
  body       text not null,
  enabled    boolean not null default true,
  -- Modelet e sistemit thirren nga kodi → nuk fshihen dot (por redaktohen lirisht).
  is_system  boolean not null default false,
  sort_order int not null default 100,
  updated_at timestamptz not null default now()
);

alter table public.email_templates enable row level security;

drop policy if exists et_admin_read on public.email_templates;
create policy et_admin_read on public.email_templates for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

drop policy if exists et_admin_write on public.email_templates;
create policy et_admin_write on public.email_templates for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

-- Modelet e sistemit nuk fshihen — mbrojtje edhe nga një klik i pakujdesshëm.
create or replace function public.email_templates_no_delete_system()
returns trigger
language plpgsql
as $$
begin
  if old.is_system then
    raise exception 'Ky model përdoret nga sistemi dhe nuk mund të fshihet. Mund ta çaktivizosh ose ta ndryshosh.';
  end if;
  return old;
end;
$$;

drop trigger if exists et_protect_system on public.email_templates;
create trigger et_protect_system before delete on public.email_templates
  for each row execute function public.email_templates_no_delete_system();

-- ---------- Modelet e parazgjedhura ----------
insert into public.email_templates (key, name, subject, body, is_system, sort_order) values

('verify', 'Kodi i verifikimit', 'Your verification code: {{code}}',
'Hello {{name}},

Thank you for joining **{{brand}}**.

Tap the code below — or the button — and the verification screen opens with your code already filled in:

[code]{{code}}[/code]

[button]Verify my account|{{link}}[/button]

If you prefer, type the 6 digits manually on the verification screen.

The code works only for your account and expires in 24 hours. Never share it — no {{brand}} staff member will ever ask you for it.', true, 10),

('welcome', 'Mirëseardhje', 'Welcome to {{brand}}',
'Hello {{name}},

Your account has been verified. You now have access to:

**Trade Live** — live prices and open positions
**Journal** — your trade history and analysis
**Telegram** — our signals channel
**Signal Setup** — MetaTrader connection and the robot

[button]Open the platform|{{site}}[/button]

Start with the **User Manual** inside the platform — it walks you through every section step by step. Any questions, we are at {{support}}.', true, 20),

('reset', 'Rivendosje fjalëkalimi', 'Reset your password',
'Hello {{name}},

We received a request to reset the password for your {{brand}} account.

[button]Set a new password|{{link}}[/button]

The link expires within one hour and can be used only once.

If you did not request this, simply ignore this email — your password stays unchanged.', true, 30),

('billing', 'Konfirmim abonimi', 'Your {{brand}} subscription is active',
'Hello {{name}},

Your payment was confirmed and your subscription is now active. Thank you for your trust.

[rows]Plan|{{plan}}
Amount|{{amount}}
Start date|{{start}}
Valid until|{{expires}}
Reference|{{invoice}}[/rows]

[button]Open the platform|{{site}}[/button]

You can review and manage your subscription any time under **Settings** inside the platform. This email also serves as your payment confirmation.', true, 40),

('expiry', 'Kujtesë skadimi', 'Your subscription expires on {{expires}}',
'Hello {{name}},

Your {{brand}} subscription expires on **{{expires}}**.

Renew in time so your signals, automated trading and channel access are not interrupted.

[button]Renew subscription|{{site}}[/button]

If you have already renewed, please ignore this reminder.', true, 50),

('expired', 'Abonimi skadoi', 'Your subscription has expired — reactivate in one click',
'Hello {{name}},

Your {{brand}} subscription expired on **{{expires}}**, and access to signals, the robot and the channel is paused for now.

Your data, history and settings are all safely stored — reactivating restores everything instantly.

[button]Reactivate subscription|{{site}}[/button]

If you have any questions before deciding, write to us at {{support}} — we are here.', true, 60),

('renewed', 'Rinovim i abonimit', 'Your subscription has been renewed',
'Hello {{name}},

Your {{brand}} subscription has been renewed successfully. Nothing is interrupted.

[rows]Plan|{{plan}}
Amount|{{amount}}
Valid until|{{expires}}
Reference|{{invoice}}[/rows]

Thank you for staying with us.', true, 70),

('payment_failed', 'Pagesa dështoi', 'Your subscription payment did not go through',
'Hello {{name}},

We tried to charge your {{brand}} subscription, but the payment did not go through.

This usually happens when a card has expired, there are insufficient funds, or the bank blocked the online payment.

[button]Update payment method|{{site}}[/button]

We will try again automatically. To keep your access uninterrupted, please fix it within the next few days.', true, 80),

('canceled', 'Anulim abonimi', 'Your subscription has been canceled',
'Hello {{name}},

Your {{brand}} subscription has been canceled as requested.

Access stays active until **{{expires}}** — until then you can keep using every service as normal.

[button]Reactivate any time|{{site}}[/button]

We are sorry to see you go. If something did not work as it should, tell us at {{support}} — every bit of feedback helps us improve.', true, 90),

('test', 'Provë e lidhjes', 'Test — your Resend connection works',
'This is a test email from the **{{brand}}** admin panel.

If you can see this message with the right logo and styling, then your Resend key, sending domain and templates are all set up correctly.', true, 999)

on conflict (key) do nothing;

-- ---------- Depoja e logos ----------
insert into storage.buckets (id, name, public)
values ('brand', 'brand', true)
on conflict (id) do nothing;

drop policy if exists brand_public_read on storage.objects;
create policy brand_public_read on storage.objects for select
  using (bucket_id = 'brand');

drop policy if exists brand_admin_write on storage.objects;
create policy brand_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'brand'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

drop policy if exists brand_admin_update on storage.objects;
create policy brand_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'brand'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));
