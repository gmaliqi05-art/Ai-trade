import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// LEXUESI I PLATFORMËS (poller): lexon feed-in kuant të pronarit (GoldSniperFX):
//  - /signals  → sinjalet e reja përcillen te 'telegram-signals' (trade + tabela + kanal).
//  - /messages → mesazhet e reja (info/chat, jo sinjal) postohen si TEKST te kanali (pa trade).
// Dedup me tabelën platform_feed_seen (nga uuid). Thirret nga pg_cron (~2s) — gati real-time.
const BASE = "https://ffvpnyddgrupdffrrytu.supabase.co/functions/v1/gsf-quant-feed";
const FEED_SIGNALS = `${BASE}/signals`;
const FEED_MESSAGES = `${BASE}/messages`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Apikey, X-Client-Info",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Numër i qëndrueshëm nga uuid (për idempotencën e tg_message_id te telegram-signals).
function uuidToNum(id: string): number {
  const hex = id.replace(/[^0-9a-f]/gi, "").slice(0, 12);
  const n = parseInt(hex, 16);
  return Number.isFinite(n) ? n : 0;
}

// deno-lint-ignore no-explicit-any
async function fetchList(url: string, key: string): Promise<any[]> {
  try {
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    const j = await resp.json().catch(() => ({}));
    return Array.isArray(j?.[key]) ? j[key] : [];
  } catch { return []; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  const SELF = Deno.env.get("SUPABASE_URL")!;
  const db = createClient(SELF, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Pronari (ai që ka kanalin GoldSniper) + çelësi i webhook-ut + konfigurimi i kanalit.
  const { data: gs } = await db.from("gold_sniper_config").select("*").not("channel_id", "is", null).limit(1).maybeSingle();
  const ownerId = gs?.user_id;
  if (!ownerId) return json({ ok: false, error: "no_owner" });
  const { data: keyRow } = await db.from("telegram_sin_config").select("webhook_secret").eq("user_id", ownerId).maybeSingle();
  const secret = keyRow?.webhook_secret;

  let sent = 0, skipped = 0, msgSent = 0;

  // ---- A) SINJALET → trade + kanal (përmes telegram-signals) ----
  if (secret) {
    const signals = await fetchList(FEED_SIGNALS, "signals");
    for (const s of signals) {
      const fid = String(s.id ?? s.signal_number ?? "");
      if (!fid) { skipped++; continue; }
      const { data: seen } = await db.from("platform_feed_seen").select("feed_id").eq("feed_id", fid).limit(1);
      if (seen && seen.length) { skipped++; continue; }
      const status = String(s.status ?? "").toLowerCase();
      await db.from("platform_feed_seen").insert({ feed_id: fid, signal_number: s.signal_number ?? null, status });
      if (!["active", "open", "new", "pending"].includes(status)) { skipped++; continue; }
      const tps = [s.take_profit_1, s.take_profit_2, s.take_profit_3, s.take_profit_4].filter((x: unknown) => x != null);
      const payload = { signal: {
        direction: String(s.direction ?? "").toLowerCase(), symbol: s.pair ?? s.symbol ?? "XAUUSD",
        entry: s.entry_price ?? null, sl: s.stop_loss ?? null, tps,
        id: uuidToNum(fid) || Number(s.signal_number ?? 0), source: s.source ?? "GoldSniperFX",
      } };
      try {
        await fetch(`${SELF}/functions/v1/telegram-signals?key=${encodeURIComponent(secret)}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        sent++;
      } catch { /* mos e ndal poller-in */ }
    }
  }

  // ---- B) MESAZHET (info/chat) → ROBOTI i lexon (lëviz SL / breakeven / dil) + tekst te kanali ----
  {
    const messages = await fetchList(FEED_MESSAGES, "messages");
    for (const m of messages) {
      const mid = String(m.id ?? "");
      if (!mid) continue;
      const { data: seen } = await db.from("platform_feed_seen").select("feed_id").eq("feed_id", mid).limit(1);
      if (seen && seen.length) continue;
      const type = String(m.type ?? "").toLowerCase();
      await db.from("platform_feed_seen").insert({ feed_id: mid, status: `msg:${type}` });
      if (type === "signal") continue; // sinjalet trajtohen nga /signals (trade)
      const text = String(m.text ?? "").trim();
      if (!text) continue;

      // 1) ROBOTI: mesazhi shkon te telegram-signals ku parseSignal e klasifikon —
      //    modify (lëviz SL / breakeven / ndrysho TP), exit (dil/mbyll), ose koment → injorohet.
      //    Vepron te MT5 për të gjithë përdoruesit (si sinjalet). Formatimi markdown hiqet.
      if (secret) {
        const clean = text.replace(/[`*_]/g, "");
        try {
          await fetch(`${SELF}/functions/v1/telegram-signals?key=${encodeURIComponent(secret)}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signal: { action: "message", message: clean, symbol: "XAUUSD", id: uuidToNum(mid), source: m.source ?? "GoldSniperFX" } }),
          });
        } catch { /* mos e ndal poller-in */ }
      }

      // 2) KANALI: posto tekstin origjinal te kanali (nëse auto_send + bot + kanal).
      if (gs?.auto_send && gs?.bot_token && gs?.channel_id) {
        const resp = await fetch(`https://api.telegram.org/bot${gs.bot_token}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: gs.channel_id, text, disable_web_page_preview: true }),
        });
        const tg = await resp.json().catch(() => ({}));
        await db.from("gold_sniper_posts").insert({
          user_id: ownerId, message: text, note: null,
          telegram_message_id: tg.ok ? (tg.result?.message_id ?? null) : null,
          status: tg.ok ? "sent" : "failed", error: tg.ok ? null : (tg.description || "dërgimi dështoi"),
          source_signal_id: `msg-${mid}`,
        });
        if (tg.ok) msgSent++;
      }
    }
  }

  return json({ ok: true, sent, skipped, msgSent });
});
