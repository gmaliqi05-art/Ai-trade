/*
  # Shto identitete 'email' për përdoruesit seed (rregullim login-i)

  Supabase GoTrue (versionet e reja) kërkon një rresht në `auth.identities` me
  provider = 'email' që login-i me email+fjalëkalim të funksionojë. Migrimet që
  krijuan demo user-in dhe super-admin-in futnin vetëm te `auth.users`, prandaj
  login-i dështonte me "Invalid login credentials".

  Ky migrim shton identitetet që mungojnë, në mënyrë idempotente.
*/

INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT
  gen_random_uuid(),
  u.id::text,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  'email',
  now(), now(), now()
FROM auth.users u
WHERE u.email IN ('demo@goldtrade.ai', 'maliqigenton@gmail.com')
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities i
    WHERE i.user_id = u.id AND i.provider = 'email'
  );
