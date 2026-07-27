import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// GoldSniper|FX — WEBHOOK HYRËS: platforma e VETË përdoruesit (gjeneruesi i tij i sinjaleve) dërgon
// një sinjal këtu (POST ?key=<ingest_secret>) dhe ai postohet automatik te kanali i tij në Telegram.
// Autentikohet me çelësin per-përdorues; nuk kërkon JWT (thirret nga platforma e jashtme e përdoruesit).
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
function fmtSignal(header: string, footer: string, p: any): string {
  const dir = String(p.direction || p.type || "").toLowerCase();
  const dirLabel = dir === "buy" ? "🟢 BUY" : dir === "sell" ? "🔴 SELL" : "";
  const entry = p.entry ?? p.entry_price;
  const sl = p.stop_loss ?? p.sl;
  const tps: number[] = Array.isArray(p.tps) ? p.tps : (p.target_price != null ? [p.target_price] : []);
  const lines: string[] = [];
  if (header) lines.push(header, "");
  if (dirLabel || p.symbol) lines.push(`${dirLabel} <b>${p.symbol || "XAUUSD"}</b>`);
  if (entry != null) lines.push(`📍 Entry: <b>${entry}</b>`);
  if (sl != null) lines.push(`🛑 SL: <b>${sl}</b>`);
  tps.forEach((tp, i) => { if (tp != null) lines.push(`🎯 TP${i + 1}: <b>${tp}</b>`); });
  if (p.note) lines.push("", String(p.note));
  else lines.push("", "Good luck! 🥇");
  if (footer) lines.push("", footer);
  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return json({ ok: true, info: "GoldSniper ingest webhook" });
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  if (!key) return json({ ok: false, error: "missing_key" });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: cfg } = await db.from("gold_sniper_config").select("*").eq("ingest_secret", key).maybeSingle();
  if (!cfg) return json({ ok: false, error: "unknown_key" });
  if (!cfg.bot_token || !cfg.channel_id) return json({ ok: false, error: "not_configured", message: "Lidh botin dhe kanalin te faqja GoldSniper." });

  const body = await req.json().catch(() => ({}));
  // Teksti: ose i dërguar gati (message), ose i formatuar nga fushat strukturore.
  const text = body.message ? String(body.message) : fmtSignal(cfg.header || "", cfg.footer || "", body);

  const resp = await fetch(`https://api.telegram.org/bot${cfg.bot_token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: cfg.channel_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const tg = await resp.json().catch(() => ({}));
  const ok = !!tg.ok;
  const tps: number[] = Array.isArray(body.tps) ? body.tps : (body.target_price != null ? [body.target_price] : []);
  await db.from("gold_sniper_posts").insert({
    user_id: cfg.user_id, symbol: body.symbol ?? null, direction: (body.direction ?? body.type) ?? null,
    entry: (body.entry ?? body.entry_price) ?? null, stop_loss: (body.stop_loss ?? body.sl) ?? null, tps,
    note: body.note ?? null, message: text, telegram_message_id: ok ? (tg.result?.message_id ?? null) : null,
    status: ok ? "sent" : "failed", error: ok ? null : (tg.description || "dërgimi dështoi"),
  });
  if (!ok) return json({ ok: false, error: "telegram", message: tg.description || "Dërgimi dështoi." }, 502);
  return json({ ok: true, message_id: tg.result?.message_id ?? null });
});
