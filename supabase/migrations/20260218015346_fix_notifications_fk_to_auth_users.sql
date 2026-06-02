/*
  # Fix notifications FK to auth.users

  notifications.user_id was referencing profiles(id) which causes insert failures
  when profile doesn't exist yet. Changed to reference auth.users(id).
*/

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
