-- platform_feed_seen: MBYLLET NGA JASHTË (5 gusht 2026)
--
-- Kjo tabelë s'mban të dhëna personale — vetëm çelësa idempotence. Pikërisht aty qëndronte rreziku:
-- roli 'anon' (çelësi i të cilit ndodhet te bundle-i publik i faqes) kishte SELECT, INSERT, UPDATE
-- dhe DELETE mbi të, pa asnjë RLS. Kush e dinte skemën mund të:
--
--   · SHTONTE çelësa paraprakisht ('mid:…' ose 'fp:msg:…') → 'telegram-signals' e sheh sinjalin ose
--     urdhrin si dublikatë dhe DEL menjëherë. Pra një "Cancel BUY" mund të bllokohej para se të
--     ekzekutohej, dhe në raport do të dukej thjesht si "duplicate";
--   · FSHINTE çelësa → i njëjti sinjal ekzekutohet dy herë, pra tregti të dyfishta te llogaritë.
--
-- Të dyja prekin drejtpërdrejt paratë, dhe asnjëra nuk do të linte gjurmë si sulm.
--
-- Zgjidhja është ajo e provuar te 'billing_secrets' dhe 'email_secrets': RLS i ndezur PA asnjë
-- politikë. Atëherë nuk e prek dot as 'anon' as 'authenticated'; 'service_role' e anashkalon RLS-në
-- gjithsesi, dhe të dy funksionet që e përdorin ('platform-poll', 'telegram-signals') punojnë me
-- service-role. Fronti nuk e prek fare këtë tabelë — u verifikua para ndryshimit.
alter table public.platform_feed_seen enable row level security;

revoke all on public.platform_feed_seen from anon, authenticated;
