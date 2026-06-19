import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// expert-room v2 — DHOMA E EKSPERTËVE (korporata këshilluese; vetëm super-admin / cron).
// (1) BATCH: çdo 20 trade auto TP/SL → paneli i ekspertëve (me doktrinat e tyre) i analizon,
//     pastaj njofton admin-at me PUSH + njoftim në dashboard (raport pas çdo 20 trade-sh auto).
// (2) RESEARCH: Claude bën hulumtim të thellë për çdo anëtar — parimet/rregullat/metodat
//     PUBLIKE të metodologjisë së tij → ruhen si 'doktrinë' te expert_profiles.
// (3) SYNTHESIZE: doktrinat + analizat e batch-eve → SUPER INFORMATORI (modele tregtimi,
//     rregulla thelbësore, harta për robotin) te expert_knowledge.
// (4) set_autotrade: çelës ON/OFF i ruajtur — SKELET: asnjë motor s'e lexon; S'TREGTON.
// VETËM KËSHILLUESE: nuk prek robotin aktual/konfigurimin e tij.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-cron-secret",
};
const BATCH = 20;

function json(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function r1(n: number) { return Math.round(n * 10) / 10; }

async function claude(db: ReturnType<typeof createClient>, sys: string, user: string, maxTokens = 3000): Promise<unknown> {
  const { data: prov } = await db.from("ai_providers").select("api_key_encrypted, model").eq("slug", "anthropic").eq("is_active", true).maybeSingle();
  const key = (prov as { api_key_encrypted?: string } | null)?.api_key_encrypted;
  if (!key) return { error: "Pa çelës Claude të konfiguruar." };
  const model = (prov as { model?: string }).model || "claude-sonnet-4-6";
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: sys, messages: [{ role: "user", content: user }] }),
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) return { error: `Claude error ${resp.status}` };
    const data = await resp.json();
    const text = data?.content?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { error: "Claude nuk ktheu JSON." };
    try { return JSON.parse(m[0]); } catch { return { error: "Përgjigje e paplotë." }; }
  } catch (e) { return { error: `Claude exception: ${(e as Error).message}` }; }
}

interface SigRow { id: string; status: string; result_pct: number | null; created_at: string; closed_at: string | null; updated_at: string | null; features: Record<string, unknown> | null; }
function effTime(r: SigRow): string { return r.closed_at || r.updated_at || r.created_at; }

function batchStats(rows: SigRow[]) {
  const n = rows.length;
  const wins = rows.filter((r) => r.status === "hit_tp").length;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const trades = rows.map((r) => { const f = r.features || {}; return {
    outcome: r.status === "hit_tp" ? "TP" : "SL", dir: f.dir ?? null, symbol: f.symbol ?? null,
    conf: num(f.conf), adx: num(f.adx), rsi: num(f.rsi), macd_hist: num(f.macd_hist), atr_pct: num(f.atr_pct),
    er: num(f.er), overlap: f.overlap === true, d1_aligned: f.d1_aligned === true,
    dow: f.dow ?? null, et_hour: num(f.et_hour), result_pct: r.result_pct, entered_at: r.created_at };
  });
  const side = (st: string, sel: (f: Record<string, unknown>) => number | null) => {
    const xs = rows.filter((r) => r.status === st && r.features).map((r) => sel(r.features!)).filter((x): x is number => x != null);
    return xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  };
  const num2 = (v: unknown) => (typeof v === "number" ? v : null);
  return { count: n, wins, losses: n - wins, winRate: n ? Math.round((wins / n) * 100) : 0,
    tpAvgAdx: side("hit_tp", (f) => num2(f.adx)), slAvgAdx: side("hit_sl", (f) => num2(f.adx)),
    tpAvgEr: side("hit_tp", (f) => num2(f.er)), slAvgEr: side("hit_sl", (f) => num2(f.er)),
    tpAvgAtr: side("hit_tp", (f) => num2(f.atr_pct)), slAvgAtr: side("hit_sl", (f) => num2(f.atr_pct)),
    trades };
}

async function getCovered(db: ReturnType<typeof createClient>): Promise<string> {
  const { data } = await db.from("app_config").select("value").eq("key", "expert_room_covered_through").maybeSingle();
  return (data as { value?: string } | null)?.value || "1970-01-01T00:00:00Z";
}
async function setCfg(db: ReturnType<typeof createClient>, key: string, v: string) {
  await db.from("app_config").upsert({ key, value: v }, { onConflict: "key" });
}
async function getCfg(db: ReturnType<typeof createClient>, key: string): Promise<string | null> {
  const { data } = await db.from("app_config").select("value").eq("key", key).maybeSingle();
  return (data as { value?: string } | null)?.value ?? null;
}

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

interface Profile { slug: string; name: string; methodology: string | null; doctrine: Record<string, unknown> | null }
async function profiles(db: ReturnType<typeof createClient>): Promise<Profile[]> {
  const { data } = await db.from("expert_profiles").select("slug, name, methodology, doctrine, icon, researched_at, created_at").order("created_at", { ascending: true });
  return (data ?? []) as Profile[];
}

// (2) RESEARCH — doktrina e një eksperti nga dija publike e metodologjisë së tij.
async function researchOne(db: ReturnType<typeof createClient>, p: Profile): Promise<Record<string, unknown>> {
  const sys = "Je studiues i metodologjive të tregtimit. Për metodologjinë e dhënë, përmblidh dijen PUBLIKE të dokumentuar gjerësisht " +
    "(libra, intervista, materiale arsimore të njohura) — parimet, rregullat e disiplinës, modelet e hyrjes/daljes, menaxhimin e rrezikut. " +
    "MOS shpik citate personale; përshkruaj parimet si dije e përgjithshme e shkollës/metodologjisë. Përshtate fokusimin për një robot trend-following në AR (XAUUSD) me scalp + swing. " +
    "Përgjigju VETËM me JSON në SHQIP: {\"principles\":[\"...\"],\"rules\":[\"...\"],\"entry_models\":[{\"name\":\"...\",\"desc\":\"...\"}],\"risk\":[\"...\"],\"applies_to_bot\":[\"...\"],\"note\":\"burimi: dije publike e metodologjisë\"}";
  const res = await claude(db, sys, JSON.stringify({ name: p.name, methodology: p.methodology }), 2500);
  if (!(res as { error?: string }).error) {
    await db.from("expert_profiles").update({ doctrine: res, researched_at: new Date().toISOString() }).eq("slug", p.slug);
  }
  return { slug: p.slug, ok: !(res as { error?: string }).error, error: (res as { error?: string }).error };
}

// Njofton admin-at për një raport të ri të Dhomës: njoftim në dashboard + PUSH (web/telefon).
// Best-effort: çdo gabim injorohet që batch-i të mos prishet.
async function notifyExperts(db: ReturnType<typeof createClient>, batchNo: number, stats: { count: number; wins: number; losses: number; winRate: number }, ai: unknown): Promise<void> {
  try {
    const recs = (((ai as { recommendations?: unknown[] }).recommendations) || []) as unknown[];
    const title = `Dhoma e Ekspertëve — Raport #${batchNo}`;
    const body = `${stats.count} trade auto: fitore ${stats.winRate}% (${stats.wins}W/${stats.losses}L). ${recs.length} rekomandim${recs.length === 1 ? "" : "e"}. Hape për detaje.`;
    const { data: admins } = await db.from("profiles").select("id").eq("is_admin", true);
    const ids = ((admins ?? []) as Array<{ id: string }>).map((a) => a.id);
    if (ids.length === 0) return;
    // Njoftim në dashboard (NotificationsPage) për secilin admin.
    await db.from("notifications").insert(ids.map((uid) => ({
      user_id: uid, type: "expert", title, body, data: { batch_no: batchNo, win_rate: stats.winRate, url: "/" }, sent_push: true,
    })));
    // PUSH te secili admin (përmes web-push-send me service-role).
    const base = Deno.env.get("SUPABASE_URL"), svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    for (const uid of ids) {
      try {
        await fetch(`${base}/functions/v1/web-push-send`, {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${svc}` },
          body: JSON.stringify({ user_id: uid, title, body, url: "/", tag: `expert-${batchNo}` }),
          signal: AbortSignal.timeout(8000),
        });
      } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }
}

// (1) BATCH — paneli (me doktrina nëse ka) analizon 20 trade.
async function runBatch(db: ReturnType<typeof createClient>): Promise<Record<string, unknown> | null> {
  const pend = await pendingRows(db);
  if (pend.length < BATCH) return null;
  const batch = pend.slice(0, BATCH);
  const stats = batchStats(batch);
  const profs = await profiles(db);
  const panel = profs.map((p) => ({ slug: p.slug, name: p.name,
    doctrine_summary: p.doctrine ? { principles: ((p.doctrine.principles as string[]) || []).slice(0, 4), rules: ((p.doctrine.rules as string[]) || []).slice(0, 4) } : null }));
  const sys = "Je një PANEL ekspertësh elitarë tregtimi (anëtarët + doktrinat e tyre të jepen). Analizoni një grup prej ~20 trade-sh REALE " +
    "të një roboti trend-following ari që PREKËN TP/SL, nga kushtet në hyrje. SECILI anëtar analizon SIPAS doktrinës së vet " +
    "(2–3 gjetje konkrete nga të dhënat; mostra e vogël → shëno pasigurinë). Pastaj: konsensus i shkurtër, 2–4 rekomandime konkrete e " +
    "konservatore për robotin, dhe 0–2 'modele tregtimi' të vëzhguara (pattern që përsëritet në fitime/humbje). " +
    "Përgjigju VETËM me JSON në SHQIP: {\"experts\":[{\"slug\":\"...\",\"role\":\"emri i shkurt\",\"findings\":[\"...\"]}],\"consensus\":\"...\",\"patterns\":[{\"name\":\"...\",\"desc\":\"...\"}],\"recommendations\":[{\"title\":\"...\",\"detail\":\"...\",\"confidence\":\"low|medium|high\"}],\"caution\":\"...\"}";
  const ai = await claude(db, sys, JSON.stringify({ panel, stats }), 3500);
  if ((ai as { error?: string }).error) return { error: (ai as { error?: string }).error };
  const { data: last } = await db.from("expert_room_analyses").select("batch_no").order("batch_no", { ascending: false }).limit(1).maybeSingle();
  const batchNo = (((last as { batch_no?: number } | null)?.batch_no) || 0) + 1;
  const toTime = effTime(batch[batch.length - 1]);
  await db.from("expert_room_analyses").insert({ batch_no: batchNo, trades_count: batch.length, win_rate: stats.winRate,
    from_time: effTime(batch[0]), to_time: toTime, payload: { ...(ai as object), stats } });
  await setCfg(db, "expert_room_covered_through", toTime);
  await notifyExperts(db, batchNo, stats, ai);
  return { inserted: true, batch_no: batchNo };
}

// (3) SYNTHESIZE — Super Informatori nga doktrinat + analizat.
async function synthesize(db: ReturnType<typeof createClient>): Promise<Record<string, unknown>> {
  const profs = await profiles(db);
  const { data: an } = await db.from("expert_room_analyses").select("batch_no, win_rate, payload").order("batch_no", { ascending: false }).limit(8);
  const analyses = (an ?? []).map((a: Record<string, unknown>) => ({ batch: a.batch_no, winRate: a.win_rate,
    consensus: (a.payload as Record<string, unknown>)?.consensus, recommendations: (a.payload as Record<string, unknown>)?.recommendations, patterns: (a.payload as Record<string, unknown>)?.patterns }));
  const doctrines = profs.map((p) => ({ name: p.name, doctrine: p.doctrine ? { principles: ((p.doctrine.principles as string[]) || []).slice(0, 5), applies_to_bot: ((p.doctrine.applies_to_bot as string[]) || []).slice(0, 4) } : null }));
  const sys = "Je kryeanalisti i një dhome ekspertësh tregtimi. Nga DOKTRINAT e anëtarëve + ANALIZAT e grupeve të trade-ve reale, " +
    "ndërto SUPER INFORMATORIN: bazën e dijes së konsoliduar për robotin (ar, trend-following, scalp+swing). " +
    "Përgjigju VETËM me JSON në SHQIP: {\"core_rules\":[\"rregull thelbësor i konsoliduar\"],\"trading_models\":[{\"name\":\"...\",\"desc\":\"...\",\"conditions\":[\"...\"]}],\"do\":[\"...\"],\"dont\":[\"...\"],\"robot_mapping\":[{\"param\":\"p.sh. min ADX\",\"suggestion\":\"...\",\"basis\":\"nga cili ekspert/analizë\"}],\"readiness\":{\"score\":0-100,\"missing\":[\"çfarë duhet ende para se të mendohet aktivizimi\"]},\"caution\":\"...\"}";
  const res = await claude(db, sys, JSON.stringify({ doctrines, analyses }), 3500);
  if (!(res as { error?: string }).error) await db.from("expert_knowledge").insert({ kind: "synthesis", payload: res });
  return res as Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let isCron = false;
  try {
    const { data: cs } = await db.from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
    const secret = (cs as { value?: string } | null)?.value;
    if (secret && req.headers.get("x-cron-secret") === secret) isCron = true;
  } catch { /* injoro */ }

  try {
    if (isCron) {
      // NJË batch për thirrje: analiza e 20 trade-ve me 9 ekspertë + JSON i plotë mund të
      // zgjasë ~70–110s; 2 batch-e do ta kalonin afatin wall-clock (~150s) të edge-function-it.
      // Cron-i thirret çdo 10 min, ndaj prapambetja pastrohet gradualisht.
      const r = await runBatch(db);
      return json({ cron: true, runs: r ? 1 : 0, results: r ? [r] : [] });
    }

    const auth = req.headers.get("Authorization") || "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const { data: prof } = await db.from("profiles").select("is_admin").eq("id", u.user.id).maybeSingle();
    if (!(prof as { is_admin?: boolean } | null)?.is_admin) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));

    if (body.run === true) { const r = await runBatch(db); if (r && (r as { error?: string }).error) return json({ error: (r as { error?: string }).error }); }
    if (body.research === true) {
      // NJË ekspert për kërkesë — që të mos kalohet afati (150s) i edge function-it.
      // UI-ja e thërret në lak derisa 'researchRemaining' të bëhet 0.
      const profs2 = await profiles(db);
      const next = profs2.find((p) => !p.doctrine);
      if (next) await researchOne(db, next);
    }
    if (body.synthesize === true) { const r = await synthesize(db); if ((r as { error?: string }).error) return json({ error: (r as { error?: string }).error }); }
    if (typeof body.set_autotrade === "boolean") {
      // SKELET: ruan vetëm flamurin — asnjë motor s'e lexon ende; S'TREGTON.
      await setCfg(db, "expert_autotrade_enabled", body.set_autotrade ? "true" : "false");
    }

    const [{ data: analyses }, profs, { data: knw }] = await Promise.all([
      db.from("expert_room_analyses").select("*").order("created_at", { ascending: false }).limit(50),
      profiles(db),
      db.from("expert_knowledge").select("*").eq("kind", "synthesis").order("created_at", { ascending: false }).limit(1),
    ]);
    const pend = await pendingRows(db);
    const autotrade = (await getCfg(db, "expert_autotrade_enabled")) === "true";
    const researchRemaining = (profs as Profile[]).filter((p) => !p.doctrine).length;
    return json({ analyses: analyses ?? [], profiles: profs, knowledge: (knw ?? [])[0] ?? null, pending: pend.length, batchSize: BATCH, autotrade, researchRemaining });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
