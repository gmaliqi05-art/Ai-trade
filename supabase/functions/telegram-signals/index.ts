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
// Zgjidh emrin REAL të simbolit te brokeri (XAUUSD → XAUUSD.s / XAUUSD+), me cache te symbol_map.
// PROVA E GJALLËRISË: te PU Prime "XAUUSD" figuron në listë por llogaria tregton "XAUUSD.s" —
// kërkesat për emrin e gabuar NGECIN në timeout. Emri pranohet (dhe cache-ohet) vetëm nëse
// /specification përgjigjet shpejt dhe tregtimi s'është i çaktivizuar.
async function symbolAlive(cfg: Cfg, symbol: string): Promise<boolean> {
  try {
    const resp = await fetch(`${host(cfg.region)}/users/current/accounts/${cfg.account_id}/symbols/${encodeURIComponent(symbol)}/specification`, {
      headers: { "auth-token": cfg.token }, signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) return false;
    const spec = await resp.json() as { tradeMode?: string };
    return !!spec && typeof spec === "object" && spec.tradeMode !== "SYMBOL_TRADE_MODE_DISABLED";
  } catch { return false; }
}
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
  const candidates = [...new Set([
    ...names.filter((n) => n.toUpperCase() === want),
    ...names.filter((n) => n.toUpperCase() !== want && n.toUpperCase().startsWith(want)),
    ...(isGold ? names.filter((n) => /XAUUSD/i.test(n)) : []),
  ])];
  for (const cand of candidates) {
    if (await symbolAlive(cfg, cand)) {
      symCache.set(ck, cand);
      try { await db.from("metaapi_config").update({ symbol_map: { ...map, [want]: cand } }).eq("user_id", cfg.user_id); } catch { /* */ }
      return cand;
    }
  }
  // Asnjë provë s'kaloi (kalimtar?) → mos e ngurtëso në cache të DB-së; përdor kandidatin e parë
  // ose të kërkuarin vetëm për këtë thirrje.
  return candidates[0] || want;
}

// ---------- Parser i mesazheve ----------
interface TpUpdate { idx: number; price: number; }
interface Parsed {
  kind: "entry" | "exit" | "modify" | "unknown";
  symbol: string | null;
  direction: "buy" | "sell" | null;
  entryType: "market" | "limit";
  entryPrice: number | null;
  stopLoss: number | null;
  tps: number[];
  mod?: { sl?: number; breakeven?: boolean; tpUpdates?: TpUpdate[] };
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
  const none: Parsed = { kind: "unknown", symbol: null, direction: null, entryType: "market", entryPrice: null, stopLoss: null, tps: [] };

  // Simboli
  let symbol: string | null = null;
  for (const [re, name] of SYMBOL_ALIASES) { if (re.test(low)) { symbol = name; break; } }

  // Drejtimi (fjala) — VETËM tregues; NUK mjafton vetëm ai për të hapur trade (shmang komentet).
  let direction: "buy" | "sell" | null = null;
  if (/\b(sell|short|shit)\b/i.test(low)) direction = "sell";
  else if (/\b(buy|long|blej)\b/i.test(low)) direction = "buy";

  // Stop-loss (numri pas SL / Stop Loss)
  const slMatch = low.match(/(?:sl|s\/l|stop\s*loss|stoploss|ndalese)\s*:?\s*(\d{2,7}(?:\.\d+)?)/i);
  const stopLoss = slMatch ? parseFloat(slMatch[1]) : null;

  // Take-profit(s) me INDEKS — "TP 1: 4112", "TP3 4060", "Change TP 4 to 4054"
  const tpUpdates: TpUpdate[] = [];
  const tpIdxRe = /(?:tp|take\s*profit)\s*(\d)\s*(?:to\s*)?:?\s*(\d{2,7}(?:\.\d+)?)/gi;
  let tu: RegExpExecArray | null;
  while ((tu = tpIdxRe.exec(low)) !== null) {
    const idx = parseInt(tu[1], 10), price = parseFloat(tu[2]);
    if (idx >= 1 && Number.isFinite(price) && !tpUpdates.some((x) => x.idx === idx)) tpUpdates.push({ idx, price });
  }
  // TP pa indeks (p.sh. "take profit 4112", "target 4112")
  const tpNoIdx: number[] = [];
  const tpGenRe = /(?:take\s*profit|target|objektiv)\s*:?\s*(\d{2,7}(?:\.\d+)?)/gi;
  let tg: RegExpExecArray | null;
  while ((tg = tpGenRe.exec(low)) !== null) { const v = parseFloat(tg[1]); if (Number.isFinite(v)) tpNoIdx.push(v); }

  // Entry — "Entry zone 4115 - 4116" / "4080-4077" / "4145" / "@ 4150" / "entry 4150"
  let entryPrice: number | null = null;
  const zoneRe = low.match(/(?:entry\s*zone|entry|zone|hyrje|@|price)\s*:?\s*(\d{2,7}(?:\.\d+)?)\s*(?:[-–—to]+\s*(\d{2,7}(?:\.\d+)?))?/i)
    || low.match(/\b(?:buy|sell|blej|shit|long|short)\s*(?:limit|stop)?\s*:?\s*@?\s*(\d{2,7}(?:\.\d+)?)/i);
  if (zoneRe) {
    const a = parseFloat(zoneRe[1]);
    const b = zoneRe[2] != null ? parseFloat(zoneRe[2]) : NaN;
    entryPrice = Number.isFinite(b) ? Math.round(((a + b) / 2) * 100) / 100 : a; // zonë → mesi
  }
  // Lloji: nëse ka çmim hyrjeje → "limit" (ekzekutimi vendos pending vs market sipas afërsisë me tregun);
  // pa çmim → "market". SHËNIM: NUK përdorim fjalën "market" nga teksti (p.sh. "Market is very dangerous"
  // e bënte gabimisht market). Vetëm "buy/sell now" pa çmim → market (mbulohet nga entryPrice == null).
  const entryType: "market" | "limit" = entryPrice != null ? "limit" : "market";

  // ===== KLASIFIKIM =====
  // 1) HYRJE: kërkon drejtim + strukturë (SL ose TP me indeks) — jo thjesht fjalën "buy/sell" në koment.
  const hasStructure = stopLoss != null || tpUpdates.length > 0 || tpNoIdx.length > 0;
  // Koment "s'ka sinjal" (p.sh. "we didn't issue the buy signal", "no signal") → injoro edhe nëse ka fjalën buy/sell.
  const noSignal = /\b(no (buy|sell|new)? ?signal|didn'?t issue|not issuing|no setup|no trade|s'ka sinjal)\b/i.test(low);
  if (direction && hasStructure && !noSignal) {
    if (!symbol) symbol = defaultSymbol;
    const tpSet: number[] = [];
    for (const u of tpUpdates.sort((x, y) => x.idx - y.idx)) if (!tpSet.includes(u.price)) tpSet.push(u.price);
    for (const v of tpNoIdx) if (!tpSet.includes(v)) tpSet.push(v);
    const tps = tpSet.sort((a, b) => (direction === "buy" ? a - b : b - a));
    return { kind: "entry", symbol, direction, entryType, entryPrice, stopLoss, tps };
  }

  // 2) DALJE (mbyll gjithçka)
  const isExit = /\b(close all|close everything|close the trade|close now|close|exit|cancel|cancelled|canceled|anulo|mbyll|mbylle|dil|dil nga|closed)\b/i.test(low);
  if (isExit && !hasStructure) {
    return { kind: "exit", symbol: symbol ?? defaultSymbol, direction: null, entryType: "market", entryPrice: null, stopLoss: null, tps: [] };
  }

  // 3) MENAXHIM (modify): lëviz SL / breakeven / ndrysho TP-t — pa drejtim të ri.
  const breakeven = /break\s*even|breakeven/i.test(low);
  let modSl: number | undefined;
  const moveSl = low.match(/(?:move|moving|change|changing|update|vendos|zhvendos)[^\d]{0,20}(?:sl|stop\s*loss)[^\d]{0,8}(\d{2,7}(?:\.\d+)?)/i)
    || low.match(/(?:sl|stop\s*loss)\s*(?:to|=|:)\s*(\d{2,7}(?:\.\d+)?)/i);
  if (moveSl) modSl = parseFloat(moveSl[1]);
  if (breakeven || modSl != null || tpUpdates.length > 0) {
    return { kind: "modify", symbol: symbol ?? defaultSymbol, direction: null, entryType: "market", entryPrice: null, stopLoss: null, tps: [],
      mod: { sl: modSl, breakeven, tpUpdates: tpUpdates.length > 0 ? tpUpdates : undefined } };
  }

  return { ...none, symbol };
}

// ---------- Push notification te aplikacioni (web-push-send) ----------
async function pushNotify(payload: { user_id: string; title: string; body: string; url?: string; tag?: string }) {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/web-push-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* jo-kritik */ }
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

// ===== MENAXHERI I SHKALLËVE TË TP (cron çdo 1 min) =====
// Kur tiku 'move_be_after_tp1' është ON:
//   TP1 preket → legs e mbetura (TP2/3/4) → SL te HYRJA (breakeven)
//   TP2 preket → legs e mbetura → SL te ÇMIMI I TP2 — dhe KURRË më lart se TP2,
//   që tregu të ketë hapësirë për uljet/ngritjet e veta para se të prekë TP3/TP4.
// Kur tiku është OFF: asnjë ndërhyrje — mbeten vetëm SL/TP-të e vendosura në hyrje.
// Gjithmonë (pavarësisht tikut): përditëson statuset — pending i mbushur → open; leg i mbyllur → closed.
// deno-lint-ignore no-explicit-any
async function manageUser(db: ReturnType<typeof createClient>, cfgRow: any) {
  const userId = String(cfgRow.user_id);
  const { data: rowsRaw } = await db.from("telegram_trades").select("*")
    .eq("user_id", userId).in("status", ["open", "pending"]);
  // deno-lint-ignore no-explicit-any
  const rows = (rowsRaw || []) as any[];
  if (rows.length === 0) return { user: userId.slice(0, 8), legs: 0 };

  const { data: mcfg } = await db.from("metaapi_config").select("*").eq("user_id", userId).maybeSingle();
  if (!mcfg || !mcfg.account_id || !mcfg.token) return { user: userId.slice(0, 8), error: "no_metaapi" };
  const cfg = mcfg as unknown as Cfg;

  const { data: chansRaw } = await db.from("telegram_sin_channels").select("chat_id, move_be_after_tp1").eq("user_id", userId);
  // deno-lint-ignore no-explicit-any
  const chans = new Map<string, any>(((chansRaw || []) as any[]).map((c) => [String(c.chat_id), c]));
  // deno-lint-ignore no-explicit-any
  const positions = (await maGet(cfg, "/positions").catch(() => [])) as any[];
  // deno-lint-ignore no-explicit-any
  const orders = (await maGet(cfg, "/orders").catch(() => [])) as any[];
  const posIds = new Set((positions || []).map((p) => String(p.id)));
  const ordIds = new Set((orders || []).map((o) => String(o.id)));
  const now = new Date().toISOString();
  let changed = 0;

  // 1) PENDING → u mbush (u bë pozicion me të njëjtin id) ose u anulua/skadoi te brokeri.
  for (const t of rows) {
    if (t.status !== "pending") continue;
    const oid = t.metaapi_order_id ? String(t.metaapi_order_id) : "";
    if (oid && posIds.has(oid)) {
      await db.from("telegram_trades").update({ status: "open", metaapi_position_id: oid }).eq("id", t.id);
      t.status = "open"; t.metaapi_position_id = oid; changed++;
    } else if (oid && !ordIds.has(oid)) {
      await db.from("telegram_trades").update({ status: "closed", closed_at: now, reason: "Pending s'është më te brokeri" }).eq("id", t.id);
      t.status = "closed"; changed++;
    }
  }

  // (Toleranca e hyrjes ±$1 u HOQ me kërkesë të pronarit — dërguesit e sinjaleve thanë që hyrja
  // pa e arritur çmimi SAKTËSISHT nivelin e tyre nuk vlen. Pending mbushet vetëm me prekje të saktë.)

  // 2) Grupim sipas sinjalit; leg i zhdukur ndërsa vëllezërit janë hapur ⇒ e preku TP-në e vet
  //    (SL është i njëjtë për të gjitha legs — po të prekej SL, mbylleshin të gjitha njëherësh).
  // deno-lint-ignore no-explicit-any
  const bySignal = new Map<string, any[]>();
  for (const t of rows) {
    const k = String(t.signal_id || t.id);
    if (!bySignal.has(k)) bySignal.set(k, []);
    bySignal.get(k)!.push(t);
  }
  for (const [, legs] of bySignal) {
    const openLegs = legs.filter((l) => l.status === "open" && l.metaapi_position_id);
    const gone = openLegs.filter((l) => !posIds.has(String(l.metaapi_position_id)));
    const alive = openLegs.filter((l) => posIds.has(String(l.metaapi_position_id)));
    for (const g of gone) {
      const reason = alive.length > 0 ? `TP${g.tp_index} u prek` : "U mbyll te brokeri";
      await db.from("telegram_trades").update({ status: "closed", closed_at: now, reason }).eq("id", g.id);
      g.status = "closed"; g.reason = reason; changed++;
    }
    // Të gjitha legs u mbyllën → shëno edhe SINJALIN 'closed' (raporti: tp_hit>0 = fitim deri te TPn; 0 = SL).
    if (gone.length > 0 && alive.length === 0 && legs[0].signal_id) {
      await db.from("telegram_signals").update({ status: "closed" }).eq("id", legs[0].signal_id).in("status", ["executed", "partial", "pending"]);
    }
  }

  // 3) PREKJA E TP-ve (nga çmimi LIVE + legs të mbyllura) → push notification për çdo TP të ri;
  //    dhe kur tiku është ON → SHKALLA E SL: gjithmonë NJË TP mbrapa çmimit:
  //    TP1 preket → SL te HYRJA (BE) · TP2 preket → SL te TP1 · TP3 preket → SL te TP2 · ...
  const ladderOn = !!cfgRow.move_be_after_tp1;
  let laddered = 0, notified = 0;
  const priceCache = new Map<string, { bid: number; ask: number } | null>();
  for (const [, legs] of bySignal) {
    if (!legs[0].signal_id) continue;
    const alive = legs.filter((l) => l.status === "open" && l.metaapi_position_id && posIds.has(String(l.metaapi_position_id)));
    // Sinjali: nivelet e TP-ve + sa është prekur deri tani (kundër njoftimeve të dyfishta)
    const { data: sig } = await db.from("telegram_signals")
      .select("id, tps, tp_hit, symbol, direction, tg_chat_id").eq("id", legs[0].signal_id).maybeSingle();
    if (!sig) continue;
    const tps = (Array.isArray(sig.tps) ? sig.tps : []).map(Number).filter((v: number) => v > 0);
    if (tps.length === 0) continue;
    const prevHit = Number(sig.tp_hit) || 0;
    const isBuy = String(legs[0].action).toUpperCase() === "BUY";
    const sym = String(legs[0].symbol || sig.symbol || "XAUUSD");

    // (a) nga legs e mbyllura ("TPn u prek" — mode multi/split)
    const closedHit = Math.max(0, ...legs.filter((l) => /^TP\d+ u prek/.test(String(l.reason || ""))).map((l) => Number(l.tp_index) || 0));
    // (b) nga çmimi LIVE (mbulon edhe mënyrën 'TP më i larti', ku s'ka legs të ndërmjetme)
    let priceHit = 0;
    if (alive.length > 0) {
      if (!priceCache.has(sym)) priceCache.set(sym, await livePrice(cfg, sym));
      const lp = priceCache.get(sym);
      if (lp) for (let k = 1; k <= tps.length; k++) {
        const touched = isBuy ? lp.bid >= tps[k - 1] : lp.ask <= tps[k - 1];
        if (touched) priceHit = k;
      }
    }
    const maxHit = Math.max(closedHit, priceHit);
    if (maxHit <= prevHit && maxHit < 1) continue;

    // PUSH NOTIFICATION për çdo TP të RI të prekur (TP1, TP2, TP3...)
    if (maxHit > prevHit) {
      for (let k = prevHit + 1; k <= maxHit; k++) {
        const nextSl = ((chans.get(String(sig.tg_chat_id ?? ""))?.move_be_after_tp1 ?? cfgRow.move_be_after_tp1) === true) ? (k === 1 ? "breakeven" : `TP${k - 1}`) : null;
        await pushNotify({
          user_id: userId,
          title: `🎯 TP${k} u prek — ${sym} ${isBuy ? "BUY" : "SELL"}`,
          body: `Çmimi preku TP${k} (${tps[k - 1]})${nextSl ? ` · SL kalon te ${nextSl}` : ""} — Telegram Sin`,
          url: "/", tag: `tgsin-tp-${String(sig.id).slice(0, 8)}-${k}`,
        });
        notified++;
      }
      await db.from("telegram_signals").update({ tp_hit: maxHit }).eq("id", sig.id);
    }

    // SHKALLA E SL (vetëm me tik ON): caku = një TP mbrapa (TP1→BE, TPn→TP(n-1))
    const ladderOnG = (chans.get(String(sig.tg_chat_id ?? ""))?.move_be_after_tp1 ?? cfgRow.move_be_after_tp1) === true;
    if (!ladderOnG || maxHit < 1 || alive.length === 0) continue;
    const target = maxHit === 1 ? (Number(alive[0].entry_price) || null) : tps[maxHit - 2];
    if (!(Number(target) > 0)) continue;
    const tgt = Math.round(Number(target) * 100) / 100;
    for (const leg of alive) {
      const cur = Number(leg.stop_loss);
      // Lëviz VETËM në drejtim të fitimit (BUY: vetëm lart; SELL: vetëm poshtë) — kurrë mbrapsht.
      const better = Number.isFinite(cur) ? (isBuy ? tgt > cur : tgt < cur) : true;
      if (!better) continue;
      const r = await maTrade(cfg, { actionType: "POSITION_MODIFY", positionId: String(leg.metaapi_position_id), stopLoss: tgt, takeProfit: Number(leg.take_profit) || undefined });
      const br = brokerResult(r.body);
      if (r.ok && br.ok) {
        await db.from("telegram_trades").update({ stop_loss: tgt }).eq("id", leg.id);
        laddered++; changed++;
      }
    }
  }
  return { user: userId.slice(0, 8), changed, laddered, notified };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return json({ ok: true, info: "Telegram Sin webhook" });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const url = new URL(req.url);

  // 0) DEGA E CRON-it (?manage=1 + x-cron-secret): menaxheri i shkallëve të TP + statuset.
  if (url.searchParams.get("manage") === "1") {
    try {
      const { data: cs } = await db.from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
      const secret = (cs as { value?: string } | null)?.value;
      if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "unauthorized" }, 401);
    } catch { return json({ error: "unauthorized" }, 401); }
    const managed: unknown[] = [];
    const { data: cfgs } = await db.from("telegram_sin_config").select("*").eq("active", true);
    for (const c of (cfgs || [])) {
      try { managed.push(await manageUser(db, c)); }
      catch (e) { managed.push({ user: String(c.user_id).slice(0, 8), error: (e as Error).message }); }
    }
    return json({ ok: true, managed });
  }

  // 1) Autentiko burimin nga ?key=<webhook_secret> (çelësi i njërit prej përdoruesve)
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

  // 2) BROADCAST (kërkesa e pronarit): sinjali përpunohet për TË GJITHË përdoruesit me Telegram Sin
  // AKTIV — secili tregton në llogarinë e VET MetaApi me parametrat e VET për kanal (lot/TP/tik…),
  // të cilët i rregullon vetë në faqen e tij. Çelësi vetëm autentikon burimin (kopjuesin).
  const { data: allCfgs } = await db.from("telegram_sin_config").select("*").eq("active", true);
  // deno-lint-ignore no-explicit-any
  const cfgList: any[] = [...(allCfgs || [])];
  // pronari i çelësit përfshihet edhe kur është joaktiv → mesazhi i regjistrohet si 'ignored' (si më parë)
  if (!cfgList.some((c) => String(c.user_id) === String(cfgRow.user_id))) cfgList.push(cfgRow);
  const results: Record<string, unknown>[] = [];
  for (const c of cfgList) {
    try { results.push({ user: String(c.user_id).slice(0, 8), ...(await processForUser(db, c, { text, chatId, messageId, sender })) }); }
    catch (e) { results.push({ user: String(c.user_id).slice(0, 8), error: (e as Error).message }); }
  }
  return json({ ok: true, results });
});

// Përpunon një mesazh kanali për NJË përdorues: filtra → idempotencë → parametrat për kanal →
// parse → modify/exit/entry — gjithçka në llogarinë dhe me cilësimet e ATIJ përdoruesi.
// deno-lint-ignore no-explicit-any
async function processForUser(db: ReturnType<typeof createClient>, cfgRow: any, m: { text: string; chatId: string; messageId: number; sender: string }): Promise<Record<string, unknown>> {
  const { text, chatId, messageId, sender } = m;
  // Brenda këtij funksioni 'json' kthen OBJEKT të thjeshtë (jo Response) — rezultatet e të gjithë
  // përdoruesve mblidhen nga thirrësi (broadcast) dhe kthehen si NJË përgjigje e vetme.
  const json = (x: Record<string, unknown>) => x;

  // Filtrim burimi (nëse konfiguruar)
  // KANAL I ÇAKTIVIZUAR nga faqja (çelësi për-kanal): regjistro si 'ignored', mos tregto.
  const disabledChats: string[] = cfgRow.disabled_chats || [];
  const chatDisabled = disabledChats.includes(chatId);
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

  // 3.5) PARAMETRAT PËR KANAL: çdo kanal ka lot/TP-mode/SL/max/shkallët e VETA.
  // Krijohet vetë me sinjalin e parë (kopjon parazgjedhjet e config-ut global).
  // deno-lint-ignore no-explicit-any
  let chRow: any = null;
  if (chatId) {
    const { data: ch0 } = await db.from("telegram_sin_channels").select("*")
      .eq("user_id", cfgRow.user_id).eq("chat_id", chatId).maybeSingle();
    chRow = ch0;
    if (!chRow) {
      const def = {
        user_id: cfgRow.user_id, chat_id: chatId, name: sender || chatId, enabled: !chatDisabled,
        lot: Number(cfgRow.lot) || 0.01, tp_mode: cfgRow.tp_mode || "multi",
        fallback_sl_usd: Number(cfgRow.fallback_sl_usd) || 30,
        move_be_after_tp1: !!cfgRow.move_be_after_tp1, max_open: Number(cfgRow.max_open) || 3,
      };
      const { data: chNew } = await db.from("telegram_sin_channels").insert(def).select("*").maybeSingle();
      chRow = chNew ?? def;
    }
  }
  const eff = {
    lot: Number(chRow?.lot ?? cfgRow.lot) || 0.01,
    tp_mode: String(chRow?.tp_mode ?? cfgRow.tp_mode ?? "multi"),
    fallback_sl_usd: Number(chRow?.fallback_sl_usd ?? cfgRow.fallback_sl_usd) || 0,
    max_open: Number(chRow?.max_open ?? cfgRow.max_open) || 3,
  };
  const channelOff = chatDisabled || (chRow ? chRow.enabled === false : false);

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

  if (p.kind === "unknown") { await finish("ignored", "koment/tekst — s'është sinjal me strukturë (Entry/SL/TP)"); return json({ ok: true, kind: "unknown" }); }
  if (channelOff) { await finish("ignored", "kanali është i çaktivizuar nga cilësimet"); return json({ ok: true, skip: "chat_disabled" }); }
  if (!cfgRow.active) { await finish("ignored", "Telegram Sin joaktiv"); return json({ ok: true, skip: "inactive" }); }

  // Ngarko konfigurimin MetaApi të përdoruesit (tregton në llogarinë e tij — si te Trade Live)
  const { data: mcfg } = await db.from("metaapi_config").select("*").eq("user_id", cfgRow.user_id).maybeSingle();
  if (!mcfg || !mcfg.account_id || !mcfg.token) { await finish("rejected", "MetaApi s'është konfiguruar"); return json({ ok: true, error: "no_metaapi" }); }
  const cfg = mcfg as unknown as Cfg;

  const tradeSym = await resolveSymbol(cfg, p.symbol || "XAUUSD", db);
  const norm = (s: string) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const isGold = (s: string) => /XAU|GOLD|ARI/i.test(s || "");
  const same = (a: string, b: string) => norm(a) === norm(b) || (isGold(a) && isGold(b));

  // ===== MENAXHIM (modify): lëviz SL / breakeven / ndrysho TP — mbi pozicionet & porositë ekzistuese =====
  if (p.kind === "modify") {
    const { data: rows } = await db.from("telegram_trades").select("*")
      .eq("user_id", cfgRow.user_id).in("status", ["open", "pending"]);
    const targets = (rows || []).filter((t) => same(t.symbol || "", tradeSym) || same(t.symbol || "", p.symbol || ""));
    if (targets.length === 0) { await finish("ignored", "s'ka pozicione/porosi për të ndryshuar"); if (cfgRow.bot_token) await tgReply(cfgRow.bot_token, chatId, `ℹ️ Telegram Sin: s'ka pozicione aktive për të ndryshuar (${tradeSym}).`); return json({ ok: true, kind: "modify", changed: 0 }); }

    // TIKU I NDJEKJES (për-kanal): kur është OFF, SL-ja NUK lëvizet KURRË pas hyrjes — as nga
    // shkallëzimi ynë, as nga urdhrat e dërguesit ("move SL to breakeven"). SL/TP mbeten siç u
    // dërguan në sinjal. (Rasti real: BE-ja e dërguesit e nxori nga trade para se çmimi të kapte TP2.)
    const followOn = (chRow?.move_be_after_tp1 ?? cfgRow.move_be_after_tp1) === true;
    const slRequested = !!(p.mod?.breakeven || p.mod?.sl != null);
    const tpMap = new Map<number, number>();
    for (const u of (p.mod?.tpUpdates || [])) tpMap.set(u.idx, u.price);
    if (slRequested && !followOn && tpMap.size === 0) {
      await finish("ignored", "tiku 'Mbrojtja shkallë-shkallë' është OFF — SL nuk ndiqet (mbetet siç u dërgua)");
      if (cfgRow.bot_token) await tgReply(cfgRow.bot_token, chatId, `ℹ️ Telegram Sin: lëvizja e SL u ANASHKALUA (tiku i mbrojtjes OFF) — SL mbetet siç u dërgua në sinjal.`);
      return json({ ok: true, kind: "modify", changed: 0, skipped: "follow_off" });
    }
    let changed = 0; const notes: string[] = [];

    for (const t of targets) {
      const applySl = slRequested && followOn;
      const newSl = applySl ? (p.mod?.breakeven ? Number(t.entry_price) : (p.mod?.sl != null ? p.mod.sl : Number(t.stop_loss))) : Number(t.stop_loss);
      const newTp = tpMap.has(Number(t.tp_index)) ? tpMap.get(Number(t.tp_index))! : Number(t.take_profit);
      // Nëse ky rresht nuk preket nga asnjë ndryshim, kaloje.
      const slChanged = applySl && Number.isFinite(newSl) && newSl !== Number(t.stop_loss);
      const tpChanged = tpMap.has(Number(t.tp_index)) && Number.isFinite(newTp) && newTp !== Number(t.take_profit);
      if (!slChanged && !tpChanged) continue;

      let r;
      if (t.status === "pending" && t.metaapi_order_id) {
        r = await maTrade(cfg, { actionType: "ORDER_MODIFY", orderId: t.metaapi_order_id, openPrice: Number(t.entry_price), stopLoss: Math.round(newSl * 100) / 100, takeProfit: Math.round(newTp * 100) / 100 });
      } else if (t.metaapi_position_id) {
        r = await maTrade(cfg, { actionType: "POSITION_MODIFY", positionId: t.metaapi_position_id, stopLoss: Math.round(newSl * 100) / 100, takeProfit: Math.round(newTp * 100) / 100 });
      } else continue;
      const br = brokerResult(r.body);
      if (r.ok && br.ok) {
        await db.from("telegram_trades").update({ stop_loss: Math.round(newSl * 100) / 100, take_profit: Math.round(newTp * 100) / 100, reason: `TG modify${p.mod?.breakeven ? " (breakeven)" : ""}` }).eq("id", t.id);
        changed++;
        if (slChanged) notes.push(`SL→${Math.round(newSl * 100) / 100}${p.mod?.breakeven ? " (BE)" : ""}`);
        if (tpChanged) notes.push(`TP${t.tp_index}→${Math.round(newTp * 100) / 100}`);
      }
    }
    await finish(changed > 0 ? "modified" : "ignored", changed > 0 ? null : "asnjë ndryshim s'u aplikua");
    if (cfgRow.bot_token) await tgReply(cfgRow.bot_token, chatId, `🔧 Telegram Sin: ${changed} ndryshime (${tradeSym})${notes.length ? "\n" + [...new Set(notes)].join(", ") : ""}.`);
    return json({ ok: true, kind: "modify", changed });
  }

  // ===== DALJE: mbyll pozicionet HAPUR + anulo porositë NË PRITJE të Telegram Sin për këtë simbol =====
  if (p.kind === "exit") {
    const { data: openTrades } = await db.from("telegram_trades").select("*")
      .eq("user_id", cfgRow.user_id).in("status", ["open", "pending"]);
    const toClose = (openTrades || []).filter((t) => same(t.symbol || "", tradeSym) || same(t.symbol || "", p.symbol || ""));
    let closed = 0, canceled = 0;
    for (const t of toClose) {
      if (t.status === "pending" && t.metaapi_order_id) {
        // Anulo porosinë NË PRITJE (ende s'është mbushur)
        const r = await maTrade(cfg, { actionType: "ORDER_CANCEL", orderId: t.metaapi_order_id });
        const br = brokerResult(r.body);
        if (r.ok && (br.ok || /order.*not.*found|already/i.test(br.msg))) {
          await db.from("telegram_trades").update({ status: "closed", closed_at: new Date().toISOString(), reason: "Telegram: exit (anuluar pending)" }).eq("id", t.id);
          canceled++;
        }
      } else if (t.metaapi_position_id) {
        const r = await maTrade(cfg, { actionType: "POSITION_CLOSE_ID", positionId: t.metaapi_position_id });
        const br = brokerResult(r.body);
        if (r.ok && (br.ok || /position.*not.*found/i.test(br.msg))) {
          await db.from("telegram_trades").update({ status: "closed", closed_at: new Date().toISOString(), reason: "Telegram: exit" }).eq("id", t.id);
          closed++;
        }
      }
    }
    const total = closed + canceled;
    await finish(total > 0 ? "closed" : "ignored", total > 0 ? null : "asnjë pozicion/porosi për mbyllje");
    if (cfgRow.bot_token) await tgReply(cfgRow.bot_token, chatId, `✅ Telegram Sin: u mbyllën <b>${closed}</b> pozicione dhe u anuluan <b>${canceled}</b> porosi në pritje (${tradeSym}).`);
    return json({ ok: true, kind: "exit", closed, canceled });
  }

  // ===== HYRJE =====
  const isBuy = p.direction === "buy";
  const lp = await livePrice(cfg, tradeSym);
  const mkt = lp ? (isBuy ? lp.ask : lp.bid) : (p.entryPrice ?? 0);
  if (!(mkt > 0)) { await finish("rejected", "s'mora çmim live nga MetaApi"); return json({ ok: true, error: "no_price" }); }

  // PENDING vs MARKET: nëse trejderi dha një çmim hyrjeje TË SAKTË që tregu s'e ka arritur ende,
  // vendos porosi NË PRITJE (limit/stop) — mbushet AUTOMATIKISHT kur çmimi arrin aty. Ndryshe: market.
  //   BUY:  entry < treg → BUY_LIMIT  | entry > treg → BUY_STOP
  //   SELL: entry > treg → SELL_LIMIT | entry < treg → SELL_STOP
  let pending = false;
  let pendingType = "";
  let ref = mkt;
  if (p.entryPrice != null && p.entryType !== "market") {
    const diff = Math.abs(p.entryPrice - mkt);
    const tol = mkt * 0.0005;              // shumë afër tregut → market (pending s'ka kuptim)
    const tooFar = diff > mkt * 0.03;      // >3% larg → ka gjasë parse gabim → market (siguri)
    if (diff > tol && !tooFar) {
      pending = true;
      ref = p.entryPrice;
      if (isBuy) pendingType = p.entryPrice < mkt ? "ORDER_TYPE_BUY_LIMIT" : "ORDER_TYPE_BUY_STOP";
      else pendingType = p.entryPrice > mkt ? "ORDER_TYPE_SELL_LIMIT" : "ORDER_TYPE_SELL_STOP";
    }
  }

  // SL: nga sinjali, ose fallback (entry ∓ fallback_sl_usd). Pa SL të vlefshëm → refuzo (siguri).
  let sl = p.stopLoss;
  const fb = eff.fallback_sl_usd;
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
  const mode = eff.tp_mode;
  let plan: Array<{ tp: number; vol: number; idx: number }> = [];
  const baseLot = Math.max(eff.lot, 0.01);
  if (mode === "first") {
    plan = [{ tp: validTps[0], vol: baseLot, idx: 1 }];
  } else if (mode === "last") {
    // NJË pozicion i vetëm me TP-në MË TË LARGËT (TP3/TP4). TP-të e ndërmjetme bëhen nivele
    // alarmi: menaxheri (cron) dërgon push për çdo prekje dhe (me tik ON) ngjit SL-në shkallë-shkallë.
    plan = [{ tp: validTps[validTps.length - 1], vol: baseLot, idx: validTps.length }];
  } else if (mode === "split") {
    const each = Math.max(Math.floor((baseLot / validTps.length) * 100) / 100, 0.01);
    plan = validTps.map((tp, i) => ({ tp, vol: each, idx: i + 1 }));
  } else { // multi — një pozicion (me lot të plotë) për çdo TP
    plan = validTps.map((tp, i) => ({ tp, vol: baseLot, idx: i + 1 }));
  }

  // Kufizim pozicionesh PËR KANAL (numëron vetëm trade-t e sinjaleve të KËTIJ kanali)
  const { data: chSigIds } = await db.from("telegram_signals").select("id")
    .eq("user_id", cfgRow.user_id).eq("tg_chat_id", chatId).limit(500);
  const idSet = new Set((chSigIds || []).map((r) => r.id));
  const { data: openNow } = await db.from("telegram_trades").select("id, signal_id").eq("user_id", cfgRow.user_id).in("status", ["open", "pending"]);
  const openCount = (openNow || []).filter((r) => r.signal_id && idSet.has(r.signal_id)).length;
  const room = Math.max(0, eff.max_open - openCount);
  if (room <= 0) { await finish("rejected", `Max pozicione të hapura për kanalin (${eff.max_open})`); return json({ ok: true, error: "max_open" }); }
  plan = plan.slice(0, room);

  const maxLot = Number(cfg.max_lot) > 0 ? Number(cfg.max_lot) : Infinity;
  let executed = 0; const details: string[] = [];
  for (const leg of plan) {
    const vol = Math.min(Math.round(leg.vol * 100) / 100, maxLot);
    const tp = Math.round(leg.tp * 100) / 100;
    const tradeBody: Record<string, unknown> = {
      actionType: pending ? pendingType : (isBuy ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL"),
      symbol: tradeSym, volume: vol, comment: `${TG_TAG}${leg.idx}`, stopLoss: sl, takeProfit: tp,
    };
    if (pending) tradeBody.openPrice = Math.round(ref * 100) / 100; // çmimi ku pret të mbushet
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
      metaapi_order_id: br.orderId, metaapi_position_id: pending ? null : br.positionId,
      status: br.ok ? (pending ? "pending" : "open") : "rejected",
      reason: br.ok ? `TG TP${leg.idx}${pending ? " (pending)" : ""}` : `Brokeri: ${br.msg || br.code}`, raw_response: r.body ?? null,
    });
    if (br.ok) { executed++; details.push(`TP${leg.idx} @ ${tp} (${vol})${pending ? " ⏳" : ""}`); }
  }

  // PUSH: njofto në aplikacion kur hapet trade/porosi e re nga sinjali (kërkesa e pronarit)
  if (executed > 0) {
    await pushNotify({
      user_id: cfgRow.user_id,
      title: `📥 ${isBuy ? "BUY" : "SELL"} ${tradeSym} — sinjal i ri (${chRow?.name || sender || "Telegram"})`,
      body: `${pending ? "Porosi në pritje" : "Hyri"} ${executed} pozicione · SL ${sl}${validTps.length ? ` · TP ${validTps.join("/")}` : ""}`,
      url: "/", tag: `tgsin-entry-${signalId ?? messageId}`,
    });
  }
  const kindWord = pending ? "porosi në pritje" : "pozicione";
  await finish(executed > 0 ? (pending ? "pending" : (executed === plan.length ? "executed" : "partial")) : "rejected", executed > 0 ? null : "asnjë leg s'u ekzekutua (shih telegram_trades)");
  if (cfgRow.bot_token) {
    const emoji = executed > 0 ? "✅" : "⚠️";
    await tgReply(cfgRow.bot_token, chatId,
      `${emoji} <b>Telegram Sin</b> — ${isBuy ? "BUY" : "SELL"} ${tradeSym}` + (pending ? ` @ ${Math.round(ref * 100) / 100} ⏳` : "") + `\n` +
      (executed > 0 ? `${pending ? "Vendosi" : "Hyri në"} ${executed} ${kindWord}:\n${details.join("\n")}\nSL: ${sl}` : `S'u hap dot: shih raportet në aplikacion.`));
  }
  return json({ ok: true, kind: "entry", pending, executed, legs: plan.length });
}
