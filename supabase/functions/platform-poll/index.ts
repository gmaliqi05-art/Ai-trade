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

// ---- FILTRAT E MESAZHEVE (konfigurohen te Admin → GoldSniperFX) ----
// Heq emoji-t, simbolet dekorative dhe variacionet e tyre; pastron hapësirat e mbetura.
function stripEmojis(s: string): string {
  return s
    .replace(/[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F3FB}-\u{1F3FF}\u{200D}]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .split("\n").map((l) => l.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A e përmban teksti ndonjë fjalë kyçe të bllokuar (një për rresht ose ndarë me presje)?
// KUFIJ FJALE: "eric" NUK duhet të përputhet brenda "America" — prandaj shqyrtohet si fjalë
// e plotë kur termi është një fjalë e vetme; termat me hapësira kërkohen si frazë.
function matchedBlockedWord(text: string, blocked: string): string | null {
  const words = blocked.split(/[\n,]/).map((w) => w.trim()).filter(Boolean);
  if (words.length === 0) return null;
  const low = text.toLowerCase();
  for (const w of words) {
    const lw = w.toLowerCase();
    if (/\s/.test(lw)) { if (low.includes(lw)) return w; continue; }
    const esc = lw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(low)) return w;
  }
  return null;
}

// ---- RREGULLAT E INTEGRUARA TË BLLOKIMIT (kërkesa e pronarit, 2 gusht 2026) ----
// Kthen arsyen e bllokimit ose null nëse mesazhi lejohet.
// deno-lint-ignore no-explicit-any
function blockReason(text: string, m: any, blockedWords: string): { reason: string; matched: string | null } | null {
  const hasSiren = /🚨/.test(text);
  // Media: varet nga fusha që dërgon feed-i; kontrollohen emrat e mundshëm.
  const hasMedia = !!(m?.photo || m?.image || m?.media || m?.has_photo || m?.file || m?.document || m?.attachment);
  // "Informacion i vlefshëm" = ka çmim (3+ shifra) ose është sinjal/urdhër roboti.
  const hasPrice = /\d{3,}/.test(text);
  const signalLike = isSignalLike(text);
  const robotOrder = isRobotOrder(text);

  // 1) Çdo mesazh me përmendje @emri.
  const mention = text.match(/@[A-Za-z0-9_]{2,}/);
  if (mention) return { reason: "mention", matched: mention[0] };
  // 2) Emrat e bllokuar + lista e Adminit (me kufij fjale).
  const kw = matchedBlockedWord(text, blockedWords);
  if (kw) return { reason: "keyword", matched: kw };
  // 3) Ftesa për depozitë / përmirësim llogarie.
  const dep = text.match(/\bdeposits?\b|\bupgrade\s+(?:your\s+)?account\b/i);
  if (dep) return { reason: "deposit", matched: dep[0] };
  // 4) Ftesa për video.
  const vid = text.match(/\bwatch\s+the\s+video\b/i);
  if (vid) return { reason: "video", matched: vid[0] };
  // 5) "Scalp group" — VETËM kur s'është sinjal apo urdhër roboti.
  const sg = text.match(/\bscalp\s*group\b/i);
  if (sg && !signalLike && !robotOrder) return { reason: "scalp_group", matched: sg[0] };
  // 6) Sirenë 🚨 e shoqëruar me foto/media.
  if (hasSiren && hasMedia) return { reason: "siren_media", matched: "🚨 + media" };
  // 7) Sirenë 🚨 pa asnjë informacion (pa çmim, pa sinjal, pa urdhër).
  if (hasSiren && !hasPrice && !signalLike && !robotOrder) return { reason: "siren_no_info", matched: "🚨" };
  return null;
}

// A duket si SINJAL i plotë (drejtim + hyrje/SL/TP)?
function isSignalLike(text: string): boolean {
  return /\b(buy|sell)\b/i.test(text) && /\bentry\b|\bsl\b|\btp\s*\d?\b/i.test(text);
}

// R10: nga një mesazh që përmban sinjal, mban VETËM rreshtat e sinjalit —
// tekstet përshkruese sipër/poshtë hiqen.
function extractSignal(text: string): string | null {
  const keep = text.split("\n").map((l) => l.trim()).filter((l) =>
    /^[^A-Za-z0-9]*\b(buy|sell)\b/i.test(l) ||
    /^[^A-Za-z0-9]*\b(entry|enter)\b/i.test(l) ||
    /^[^A-Za-z0-9]*\b(sl|stop\s*loss)\b/i.test(l) ||
    /^[^A-Za-z0-9]*\b(tp\s*\d?|take\s*profit\s*\d?)\b/i.test(l)
  );
  return keep.length >= 2 ? keep.join("\n") : null;
}

// A duket si URDHËR për robotin (lëviz SL, breakeven, mbyll, ANULO, TP)? Këta NUK bllokohen nga
// filtri i komenteve — përndryshe roboti s'do t'i mbronte pozicionet e hapura.
//
// "CANCEL" MUNGONTE (5 gusht 2026). Lista e foljeve këtu kishte mbetur pas asaj të parserit: ai i
// njeh 'cancel/remove/delete/abort/scrap/drop/kill/void/anulo', kjo njihte vetëm 'close/exit/mbyll'.
// Pasoja: me 'Fshih bisedat' të ndezur, një "Cancel BUY" trajtohej si muhabet dhe hidhej pa arritur
// kurrë te roboti — ndërsa porositë rrinin te brokeri. Foljet mbahen të njëjta me ato të parserit.
function isRobotOrder(text: string): boolean {
  // 'tp\s*\d?' e jo 'tp': te "TP1 4160" nuk ka kufi fjale mes 'p' dhe '1', ndaj '\btp\b' dështonte
  // dhe ndryshimi i një objektivi hidhej si muhabet. E gjeti testi, jo syri.
  return /\b(sl|stop\s*loss|tp\s*\d?|take\s*profit\s*\d?|break\s*even|breakeven|be)\b/i.test(text)
    || /\b(move|close|exit|cancel|remove|delete|abort|scrap|drop|kill|void|flat|mbyll(?:e|eni)?|anulo(?:je|jeni)?|dil)\b/i.test(text);
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
      const status = String(s.status ?? "").toLowerCase();
      // REZERVIM ATOMIK (kundër dublimit): INSERT ... ON CONFLICT DO NOTHING + RETURNING.
      // Vetëm ekzekutimi që e fiton rreshtin e dërgon sinjalin; ekzekutimet paralele
      // marrin 0 rreshta dhe dalin. Kontrolli i vjetër "select pastaj insert" kishte
      // vrimë kohore ku dy poll-e paralele e dërgonin të njëjtin sinjal dy herë.
      const { data: claimed, error: claimErr } = await db.from("platform_feed_seen")
        .upsert({ feed_id: fid, signal_number: s.signal_number ?? null, status },
          { onConflict: "feed_id", ignoreDuplicates: true })
        .select("feed_id");
      if (claimErr || !claimed || claimed.length === 0) { skipped++; continue; }
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
      const type = String(m.type ?? "").toLowerCase();
      // I njëjti rezervim atomik si te sinjalet — një mesazh përpunohet vetëm një herë.
      const { data: claimed, error: claimErr } = await db.from("platform_feed_seen")
        .upsert({ feed_id: mid, status: `msg:${type}` },
          { onConflict: "feed_id", ignoreDuplicates: true })
        .select("feed_id");
      if (claimErr || !claimed || claimed.length === 0) continue;
      if (type === "signal") continue; // sinjalet trajtohen nga /signals (trade)
      let text = String(m.text ?? "").trim();
      if (!text) continue;

      // ---- FILTRAT (Admin → GoldSniperFX → Bllokimet) ----
      // a) RREGULLAT E BLLOKIMIT: @përmendje · emrat/fjalët e Adminit · deposit/upgrade account ·
      //    watch the video · "scalp group" jo-sinjal · 🚨 me foto · 🚨 pa asnjë informacion.
      //    Mesazhi i bllokuar NUK kalon askund — as te abonentët, as te kanali.
      const why = blockReason(text, m, String(gs?.msg_blocked_words || ""));
      if (why) {
        // RAPORTI: ruaj arsyen dhe fjalën e saktë — shfaqet te Admin → GoldSniperFX → Raporti.
        await db.from("message_block_log").insert({
          feed_id: mid, reason: why.reason, matched: why.matched,
          text_excerpt: text.slice(0, 2000), source: m.source ?? "GoldSniperFX",
        }).then(() => {}, () => {});
        // BLLOKIMI NDALON SHFAQJEN, JO MBROJTJEN E PARAVE (5 gusht 2026).
        // Filtri u bë për të mos i çuar abonentëve spam. Por nëse i njëjti mesazh është urdhër
        // roboti — "Cancel BUY", "close all", "move SL to BE" — heqja e tij nuk fsheh thjesht një
        // rresht teksti: lë porosi dhe pozicione të hapura te brokeri, me para të vërteta, kur
        // pronari ka kërkuar shprehimisht t'i ndalë. Ndaj urdhri kalon te roboti gjithsesi; te
        // kanali nuk postohet, saktësisht siç është vendosur.
        if (secret && isRobotOrder(text)) {
          try {
            await fetch(`${SELF}/functions/v1/telegram-signals?key=${encodeURIComponent(secret)}`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ signal: {
                action: "message", message: text.replace(/[`*_]/g, ""), symbol: "XAUUSD",
                id: uuidToNum(mid), source: m.source ?? "GoldSniperFX",
              } }),
            });
          } catch { /* mos e ndal poller-in */ }
        }
        skipped++; continue;
      }
      // b) Fshehja e komenteve/bisedave — urdhrat e robotit (SL/TP/breakeven/mbyll) kalojnë gjithmonë.
      if (gs?.msg_hide_chat && !isRobotOrder(text)) {
        await db.from("message_block_log").insert({
          feed_id: mid, reason: "hide_chat", matched: null,
          text_excerpt: text.slice(0, 2000), source: m.source ?? "GoldSniperFX",
        }).then(() => {}, () => {});
        skipped++; continue;
      }
      // c) Heqja e emoji-ve/simboleve dekorative nga teksti që shfaqet dhe postohet.
      if (gs?.msg_strip_emojis !== false) { text = stripEmojis(text); if (!text) { skipped++; continue; } }

      // d) MESAZH QË PËRSHKRUAN NJË SINJAL (p.sh. i njëjti hyrje i rikthyer me 🚨):
      //    · R10 — mbahen VETËM rreshtat e sinjalit (tekstet sipër/poshtë hiqen);
      //    · R8  — dërgohet me history:true → REGJISTROHET dhe SHFAQET, por NUK hap trade
      //            (sinjali i vërtetë ka ardhur tashmë nga feed-i /signals);
      //    · nuk ripostohet te kanali, sepse sinjali është postuar një herë nga seksioni A.
      const extracted = extractSignal(text);
      const infoOnly = !!extracted;
      if (extracted) text = extracted;

      // 1) ROBOTI: mesazhi shkon te telegram-signals ku parseSignal e klasifikon —
      //    modify (lëviz SL / breakeven / ndrysho TP), exit (dil/mbyll), ose koment → injorohet.
      //    Vepron te MT5 për të gjithë përdoruesit (si sinjalet). Formatimi markdown hiqet.
      if (secret) {
        const clean = text.replace(/[`*_]/g, "");
        try {
          await fetch(`${SELF}/functions/v1/telegram-signals?key=${encodeURIComponent(secret)}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              signal: { action: "message", message: clean, symbol: "XAUUSD", id: uuidToNum(mid), source: m.source ?? "GoldSniperFX" },
              ...(infoOnly ? { history: true } : {}),
            }),
          });
        } catch { /* mos e ndal poller-in */ }
      }

      // 2) KANALI: posto tekstin te kanali (nëse auto_send + bot + kanal).
      //    Përshkrimet e sinjaleve (infoOnly) NUK ripostohen — sinjali u postua nga seksioni A.
      if (!infoOnly && gs?.auto_send && gs?.bot_token && gs?.channel_id) {
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
