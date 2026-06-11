import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// expert-room — DHOMA E EKSPERTËVE (vetëm super-admin / cron).
// Merr trade-t auto (sinjale të motorit) që PREKËN TP ose SL, i grupon ÇDO 10, dhe një panel
// me 4 ekspertë AI (Claude) analizon kushtet në hyrje (koha/sesioni, ADX, RSI, MACD, ER, ATR,
// trendi ditor) → gjetje + konsensus + rekomandime KONKRETE për të përmirësuar robotin.
// VETËM KËSHILLUESE: ruan ekspertizat te expert_room_analyses; NUK prek robotin/konfigurimin.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-cron-secret",
};
const BATCH = 10; // analiza niset për çdo 10 trade të reja TP/SL

function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function r1(n: number) { return Math.round(n * 10) / 10; }

interface SigRow { id: string; status: string; result_pct: number | null; created_at: string; closed_at: string | null; updated_at: string | null; features: Record<string, unknown> | null; }
function effTime(r: SigRow): string { return r.closed_at || r.updated_at || r.created_at; }

// Përmbledhje deterministike e batch-it (faktet që do t'i interpretojnë ekspertët).
function batchStats(rows: SigRow[]) {
  const n = rows.length;
  const wins = rows.filter((r) => r.status === "hit_tp").length;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const avg = (sel: (f: Record<string, unknown>) => number | null) => {
    const xs = rows.map((r) => (r.features ? sel(r.features) : null)).filter((x): x is number => x != null);
    return xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  };
  const trades = rows.map((r) => {
    const f = r.features || {};
    return {
      outcome: r.status === "hit_tp" ? "TP" : "SL",
      dir: f.dir ?? null, symbol: f.symbol ?? null, conf: num(f.conf),
      adx: num(f.adx), rsi: num(f.rsi), macd_hist: num(f.macd_hist), atr_pct: num(f.atr_pct),
      er: num(f.er), overlap: f.overlap === true, d1_aligned: f.d1_aligned === true,
      dow: f.dow ?? null, et_hour: num(f.et_hour), result_pct: r.result_pct,
      entered_at: r.created_at,
    };
  });
  return {
    count: n, wins, losses: n - wins, winRate: n ? Math.round((wins / n) * 100) : 0,
    avgConf: avg((f) => num(f.conf)), avgAdx: avg((f) => num(f.adx)),
    tpAvgAdx: (() => { const xs = rows.filter((r) => r.status === "hit_tp" && r.features).map((r) => num(r.features!.adx)).filter((x): x is number => x != null); return xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null; })(),
    slAvgAdx: (() => { const xs = rows.filter((r) => r.status === "hit_sl" && r.features).map((r) => num(r.features!.adx)).filter((x): x is number => x != null); return xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null; })(),
    trades,
  };
}

async function claudeExperts(db: ReturnType<typeof createClient>, stats: unknown): Promise<unknown> {
  const { data: prov } = await db.from("ai_providers").select("api_key_encrypted, model").eq("slug", "anthropic").eq("is_active", true).maybeSingle();
  const key = (prov as { api_key_encrypted?: string } | null)?.api_key_encrypted;
  if (!key) return { error: "Pa çelës Claude të konfiguruar." };
  const model = (prov as { model?: string }).model || "claude-opus-4-8";

  const sys = "Je një PANEL me 4 ekspertë tregtimi që analizojnë një grup prej ~10 trade-sh REALE të një roboti trend-following (ar/naftë), " +
    "që PREKËN TP ose SL. Të jepet përmbledhja statistikore + çdo trade me kushtet në momentin e hyrjes (outcome TP/SL, drejtimi, besueshmëria, ADX, RSI, MACD, ATR%, Efficiency Ratio, sesioni overlap, trendi ditor, ora ET, dita). " +
    "4 ROLET: (1) 'Rreziku' — raporti rrezik/shpërblim, humbjet, SL-të e parakohshme; (2) 'Koha & Sesioni' — ora/sesioni/dita kur fitohet vs humbet; (3) 'Teknik' — ADX/RSI/MACD/ER që ndajnë TP nga SL; (4) 'Struktura e tregut' — volatiliteti (ATR), trendi ditor, drejtimi. " +
    "Secili ekspert jep 2–4 gjetje KONKRETE bazuar VETËM te të dhënat (jo teori të përgjithshme). Mostra është e VOGËL (~10) → ji i kujdesshëm, shëno pasigurinë. " +
    "Pastaj jep KONSENSUS të shkurtër dhe 2–4 REKOMANDIME konkrete e konservatore për robotin (p.sh. 'ngri ADX min në 25', 'shmang orën X ET', 'kërko ER≥0.40') — të shpjegueshme, pa mbi-përshtatje. " +
    "Përgjigju VETËM me JSON kompakt në SHQIP: {\"experts\":[{\"role\":\"Rreziku\",\"findings\":[\"...\"]},{\"role\":\"Koha & Sesioni\",\"findings\":[\"...\"]},{\"role\":\"Teknik\",\"findings\":[\"...\"]},{\"role\":\"Struktura e tregut\",\"findings\":[\"...\"]}],\"consensus\":\"...\",\"recommendations\":[{\"title\":\"...\",\"detail\":\"...\",\"confidence\":\"low|medium|high\"}],\"caution\":\"...\"}.";

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 3000, system: sys, messages: [{ role: "user", content: JSON.stringify(stats) }] }),
      signal: AbortSignal.timeout(45000),
    });
    if (!resp.ok) return { error: `Claude error ${resp.status}` };
    const data = await resp.json();
    const text = data?.content?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { error: "Claude nuk ktheu JSON." };
    try { return JSON.parse(m[0]); } catch { return { error: "Claude ktheu përgjigje të paplotë." }; }
  } catch (e) {
    return { error: `Claude exception: ${(e as Error).message}` };
  }
}

async function getCovered(db: ReturnType<typeof createClient>): Promise<string> {
  const { data } = await db.from("app_config").select("value").eq("key", "expert_room_covered_through").maybeSingle();
  return (data as { value?: string } | null)?.value || "1970-01-01T00:00:00Z";
}
async function setCovered(db: ReturnType<typeof createClient>, v: string) {
  await db.from("app_config").upsert({ key: "expert_room_covered_through", value: v }, { onConflict: "key" });
}

// Sa trade TP/SL të reja (të paanalizuara) presin? + lista e renditur sipas kohës së mbylljes.
async function pendingRows(db: ReturnType<typeof createClient>): Promise<SigRow[]> {
  const covered = await getCovered(db);
  const { data } = await db.from("signals")
    .select("id, status, result_pct, created_at, closed_at, updated_at, features")
    .eq("source", "engine").in("status", ["hit_tp", "hit_sl"]).not("features", "is", null)
    .order("created_at", { ascending: true }).limit(2000);
  const rows = ((data ?? []) as SigRow[]).filter((r) => effTime(r) > covered);
  rows.sort((a, b) => effTime(a).localeCompare(effTime(b)));
  return rows;
}

// Niset një batch (nëse ka ≥10 të reja). Kthen rezultatin ose null.
async function runBatch(db: ReturnType<typeof createClient>): Promise<Record<string, unknown> | null> {
  const pend = await pendingRows(db);
  if (pend.length < BATCH) return null;
  const batch = pend.slice(0, BATCH);
  const stats = batchStats(batch);
  const ai = await claudeExperts(db, stats);
  if ((ai as { error?: string }).error) return { error: (ai as { error?: string }).error };

  const { data: last } = await db.from("expert_room_analyses").select("batch_no").order("batch_no", { ascending: false }).limit(1).maybeSingle();
  const batchNo = (((last as { batch_no?: number } | null)?.batch_no) || 0) + 1;
  const toTime = effTime(batch[batch.length - 1]);
  const row = {
    batch_no: batchNo, trades_count: batch.length, win_rate: stats.winRate,
    from_time: effTime(batch[0]), to_time: toTime,
    payload: { ...(ai as object), stats },
  };
  const { data: ins } = await db.from("expert_room_analyses").insert(row).select("id").maybeSingle();
  await setCovered(db, toTime);
  return { inserted: true, batch_no: batchNo, id: (ins as { id?: string } | null)?.id };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // MODI CRON: x-cron-secret valid → niset auto-analiza (pa JWT).
  let isCron = false;
  try {
    const { data: cs } = await db.from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
    const secret = (cs as { value?: string } | null)?.value;
    if (secret && req.headers.get("x-cron-secret") === secret) isCron = true;
  } catch { /* injoro */ }

  try {
    if (isCron) {
      let runs = 0; const results: unknown[] = [];
      // Përpunon deri në 3 batch-e për thirrje (kap backlog-un gradualisht), pa e ngarkuar.
      for (let i = 0; i < 3; i++) {
        const r = await runBatch(db);
        if (!r) break;
        results.push(r); runs++;
        if ((r as { error?: string }).error) break;
      }
      return json({ cron: true, runs, results });
    }

    // MODI ADMIN (UI): kërkon JWT super-admin. Kthen analizat + sa presin.
    const auth = req.headers.get("Authorization") || "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const { data: prof } = await db.from("profiles").select("is_admin").eq("id", u.user.id).maybeSingle();
    if (!(prof as { is_admin?: boolean } | null)?.is_admin) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    // Admin mund ta nisë manualisht një batch nëse ka ≥10 të reja (auto-i mbetet kryesori).
    if (body.run === true) { const r = await runBatch(db); if (r && (r as { error?: string }).error) return json({ error: (r as { error?: string }).error }); }

    const { data: analyses } = await db.from("expert_room_analyses").select("*").order("created_at", { ascending: false }).limit(50);
    const pend = await pendingRows(db);
    return json({ analyses: analyses ?? [], pending: pend.length, batchSize: BATCH });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
