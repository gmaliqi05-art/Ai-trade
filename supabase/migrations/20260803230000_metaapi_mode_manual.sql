-- ETIKETA DEMO/LIVE — zbulim automatik + mbivendosje e pronarit (3 gusht 2026)
--
-- Nga PR #563, modaliteti lexohet nga vetë brokeri (account-information → ACCOUNT_TRADE_MODE_*),
-- sepse kolona 'mode' me default 'demo' i etiketonte gabimisht të gjitha llogaritë e reja.
--
-- Por pronari i platformës mban një llogari që e përdor vetë dhe do ta shohë të shënuar ndryshe
-- nga sa e raporton brokeri. Etiketën e sheh VETËM ai që kyçet në atë llogari — çdo përdorues
-- hyn te e veta — ndaj kjo është thjesht preferencë pamjeje e pronarit të llogarisë.
--
-- Zgjidhja mban të dyja, pa i ngatërruar:
--   • mode          → ajo që SHFAQET
--   • mode_detected → ajo që RAPORTON BROKERI (ruhet gjithmonë, edhe kur ka mbivendosje)
--   • mode_manual   → true = zbulimi nuk e prek më 'mode'; false = 'mode' ndjek brokerin
--
-- E vërteta nuk humbet kurrë: 'mode_detected' shkruhet në çdo kontroll lidhjeje, dhe faqja e
-- cilësimeve e tregon krahas etiketës kur të dyja ndryshojnë.

alter table public.metaapi_config
  add column if not exists mode_manual   boolean not null default false,
  add column if not exists mode_detected text;

comment on column public.metaapi_config.mode_manual is
  'true = etiketa DEMO/LIVE e vendos pronari vetë dhe zbulimi NUK e mbishkruan. false = lexohet nga brokeri.';
comment on column public.metaapi_config.mode_detected is
  'Çfarë raporton brokeri realisht (demo/live). Ruhet gjithmonë, edhe kur mode_manual=true — e vërteta nuk humbet.';
