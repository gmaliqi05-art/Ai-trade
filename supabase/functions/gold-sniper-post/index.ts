import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// GoldSniper|FX — poston një sinjal te kanali i VETË përdoruesit përmes botit të tij (Telegram).
// bot_token ruhet te DB (RLS user-owned) dhe s'ekspozohet te klienti; postimi bëhet këtu në server.
// Veprime: 'test' (mesazh prove) ose 'post' (sinjal me formatim). Autentikohet me JWT-në e përdoruesit.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function fmtSignal(header: string, footer: string, p: {
  symbol?: string; direction?: string; entry?: number; stop_loss?: number; tps?: number[]; note?: string;
}): string {
  const dir = String(p.direction || "").toLowerCase();
  const dirLabel = dir === "buy" ? "🟢 BUY" : dir === "sell" ? "🔴 SELL" : "";
  const lines: string[] = [];
  if (header) lines.push(header, "");
  if (dirLabel || p.symbol) lines.push(`${dirLabel} <b>${p.symbol || "XAUUSD"}</b>`);
  if (p.entry != null) lines.push(`📍 Entry: <b>${p.entry}</b>`);
  if (p.stop_loss != null) lines.push(`🛑 SL: <b>${p.stop_loss}</b>`);
  (p.tps || []).forEach((tp, i) => { if (tp != null) lines.push(`🎯 TP${i + 1}: <b>${tp}</b>`); });
  if (p.note) lines.push("", p.note);
  if (footer) lines.push("", footer);
  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try {
    const auth = req.headers.get("Authorization") || "";
    const jwt = auth.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Identifiko përdoruesin nga JWT-ja e tij.
    const { data: userRes } = await svc.auth.getUser(jwt);
    const user = userRes?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "post");

    // Konsola "GoldSniperFX": stafi poston te kanali i llogarisë PRONARE (jo te i vet).
    // owner_id pranohet VETËM nga admini ose nga operatori i GoldSniperFX — përndryshe injorohet.
    let ownerId = user.id;
    if (body.owner_id && String(body.owner_id) !== user.id) {
      const { data: me } = await svc.from("profiles").select("is_admin, is_gs_operator").eq("id", user.id).maybeSingle();
      if (!me?.is_admin && !me?.is_gs_operator) return json({ error: "forbidden" }, 403);
      ownerId = String(body.owner_id);
    }

    const { data: cfg } = await svc.from("gold_sniper_config").select("*").eq("user_id", ownerId).maybeSingle();
    if (!cfg || !cfg.bot_token || !cfg.channel_id) return json({ error: "not_configured", message: "Lidh botin dhe kanalin së pari." }, 400);

    let text: string;
    if (action === "test") {
      text = `✅ GoldSniper|FX — connection works. This is a test message.`;
    } else {
      // Teksti: ose i dërguar gati (custom), ose i formatuar nga fushat e sinjalit.
      text = body.message
        ? String(body.message)
        : fmtSignal(cfg.header || "", cfg.footer || "", body);
    }

    const resp = await fetch(`https://api.telegram.org/bot${cfg.bot_token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.channel_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const tg = await resp.json().catch(() => ({}));
    const ok = !!tg.ok;
    const messageId = ok ? tg.result?.message_id ?? null : null;

    if (action !== "test") {
      await svc.from("gold_sniper_posts").insert({
        user_id: ownerId, symbol: body.symbol ?? null, direction: body.direction ?? null,
        entry: body.entry ?? null, stop_loss: body.stop_loss ?? null, tps: body.tps ?? [],
        note: body.note ?? null, message: text, telegram_message_id: messageId,
        status: ok ? "sent" : "failed", error: ok ? null : (tg.description || "dërgimi dështoi"),
      });
    }
    if (!ok) return json({ ok: false, error: "telegram", message: tg.description || "Dërgimi dështoi (kontrollo tokenin/kanalin dhe që boti është admin)." }, 502);
    return json({ ok: true, message_id: messageId });
  } catch (e) {
    return json({ ok: false, error: "internal", message: (e as Error).message }, 500);
  }
});
