/*
  # Create Super Admin User: maliqigenton@gmail.com

  Creates the super admin account with full platform access.
  - Creates auth.users entry with hashed password
  - Creates profile entry with is_admin = true
  - Subscription tier set to 'premium'
*/

DO $$
DECLARE
  admin_id uuid;
BEGIN
  SELECT id INTO admin_id FROM auth.users WHERE email = 'maliqigenton@gmail.com';

  IF admin_id IS NULL THEN
    admin_id := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      role, aud, confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) VALUES (
      admin_id,
      '00000000-0000-0000-0000-000000000000',
      'maliqigenton@gmail.com',
      crypt('Mymarshop@2018', gen_salt('bf')),
      now(), now(), now(),
      'authenticated', 'authenticated',
      '', '', '', ''
    );
  END IF;

  INSERT INTO public.profiles (id, full_name, username, balance, subscription_tier, is_admin)
  VALUES (admin_id, 'Maliq Igenton', 'maliqigenton', 100000.00, 'premium', true)
  ON CONFLICT (id) DO UPDATE SET
    full_name = 'Maliq Igenton',
    subscription_tier = 'premium',
    is_admin = true;
END $$;
