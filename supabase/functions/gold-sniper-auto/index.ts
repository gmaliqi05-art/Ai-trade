import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// GoldSniper|FX — DËRGIM AUTOMATIK (cron ~1 min): kur përdoruesi ka auto_send ON, poston vetë te
// kanali i tij sinjalet e REJA të gjeneruara nga MOTORI I PLATFORMËS (tabela 'signals' — robotët e tij).
// Burimi janë sinjalet e VETA të përdoruesit, JO sinjalet e kopjuara nga kanale të tjera.
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
function fmtSignal(header: string, footer: string, s: any): string {
  const dir = String(s.type || "").toLowerCase();
  const dirLabel = dir === "buy" ? "🟢 BUY" : dir === "sell" ? "🔴 SELL" : "";
  const lines: string[] = [];
  if (header) lines.push(header, "");
  if (dirLabel || s.symbol) lines.push(`${dirLabel} <b>${s.symbol || "XAUUSD"}</b>`);
  if (s.entry_price != null) lines.push(`📍 Entry: <b>${s.entry_price}</b>`);
  if (s.stop_loss != null) lines.push(`🛑 SL: <b>${s.stop_loss}</b>`);
  if (s.target_price != null) lines.push(`🎯 TP: <b>${s.target_price}</b>`);
  lines.push("", "Good luck! 🥇");
  if (footer) lines.push("", footer);
  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const { data: cs } = await db.from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
    const secret = (cs as { value?: string } | null)?.value;
    if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "unauthorized" }, 401);
  } catch { return json({ error: "unauthorized" }, 401); }

  // Konfigurimet me dërgim automatik të ndezur dhe kanal të lidhur.
  const { data: cfgs } = await db.from("gold_sniper_config").select("*").eq("auto_send", true);
  const results: unknown[] = [];
  for (const cfg of (cfgs || [])) {
    if (!cfg.bot_token || !cfg.channel_id) continue;
    // Sinjalet e REJA të motorit (15 min të fundit) — të vetat e përdoruesit ose globale të motorit.
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: sigs } = await db.from("signals")
      .select("id, type, symbol, entry_price, target_price, stop_loss, created_at, user_id")
      .eq("status", "active").gte("created_at", since)
      .or(`user_id.eq.${cfg.user_id},user_id.is.null`)
      .order("created_at", { ascending: true }).limit(20);
    let posted = 0;
    for (const s of (sigs || [])) {
      // Idempotencë: mos e posto dy herë të njëjtin sinjal për këtë përdorues.
      const { data: dup } = await db.from("gold_sniper_posts")
        .select("id").eq("user_id", cfg.user_id).eq("source_signal_id", s.id).limit(1);
      if (dup && dup.length > 0) continue;
      const text = fmtSignal(cfg.header || "", cfg.footer || "", s);
      const resp = await fetch(`https://api.telegram.org/bot${cfg.bot_token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cfg.channel_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
      });
      const tg = await resp.json().catch(() => ({}));
      const ok = !!tg.ok;
      await db.from("gold_sniper_posts").insert({
        user_id: cfg.user_id, source_signal_id: s.id, symbol: s.symbol ?? null, direction: s.type ?? null,
        entry: s.entry_price ?? null, stop_loss: s.stop_loss ?? null, tps: s.target_price != null ? [s.target_price] : [],
        message: text, telegram_message_id: ok ? (tg.result?.message_id ?? null) : null,
        status: ok ? "sent" : "failed", error: ok ? null : (tg.description || "dërgimi dështoi"),
      });
      if (ok) posted++;
    }
    results.push({ user: String(cfg.user_id).slice(0, 8), posted });
  }
  return json({ ok: true, results });
});
