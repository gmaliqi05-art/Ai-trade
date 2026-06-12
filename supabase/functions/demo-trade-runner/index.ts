import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// demo-trade-runner — cron. VIRTUAL paper-trading që pasqyron robotin LIVE, por:
//   • përdor TË NJËJTAT sinjale të motorit (signals, source='engine')
//   • me çmimet REALE të arit (assets.current_price)
//   • PA MetaApi, PA para reale → punon edhe kur MetaApi është poshtë.
// Çdo user ka një kuletë virtuale €100 (profiles.demo_balance). Madhësimi i pozicionit
// është i njëjtë me auto-trade-runner (fixed-fractional sipas risk_per_trade_pct + presetit).
// NUK prek auto-trade-runner-in, metaapi_config, as tregtimin real.
//
// Cron: çdo 1–2 min. Portë sigurie x-cron-secret (fail-safe: lejo nëse s'ka sekret).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-cron-secret",
};

const OPEN_WINDOW_MIN = 15;   // sinjale të freskëta për të hapur demo-trade
const EXPIRE_H = 48;          // demo-trade i pambyllur pas 48h → 'closed' (exit_reason='expired')

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function normSym(s: string): string { return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

// Vlera € për 1.0 lëvizje çmimi për 1 lot (ar: 100 oz/lot; naftë: 1000 fuçi; fx: 100k).
function valuePerPrice(symbol: string): number {
  const s = normSym(symbol);
  if (s.includes("XAU") || s.includes("GOLD")) return 100;
  if (s.includes("USOIL") || s.includes("UKOIL") || s.includes("OIL") || s.includes("WTI") || s.includes("BRENT")) return 1000;
  return 100000;
}

// E njëjta logjikë "lot sipas besueshmërisë" si auto-trade-runner.
function lotForConfidence(cfg: Record<string, unknown>, conf: number): number {
  let lot = Number(cfg.default_lot) || 0.01;
  if (cfg.dynamic_lot) {
    const t1 = Number(cfg.lot_conf_t1) || 70, t2 = Number(cfg.lot_conf_t2) || 80, t3 = Number(cfg.lot_conf_t3) || 90;
    if (conf >= t3) lot = Number(cfg.lot_conf_90) || lot;
    else if (conf >= t2) lot = Number(cfg.lot_conf_80) || lot;
    else if (conf >= t1) lot = Number(cfg.lot_conf_70) || lot;
    else lot = Number(cfg.lot_conf_70) || lot;
  }
  const maxLot = Number(cfg.max_lot) || 1;
  return Math.max(0.01, Math.min(lot, maxLot));
}

// Madhësim fixed-fractional (njëlloj si live): rrezik = % e equity-t demo, i kufizuar nga SL-ja.
function sizeVolume(cfg: Record<string, unknown>, equity: number, conf: number, slPriceDist: number, symbol: string): number {
  const lot = lotForConfidence(cfg, conf);
  const riskPct = Number(cfg.risk_per_trade_pct) || 1;
  const maxLot = Number(cfg.max_lot) || 1;
  const equityRisk = (equity * riskPct) / 100;
  const maxDaily = Number(cfg.max_daily_loss) > 0 ? Number(cfg.max_daily_loss) : equityRisk;
  const perTradeRisk = Math.min(equityRisk, maxDaily);
  const vpp = valuePerPrice(symbol);
  let volume = lot;
  if (slPriceDist > 0 && vpp > 0) {
    const lotByRisk = Math.floor((perTradeRisk / (slPriceDist * vpp)) * 100) / 100;
    volume = Math.min(lot, lotByRisk, maxLot);
  }
  volume = Math.round(volume * 100) / 100;
  if (volume < 0.01) volume = 0.01; // demo: lejo gjithmonë minimumin
  return volume;
}

const DEFAULT_CFG: Record<string, unknown> = {
  default_lot: 0.01, max_lot: 1, risk_per_trade_pct: 1, max_daily_loss: 0,
  max_open_trades: 5, min_confidence: 55, dynamic_lot: false,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Portë sigurie për cron (vetëm akses). Fail-safe: lejo nëse s'ka sekret/gabim.
  try {
    const { data: cs } = await db.from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
    const secret = (cs as { value?: string } | null)?.value;
    if (secret && req.headers.get("x-cron-secret") !== secret) return json({ error: "unauthorized" }, 401);
  } catch { /* fail-safe */ }

  let dryRun = false;
  try { const b = await req.json(); dryRun = b?.dryRun === true; } catch { /* pa trup */ }

  try {
    // 1) Userat me demo aktive + kuleta e tyre.
    const { data: profs } = await db.from("profiles").select("id, demo_balance, demo_enabled").eq("demo_enabled", true);
    const users = (profs ?? []) as { id: string; demo_balance: number | null; demo_enabled: boolean }[];
    if (users.length === 0) return json({ ok: true, dryRun, opened: 0, closed: 0, note: "no demo users" });

    // 2) Konfigurimi per-user (preset/rrezik) — njëlloj si live; default nëse s'ka rresht.
    const { data: cfgRows } = await db.from("metaapi_config").select("*");
    const cfgBy = new Map<string, Record<string, unknown>>();
    for (const c of (cfgRows ?? []) as Record<string, unknown>[]) cfgBy.set(String(c.user_id), c);

    // 3) Çmimet aktuale (real) sipas simbolit.
    const { data: assetRows } = await db.from("assets").select("symbol, current_price");
    const priceBy = new Map<string, number>();
    for (const a of (assetRows ?? []) as { symbol: string; current_price: number | null }[]) {
      if (a.current_price != null) priceBy.set(normSym(a.symbol), Number(a.current_price));
    }

    // Balanca pune (delta nga mbylljet shkruhet një herë në fund).
    const bal = new Map<string, number>();
    for (const u of users) bal.set(u.id, Number(u.demo_balance ?? 100));

    let opened = 0, closed = 0;

    // 4) VLERËSIM — mbyll demo-trade-t e hapura kur prekin TP/SL (ose skadojnë).
    const { data: openTrades } = await db
      .from("demo_trades")
      .select("id, user_id, symbol, side, volume, entry_price, sl, tp, opened_at")
      .eq("status", "open")
      .limit(2000);
    const expireBefore = Date.now() - EXPIRE_H * 60 * 60 * 1000;
    const openCountBy = new Map<string, number>();

    for (const t of (openTrades ?? []) as { id: string; user_id: string; symbol: string; side: string; volume: number; entry_price: number; sl: number | null; tp: number | null; opened_at: string }[]) {
      if (!bal.has(t.user_id)) continue; // user jo-demo → lëre të hapur
      const price = priceBy.get(normSym(t.symbol));
      const isBuy = (t.side || "").toLowerCase() === "buy";
      const entry = Number(t.entry_price), sl = t.sl != null ? Number(t.sl) : null, tp = t.tp != null ? Number(t.tp) : null;
      const vpp = valuePerPrice(t.symbol);
      let exitReason: string | null = null, exitPrice: number | null = null;

      if (price != null) {
        const hitTp = tp != null && (isBuy ? price >= tp : price <= tp);
        const hitSl = sl != null && (isBuy ? price <= sl : price >= sl);
        if (hitTp) { exitReason = "tp"; exitPrice = tp; }
        else if (hitSl) { exitReason = "sl"; exitPrice = sl; }
      }
      if (!exitReason && new Date(t.opened_at).getTime() < expireBefore) {
        exitReason = "expired"; exitPrice = price ?? entry;
      }

      if (exitReason && exitPrice != null) {
        const profit = (exitPrice - entry) * (isBuy ? 1 : -1) * Number(t.volume) * vpp;
        if (!dryRun) {
          await db.from("demo_trades").update({
            status: "closed", exit_price: exitPrice, exit_reason: exitReason,
            profit: Math.round(profit * 100) / 100, closed_at: new Date().toISOString(),
          }).eq("id", t.id);
        }
        bal.set(t.user_id, (bal.get(t.user_id) ?? 0) + profit);
        closed++;
      } else {
        openCountBy.set(t.user_id, (openCountBy.get(t.user_id) ?? 0) + 1);
      }
    }

    // 5) HAPJE — sinjale reale të freskëta, virtuale për çdo demo user (dedup per user+signal).
    const sinceIso = new Date(Date.now() - OPEN_WINDOW_MIN * 60 * 1000).toISOString();
    const { data: sigs } = await db
      .from("signals")
      .select("id, symbol, type, entry_price, target_price, stop_loss, confidence, created_at")
      .eq("source", "engine")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(50);
    const signals = (sigs ?? []) as { id: string; symbol: string; type: string; entry_price: number | null; target_price: number | null; stop_loss: number | null; confidence: number | null; created_at: string }[];

    if (signals.length > 0) {
      // dedup: cilat (user, signal) ekzistojnë tashmë.
      const sigIds = signals.map((s) => s.id);
      const { data: existing } = await db.from("demo_trades").select("user_id, signal_id").in("signal_id", sigIds);
      const seen = new Set<string>();
      for (const e of (existing ?? []) as { user_id: string; signal_id: string | null }[]) {
        if (e.signal_id) seen.add(`${e.user_id}|${e.signal_id}`);
      }

      const toInsert: Record<string, unknown>[] = [];
      for (const u of users) {
        const cfg = cfgBy.get(u.id) ?? DEFAULT_CFG;
        const minConf = Number(cfg.min_confidence ?? DEFAULT_CFG.min_confidence);
        const maxOpen = Number(cfg.max_open_trades) || 5;
        let cnt = openCountBy.get(u.id) ?? 0;
        for (const s of signals) {
          if (cnt >= maxOpen) break;
          if (s.entry_price == null || s.stop_loss == null) continue;
          if (Number(s.confidence ?? 0) < minConf) continue;
          if (seen.has(`${u.id}|${s.id}`)) continue;
          const entry = Number(s.entry_price);
          const sl = Number(s.stop_loss);
          const slDist = Math.abs(entry - sl);
          if (!(slDist > 0)) continue;
          const isBuy = (s.type || "").toLowerCase() === "buy";
          // TP: synimi i sinjalit nëse ka, përndryshe R:R 2:1 mbi distancën e SL-së.
          const tp = s.target_price != null ? Number(s.target_price) : (isBuy ? entry + slDist * 2 : entry - slDist * 2);
          const volume = sizeVolume(cfg, bal.get(u.id) ?? 100, Number(s.confidence ?? 70), slDist, s.symbol);
          toInsert.push({
            user_id: u.id, signal_id: s.id, symbol: s.symbol, side: isBuy ? "buy" : "sell",
            volume, entry_price: entry, sl, tp, status: "open",
          });
          seen.add(`${u.id}|${s.id}`);
          cnt++;
          opened++;
        }
        openCountBy.set(u.id, cnt);
      }
      if (!dryRun && toInsert.length) await db.from("demo_trades").insert(toInsert);
    }

    // 6) Shkruaj balancat e ndryshuara.
    if (!dryRun) {
      for (const u of users) {
        const nb = Math.round((bal.get(u.id) ?? 0) * 100) / 100;
        if (nb !== Number(u.demo_balance ?? 100)) {
          await db.from("profiles").update({ demo_balance: nb }).eq("id", u.id);
        }
      }
    }

    return json({ ok: true, dryRun, users: users.length, opened, closed });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
