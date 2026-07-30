import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// LEXUESI I PLATFORMËS (poller): lexon feed-in kuant të pronarit (GoldSniperFX) dhe përcjell
// sinjalet E REJA te 'telegram-signals' — i njëjti zinxhir: trade në MT5 + tabela/raporte + kanal.
// Dedup me tabelën platform_feed_seen (nga uuid-i i sinjalit). Thirret nga pg_cron (~çdo 15s).
const FEED_URL = "https://ffvpnyddgrupdffrrytu.supabase.co/functions/v1/gsf-quant-feed/signals";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  const SELF = Deno.env.get("SUPABASE_URL")!;
  const db = createClient(SELF, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Çelësi i webhook-ut i PRONARIT (ai që ka kanalin GoldSniper) — për t'i përcjellë sinjalet.
  const { data: gs } = await db.from("gold_sniper_config").select("user_id").not("channel_id", "is", null).limit(1).maybeSingle();
  const ownerId = gs?.user_id;
  if (!ownerId) return json({ ok: false, error: "no_owner" });
  const { data: keyRow } = await db.from("telegram_sin_config").select("webhook_secret").eq("user_id", ownerId).maybeSingle();
  const secret = keyRow?.webhook_secret;
  if (!secret) return json({ ok: false, error: "no_webhook_secret" });

  // Lexo feed-in.
  let feed: Record<string, unknown> = {};
  try {
    const resp = await fetch(FEED_URL, { headers: { Accept: "application/json" } });
    feed = await resp.json().catch(() => ({}));
  } catch (e) { return json({ ok: false, error: "feed_unreachable", detail: String(e) }); }
  // deno-lint-ignore no-explicit-any
  const signals: any[] = Array.isArray((feed as any)?.signals) ? (feed as any).signals : [];

  let sent = 0, skipped = 0;
  for (const s of signals) {
    const fid = String(s.id ?? s.signal_number ?? "");
    if (!fid) { skipped++; continue; }
    const { data: seen } = await db.from("platform_feed_seen").select("feed_id").eq("feed_id", fid).limit(1);
    if (seen && seen.length) { skipped++; continue; }
    const status = String(s.status ?? "").toLowerCase();
    // Shëno si të parë (edhe nëse s'e përcjellim) që të mos ripërpunohet.
    await db.from("platform_feed_seen").insert({ feed_id: fid, signal_number: s.signal_number ?? null, status });
    // Përcjell VETËM hyrjet aktive/të hapura. Të mbyllurat/anuluarat i kapërcejmë.
    if (!["active", "open", "new", "pending"].includes(status)) { skipped++; continue; }

    const tps = [s.take_profit_1, s.take_profit_2, s.take_profit_3, s.take_profit_4].filter((x: unknown) => x != null);
    const payload = {
      signal: {
        direction: String(s.direction ?? "").toLowerCase(),
        symbol: s.pair ?? s.symbol ?? "XAUUSD",
        entry: s.entry_price ?? null,
        sl: s.stop_loss ?? null,
        tps,
        id: uuidToNum(fid) || Number(s.signal_number ?? 0),
        source: s.source ?? "GoldSniperFX",
      },
    };
    try {
      await fetch(`${SELF}/functions/v1/telegram-signals?key=${encodeURIComponent(secret)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      sent++;
    } catch { /* mos e ndal poller-in për një dështim */ }
  }
  return json({ ok: true, total: signals.length, sent, skipped });
});
