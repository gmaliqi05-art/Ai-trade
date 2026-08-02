-- SISTEMI I SUPORTIT (2 gusht 2026)
-- Klienti hap bileta (tickets) nga faqja Suport; Admini i sheh dhe përgjigjet te faqja e vet.
-- Email-i zyrtar: support@goldsniper.vip (shfaqet në UI; biseda kryhet brenda platformës).

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null,
  status text not null default 'open' check (status in ('open','answered','closed')),
  unread_by_admin boolean not null default true,
  unread_by_user boolean not null default false,
  created_at timestamptz not null default now(),
  last_msg_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender text not null check (sender in ('user','admin')),
  sender_id uuid not null,
  body text not null check (length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index if not exists support_messages_ticket_idx on public.support_messages(ticket_id, created_at);
create index if not exists support_tickets_user_idx on public.support_tickets(user_id, last_msg_at desc);

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;

-- Klienti: vetëm biletat e veta.
create policy st_user_select on public.support_tickets for select to authenticated
  using (auth.uid() = user_id);
create policy st_user_insert on public.support_tickets for insert to authenticated
  with check (auth.uid() = user_id);
create policy st_user_update on public.support_tickets for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy sm_user_select on public.support_messages for select to authenticated
  using (exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid()));
create policy sm_user_insert on public.support_messages for insert to authenticated
  with check (sender = 'user' and sender_id = auth.uid()
              and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid()));

-- Admini: gjithçka.
create policy st_admin_all on public.support_tickets for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));
create policy sm_admin_all on public.support_messages for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

-- Admini mund t'i lërë klientit një njoftim te zilja kur i përgjigjet biletës.
create policy notif_admin_insert on public.notifications for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));
