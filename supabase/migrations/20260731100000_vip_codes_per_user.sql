-- Kodet VIP lidhen me PËRDORUES konkret + burimi i privilegjit VIP.
-- Problemi: kodet ishin globale — çdo përdorues i kyçur mund të hapte VIP me kodin e dikujt tjetër,
-- dhe vip-verify i vendoste is_vip=true përgjithmonë (mbyllja e VIP rihapej vetë në refresh).
-- Tani: një kod vlen VETËM për përdoruesin të cilit i është caktuar (user_id); vip_source dallon
-- VIP e dhënë nga admini ('admin' — hapet vetë, pa kod) nga VIP me kod ('code' — mbyllet/rihapet me kod).
-- (Caktimet e të dhënave u bënë direkt live — këtu vetëm skema, pa vlera kodesh.)
alter table public.vip_access_codes
  add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.profiles
  add column if not exists vip_source text;
