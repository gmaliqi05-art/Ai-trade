import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// GoldSniper|FX — DËRGIM AUTOMATIK: I ÇAKTIVIZUAR (kërkesa e pronarit, 31 korrik 2026).
//
// Ky funksion postonte te kanali Telegram sinjalet e gjeneruara nga MOTORI I PLATFORMËS
// (tabela 'signals' — roboti i sinjaleve/MMT). Pronari kërkoi që sinjalet e krijuara nga
// platforma të MOS dërgohen më në Telegram — në kanal shkojnë VETËM sinjalet e marra nga
// platforma e tij e jashtme GoldSniperFX (rruga: platform-poll → telegram-signals →
// postToOwnerChannel, dhe webhook-u gold-sniper-ingest).
//
// Edhe cron job-i (jobid 22, 'gold-sniper-auto', çdo 1 min) u hoq nga cron.job.
// Funksioni mbetet i deploy-uar si NO-OP që çdo thirrje e mbetur të marrë përgjigje
// të qartë pa postuar asgjë. Historia e plotë e kodit: git log i këtij skedari.
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve((_req: Request) => {
  return json({ ok: true, disabled: true, note: "Postimi automatik i sinjaleve të motorit në Telegram është çaktivizuar — vetëm sinjalet e GoldSniperFX-feed postohen (telegram-signals / gold-sniper-ingest)." });
});
