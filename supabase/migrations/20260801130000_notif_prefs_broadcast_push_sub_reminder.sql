-- (1) Kujtesa e abonimit: data e skadimit + gjurma e kujtesës së dërguar (1 javë para).
alter table public.profiles
  add column if not exists subscription_expires_at timestamptz,
  add column if not exists sub_reminder_sent_at timestamptz;

-- (2) Push automatik për MESAZHET e platformës (broadcast): kur futet një njoftim broadcast,
-- dërgohet web push te të gjithë që kanë preferencën 'messages' aktive.
create or replace function public.notify_broadcast_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare secret text;
begin
  if new.is_broadcast then
    select value into secret from app_config where key = 'cron_secret';
    if secret is not null then
      perform net.http_post(
        url := 'https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/web-push-send',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',secret),
        body := jsonb_build_object('audience','all','pref','messages',
          'title', coalesce(new.title,'GOLDTRADE'), 'body', coalesce(new.body,''), 'url','/', 'tag','broadcast')
      );
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_broadcast_push on public.notifications;
create trigger trg_broadcast_push after insert on public.notifications
for each row execute function public.notify_broadcast_push();

-- (3) Cron ditor për kujtesën e abonimit (08:00 UTC).
do $$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'subscription-reminder-daily' limit 1;
  if jid is not null then perform cron.unschedule(jid); end if;
  perform cron.schedule('subscription-reminder-daily', '0 8 * * *', $cmd$
    select net.http_post(
      url := 'https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/subscription-reminder',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from app_config where key='cron_secret')),
      body := '{}'::jsonb);
  $cmd$);
end $$;
