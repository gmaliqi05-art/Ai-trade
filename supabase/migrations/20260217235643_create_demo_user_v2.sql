
/*
  # Create Demo User

  Creates a demo user account in auth.users and matching profile.
*/

DO $$
DECLARE
  demo_id uuid;
BEGIN
  SELECT id INTO demo_id FROM auth.users WHERE email = 'demo@goldtrade.ai';

  IF demo_id IS NULL THEN
    demo_id := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      role, aud, confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) VALUES (
      demo_id,
      '00000000-0000-0000-0000-000000000000',
      'demo@goldtrade.ai',
      crypt('demo123456', gen_salt('bf')),
      now(), now(), now(),
      'authenticated', 'authenticated',
      '', '', '', ''
    );
  END IF;

  INSERT INTO public.profiles (id, full_name, username, balance, subscription_tier)
  VALUES (demo_id, 'Demo Trader', 'demo', 10000.00, 'pro')
  ON CONFLICT (id) DO UPDATE SET full_name = 'Demo Trader', subscription_tier = 'pro';
END $$;
