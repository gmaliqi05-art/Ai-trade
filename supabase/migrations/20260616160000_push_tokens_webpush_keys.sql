-- ============================================================
-- WEB PUSH: kolonat që mungonin te push_tokens (p256dh, auth).
-- Frontend-i (src/services/push.ts) i ruan këto gjatë abonimit; pa to upsert-i
-- dështonte → "Gabim gjatë aktivizimit" dhe butoni nuk funksiononte.
-- (Çelësat VAPID -- vapid_public/vapid_private/vapid_subject -- vendosen
--  OPERACIONALISHT te app_config, jo në Git, njësoj si cron_secret.)
-- ============================================================
ALTER TABLE public.push_tokens ADD COLUMN IF NOT EXISTS p256dh text;
ALTER TABLE public.push_tokens ADD COLUMN IF NOT EXISTS auth   text;
