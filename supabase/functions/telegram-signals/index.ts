import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ================= Telegram Sin =================
// Webhook që Telegram e thërret sapo trejderat dërgojnë një mesazh. Rrjedha:
//   Telegram → POST .../telegram-signals?key=<webhook_secret> → identifiko përdoruesin →
//   parso mesazhin (BUY/SELL, simbol, Entry, SL, TP1..TPn) → ekzekuto në MetaApi (market) →
//   ruaj në telegram_signals + telegram_trades. Mesazh "close/exit/dil" → mbyll pozicionet.
// Ri-përdor TË NJËJTIN mekanizëm si roboti i Sinjaleve (auth-token te MetaApi, POST /trade).

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Telegram-Bot-Api-Secret-Token",
};
function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}

const TG_TAG = "TG"; // comment te pozicionet e hapura nga Telegram Sin (për t'i identifikuar te mbyllja/raportet)

// ---------- MetaApi helpers (identike me robotin e Sinjaleve) ----------
interface Cfg {
  user_id: string; account_id: string; token: string; region: string; mode: string;
  default_lot?: number; max_lot?: number; symbol_map?: Record<string, string> | null;
}
function host(region: string) {
  return `https://mt-client-api-v1.${(region || "new-york").trim()}.agiliumtrade.ai`;
}
async function maGet(cfg: Cfg, path: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(`${host(cfg.region)}/users/current/accounts/${cfg.account_id}${path}`, {
        headers: { "auth-token": cfg.token }, signal: AbortSignal.timeout(15000),
      });
      const txt = await resp.text();
      let body: unknown = txt; try { body = JSON.parse(txt); } catch { /* */ }
      if (resp.status === 429 || resp.status === 502 || resp.status === 503) { /* retry */ }
      else if (!resp.ok) throw new Error(`MetaApi ${resp.status}`);
      else return body;
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/^MetaApi \d{3}$/.test(msg)) throw e;
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  throw new Error("MetaApi unreachable");
}
async function maTrade(cfg: Cfg, body: Record<string, unknown>) {
  const resp = await fetch(`${host(cfg.region)}/users/current/accounts/${cfg.account_id}/trade`, {
    method: "POST", headers: { "auth-token": cfg.token, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  const txt = await resp.text();
  let b: unknown = txt; try { b = JSON.parse(txt); } catch { /* */ }
  return { ok: resp.ok, status: resp.status, body: b };
}
function brokerResult(body: unknown): { ok: boolean; code: number; msg: string; orderId: string | null; positionId: string | null } {
  const o = (body ?? {}) as Record<string, unknown>;
  const code = Number(o.numericCode);
  const orderId = (o.orderId as string) ?? null;
  const positionId = (o.positionId as string) ?? null;
  const msg = String(o.message ?? "");
  const ok = code === 10009 || code === 10008 || code === 10010 || ((!!orderId || !!positionId) && !Number.isFinite(code));
  return { ok, code, msg, orderId: orderId ?? positionId, positionId };
}
async function livePrice(cfg: Cfg, sym: string): Promise<{ bid: number; ask: number } | null> {
  try {
    const p = await maGet(cfg, `/symbols/${encodeURIComponent(sym)}/current-price`) as { ask?: number; bid?: number };
    const ask = Number(p?.ask), bid = Number(p?.bid);
    if (Number.isFinite(ask) && Number.isFinite(bid) && ask > 0 && bid > 0) return { bid, ask };
  } catch { /* */ }
  return null;
}
// Zgjidh emrin REAL të simbolit te brokeri (XAUUSD → XAUUSD+), me cache te symbol_map.
const symCache = new Map<string, string>();
async function resolveSymbol(cfg: Cfg, requested: string, db: ReturnType<typeof createClient>): Promise<string> {
  const want = (requested || "").toUpperCase().trim();
  const ck = `${cfg.account_id}:${want}`;
  if (symCache.has(ck)) return symCache.get(ck)!;
  const map = (cfg.symbol_map || {}) as Record<string, string>;
  if (map[want]) { symCache.set(ck, map[want]); return map[want]; }
  let names: string[] = [];
  try { const arr = await maGet(cfg, "/symbols"); if (Array.isArray(arr)) names = arr.map((s) => String(s)); } catch { /* */ }
  const isGold = /XAU|GOLD|ARI/.test(want);
  let pick = names.find((n) => n.toUpperCase() === want)
    || names.find((n) => n.toUpperCase().startsWith(want))
    || (isGold ? names.find((n) => /XAUUSD/i.test(n)) : undefined);
  const chosen = pick || want;
  symCache.set(ck, chosen);
  if (chosen !== want) {
    try { await db.from("metaapi_config").update({ symbol_map: { ...map, [want]: chosen } }).eq("user_id", cfg.user_id); } catch { /* */ }
  }
  return chosen;
}

// ---------- Parser i mesazheve ----------
interface Parsed {
  kind: "entry" | "exit" | "unknown";
  symbol: string | null;
  direction: "buy" | "sell" | null;
  entryType: "market" | "limit";
  entryPrice: number | null;
  stopLoss: number | null;
  tps: number[];
}
const SYMBOL_ALIASES: Array<[RegExp, string]> = [
  [/\b(xauusd|xau\/usd|gold|ari|floriri)\b/i, "XAUUSD"],
  [/\b(xagusd|silver|argjend)\b/i, "XAGUSD"],
  [/\b(eurusd|eur\/usd)\b/i, "EURUSD"],
  [/\b(gbpusd|gbp\/usd)\b/i, "GBPUSD"],
  [/\b(usdjpy|usd\/jpy)\b/i, "USDJPY"],
  [/\b(btcusd|bitcoin|btc)\b/i, "BTCUSD"],
  [/\b(usoil|wti|oil|nafte|nafta)\b/i, "USOIL"],
];
function nums(re: RegExp, text: string): number[] {
  const out: number[] = [];
  let m: RegExpExecArray | null;
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = r.exec(text)) !== null) { const v = parseFloat(m[1]); if (Number.isFinite(v)) out.push(v); }
  return out;
}
function parseSignal(raw: string, defaultSymbol: string): Parsed {
  const text = (raw || "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const low = text.toLowerCase();

  // Simboli
  let symbol: string | null = null;
  for (const [re, name] of SYMBOL_ALIASES) { if (re.test(low)) { symbol = name; break; } }

  // Dalje (exit)
  const isExit = /\b(close|exit|mbyll|mbylle|dil|dil nga|closed|tp hit|sl hit)\b/i.test(low)
    && !/\b(buy|sell|long|short|blej|shit)\b/i.test(low);
  if (isExit) return { kind: "exit", symbol: symbol ?? defaultSymbol, direction: null, entryType: "market", entryPrice: null, stopLoss: null, tps: [] };

  // Drejtimi
  let direction: "buy" | "sell" | null = null;
  if (/\b(buy|long|blej)\b/i.test(low)) direction = "buy";
  else if (/\b(sell|short|shit)\b/i.test(low)) direction = "sell";
  if (!direction) return { kind: "unknown", symbol, direction: null, entryType: "market", entryPrice: null, stopLoss: null, tps: [] };

  if (!symbol) symbol = defaultSymbol;

  // Entry
  let entryType: "market" | "limit" = "market";
  let entryPrice: number | null = null;
  if (/\b(now|market|current|menjehere|tani)\b/i.test(low)) entryType = "market";
  const eMatch = low.match(/(?:entry|@|zone|hyrje|price)\s*:?\s*(\d{2,7}(?:\.\d+)?)/i)
    || low.match(/\b(?:buy|sell|blej|shit|long|short)\s*(?:limit|stop)?\s*:?\s*@?\s*(\d{2,7}(?:\.\d+)?)/i);
  if (eMatch) { entryPrice = parseFloat(eMatch[1]); if (/limit|stop/i.test(low)) entryType = "limit"; }

  // Stop-loss
  let stopLoss: number | null = null;
  const slMatch = low.match(/(?:sl|s\/l|stop\s*loss|stoploss|stop|ndalese)\s*:?\s*(\d{2,7}(?:\.\d+)?)/i);
  if (slMatch) stopLoss = parseFloat(slMatch[1]);

  // Take-profit(s) — TP, TP1..TP4, target; mbledh të gjitha numrat pas fjalëve TP
  const tpSet: number[] = [];
  const tpRe = /(?:tp\s*\d?|take\s*profit|target|objektiv)\s*:?\s*((?:\d{2,7}(?:\.\d+)?\s*)+)/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tpRe.exec(low)) !== null) {
    for (const v of nums(/(\d{2,7}(?:\.\d+)?)/, tm[1])) if (!tpSet.includes(v)) tpSet.push(v);
  }
  // Rendit TP-t në drejtimin e trade-it (BUY rritës, SELL rënës)
  const tps = tpSet.sort((a, b) => (direction === "buy" ? a - b : b - a));

  return { kind: "entry", symbol, direction, entryType, entryPrice, stopLoss, tps };
}

// ---------- Dërgo përgjigje te Telegram (konfirmim) ----------
async function tgReply(botToken: string, chatId: string | number, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* jo-kritik */ }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return json({ ok: true, info: "Telegram Sin webhook" });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 1) Identifiko përdoruesin nga ?key=<webhook_secret>
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  if (!key) return json({ ok: false, error: "missing_key" }, 200); // 200 që Telegram të mos ri-provojë pafund
  const { data: cfgRow } = await db.from("telegram_sin_config").select("*").eq("webhook_secret", key).maybeSingle();
  if (!cfgRow) return json({ ok: false, error: "unknown_key" }, 200);

  // Verifikim shtesë: header-i secret_token i Telegram-it (nëse është vendosur)
  const hdr = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (hdr && cfgRow.webhook_secret && hdr !== cfgRow.webhook_secret) return json({ ok: false, error: "bad_secret" }, 200);

  const update = await req.json().catch(() => ({}));
  const msg = update.message || update.channel_post || update.edited_message || null;
  if (!msg) return json({ ok: true, skip: "no_message" });
  const text: string = msg.text || msg.caption || "";
  const chatId = String(msg.chat?.id ?? "");
  const messageId = Number(msg.message_id ?? 0);
  const sender = String(msg.from?.username || msg.from?.id || msg.sender_chat?.title || "");

  // 2) Filtrim burimi (nëse konfiguruar)
  const allowChats: string[] = cfgRow.allowed_chat_ids || [];
  const allowSenders: string[] = cfgRow.allowed_senders || [];
  if (allowChats.length > 0 && !allowChats.includes(chatId)) return json({ ok: true, skip: "chat_not_allowed", chatId });
  if (allowSenders.length > 0 && sender && !allowSenders.map((s) => s.toLowerCase()).includes(sender.toLowerCase()))
    return json({ ok: true, skip: "sender_not_allowed", sender });

  // 3) Idempotencë — mos ekzekto dy herë të njëjtin mesazh (Telegram ri-provon në timeout)
  if (messageId) {
    const { data: dup } = await db.from("telegram_signals").select("id")
      .eq("user_id", cfgRow.user_id).eq("tg_message_id", messageId).limit(1);
    if (dup && dup.length > 0) return json({ ok: true, skip: "duplicate" });
  }

  // 4) Parso
  const p = parseSignal(text, cfgRow.symbol_default || "XAUUSD");
  const { data: sigRow } = await db.from("telegram_signals").insert({
    user_id: cfgRow.user_id, tg_chat_id: chatId, tg_message_id: messageId || null, tg_sender: sender,
    raw_text: text, kind: p.kind, symbol: p.symbol, direction: p.direction,
    entry_type: p.entryType, entry_price: p.entryPrice, stop_loss: p.stopLoss, tps: p.tps, status: "received",
  }).select("id").maybeSingle();
  const signalId = sigRow?.id ?? null;

  const finish = async (status: string, error: string | null) => {
    if (signalId) await db.from("telegram_signals").update({ status, error }).eq("id", signalId);
  };

  if (p.kind === "unknown") { await finish("ignored", "s'u njoh si sinjal (pa BUY/SELL)"); return json({ ok: true, kind: "unknown" }); }
  if (!cfgRow.active) { await finish("ignored", "Telegram Sin joaktiv"); return json({ ok: true, skip: "inactive" }); }

  // Ngarko konfigurimin MetaApi të përdoruesit (tregton në llogarinë e tij — si te Trade Live)
  const { data: mcfg } = await db.from("metaapi_config").select("*").eq("user_id", cfgRow.user_id).maybeSingle();
  if (!mcfg || !mcfg.account_id || !mcfg.token) { await finish("rejected", "MetaApi s'është konfiguruar"); return json({ ok: true, error: "no_metaapi" }); }
  const cfg = mcfg as unknown as Cfg;

  const tradeSym = await resolveSymbol(cfg, p.symbol || "XAUUSD", db);

  // ===== DALJE: mbyll pozicionet e Telegram Sin për këtë simbol =====
  if (p.kind === "exit") {
    const { data: openTrades } = await db.from("telegram_trades").select("*")
      .eq("user_id", cfgRow.user_id).eq("status", "open");
    const norm = (s: string) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const isGold = (s: string) => /XAU|GOLD|ARI/i.test(s || "");
    const same = (a: string, b: string) => norm(a) === norm(b) || (isGold(a) && isGold(b));
    const toClose = (openTrades || []).filter((t) => same(t.symbol || "", tradeSym) || same(t.symbol || "", p.symbol || ""));
    let closed = 0;
    for (const t of toClose) {
      if (!t.metaapi_position_id) continue;
      const r = await maTrade(cfg, { actionType: "POSITION_CLOSE_ID", positionId: t.metaapi_position_id });
      const br = brokerResult(r.body);
      if (r.ok && (br.ok || /position.*not.*found/i.test(br.msg))) {
        await db.from("telegram_trades").update({ status: "closed", closed_at: new Date().toISOString(), reason: "Telegram: exit" }).eq("id", t.id);
        closed++;
      }
    }
    await finish(closed > 0 ? "closed" : "ignored", closed > 0 ? null : "asnjë pozicion i hapur për mbyllje");
    if (cfgRow.bot_token) await tgReply(cfgRow.bot_token, chatId, `✅ Telegram Sin: u mbyllën <b>${closed}</b> pozicione (${tradeSym}).`);
    return json({ ok: true, kind: "exit", closed });
  }

  // ===== HYRJE =====
  const isBuy = p.direction === "buy";
  const lp = await livePrice(cfg, tradeSym);
  const ref = lp ? (isBuy ? lp.ask : lp.bid) : (p.entryPrice ?? 0);
  if (!(ref > 0)) { await finish("rejected", "s'mora çmim live nga MetaApi"); return json({ ok: true, error: "no_price" }); }

  // SL: nga sinjali, ose fallback (entry ∓ fallback_sl_usd). Pa SL të vlefshëm → refuzo (siguri).
  let sl = p.stopLoss;
  const fb = Number(cfgRow.fallback_sl_usd) || 0;
  if (!(Number(sl) > 0) && fb > 0) sl = isBuy ? ref - fb : ref + fb;
  if (!(Number(sl) > 0)) { await finish("rejected", "pa stop-loss (as nga sinjali as fallback) — refuzuar për siguri"); return json({ ok: true, error: "no_sl" }); }
  // Siguro që SL është në anën e duhur
  if (isBuy && sl! >= ref) sl = ref - (fb > 0 ? fb : ref * 0.005);
  if (!isBuy && sl! <= ref) sl = ref + (fb > 0 ? fb : ref * 0.005);
  sl = Math.round(sl! * 100) / 100;

  // TP-t e vlefshëm (në anën e duhur ndaj çmimit); nëse s'ka, një TP i vetëm 2×SL-distancë
  const slDist = Math.abs(ref - sl);
  let validTps = p.tps.filter((tp) => (isBuy ? tp > ref : tp < ref));
  if (validTps.length === 0) validTps = [Math.round((isBuy ? ref + slDist * 2 : ref - slDist * 2) * 100) / 100];

  // Mënyra e TP-ve
  const mode = cfgRow.tp_mode || "multi";
  let plan: Array<{ tp: number; vol: number; idx: number }> = [];
  const baseLot = Math.max(Number(cfgRow.lot) || 0.01, 0.01);
  if (mode === "first") {
    plan = [{ tp: validTps[0], vol: baseLot, idx: 1 }];
  } else if (mode === "split") {
    const each = Math.max(Math.floor((baseLot / validTps.length) * 100) / 100, 0.01);
    plan = validTps.map((tp, i) => ({ tp, vol: each, idx: i + 1 }));
  } else { // multi — një pozicion (me lot të plotë) për çdo TP
    plan = validTps.map((tp, i) => ({ tp, vol: baseLot, idx: i + 1 }));
  }

  // Kufizim pozicionesh të hapura
  const { data: openNow } = await db.from("telegram_trades").select("id").eq("user_id", cfgRow.user_id).eq("status", "open");
  const openCount = (openNow || []).length;
  const room = Math.max(0, (Number(cfgRow.max_open) || 12) - openCount);
  if (room <= 0) { await finish("rejected", `Max pozicione të hapura (${cfgRow.max_open})`); return json({ ok: true, error: "max_open" }); }
  plan = plan.slice(0, room);

  const maxLot = Number(cfg.max_lot) > 0 ? Number(cfg.max_lot) : Infinity;
  let executed = 0; const details: string[] = [];
  for (const leg of plan) {
    const vol = Math.min(Math.round(leg.vol * 100) / 100, maxLot);
    const tp = Math.round(leg.tp * 100) / 100;
    const tradeBody: Record<string, unknown> = {
      actionType: isBuy ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
      symbol: tradeSym, volume: vol, comment: `${TG_TAG}${leg.idx}`, stopLoss: sl, takeProfit: tp,
    };
    let r = await maTrade(cfg, tradeBody);
    // 10016 (invalid stops) → zgjero SL/TP 1.5×, provo edhe një herë
    const rb0 = r.body as { numericCode?: number } | null;
    if (!(r.ok && brokerResult(r.body).ok) && rb0?.numericCode === 10016) {
      const d2 = Math.round(slDist * 1.5 * 100) / 100;
      const sl2 = Math.round((isBuy ? ref - d2 : ref + d2) * 100) / 100;
      const tp2 = Math.round((isBuy ? ref + d2 * 2 : ref - d2 * 2) * 100) / 100;
      tradeBody.stopLoss = sl2; tradeBody.takeProfit = tp2;
      await new Promise((res) => setTimeout(res, 400));
      r = await maTrade(cfg, tradeBody);
    }
    const br = brokerResult(r.body);
    await db.from("telegram_trades").insert({
      signal_id: signalId, user_id: cfgRow.user_id, symbol: tradeSym, action: isBuy ? "BUY" : "SELL",
      volume: vol, tp_index: leg.idx, entry_price: ref, stop_loss: Number(tradeBody.stopLoss), take_profit: Number(tradeBody.takeProfit),
      metaapi_order_id: br.orderId, metaapi_position_id: br.positionId, status: br.ok ? "open" : "rejected",
      reason: br.ok ? `TG TP${leg.idx}` : `Brokeri: ${br.msg || br.code}`, raw_response: r.body ?? null,
    });
    if (br.ok) { executed++; details.push(`TP${leg.idx} @ ${tp} (${vol})`); }
  }

  await finish(executed > 0 ? (executed === plan.length ? "executed" : "partial") : "rejected", executed > 0 ? null : "asnjë leg s'u ekzekutua (shih telegram_trades)");
  if (cfgRow.bot_token) {
    const emoji = executed > 0 ? "✅" : "⚠️";
    await tgReply(cfgRow.bot_token, chatId,
      `${emoji} <b>Telegram Sin</b> — ${isBuy ? "BUY" : "SELL"} ${tradeSym}\n` +
      (executed > 0 ? `Hyri në ${executed} pozicione:\n${details.join("\n")}\nSL: ${sl}` : `S'u hap dot: shih raportet në aplikacion.`));
  }
  return json({ ok: true, kind: "entry", executed, legs: plan.length });
});
