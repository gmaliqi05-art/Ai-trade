import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// strategy-advisor — FAZA 3 & 4 i sistemit vetë-mësues (vetëm super-admin).
// (3) Analizon "pikat kyçe" (signals.features) vs rezultatin → win-rate sipas kushteve.
// (4) Me { advise:true }, dërgon statistikat te Claude → sugjerime për rregullime (pa overfitting).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface Row { status: string; result_pct: number | null; features: Record<string, unknown> | null; }
interface Bkt { label: string; n: number; win: number; rate: number; avgR: number }

function r1(n: number) { return Math.round(n * 10) / 10; }

function bucket(rows: Row[], keyFn: (f: Record<string, unknown>) => string | null): Bkt[] {
  const map = new Map<string, { n: number; win: number; r: number }>();
  for (const row of rows) {
    if (!row.features) continue;
    const k = keyFn(row.features);
    if (k == null) continue;
    const e = map.get(k) || { n: 0, win: 0, r: 0 };
    e.n++; if (row.status === "hit_tp") e.win++;
    e.r += Number(row.result_pct) || 0;
    map.set(k, e);
  }
  return [...map.entries()]
    .map(([label, e]) => ({ label, n: e.n, win: e.win, rate: e.n ? Math.round((e.win / e.n) * 100) : 0, avgR: e.n ? r1(e.r / e.n) : 0 }))
    .sort((a, b) => b.n - a.n);
}

function computeAnalytics(rows: Row[]) {
  const res = rows.filter((r) => r.features);
  const total = res.length;
  const wins = res.filter((r) => r.status === "hit_tp").length;
  const losses = total - wins;
  const winRate = total ? Math.round((wins / total) * 100) : 0;
  const avgR = total ? r1(res.reduce((s, r) => s + (Number(r.result_pct) || 0), 0) / total) : 0;

  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const adxB = (f: Record<string, unknown>) => { const a = num(f.adx); return a == null ? null : a < 25 ? "ADX <25" : a < 40 ? "ADX 25–40" : "ADX ≥40"; };
  const confB = (f: Record<string, unknown>) => { const c = num(f.conf); return c == null ? null : c < 70 ? "Conf <70" : c < 80 ? "Conf 70–79" : "Conf ≥80"; };
  const erB = (f: Record<string, unknown>) => { const e = num(f.er); return e == null ? null : e < 0.3 ? "ER <0.30" : e < 0.45 ? "ER 0.30–0.45" : "ER ≥0.45"; };
  const atrB = (f: Record<string, unknown>) => { const a = num(f.atr_pct); return a == null ? null : a < 0.3 ? "ATR <0.3%" : a < 0.6 ? "ATR 0.3–0.6%" : "ATR ≥0.6%"; };

  const conds: { key: string; label: string }[] = [
    { key: "adx_strong", label: "ADX i fortë (≥25)" },
    { key: "rsi_room", label: "RSI me hapësirë" },
    { key: "macd_aligned", label: "MACD në harmoni" },
    { key: "d1_aligned", label: "Trend ditor në harmoni" },
    { key: "overlap", label: "Sesioni London+NY (ari)" },
  ];
  const condRows: Bkt[] = conds.map((c) => {
    const w = res.filter((r) => r.features && r.features[c.key] === true);
    const win = w.filter((r) => r.status === "hit_tp").length;
    const r = w.reduce((s, x) => s + (Number(x.result_pct) || 0), 0);
    return { label: c.label, n: w.length, win, rate: w.length ? Math.round((win / w.length) * 100) : 0, avgR: w.length ? r1(r / w.length) : 0 };
  }).filter((x) => x.n > 0);

  return {
    total, wins, losses, winRate, avgR,
    groups: [
      { group: "Drejtimi", rows: bucket(res, (f) => (f.dir as string) || null) },
      { group: "Simboli", rows: bucket(res, (f) => (f.symbol as string) || null) },
      { group: "Forca e trendit (ADX)", rows: bucket(res, adxB) },
      { group: "Besueshmëria", rows: bucket(res, confB) },
      { group: "Efficiency Ratio", rows: bucket(res, erB) },
      { group: "Volatiliteti (ATR%)", rows: bucket(res, atrB) },
      { group: "Dita e javës", rows: bucket(res, (f) => (f.dow as string) || null) },
      { group: "Kushtet (kur janë të vërteta)", rows: condRows },
    ],
  };
}

async function claudeAdvise(db: ReturnType<typeof createClient>, analytics: unknown): Promise<unknown> {
  const { data: prov } = await db.from("ai_providers")
    .select("api_key_encrypted, model").eq("slug", "anthropic").eq("is_active", true).maybeSingle();
  const key = (prov as { api_key_encrypted?: string } | null)?.api_key_encrypted;
  if (!key) return { error: "Pa çelës Claude të konfiguruar." };
  const model = (prov as { model?: string }).model || "claude-opus-4-8";

  const sys = "Je analist sasior i strategjive të tregtimit për një bot trend-following (ar/naftë). " +
    "Merr statistika win-rate të ndara sipas kushteve, nga 'pikat kyçe' të çdo sinjali. " +
    "Beso VETËM grupet me n>=15 (mostra të vogla janë rastësi — injoroji). " +
    "Identifiko cilat kushte lidhen me win-rate më të lartë/ulët. Sugjero rregullime KONKRETE e KONSERVATORE " +
    "(p.sh. 'ngri ADX min në 25', 'shmang ditën X', 'ul peshën në sesionin aziatik') që përmirësojnë win-rate PA mbi-përshtatje. " +
    "Paralajmëro gjithmonë për mostra të vogla dhe rekomando validim në DEMO para parave reale. " +
    "Përgjigju VETËM me JSON kompakt në SHQIP: {\"insights\":[\"...\"],\"suggestions\":[{\"title\":\"...\",\"detail\":\"...\"}],\"caution\":\"...\"}.";

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 2500, system: sys, messages: [{ role: "user", content: JSON.stringify(analytics) }] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return { error: `Claude error ${resp.status}` };
    const data = await resp.json();
    const text = data?.content?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { error: "Claude nuk ktheu JSON." };
    try { return JSON.parse(m[0]); } catch { return { error: "Claude ktheu nje pergjigje te paplote — kliko perseri." }; }
  } catch (e) {
    return { error: `Claude exception: ${(e as Error).message}` };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // SIGURIA: vetëm super-admin. Identifiko thirrësin nga JWT-ja dhe verifiko is_admin.
    const auth = req.headers.get("Authorization") || "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const { data: prof } = await svc.from("profiles").select("is_admin").eq("id", u.user.id).maybeSingle();
    if (!(prof as { is_admin?: boolean } | null)?.is_admin) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const { data: rows } = await svc.from("signals")
      .select("status, result_pct, features")
      .eq("source", "engine").in("status", ["hit_tp", "hit_sl"])
      .not("features", "is", null)
      .order("created_at", { ascending: false }).limit(3000);

    const analytics = computeAnalytics((rows ?? []) as Row[]);
    let advice: unknown = null;
    if (body.advise === true && analytics.total >= 20) advice = await claudeAdvise(svc, analytics);
    else if (body.advise === true) advice = { error: `Të dhëna të pamjaftueshme (${analytics.total} sinjale të mbyllura; duhen ≥20).` };

    return json({ analytics, advice, ts: Date.now() });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
