-- Drop and recreate get_all_profiles with email column added.
-- Must DROP first because return type changes (SETOF profiles → TABLE with email).

DROP FUNCTION IF EXISTS get_all_profiles();

CREATE FUNCTION get_all_profiles()
RETURNS TABLE(
  id uuid,
  full_name text,
  username text,
  avatar_url text,
  balance numeric,
  subscription_tier text,
  is_admin boolean,
  notification_preferences jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  email text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.full_name,
    p.username,
    p.avatar_url,
    p.balance,
    p.subscription_tier,
    p.is_admin,
    p.notification_preferences,
    p.created_at,
    p.updated_at,
    u.email
  FROM profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE EXISTS (
    SELECT 1 FROM profiles adm
    WHERE adm.id = auth.uid() AND adm.is_admin = true
  )
  ORDER BY p.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_all_profiles() TO authenticated;
