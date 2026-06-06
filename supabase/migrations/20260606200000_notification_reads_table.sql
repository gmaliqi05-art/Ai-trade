-- Gjurmim server-side i njoftimeve broadcast të lexuara nga secili përdorues.
-- Broadcast-et janë një rresht i përbashkët dhe RLS s'lejon update të 'is_read' nga përdoruesi,
-- prandaj para kësaj ruheshin vetëm në localStorage (humbeshin pas logout/clear/PWA).
CREATE TABLE IF NOT EXISTS notification_reads (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);
ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users select own notification reads" ON notification_reads;
CREATE POLICY "users select own notification reads" ON notification_reads
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users insert own notification reads" ON notification_reads;
CREATE POLICY "users insert own notification reads" ON notification_reads
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users delete own notification reads" ON notification_reads;
CREATE POLICY "users delete own notification reads" ON notification_reads
  FOR DELETE USING (auth.uid() = user_id);
