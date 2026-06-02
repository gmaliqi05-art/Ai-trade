/*
  # Fix infinite recursion in profiles RLS policies

  The current SELECT and UPDATE policies on profiles contain a subquery
  that references the profiles table itself, causing infinite recursion.

  Fix: Replace subquery-based admin check with auth.jwt() metadata check,
  or use a simple uid() check. Admin access to other profiles is handled
  via service role in edge functions, not via RLS subqueries.
*/

DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
