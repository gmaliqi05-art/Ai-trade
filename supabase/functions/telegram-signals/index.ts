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
  // KUJDES: pas indeksit kërkohet KUFI FJALE (\b) — pa të, "CHANGE TP 4003" lexohej si
  // TP4 = 3 (indeksi "4" + çmimi "003") dhe do të vendoste TP-në në 3$ në vend të 4003$.
  const tpIdxRe = /(?:tp|take\s*profit)\s*([1-4])\b\s*(?:to|@|=|:)?\s*(\d{2,7}(?:\.\d+)?)/gi;
  let tu: RegExpExecArray | null;
  while ((tu = tpIdxRe.exec(low)) !== null) {
    const idx = parseInt(tu[1], 10), price = parseFloat(tu[2]);
    if (idx >= 1 && Number.isFinite(price) && !tpUpdates.some((x) => x.idx === idx)) tpUpdates.push({ idx, price });
  }
  // TP pa indeks (p.sh. "take profit 4112", "target 4112")
  const tpNoIdx: number[] = [];
  const tpGenRe = /(?:take\s*profit|target|objektiv)\s*:?\s*(\d{2,7}(?:\.\d+)?)/gi;
  // "CHANGE TP 4003" / "set tp to 4010" — TP pa indeks, i shprehur si URDHËR.
  // Forma me folje ("change TP to 4105") dhe ajo pa folje ("TP to 4105", "TP → 4105"). E dyta
  // mungonte: "Change TP to 4105" punonte, "TP to 4105" jo — pa asnjë arsye të dukshme për atë që
  // shkruan. Kërkohet një shigjetë/lidhëz, që numri i thatë pas "TP" të mos ngatërrohet me sinjal.
  const tpCmd = low.match(/(?:change|move|update|set|new)\s+(?:the\s+)?(?:tp|take\s*profit)\s*(?:to|@|=|:)?\s*(\d{3,7}(?:\.\d+)?)/i)
    || low.match(/\b(?:tp|take\s*profit)\s*(?:->|→|to|at|=|:|@)\s*(\d{3,7}(?:\.\d+)?)/i);
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

  // 2) DALJE (mbyll gjithçka) — kërkon URDHËR të qartë, jo thjesht fjalën "close/exit" të përmendur
  // brenda një sqarimi (p.sh. "gold closed above 4100" ose "close to support" NUK duhet të mbyllin).
  // Përfshihet edhe "close <simboli>" — pikërisht formën që prodhon vetë platforma te
  // structuredToText ("close XAUUSD"). Pa të, urdhri i mbylljes i dërguar nga platforma
  // klasifikohej 'unknown' dhe injorohej: pozicionet nuk mbylleshin kurrë.
  // "closed"/"close to" NUK përputhen: \b pas "close" i përjashton ato.
  //
  // RREGULLIM (4 gusht 2026) — rasti real që e nxori: kanali dërgoi "Cancel BUY - no reaction"
  // dhe roboti e la si koment. Në bazë duket qartë: kind='unknown', status='ignored' për të 7
  // përdoruesit, ndërsa porositë në pritje të sinjalit BUY mbetën te brokeri.
  //
  // Shkaku: lista e "objekteve" që lejohej të pasonin foljen nuk përmbante DREJTIMIN. Pra
  // "cancel all", "cancel orders", "cancel gold" punonin — por "cancel BUY", forma më e natyrshme
  // që përdor një trejder, nuk përputhej me asgjë.
  //
  // Fjalët MBUSHËSE mes foljes dhe objektit ("close ALL buys", "cancel THE PENDING sell") trajtohen
  // veçmas. Pa to, "Close the pending buy" nuk njihej fare si mbyllje, dhe "Close all buys" mbyllte
  // edhe shitjet — sepse "all" përputhej i pari dhe drejtimi humbte.
  //
  // FOLJET. Përveç close/exit/cancel u shtuan ato që një trejder i shkruan po aq natyrshëm në
  // anglisht — remove / delete / abort / scrap / drop / kill / void. Dolën nga një provë e gjerë
  // formash reale: "Remove the buy", "Abort the buy", "Drop the buy" nuk bënin absolutisht asgjë.
  // Ato kërkojnë GJITHMONË një objekt pas tyre; vetëm close/exit/cancel pranohen si urdhër i zhveshur.
  const VERB_X = "close|exit|cancel|remove|delete|abort|scrap|drop|kill|void"
    + "|mbyll(?:e|eni)?|anulo(?:je|jeni)?";
  const FILL = "(?:(?:all|the|this|our|my|any|open|pending|remaining|both|out)\\s+){0,3}";
  const DIR = "buy|sell|long|short|blerjen|shitjen";
  const EXIT_OBJ =
    "all|everything|now|out|it|them|pending|positions?|orders?|trades?|setups?|entr(?:y|ies)"
    + `|xau(?:usd)?|gold|${DIR}|buys|sells|longs|shorts`;
  const isExit =
    new RegExp(`\\b(?:${VERB_X})\\s+${FILL}(?:${EXIT_OBJ})\\b`, "i").test(low)
    // Urdhër i zhveshur në krye të mesazhit: "Cancel", "Close!", "Cancel — no reaction".
    // Kërkohet fillimi i tekstit dhe një shenjë ndarëse pas foljes, që "close to support" ose
    // "closed above 4100" të mos përputhen kurrë.
    || /^(?:close|exit|cancel)\s*(?:[-–—:!.,]|$)/i.test(low)
    // …dhe në FUND të mesazhit, pas një ndarësi: "Setup invalid - cancel". E njëjta formë, vetëm
    // e kthyer; pa këtë ajo mbetej krejt e palexuar.
    || /[-–—:,]\s*(?:close|exit|cancel)\s*[.!]?$/i.test(low)
    || /\b(?:closing\s+now|book\s+(?:the\s+)?profits?|get\s+out\s+now|go\s+flat)\b/i.test(low)
    || /\b(?:mbyll(?:e|eni)?|anulo(?:je|jeni)?|dil\s+(?:nga\s+trade|tani))\b/i.test(low);
  if (isExit && !hasStructure) {
    // DREJTIMI I MBYLLJES. "Cancel BUY" duhet të prekë VETËM blerjet — nëse përdoruesi ka edhe një
    // shitje të hapur nga një sinjal tjetër, ajo nuk ka pse të mbyllet bashkë me të. Kur drejtimi
    // nuk shprehet ("close all"), mbetet null dhe mbyllet gjithçka për simbolin, si më parë.
    const isBuyWord = (w: string) => /^(?:buy|long|blerjen)$/i.test(w);

    // A janë emërtuar TË DYJA anët bashkë ("close buy and sell")? Atëherë mbyllet gjithçka.
    //
    // Pranohet VETËM një lidhëz e shprehur — and / & / + / — jo presja dhe jo thjesht hapësira.
    // Arsyeja është një zgjedhje e ndërgjegjshme mes dy gabimeve të mundshme: parseri i heq presjet
    // që në fillim, ndaj "cancel the buy, the sell is still valid" duket identike me "cancel the buy
    // the sell". Po ta trajtonim hapësirën si lidhëz, ajo fjali do të mbyllte edhe shitjen — një
    // pozicion krejt të vlefshëm. Kështu siç është, mbyllet vetëm ana e parë; nëse pronari do të
    // dyja, "close all" e bën punën me një fjalë. Të mbyllësh pak më pak është gabim që rregullohet
    // me një mesazh; të mbyllësh një pozicion që s'duhej mbyllur, jo.
    const both = new RegExp(
      `\\b(?:${VERB_X})\\s+${FILL}(?:${DIR})s?\\s*(?:and|&|\\+|/)\\s*${FILL}(?:${DIR})s?\\b`, "i").test(low);
    const dm = both ? null : low.match(new RegExp(`\\b(?:${VERB_X})\\s+${FILL}(${DIR})s?\\b`, "i"));
    // Kur emërtohet vetëm njëra anë, ajo vlen — edhe nëse ana tjetër përmendet diku tjetër në
    // fjali ("cancel the buy, the sell is still valid"): ajo që pason foljen është urdhri.
    const exitDir: "buy" | "sell" | null = dm ? (isBuyWord(dm[1]) ? "buy" : "sell") : null;
    return { kind: "exit", symbol: symbol ?? defaultSymbol, direction: exitDir, entryType: "market", entryPrice: null, stopLoss: null, tps: [] };
  }

  // 3) MENAXHIM (modify): lëviz SL / breakeven / ndrysho TP-t — pa drejtim të ri.
  // BREAKEVEN — "breakeven", "break-even", ose SL/stop i çuar te hyrja ("SL → BE", "stops at entry").
  // "BE" pranohet VETËM në kontekst SL/stop — përndryshe fjala e zakonshme "be" do të shkaktonte
  // lëvizje të rreme të SL-së në çdo fjali angleze.
  const breakeven = /break\s*-?\s*even/i.test(low)
    || /(?:sl|s\/l|stops?|stop\s*loss)\s*(?:->|→|=|:|\bto\b|\bat\b|\bin\b)\s*(?:\bbe\b|entry|entri|hyrje)/i.test(low)
    // "MOVING BE" — shkurtesa pa fjalën 'SL'. Rasti real, 6 gusht 2026: pas një hyrjeje SELL erdhi
    // "Moving BE at 4061 - buyers are back." dhe roboti e la si koment; SL-të mbetën ku ishin.
    // Rregulli i mëparshëm e pranonte 'BE' VETËM pas 'SL/stop', ndaj kjo formë s'kapej fare.
    //
    // Dy mbrojtje që 'be'-ja e zakonshme angleze të mos lëvizë asnjë stop:
    //   · 'BE' duhet me SHKRONJA TË MËDHA — testohet mbi tekstin origjinal, jo mbi 'low'; kështu
    //     "this will be fine" nuk përputhet kurrë;
    //   · duhet një folje lëvizjeje brenda 24 shkronjave para saj, pra një urdhër, jo një fjali.
    // Çmimi pas saj ("at 4061") NUK merret si SL: breakeven do të thotë SL te HYRJA, dhe rregulli i
    // 'moveSl' kërkon fjalën sl/stop, të cilën kjo formë s'e ka.
    //
    // Folja kërkohet pa dallim shkronjash ("Moving", "moving"), kurse shkurtesa krahasohet e ndarë,
    // që kushti i shkronjave të mëdha të vlejë PIKËRISHT për 'BE' — jo për foljen para saj.
    || (() => {
      const m = text.match(/\b(?:mov(?:e|ing)|go(?:ing)?|set|put|bring|shift|switch|secure)\b[^.\n]{0,24}\b(be)\b/i);
      return !!m && m[1] === "BE";
    })();
  let modSl: number | undefined;
  // Foljet e menaxhimit + "sl|stop|stoploss" (edhe pa fjalën "loss") + to/at/@/=/: + çmimi.
  const VERBS = "move|moving|change|changing|update|updating|set|setting|put|putting|bring|bringing|tighten|tightening|shift|shifting|raise|raising|lower|lowering|secure|securing|adjust|adjusting|vendos|zhvendos|ngri";
  const moveSl = low.match(new RegExp(`(?:${VERBS})[^\\d]{0,24}(?:sl|s\\/l|stop\\s*loss|stoploss|stops?)[^\\d]{0,12}(\\d{2,7}(?:\\.\\d+)?)`, "i"))
    || low.match(/(?:sl|s\/l|stop\s*loss|stoploss|stops?)\s*(?:->|→|to|at|=|:|@)\s*(\d{2,7}(?:\.\d+)?)/i);
  if (moveSl) modSl = parseFloat(moveSl[1]);
  // FORMA E ZHVESHUR: "SL 4085" — pa folje dhe pa shigjetë. Doli gjatë provave të këtij rregullimi:
  // mesazhi klasifikohej 'unknown' dhe injorohej, edhe pse është mënyra më e shkurtër e mundshme për
  // të kërkuar zhvendosjen e stopit. Pranohet VETËM kur mesazhi s'përmban asgjë tjetër — pa drejtim,
  // pa çmim hyrjeje, pa TP — që një sinjal i plotë të cilit i mungon fjala BUY/SELL të mos kthehet
  // gabimisht në urdhër zhvendosjeje të SL-së.
  if (modSl == null && stopLoss != null && direction == null && entryPrice == null
      && tpUpdates.length === 0 && tpNoIdx.length === 0) {
    modSl = stopLoss;
  }
  // TP pa indeks i shprehur si urdhër → zbatohet te TP-ja e secilit leg (idx 1..4).
  const tpCmdUpdates: TpUpdate[] = [];
  if (tpUpdates.length === 0 && tpCmd) {
    const v = parseFloat(tpCmd[1]);
    if (Number.isFinite(v)) for (let i = 1; i <= 4; i++) tpCmdUpdates.push({ idx: i, price: v });
  }
  const allTp = tpUpdates.length > 0 ? tpUpdates : tpCmdUpdates;
  // MBROJTJE: një mesazh me ÇMIM HYRJEJE plus SL/TP është sinjal hyrjeje që s'u lexua dot (p.sh.
  // i mungon fjala BUY/SELL) — jo urdhër menaxhimi. Pa këtë kusht ai binte te dega e mëposhtme dhe
  // do t'i lëvizte SL/TP-të e pozicioneve EKZISTUESE sipas niveleve të një sinjali krejt tjetër.
  // Më mirë të mbetet 'unknown' dhe të duket te raportet, sesa të prekë para mbi një hamendje.
  const looksLikeBrokenEntry = entryPrice != null && (stopLoss != null || allTp.length > 0);
  if (!looksLikeBrokenEntry && (breakeven || modSl != null || allTp.length > 0)) {
    return { kind: "modify", symbol: symbol ?? defaultSymbol, direction: null, entryType: "market", entryPrice: null, stopLoss: null, tps: [],
      mod: { sl: modSl, breakeven, tpUpdates: allTp.length > 0 ? allTp : undefined } };
  }

  return { ...none, symbol };
}


// ================= LEXIMI INTELIGJENT I URDHRAVE (AI) =================
// Rrjet sigurie MBI parserin me rregulla: thirret VETËM kur rregullat s'e kuptuan dot
// mesazhin, por teksti flet për stop/TP/breakeven. Claude NUK vendos asgjë vetë — ai vetëm
// PROPOZON një formë kanonike, dhe kodi e verifikon rreptësisht para se ta pranojë:
//   1) çmimi i propozuar duhet të ndodhet FJALË-PËR-FJALË në mesazhin origjinal;
//   2) çmimi duhet të jetë brenda ±5% të çmimit aktual të arit;
//   3) drejtimi mbrojtës i SL-së kontrollohet më vonë te zbatimi (SL vetëm shtrëngohet).
// Nëse ndonjë verifikim dështon → propozimi hidhet dhe regjistrohet për Adminin.
// deno-lint-ignore no-explicit-any
async function aiNormalizeOrder(db: any, text: string): Promise<string | null> {
  const log = async (decision: string, out: string | null, reason: string | null) => {
    try { await db.from("signal_ai_log").insert({ text_in: text.slice(0, 2000), text_out: out, decision, reason }); } catch { /* */ }
  };
  try {
    // RREGULLIM KRITIK (auditim, 3 gusht 2026): kërkohej slug-u "claude", por rreshti në bazë
    // — dhe çdo funksion tjetër (expert-room, lab-trades, strategy-advisor) — përdor "anthropic".
    // Pra 'prov' dilte gjithmonë null, çelësi mungonte dhe funksioni kthehej PA asnjë gjurmë:
    // rrjeti i sigurisë me AI ishte i fjetur që nga dita e parë, pa u vënë re fare.
    const { data: prov } = await db.from("ai_providers")
      .select("api_key_encrypted, model, slug").in("slug", ["anthropic", "claude"])
      .eq("is_active", true).limit(1).maybeSingle();
    const key = prov?.api_key_encrypted;
    // Mungesa e çelësit REGJISTROHET tani — përndryshe s'kishte si ta merrje vesh që AI-ja hesht.
    if (!key) { await log("rejected", null, "asnjë ofrues AI aktiv me çelës (ai_providers)"); return null; }

    // Modeli: ai i konfiguruar, ose një i njohur si aktual. Nëse i konfiguruari s'pranohet më
    // (id i vjetruar), provohet një herë me modelin rezervë — një klasifikues sigurie s'duhet
    // të bjerë vetëm se emri i modelit ka ndërruar.
    const FALLBACK_MODEL = "claude-sonnet-5";
    const callAI = (model: string) => fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        model,
        max_tokens: 120,
        system: "You classify trade-management messages from a gold (XAUUSD) signal channel. "
          + "Answer ONLY with compact JSON, no prose. Schema: "
          + '{"action":"breakeven"|"sl"|"tp"|"close"|"none","price":number|null,"tpIndex":1|2|3|4|null,'
          + '"direction":"buy"|"sell"|null}. '
          + 'Use "breakeven" when the author asks to move the stop to entry/break-even. '
          + 'Use "sl" with the exact numeric price when they ask to move the stop loss to a price. '
          + 'Use "tp" when they ask to change a take profit. '
          + 'Use "close" when they tell readers to close, exit or cancel an existing trade or a '
          + 'pending order — set "direction" to buy or sell when they name one (e.g. "cancel the buy"), '
          + 'otherwise null. Do NOT use "close" for market commentary about price closing above or '
          + 'below a level. Use "none" if it is commentary, '
          + "an opinion, a market observation, or anything that is not an explicit instruction. "
          + "Never invent a price that is not written in the message. When unsure, answer none.",
        messages: [{ role: "user", content: text.slice(0, 1500) }],
      }),
    });

    let resp = await callAI(prov.model || FALLBACK_MODEL);
    if (!resp.ok && (prov.model || FALLBACK_MODEL) !== FALLBACK_MODEL) {
      const first = await resp.text().catch(() => "");
      if (/model/i.test(first) || resp.status === 404) resp = await callAI(FALLBACK_MODEL);
    }
    if (!resp.ok) {
      const errTxt = await resp.text().catch(() => "");
      await log("rejected", null, `Anthropic ${resp.status}: ${errTxt.slice(0, 160)}`);
      return null;
    }
    const j = await resp.json().catch(() => ({}));
    const raw = String(j?.content?.[0]?.text || "").trim();
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) { await log("rejected", null, "përgjigje jo-JSON"); return null; }
    const out = JSON.parse(m[0]) as { action?: string; price?: number | null; tpIndex?: number | null; direction?: string | null };
    const action = String(out.action || "none");
    if (action === "none") { await log("none", null, null); return null; }

    if (action === "breakeven") { await log("breakeven", "BREAKEVEN", null); return "BREAKEVEN"; }

    // MBYLLJE. Nuk ka çmim për të verifikuar, ndaj i vetmi kufizim është që drejtimi, kur jepet,
    // të përmendet vërtet në mesazh — që AI-ja të mos shpikë një "cancel the sell" nga një tekst
    // ku shitja as nuk figuron. Forma kanonike lexohet pastaj nga parseri deterministik.
    if (action === "close") {
      const dir = String(out.direction || "").toLowerCase();
      const named = dir === "buy" || dir === "sell";
      if (named && !new RegExp(`\\b(?:${dir}|${dir === "buy" ? "long" : "short"})s?\\b`, "i").test(text)) {
        await log("rejected", null, `drejtimi '${dir}' nuk përmendet në mesazh`); return null;
      }
      const c = named ? `CLOSE ${dir.toUpperCase()}` : "CLOSE XAUUSD";
      await log("close", c, null); return c;
    }

    const price = Number(out.price);
    if (!Number.isFinite(price) || price <= 0) { await log("rejected", null, "pa çmim të vlefshëm"); return null; }

    // VERIFIKIM 1 — çmimi duhet të shkruhet realisht në mesazh (kundër halucinacionit).
    const digits = String(Math.round(price));
    if (!new RegExp(`\\b${digits}(?:\\.\\d+)?\\b`).test(text.replace(/,/g, ""))) {
      await log("rejected", null, `çmimi ${price} nuk gjendet në mesazh`); return null;
    }
    // VERIFIKIM 2 — brenda ±5% të çmimit aktual të arit.
    const { data: asset } = await db.from("assets").select("current_price").eq("symbol", "XAUUSD").maybeSingle();
    const mkt = Number(asset?.current_price);
    if (Number.isFinite(mkt) && mkt > 0 && Math.abs(price - mkt) / mkt > 0.05) {
      await log("rejected", null, `çmimi ${price} jashtë ±5% të tregut (${mkt})`); return null;
    }

    if (action === "sl") { const c = `MOVE SL ${price}`; await log("sl", c, null); return c; }
    if (action === "tp") {
      const idx = Number(out.tpIndex);
      const c = idx >= 1 && idx <= 4 ? `TP${idx} ${price}` : `CHANGE TP ${price}`;
      await log("tp", c, null); return c;
    }
    await log("rejected", null, `veprim i panjohur: ${action}`); return null;
  } catch (e) {
    await log("rejected", null, (e as Error).message); return null;
  }
}

// PORTA E URDHRIT — a duhet pyetur AI-ja për këtë mesazh, dhe pse.
//
// Kthen 'ruled' (vendimi i rregullave) dhe 'needsAi'. Dy raste e ndezin AI-në:
//   · SHPËTIM — teksti flet për stop/TP/mbyllje por rregullat s'kuptuan asgjë ('unknown');
//   · VETO   — rregullat thanë urdhër, POR urdhri nuk qëndron i vetëm te rreshti i parë i shkurtër,
//              pra teksti është rrëfim me fjalë urdhri brenda.
//
// Pse pikërisht rreshti i parë: te të dhënat reale urdhrat vijnë të shkurtër dhe në krye
// ("CLOSE NOW", "MOVE SL 4050", "⚠️ CLOSE THE POSITION NOW"), ndërsa rrëfimi i shpërndan fjalët
// brenda fjalive ("My SL setup … should soon be at break even and I am still holding"). Kufiri
// 40 shkronja i mban urdhrat e vërtetë JASHTË thirrjes së AI-së — pa vonesë, pa kosto, pa varësi
// nga rrjeti për rastin që ndodh më shpesh.
function orderGate(text: string): { ruled: string; needsAi: boolean } {
  // Fjalët që e ndezin fare shqyrtimin. Përveç atyre teknike, edhe parafrazat e zakonshme të
  // daljes: "get out", "off the table", "go flat". Pa to, një urdhër i thënë me fjalë të thjeshta
  // ("guys, get out of this one") nuk arrinte as te rregullat as te AI-ja — e gjeti testi.
  // Zgjerimi është i sigurt: kjo vetëm VENDOS nëse pyetet Claude, dhe ai është i udhëzuar
  // shprehimisht të përgjigjet "none" kur s'është udhëzim i qartë.
  const mgmt = /\b(sl|s\/l|stop|stops|stoploss|stop\s*loss|tp|take\s*profit|break\s*-?\s*even|close|closing|cancel|exit|flat|mbyll\w*|anulo\w*|dil)\b/i.test(text)
    || /\bget\s+out\b|\boff\s+the\s+table\b|\bgo\s+flat\b/i.test(text)
    // 'BE' me shkronja të mëdha — shkurtesa e breakeven-it. Me shkronja të vogla do të përputhej
    // folja më e zakonshme e anglishtes dhe AI-ja do të pyetej për çdo bisedë; kështu pyetet vetëm
    // kur dikush e shkruan si shkurtesë. Format që rregullat s'i kapin dot ("BE now") mbërrijnë
    // kështu te Claude në vend që të biem në heshtje.
    || /\bBE\b/.test(text);
  const ruled = parseSignal(text, "XAUUSD").kind;
  if (!mgmt) return { ruled, needsAi: false };
  if (ruled === "unknown") return { ruled, needsAi: true };
  if (ruled !== "modify" && ruled !== "exit") return { ruled, needsAi: false };
  const firstLine = text.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
  const compact = firstLine.length <= 40 && parseSignal(firstLine, "XAUUSD").kind === ruled;
  return { ruled, needsAi: !compact };
}

// Chat-id sintetik për sinjalet që vijnë nga PLATFORMA e vetë përdoruesit (jo Telegram).
const PLATFORM_CHAT_ID = "platform";

// Gjurma e përmbajtjes (hash FNV-1a) — identifikon sinjalin nga TEKSTI i tij, jo nga id-ja e
// burimit. Përdoret për të përjashtuar dublimin kur i njëjti sinjal vjen nga dy rrugë të
// pavarura (webhook-u i drejtpërdrejtë i platformës + poller-i i feed-it).
function contentHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

// ---------- SINJAL I STRUKTURUAR nga platforma e VETË përdoruesit ----------
// Platforma jote e analizave/sinjaleve dërgon JSON të pastër → e kthejmë në tekstin kanonik që
// parseSignal e kupton, dhe kalon nëpër TË NJËJTIN zinxhir si Telegrami (trade + tabela + raporte).
// deno-lint-ignore no-explicit-any
function structuredToText(p: any): string {
  const action = String(p.action || "signal").toLowerCase();
  const sym = String(p.symbol || "XAUUSD").toUpperCase();
  if (action === "close" || action === "exit") return `close ${sym}`;
  if (action === "modify") {
    const parts: string[] = [sym];
    if (p.breakeven) parts.push("breakeven");
    if (p.sl_to != null) parts.push(`move SL to ${p.sl_to}`);
    const tps: number[] = Array.isArray(p.tps) ? p.tps : [];
    tps.forEach((t, i) => parts.push(`TP${i + 1} ${t}`));
    return parts.join("\n");
  }
  if (action === "message" && p.message) return String(p.message);
  // "signal" (parazgjedhje): hyrje e re
  const dir = String(p.direction || p.side || "").toLowerCase() === "sell" ? "SELL" : "BUY";
  const lines: string[] = [`${dir} ${sym}`];
  const entry = p.entry ?? p.entry_price ?? p.price;
  if (entry != null) lines.push(`Entry ${entry}`);
  const sl = p.sl ?? p.stop_loss;
  if (sl != null) lines.push(`SL ${sl}`);
  const tps: number[] = Array.isArray(p.tps) ? p.tps : (p.tp != null ? [p.tp] : (p.target_price != null ? [p.target_price] : []));
  tps.forEach((t, i) => lines.push(`TP${i + 1} ${t}`));
  return lines.join("\n");
}

// Tekstet rreth sinjalit (ballina / mbyllja / fundi) vijnë nga 'gold_sniper_config' dhe secili ka
// çelësin e vet ON/OFF (4 gusht 2026). Më parë mbyllja ishte e fiksuar si "Good luck! 🥇" në kod,
// pra ndryshimi i saj kërkonte rilëshim. Kur çelësi është OFF, rreshti nuk shfaqet fare.
// deno-lint-ignore no-explicit-any
function msgTexts(gs: any): { header: string; note: string; footer: string } {
  return {
    header: gs?.header_enabled === false ? "" : String(gs?.header ?? ""),
    note: gs?.note_enabled === false ? "" : String(gs?.note ?? "Good luck! 🥇"),
    footer: gs?.footer_enabled === false ? "" : String(gs?.footer ?? ""),
  };
}

// Teksti i sinjalit për kanalin GoldSniper (anglisht, HTML) — sinjalet e platformës janë të pronarit.
// deno-lint-ignore no-explicit-any
function fmtChannelSignal(header: string, footer: string, note: string, p: any): string {
  const dir = String(p.direction || p.side || "").toLowerCase();
  const dirLabel = dir === "sell" ? "🔴 SELL" : "🟢 BUY";
  const sym = String(p.symbol || "XAUUSD").toUpperCase();
  const entry = p.entry ?? p.entry_price ?? p.price;
  const sl = p.sl ?? p.stop_loss;
  const tps: number[] = Array.isArray(p.tps) ? p.tps : (p.tp != null ? [p.tp] : []);
  const lines: string[] = [];
  if (header) lines.push(header, "");
  lines.push(`${dirLabel} <b>${sym}</b>`);
  if (entry != null) lines.push(`📍 Entry: <b>${entry}</b>`);
  if (sl != null) lines.push(`🛑 SL: <b>${sl}</b>`);
  tps.forEach((tp, i) => lines.push(`🎯 TP${i + 1}: <b>${tp}</b>`));
  // Shënimi i vetë sinjalit (p.note) ka përparësi; nëse s'ka, përdoret ai i konfigurimit.
  // Kur çelësi i mbylljes është OFF, 'note' vjen bosh dhe rreshti hiqet krejt.
  const closing = p.note ? String(p.note) : note;
  if (closing) lines.push("", closing);
  if (footer) lines.push("", footer);
  return lines.join("\n");
}

// AUTO-FORWARD: poston sinjalin e platformës te kanali GoldSniper i PRONARIT (idempotent).
// deno-lint-ignore no-explicit-any
async function postToOwnerChannel(db: ReturnType<typeof createClient>, userId: string, messageId: number, ps: any): Promise<Record<string, unknown>> {
  const { data: gs } = await db.from("gold_sniper_config").select("*").eq("user_id", userId).maybeSingle();
  if (!gs || !gs.auto_send || !gs.bot_token || !gs.channel_id) return { skip: "no_channel" };
  const srcId = `platform-${messageId}`;
  const { data: dup } = await db.from("gold_sniper_posts").select("id").eq("user_id", userId).eq("source_signal_id", srcId).limit(1);
  if (dup && dup.length > 0) return { skip: "duplicate" };
  const tx = msgTexts(gs);
  const text = fmtChannelSignal(tx.header, tx.footer, tx.note, ps);
  const resp = await fetch(`https://api.telegram.org/bot${gs.bot_token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: gs.channel_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const tg = await resp.json().catch(() => ({}));
  const ok = !!tg.ok;
  const tps: number[] = Array.isArray(ps.tps) ? ps.tps : (ps.tp != null ? [ps.tp] : []);
  await db.from("gold_sniper_posts").insert({
    user_id: userId, symbol: ps.symbol ?? "XAUUSD", direction: (ps.direction ?? ps.side) ?? null,
    entry: (ps.entry ?? ps.entry_price) ?? null, stop_loss: (ps.sl ?? ps.stop_loss) ?? null, tps,
    note: ps.note ?? null, message: text, telegram_message_id: ok ? (tg.result?.message_id ?? null) : null,
    status: ok ? "sent" : "failed", error: ok ? null : (tg.description || "dërgimi dështoi"), source_signal_id: srcId,
  });
  return ok ? { ok: true, message_id: tg.result?.message_id } : { ok: false, error: tg.description };
}

// ---------- Push notification te aplikacioni (web-push-send) ----------
// 'pref: signals' → respektohet çelësi te profiles.notification_preferences: kush e fik
// te Cilësimet nuk merr më njoftime sinjalesh (të tjerët i marrin si më parë).
async function pushNotify(payload: { user_id: string; title: string; body: string; url?: string; tag?: string }) {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/web-push-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify({ ...payload, pref: "signals" }),
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
      // Porosia u zhduk te brokeri PA u mbushur (anuluar/skaduar) → edhe SINJALI shënohet 'canceled'
      // (Anuluar/Cancel në raporte) kur s'ka legs të tjera aktive — jo "Në pritje" përgjithmonë.
      await db.from("telegram_trades").update({ status: "closed", closed_at: now, reason: "Anuluar — porosia s'është më te brokeri (pa u mbushur)" }).eq("id", t.id);
      t.status = "closed"; changed++;
      if (t.signal_id) {
        const still = rows.some((x) => x.id !== t.id && String(x.signal_id) === String(t.signal_id) && ["open", "pending"].includes(x.status));
        if (!still) await db.from("telegram_signals").update({ status: "canceled" }).eq("id", t.signal_id).in("status", ["executed", "partial", "pending"]);
      }
    }
  }

  // (Toleranca e hyrjes ±$1 u HOQ me kërkesë të pronarit — dërguesit e sinjaleve thanë që hyrja
  // pa e arritur çmimi SAKTËSISHT nivelin e tyre nuk vlen. Pending mbushet vetëm me prekje të saktë.)

  // 1.6) SKADIMI I PENDING-ut pas 5 min u HOQ me kërkesë të pronarit.
  // Arsyeja: dërguesit e sinjaleve zakonisht dërgojnë vetë një mesazh "mbylleni/anulojeni" kur
  // çmimi s'e prek hyrjen — dhe atë e trajton dega e mbylljes (exit). Porosia në pritje mbetet
  // aktive derisa: (a) çmimi ta prekë hyrjen, (b) të vijë urdhri "mbyll" nga kanali, ose
  // (c) ta anulosh vetë nga tabela e porosive në pritje (Trade Live / ekran i plotë).

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
      // P&L + çmimi i daljes nga deal-et e pozicionit → raportet tregojnë pips + fitimin/humbjen.
      let net: number | null = null, exitPx: number | null = null;
      try {
        // deno-lint-ignore no-explicit-any
        const deals = await maGet(cfg, `/history-deals/position/${g.metaapi_position_id}`) as any[];
        if (Array.isArray(deals) && deals.length > 0) {
          net = Math.round(deals.reduce((s, d) => s + (Number(d.profit) || 0) + (Number(d.commission) || 0) + (Number(d.swap) || 0), 0) * 100) / 100;
          const out = deals.find((d) => /OUT/i.test(String(d.entryType || "")));
          if (out && Number(out.price) > 0) exitPx = Number(out.price);
        }
      } catch { /* raportohet pa P&L nëse historia s'lexohet dot tani */ }
      await db.from("telegram_trades").update({
        status: "closed", closed_at: now, reason,
        ...(net != null ? { net } : {}), ...(exitPx != null ? { exit_price: exitPx } : {}),
      }).eq("id", g.id);
      g.status = "closed"; g.reason = reason; changed++;
    }
    // Të gjitha legs u mbyllën → shëno edhe SINJALIN 'closed' (raporti: tp_hit>0 = fitim deri te TPn; 0 = SL).
    if (gone.length > 0 && alive.length === 0 && legs[0].signal_id) {
      await db.from("telegram_signals").update({ status: "closed" }).eq("id", legs[0].signal_id).in("status", ["executed", "partial", "pending"]);
      // PUSH: mbyllja FINALE e trade-it (fitim total / SL / mbyllje manuale te brokeri).
      try {
        const { data: sumRows } = await db.from("telegram_trades").select("net").eq("signal_id", legs[0].signal_id);
        const totalNet = Math.round((sumRows ?? []).reduce((s, r) => s + (Number((r as { net?: number }).net) || 0), 0) * 100) / 100;
        const sym0 = legs[0].symbol || "XAUUSD";
        const win = totalNet >= 0;
        await pushNotify({
          user_id: userId,
          title: `${win ? "✅ Trade closed in profit" : "🛑 Trade closed"} — ${sym0}`,
          body: `${win ? "Profit" : "Loss"} ${totalNet >= 0 ? "+" : ""}${totalNet.toFixed(2)}$ — GoldSniperFX`,
          url: "/", tag: `tgsin-closed-${String(legs[0].signal_id).slice(0, 8)}`,
        });
      } catch { /* push jo-kritik */ }
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
          title: `🎯 TP${k} hit — ${sym} ${isBuy ? "BUY" : "SELL"}`,
          body: `Price reached TP${k} (${tps[k - 1]})${nextSl ? ` · SL moves to ${nextSl === "breakeven" ? "breakeven" : nextSl}` : ""} — GoldSniperFX`,
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
  // SINJAL I STRUKTURUAR nga platforma jote (jo Telegram): { signal: {...} } ose { action/direction, ... }
  // deno-lint-ignore no-explicit-any
  const ps: any = (update.signal && typeof update.signal === "object") ? update.signal
    : (update.action || update.direction || update.side) ? update : null;
  let text: string, chatId: string, messageId: number, sender: string;
  if (ps) {
    text = structuredToText(ps);
    chatId = String(ps.source_id || PLATFORM_CHAT_ID);
    messageId = Number(ps.id ?? Date.now());
    sender = String(ps.source || "GoldSniper|FX");
  } else {
    // KANALI I TELEGRAMIT NUK E KOMANDON ROBOTIN (5 gusht 2026 — vendim i pronarit).
    //
    // Roboti i merr urdhrat VETËM nga burimet tona të njohura, që të gjitha dërgojnë 'signal':
    // platforma e pronarit (webhook + poller i feed-it) dhe konsola e Adminit. Një update i papërpunuar
    // Telegrami — pra dikush që shkruan te kanali — nuk përpunohet më.
    //
    // Praktikisht kjo rrugë s'ka sjellë kurrë asgjë: nga 459 mesazhe të përpunuara ndonjëherë, TË
    // GJITHA kanë ardhur me chat 'platform'. Por kodi e pranonte, dhe mjaftonte që dikush të regjistronte
    // një webhook te Telegrami që biseda e kanalit — komente, shaka, mendime me fjalën "close" brenda —
    // të fillonte t'i prekte pozicionet e njerëzve. Dera mbyllet me vetëdije, jo nga rastësia e
    // konfigurimit.
    return json({ ok: true, skip: "telegram_chat_not_a_command_source" });
  }
  // history=true (rilexim nga forwarder-i): regjistro/shfaq mesazhin, por MOS hap tregti.
  const history = update.history === true;

  // REZERVIM SIPAS PËRMBAJTJES (kundër dublimit NDËR-BURIMOR): i njëjti sinjal vjen nga dy
  // rrugë të pavarura — webhook-u i drejtpërdrejtë i platformës (i pari, real-time) dhe
  // poller-i i feed-it (~2s më vonë, rrjet sigurie). Identifikimi me id dështon se secila
  // rrugë ka id të vetat; PËRMBAJTJA është e njëjtë. Kushdo që e sjell i dyti humbet
  // rezervimin dhe del menjëherë — pa trade, pa rreshta, pa postim në kanal.
  // Sinjalet: kovë ditore (i njëjti tekst brenda ditës = dublim). Mesazhet (MOVE SL etj.):
  // kovë orare — i njëjti urdhër mund të përsëritet legjitimisht më vonë gjatë ditës.
  //
  // RREGULLIM (auditim, 3 gusht 2026): ky bllok ekzekutohej vetëm kur mesazhi vinte si sinjal i
  // STRUKTURUAR ('ps'). Rruga e poller-it dërgon një update në formë Telegram-i, pra 'ps' është
  // null dhe rezervimi kapërcehej krejt — prej andej kalonin dublikatet ndër-burimore. Tani
  // vlen për ÇDO rrugë.
  if (!history) {
    // (a) REZERVIM ATOMIK SIPAS ID-së SË MESAZHIT. Kontrolli i dikurshëm ishte
    //     "select → nëse s'ka, insert", pra dy thirrje njëkohshme e kalonin të dyja: gjetëm
    //     në bazë të njëjtin tg_message_id të shkruar dy herë me 12 ms diferencë. Upsert-i me
    //     'ignoreDuplicates' e zgjidh në nivel baze — vetëm i pari fiton.
    if (messageId) {
      const midKey = `mid:${chatId}:${messageId}`;
      const { data: midClaim, error: midErr } = await db.from("platform_feed_seen")
        .upsert({ feed_id: midKey, status: "msg-claim" }, { onConflict: "feed_id", ignoreDuplicates: true })
        .select("feed_id");
      if (midErr || !midClaim || midClaim.length === 0) return json({ ok: true, skip: "duplicate_message" });
    }
    // (b) REZERVIM SIPAS PËRMBAJTJES — kap dublimin kur dy burimet kanë id të ndryshme.
    //     Sinjalet: kovë ditore. Urdhrat e menaxhimit (BREAKEVEN, CLOSE NOW): kovë orare,
    //     sepse i njëjti urdhër mund të përsëritet ligjshëm më vonë gjatë ditës.
    const isMsg = ps
      ? String(ps.action || "signal").toLowerCase() === "message"
      : parseSignal(text, "XAUUSD").kind !== "entry";
    const bucket = new Date().toISOString().slice(0, isMsg ? 13 : 10);
    const fp = `fp:${isMsg ? "msg" : "sig"}:${bucket}:${contentHash(text.trim())}`;
    const { data: fpClaim, error: fpErr } = await db.from("platform_feed_seen")
      .upsert({ feed_id: fp, status: "content-claim" }, { onConflict: "feed_id", ignoreDuplicates: true })
      .select("feed_id");
    if (fpErr || !fpClaim || fpClaim.length === 0) return json({ ok: true, skip: "duplicate_content" });
  }

  // RRJETI I SIGURISË ME AI — tani në TË DY DREJTIMET.
  //
  // Deri më 5 gusht AI-ja thirrej VETËM kur rregullat dështonin. Domethënë mund të shpëtonte një
  // urdhër të humbur, por s'kishte si ta ndalte një të rremë. Dhe pikërisht të rremët u gjetën te
  // të dhënat: tri mesazhe rrëfyese u lexuan si urdhra —
  //
  //   "…my position from yesterday will reach break even, allowing me to exit without a loss"
  //   "My SL setup from yesterday should soon be at break even and I am still holding"
  //   "SL 4087 - That's a crazy, manipulative day. No more trades for me today"
  //
  // Të treja janë rrëfim i autorit për pozicionin e VET, jo udhëzim për lexuesin. Roboti do t'u
  // kishte lëvizur SL-në përdoruesve; nuk ndodhi vetëm sepse atë çast s'kishte pozicione hapur.
  // Rregullat gjykojnë me FJALË, jo me QËLLIM: "break even" është njësoj në të dyja rastet.
  //
  // Ndarja që funksionon te të dhënat reale: urdhrat janë TË SHKURTËR dhe urdhërorë ("CLOSE NOW",
  // "MOVE SL 4050", "BREAKEVEN"), kurse rrëfimi është i gjatë. Prandaj:
  //   · rreshti i parë i shkurtër që lexohet si urdhër → zbatohet menjëherë, pa AI (pa vonesë);
  //   · çdo gjë tjetër që rregullat e quajtën urdhër → i kërkohet Claude-it konfirmim;
  //   · në dyshim NUK veprohet (vendim i pronarit, 5 gusht): një urdhër i humbur rregullohet me
  //     një mesazh të dytë, një SL i lëvizur gabimisht mbi para reale nuk kthehet.
  //
  // Vlen për ÇDO rrugë tani — më parë kushti 'ps' e përjashtonte krejt atë që shkruhet drejt te
  // Telegrami, pra pikërisht kanalin ku shkruhen komentet e gjata.
  let vetoed = false;
  if (!history) {
    const { ruled, needsAi } = orderGate(text);
    if (needsAi) {
      const { data: gsCfg } = await db.from("gold_sniper_config")
        .select("ai_parse_enabled").not("channel_id", "is", null).limit(1).maybeSingle();
      if (gsCfg?.ai_parse_enabled !== false) {
        const canonical = await aiNormalizeOrder(db, text);
        if (canonical) text = canonical;
        else if (ruled !== "unknown") vetoed = true; // AI s'e pa urdhër (ose s'u arrit) → mos vepro
      }
    }
  }

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
    try { results.push({ user: String(c.user_id).slice(0, 8), ...(await processForUser(db, c, { text, chatId, messageId, sender, history, vetoed })) }); }
    catch (e) { results.push({ user: String(c.user_id).slice(0, 8), error: (e as Error).message }); }
  }

  // AUTO-FORWARD te kanali GoldSniper i PRONARIT: sinjalet e platformës janë 100% të tijat →
  // postohen automatik te kanali (nëse auto_send + bot + kanal). Vetëm hyrje e re, jo histori.
  let channel: Record<string, unknown> | null = null;
  if (ps && !history && String(ps.action || "signal").toLowerCase() === "signal") {
    channel = await postToOwnerChannel(db, cfgRow.user_id, messageId, ps).catch((e) => ({ error: (e as Error).message }));
  }
  return json({ ok: true, results, channel });
});

// Përpunon një mesazh kanali për NJË përdorues: filtra → idempotencë → parametrat për kanal →
// parse → modify/exit/entry — gjithçka në llogarinë dhe me cilësimet e ATIJ përdoruesi.
// deno-lint-ignore no-explicit-any
async function processForUser(db: ReturnType<typeof createClient>, cfgRow: any, m: { text: string; chatId: string; messageId: number; sender: string; history?: boolean; vetoed?: boolean }): Promise<Record<string, unknown>> {
  const { text, chatId, messageId, sender } = m;
  const history = m.history === true;
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

  // RILEXIM HISTORIK (backfill): regjistro/shfaq mesazhin, por MOS ekzekto asnjë tregti.
  if (history) { await finish("ignored", "📥 histori (rilexim) — pa tregti"); return json({ ok: true, kind: "history" }); }
  // VETO E RRJETIT TË SIGURISË: rregullat e lexuan si urdhër, por teksti është i gjatë/rrëfyes dhe
  // AI-ja nuk e konfirmoi (ose s'u arrit). Regjistrohet që të duket te raporti — por nuk preket
  // asnjë pozicion. Kështu një koment i gjatë s'e lëviz më SL-në e askujt.
  if (m.vetoed === true) {
    await finish("ignored", "🛑 duket koment, jo urdhër — nuk u zbatua (kontroll AI)");
    return json({ ok: true, kind: "vetoed" });
  }

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
      // SIGURESË: SL-ja lejohet të lëvizë VETËM në drejtim MBROJTËS (të shtrëngohet).
      // Për BUY do të thotë lart, për SELL poshtë. Një urdhër që e zgjeron SL-në — qoftë nga
      // teksti i dërguesit, qoftë nga leximi me AI — do të rriste humbjen maksimale; injorohet.
      const curSl = Number(t.stop_loss);
      const isBuy = String(t.action || "").toUpperCase().includes("BUY");
      const loosening = Number.isFinite(curSl) && curSl > 0 && Number.isFinite(newSl)
        && (isBuy ? newSl < curSl : newSl > curSl);
      const slChanged = applySl && !loosening && Number.isFinite(newSl) && newSl !== Number(t.stop_loss);
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
    // PUSH: lëvizja e SL / kalimi në breakeven — pa këtë, përdoruesi nuk merrte vesh se
    // rreziku i pozicionit të tij sapo ndryshoi.
    if (changed > 0) {
      const be = !!p.mod?.breakeven;
      await pushNotify({
        user_id: cfgRow.user_id,
        title: be ? `🔒 Risk-free — ${tradeSym}` : `🔧 Stop loss moved — ${tradeSym}`,
        body: be
          ? `Stop loss moved to entry (breakeven) on ${changed} position${changed > 1 ? "s" : ""} — your risk is now zero.`
          : `${[...new Set(notes)].join(" · ") || `${changed} position${changed > 1 ? "s" : ""} updated`} — GoldSniperFX`,
        url: "/", tag: `gsfx-modify-${signalId ?? messageId}`,
      });
    }
    if (cfgRow.bot_token) await tgReply(cfgRow.bot_token, chatId, `🔧 Telegram Sin: ${changed} ndryshime (${tradeSym})${notes.length ? "\n" + [...new Set(notes)].join(", ") : ""}.`);
    return json({ ok: true, kind: "modify", changed });
  }

  // ===== DALJE: mbyll pozicionet HAPUR + anulo porositë NË PRITJE të Telegram Sin për këtë simbol =====
  if (p.kind === "exit") {
    const { data: openTrades } = await db.from("telegram_trades").select("*")
      .eq("user_id", cfgRow.user_id).in("status", ["open", "pending"]);
    // Drejtimi, kur urdhri e ka thënë ("Cancel BUY"): preken vetëm tregtitë e atij drejtimi.
    // Pa drejtim ("close all") mbyllet gjithçka për simbolin, si më parë.
    const wantDir = p.direction ? String(p.direction).toLowerCase() : null;
    const toClose = (openTrades || [])
      .filter((t) => same(t.symbol || "", tradeSym) || same(t.symbol || "", p.symbol || ""))
      .filter((t) => !wantDir || String(t.action || "").toLowerCase() === wantDir);
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
      } else {
        // As porosi, as pozicion te brokeri — rresht i mbetur pezull. Mbyllet lokalisht, që të mos
        // rrijë përjetësisht 'pending' dhe të mos i bllokojë hyrjet e ardhshme te kufiri i hapjeve.
        await db.from("telegram_trades").update({ status: "closed", closed_at: new Date().toISOString(), reason: "Telegram: exit (pa referencë te brokeri)" }).eq("id", t.id);
        canceled++;
      }
    }
    const total = closed + canceled;
    await finish(total > 0 ? "closed" : "ignored", total > 0 ? null : "asnjë pozicion/porosi për mbyllje");
    // PUSH: dalje me urdhër (mbyll pozicionet / anulo pending).
    if (total > 0) {
      await pushNotify({
        user_id: cfgRow.user_id,
        title: `🚪 Exit — ${tradeSym}`,
        body: `${closed} position${closed > 1 ? "s" : ""} closed${canceled > 0 ? ` · ${canceled} pending order${canceled > 1 ? "s" : ""} canceled` : ""} — GoldSniperFX`,
        url: "/", tag: `tgsin-exit-${signalId ?? messageId}`,
      });
    }
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

  // Kufizim pozicionesh PËR KANAL (numëron vetëm trade-t e sinjaleve të KËTIJ kanali).
  // RREGULLIM (auditim, 3 gusht 2026): më parë merreshin 500 sinjalet e kanalit PA renditje dhe
  // filtrohej mbi to. Me historik mbi 500 rreshta (arrihet për pak javë), sinjalet e reja mund
  // të mbeteshin jashtë atij grupi → pozicionet e tyre nuk numëroheshin → kufiri 'max_open'
  // tejkalohej pa u vënë re. Tani nisemi nga trade-t E HAPURA (grup i vogël, i kufizuar vetiu)
  // dhe pyesim vetëm për sinjalet e tyre — saktë pavarësisht sa i gjatë bëhet historiku.
  const { data: openNow } = await db.from("telegram_trades").select("id, signal_id")
    .eq("user_id", cfgRow.user_id).in("status", ["open", "pending"]);
  const openSigIds = [...new Set((openNow || []).map((r) => r.signal_id).filter(Boolean))];
  let openCount = 0;
  if (openSigIds.length > 0) {
    const { data: chSigIds } = await db.from("telegram_signals").select("id")
      .eq("user_id", cfgRow.user_id).eq("tg_chat_id", chatId).in("id", openSigIds);
    const idSet = new Set((chSigIds || []).map((r) => r.id));
    openCount = (openNow || []).filter((r) => r.signal_id && idSet.has(r.signal_id)).length;
  }
  const room = Math.max(0, eff.max_open - openCount);
  if (room <= 0) { await finish("rejected", `Max pozicione të hapura për kanalin (${eff.max_open})`); return json({ ok: true, error: "max_open" }); }
  plan = plan.slice(0, room);

  // PAVARËSI E PLOTË (kërkesa e pronarit, 3 gusht 2026): roboti i sinjaleve GoldSniperFX nuk
  // merr asnjë kufizim nga faqja e Cilësimeve të robotëve të tjerë. Më parë loti shkurtohej me
  // 'metaapi_config.max_lot' — pra vlera e vendosur te "Konfigurimi i Sinjaleve" mund të
  // mbivendosej pa asnjë shpjegim (p.sh. 0.10 aty, por hapej 0.01). Burimi i VETËM i lotit është
  // faqja e vet: telegram_sin_channels.lot → telegram_sin_config.lot.
  // Nga 'metaapi_config' merret vetëm LIDHJA (account_id, token, region, mode).
  //
  // GABIMI 10016 ("invalid stops"): brokeri e refuzon distancën e SL-së që kërkon sinjali, sepse në
  // atë çast stops-level-i i tij është më i gjerë (hapja e së dielës, lajme, spread i trashë).
  // VENDIM I PRONARIT (3 gusht 2026): hyrja të MOS bllokohet — ndodh vetëm në disa raste, jo në çdo
  // tregti. Por meqë tregtia hapet me rrezik më të madh se sa thotë sinjali, pronari NJOFTOHET sa
  // herë ndodh: push në aplikacion, shënim te raporti i tregtisë dhe rresht te përgjigjja në Telegram.
  let executed = 0; const details: string[] = [];
  const widened: string[] = [];
  for (const leg of plan) {
    const vol = Math.round(leg.vol * 100) / 100;
    const tp = Math.round(leg.tp * 100) / 100;
    const tradeBody: Record<string, unknown> = {
      actionType: pending ? pendingType : (isBuy ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL"),
      symbol: tradeSym, volume: vol, comment: `${TG_TAG}${leg.idx}`, stopLoss: sl, takeProfit: tp,
    };
    if (pending) tradeBody.openPrice = Math.round(ref * 100) / 100; // çmimi ku pret të mbushet
    let r = await maTrade(cfg, tradeBody);
    // 10016 (invalid stops) → zgjero SL/TP 1.5×, provo edhe një herë
    const rb0 = r.body as { numericCode?: number } | null;
    let legWidened = false;
    if (!(r.ok && brokerResult(r.body).ok) && rb0?.numericCode === 10016) {
      const d2 = Math.round(slDist * 1.5 * 100) / 100;
      const sl2 = Math.round((isBuy ? ref - d2 : ref + d2) * 100) / 100;
      const tp2 = Math.round((isBuy ? ref + d2 * 2 : ref - d2 * 2) * 100) / 100;
      tradeBody.stopLoss = sl2; tradeBody.takeProfit = tp2;
      legWidened = true;
      await new Promise((res) => setTimeout(res, 400));
      r = await maTrade(cfg, tradeBody);
    }
    const br = brokerResult(r.body);
    // Vlerat e VËRTETA me të cilat u dërgua urdhri — jo ato që kërkoi sinjali. Kur ka pasur
    // zgjerim, raporti duhet të tregojë atë që është realisht te brokeri.
    const slUsed = Number(tradeBody.stopLoss);
    const tpUsed = Number(tradeBody.takeProfit);
    await db.from("telegram_trades").insert({
      signal_id: signalId, user_id: cfgRow.user_id, symbol: tradeSym, action: isBuy ? "BUY" : "SELL",
      volume: vol, tp_index: leg.idx, entry_price: ref, stop_loss: slUsed, take_profit: tpUsed,
      // NIVELET ORIGJINALE — ruhen veç dhe nuk preken më kurrë. 'stop_loss' e lëviz menaxheri ynë
      // (breakeven / ngjitje shkallë-shkallë), ndaj pas pak orësh ai nuk është më ai i sinjalit.
      // Pa këto dy, pyetja "po ta kishte lënë siç ishte, a do të fitonte?" s'ka si t'i përgjigjet.
      orig_stop_loss: slUsed, orig_take_profit: tpUsed,
      metaapi_order_id: br.orderId, metaapi_position_id: pending ? null : br.positionId,
      status: br.ok ? (pending ? "pending" : "open") : "rejected",
      reason: br.ok
        ? `TG TP${leg.idx}${pending ? " (pending)" : ""}${legWidened ? ` · brokeri kërkoi stop më të gjerë (10016): SL ${sl}→${slUsed}, TP ${tp}→${tpUsed}` : ""}`
        : `Brokeri: ${br.msg || br.code}`,
      raw_response: r.body ?? null,
    });
    if (br.ok) {
      executed++;
      details.push(`TP${leg.idx} @ ${tpUsed} (${vol})${pending ? " ⏳" : ""}${legWidened ? " ⚠️" : ""}`);
      if (legWidened) widened.push(`TP${leg.idx}: SL ${sl}→${slUsed}, TP ${tp}→${tpUsed}`);
    }
  }

  // PUSH: njofto në aplikacion kur hapet trade/porosi e re nga sinjali (kërkesa e pronarit)
  if (executed > 0) {
    await pushNotify({
      user_id: cfgRow.user_id,
      title: `📥 New signal — ${isBuy ? "BUY" : "SELL"} ${tradeSym}`,
      body: `${pending ? "Pending" : "Opened"} ${executed} position${executed > 1 ? "s" : ""} · SL ${sl}${validTps.length ? ` · TP ${validTps.join("/")}` : ""} — GoldSniperFX`,
      url: "/", tag: `tgsin-entry-${signalId ?? messageId}`,
    });
  }

  // NJOFTIM I VEÇANTË për 10016 — i ndarë nga njoftimi i hyrjes, që të mos humbasë mes tij.
  // Tregtia ËSHTË hapur; ky push thotë vetëm se rreziku real doli më i madh se i sinjalit.
  if (widened.length > 0) {
    await pushNotify({
      user_id: cfgRow.user_id,
      title: `⚠️ Broker widened the stop — ${tradeSym}`,
      body: `Your broker refused the signal's stop distance (error 10016) and required a wider one. `
        + `The trade was opened, but with more risk than the signal asked for — ${widened.join(" · ")}`,
      url: "/", tag: `tgsin-10016-${signalId ?? messageId}`,
    });
  }

  const kindWord = pending ? "porosi në pritje" : "pozicione";
  await finish(executed > 0 ? (pending ? "pending" : (executed === plan.length ? "executed" : "partial")) : "rejected", executed > 0 ? null : "asnjë leg s'u ekzekutua (shih telegram_trades)");
  if (cfgRow.bot_token) {
    const emoji = executed > 0 ? "✅" : "⚠️";
    await tgReply(cfgRow.bot_token, chatId,
      `${emoji} <b>Telegram Sin</b> — ${isBuy ? "BUY" : "SELL"} ${tradeSym}` + (pending ? ` @ ${Math.round(ref * 100) / 100} ⏳` : "") + `\n` +
      (executed > 0 ? `${pending ? "Vendosi" : "Hyri në"} ${executed} ${kindWord}:\n${details.join("\n")}\nSL: ${sl}` : `S'u hap dot: shih raportet në aplikacion.`)
      + (widened.length > 0 ? `\n⚠️ Brokeri kërkoi stop më të gjerë (10016): ${widened.join(" · ")}` : ""));
  }
  return json({ ok: true, kind: "entry", pending, executed, legs: plan.length });
}
