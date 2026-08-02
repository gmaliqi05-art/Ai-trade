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

-- ---------- Marka & pamja e përbashkët ----------
alter table public.email_config
  add column if not exists brand_name  text not null default 'GoldSniperFX',
  add column if not exists logo_url     text not null default '',
  add column if not exists legal_note   text not null default
    'Tregtimi në tregjet financiare mbart rrezik të lartë dhe mund të çojë në humbjen e kapitalit. GoldSniperFX ofron analiza, sinjale dhe mjete teknologjike për qëllime informative dhe edukative — nuk është këshillë investimi dhe nuk garanton asnjë fitim. Performanca e kaluar nuk garanton rezultate të ardhshme. Ti mban përgjegjësi të plotë për vendimet e tua të tregtimit.',
  add column if not exists footer_note  text not null default 'Krijuar nga MarGroup DE';

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

('verify', 'Kodi i verifikimit', 'Kodi yt i verifikimit: {{code}}',
'Përshëndetje {{name}},

Faleminderit që u bashkove me **{{brand}}**.

Vendos këtë kod 6-shifror në ekranin e verifikimit për të hapur platformën:

[code]{{code}}[/code]

Kodi vlen vetëm për llogarinë tënde dhe skadon pas 24 orësh. Mos ia jep askujt — asnjë punonjës i {{brand}} nuk do të ta kërkojë kurrë.', true, 10),

('welcome', 'Mirëseardhje', 'Mirë se erdhe në {{brand}}',
'Përshëndetje {{name}},

Llogaria jote u verifikua me sukses. Që tani ke qasje te:

**Trade Live** — çmimet dhe pozicionet në kohë reale
**Journal** — historiku dhe analiza e tregtive të tua
**Telegram** — kanali ynë i sinjaleve
**Konfigurimi i Sinjaleve** — lidhja me MetaTrader dhe roboti

[button]Hap platformën|{{site}}[/button]

Nis me **Manualin e përdorimit** brenda platformës — të shpjegon hap pas hapi çdo pjesë. Për çdo pyetje jemi te {{support}}.', true, 20),

('reset', 'Rivendosje fjalëkalimi', 'Rivendos fjalëkalimin e llogarisë sate',
'Përshëndetje {{name}},

Morëm një kërkesë për të rivendosur fjalëkalimin e llogarisë sate te {{brand}}.

[button]Vendos fjalëkalim të ri|{{link}}[/button]

Lidhja skadon brenda një ore dhe përdoret vetëm një herë.

Nëse nuk e ke kërkuar ti, injoroje këtë email — fjalëkalimi yt nuk ndryshon.', true, 30),

('billing', 'Konfirmim abonimi', 'Abonimi yt në {{brand}} është aktiv',
'Përshëndetje {{name}},

Pagesa u konfirmua dhe abonimi yt është aktivizuar. Faleminderit për besimin.

[rows]Plani|{{plan}}
Shuma|{{amount}}
Data e fillimit|{{start}}
Vlen deri më|{{expires}}
Referenca|{{invoice}}[/rows]

[button]Hap platformën|{{site}}[/button]

Abonimin mund ta shohësh dhe menaxhosh kurdo te **Cilësimet** brenda platformës. Ky email shërben edhe si konfirmim i pagesës.', true, 40),

('expiry', 'Kujtesë skadimi', 'Abonimi yt skadon më {{expires}}',
'Përshëndetje {{name}},

Abonimi yt te {{brand}} skadon më **{{expires}}**.

Rinovoje me kohë që sinjalet, tregtimi automatik dhe qasja te kanali të mos ndërpriten.

[button]Rinovo abonimin|{{site}}[/button]

Nëse e ke rinovuar tashmë, injoroje këtë kujtesë.', true, 50),

('expired', 'Abonimi skadoi', 'Abonimi yt skadoi — riaktivizoje me një klik',
'Përshëndetje {{name}},

Abonimi yt te {{brand}} skadoi më **{{expires}}** dhe qasja te sinjalet, roboti dhe kanali është ndërprerë përkohësisht.

Të dhënat, historiku dhe konfigurimet e tua janë ruajtur të plota — riaktivizimi i rikthen të gjitha menjëherë.

[button]Riaktivizo abonimin|{{site}}[/button]

Nëse ke ndonjë pyetje para se të vendosësh, shkruajna te {{support}} — jemi këtu.', true, 60),

('renewed', 'Rinovim i abonimit', 'Abonimi yt u rinovua',
'Përshëndetje {{name}},

Abonimi yt te {{brand}} u rinovua me sukses. Asgjë nuk ndërpritet.

[rows]Plani|{{plan}}
Shuma|{{amount}}
Vlen deri më|{{expires}}
Referenca|{{invoice}}[/rows]

Faleminderit që vazhdon me ne.', true, 70),

('payment_failed', 'Pagesa dështoi', 'Pagesa e abonimit nuk u krye',
'Përshëndetje {{name}},

Provuam të tërheqim pagesën e abonimit tënd te {{brand}}, por transaksioni nuk u krye.

Zakonisht kjo ndodh kur karta ka skaduar, nuk ka fonde të mjaftueshme ose banka e ka bllokuar pagesën online.

[button]Përditëso mënyrën e pagesës|{{site}}[/button]

Do të provojmë sërish automatikisht. Që qasja të mos ndërpritet, rregulloje brenda pak ditësh.', true, 80),

('canceled', 'Anulim abonimi', 'Abonimi yt u anulua',
'Përshëndetje {{name}},

Abonimi yt te {{brand}} u anulua sipas kërkesës.

Qasja mbetet aktive deri më **{{expires}}** — deri atëherë vazhdon t''i përdorësh të gjitha shërbimet normalisht.

[button]Riaktivizo kurdo|{{site}}[/button]

Na vjen keq që po ndahemi. Nëse diçka nuk shkoi si duhet, na e thuaj te {{support}} — çdo mendim na ndihmon të përmirësohemi.', true, 90),

('test', 'Provë e lidhjes', 'Provë — lidhja me Resend punon',
'Ky është një email prove nga paneli i administrimit të **{{brand}}**.

Nëse e sheh këtë mesazh me logon dhe pamjen e duhur, atëherë çelësi i Resend, domeni i dërgimit dhe modelet janë konfiguruar saktë.', true, 999)

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
