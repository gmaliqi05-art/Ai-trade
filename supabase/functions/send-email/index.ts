import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// DËRGUESI QENDROR I EMAIL-EVE (Resend) — GoldSniperFX.
//
// Tekstet NUK janë më brenda kodit: çdo model lexohet nga tabela 'email_templates' dhe
// redaktohet nga Admini. Këtu qëndron vetëm korniza (logo, ngjyrat, fundi ligjor) dhe
// përkthimi i shënjave të thjeshta në HTML.
//
// Çelësi i Resend lexohet nga 'email_secrets' (RLS pa politika → vetëm service-role).

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SITE = "https://www.goldsniper.vip";
const SUPPORT = "support@goldsniper.vip";

// Paleta e markës — e marrë nga logoja (blu e errët + ar).
const C = {
  bg: "#0a1526", card: "#0f2137", line: "#1c3350",
  gold: "#f0b429", goldSoft: "#fbd77a", text: "#e8eef7",
};
const MUTED = "#8ba3c0";
const FAINT = "#5d7590";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** **tekst** → i trashë. Zbatohet PAS shpëtimit të HTML-së, që të mos hyjë kod i huaj. */
const bold = (s: string) =>
  s.replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#ffffff;font-weight:700;">$1</strong>');

/** Zëvendëson {{variablat}}. Vlerat shpëtohen — asnjë e dhënë përdoruesi s'bëhet HTML. */
function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, k: string) => vars[k.toLowerCase()] ?? "");
}

/** Përkthen shënjat e thjeshta të modelit në HTML email-i (tabela, jo flexbox). */
function renderBody(src: string): string {
  const out: string[] = [];

  // Blloqet me shënja të veçanta nxirren para paragrafëve.
  const parts = src.split(/(\[code\][\s\S]*?\[\/code\]|\[button\][\s\S]*?\[\/button\]|\[rows\][\s\S]*?\[\/rows\])/g);

  for (const part of parts) {
    if (!part.trim()) continue;

    const code = part.match(/^\[code\]([\s\S]*?)\[\/code\]$/);
    if (code) {
      out.push(
        `<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 18px;">
<span style="display:inline-block;background:${C.bg};border:1px solid ${C.gold};border-radius:14px;padding:16px 28px;color:${C.goldSoft};font-size:31px;font-weight:800;letter-spacing:10px;font-family:'Courier New',monospace;">${esc(code[1].trim())}</span>
</td></tr></table>`);
      continue;
    }

    const btn = part.match(/^\[button\]([\s\S]*?)\[\/button\]$/);
    if (btn) {
      const [label, href] = btn[1].split("|");
      out.push(
        `<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:6px 0 20px;">
<a href="${esc((href || SITE).trim())}" style="display:inline-block;background:${C.gold};color:#0a1526;font-size:14px;font-weight:800;text-decoration:none;padding:13px 30px;border-radius:11px;">${esc((label || "Hap").trim())}</a>
</td></tr></table>`);
      continue;
    }

    const rows = part.match(/^\[rows\]([\s\S]*?)\[\/rows\]$/);
    if (rows) {
      const items = rows[1].split("\n").map((l) => l.trim()).filter(Boolean)
        .map((l) => { const i = l.indexOf("|"); return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
        .filter((x): x is string[] => !!x && !!x[1]); // rreshtat pa vlerë hiqen vetë
      if (items.length) {
        out.push(
          `<table width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 20px;border:1px solid ${C.line};border-radius:12px;overflow:hidden;">${
            items.map(([k, v], i) =>
              `<tr style="background:${i % 2 ? "rgba(255,255,255,0.02)" : "transparent"};">
<td style="padding:11px 15px;color:${MUTED};font-size:12px;">${esc(k)}</td>
<td style="padding:11px 15px;color:${C.text};font-size:13px;font-weight:600;text-align:right;">${esc(v)}</td></tr>`).join("")
          }</table>`);
      }
      continue;
    }

    // Tekst i zakonshëm → paragrafë (rreshtat bosh i ndajnë).
    for (const para of part.split(/\n{2,}/)) {
      const p = para.trim();
      if (!p) continue;
      out.push(`<p style="margin:0 0 14px;color:${MUTED};font-size:14px;line-height:1.75;">${bold(esc(p)).replace(/\n/g, "<br>")}</p>`);
    }
  }
  return out.join("");
}

/** Koka: logoja e ngarkuar, ose emri i markës i shkruar me stil (shfaqet gjithmonë,
 *  edhe kur klienti i email-it i bllokon fotot). */
function header(brand: string, logoUrl: string): string {
  if (logoUrl) {
    return `<img src="${esc(logoUrl)}" alt="${esc(brand)}" width="150" style="display:block;width:150px;max-width:64%;height:auto;border:0;outline:none;">`;
  }
  const m = brand.match(/^(.*?)(FX)$/i);
  const head = m ? m[1] : brand;
  const tail = m ? m[2] : "";
  return `<div style="font-size:24px;font-weight:800;letter-spacing:.4px;line-height:1;">
<span style="color:${C.gold};">${esc(head)}</span><span style="color:#ffffff;">${esc(tail)}</span>
</div>
<div style="margin-top:6px;color:${MUTED};font-size:9px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">Telegram Trading Platform</div>`;
}

function layout(brand: string, logoUrl: string, body: string, legal: string, footer: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${C.bg};padding:34px 12px;">
<tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:540px;background:${C.card};border:1px solid ${C.line};border-radius:20px;overflow:hidden;">

    <tr><td align="center" style="padding:30px 30px 22px;border-bottom:1px solid ${C.line};">
      ${header(brand, logoUrl)}
    </td></tr>

    <tr><td style="padding:28px 30px 10px;">${body}</td></tr>

    <tr><td style="padding:18px 30px 26px;border-top:1px solid ${C.line};">
      <p style="margin:0 0 12px;color:${FAINT};font-size:10px;line-height:1.7;">${esc(legal)}</p>
      <p style="margin:0 0 10px;color:${MUTED};font-size:11px;line-height:1.7;">
        <a href="${SITE}" style="color:${C.gold};text-decoration:none;">goldsniper.vip</a>
        &nbsp;·&nbsp;
        <a href="mailto:${SUPPORT}" style="color:${C.gold};text-decoration:none;">${SUPPORT}</a>
        &nbsp;·&nbsp;
        <a href="${SITE}/#legal" style="color:${MUTED};text-decoration:underline;">Politikat Ligjore</a>
      </p>
      <p style="margin:0;color:${FAINT};font-size:10px;">© ${new Date().getFullYear()} ${esc(brand)} · ${esc(footer)}</p>
    </td></tr>

  </table>
</td></tr></table></body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE);

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ ok: false, error: "unauthorized" }, 401);

    // Thirrës i lejuar: service-role (funksionet e brendshme) OSE admin (provë/parapamje/dërgim me dorë).
    const internal = jwt === SERVICE;
    if (!internal) {
      const { data: u } = await db.auth.getUser(jwt);
      const uid = u?.user?.id;
      if (!uid) return json({ ok: false, error: "unauthorized" }, 401);
      const { data: me } = await db.from("profiles").select("is_admin").eq("id", uid).maybeSingle();
      if (!me?.is_admin) return json({ ok: false, error: "forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const template = String(body.template || "");
    const to = String(body.to || "").trim();
    const preview = body.preview === true;   // vetëm ndërto HTML-në, mos dërgo
    if (!template || (!to && !preview)) return json({ ok: false, error: "bad_request" }, 400);

    const { data: cfgRow } = await db.from("email_config").select("*").eq("id", 1).maybeSingle();
    const cfg = (cfgRow ?? {}) as Record<string, unknown>;
    const brand = String(cfg.brand_name || "GoldSniperFX");
    const logoUrl = String(cfg.logo_url || "");
    const legal = String(cfg.legal_note || "");
    const footNote = String(cfg.footer_note || "Krijuar nga MarGroup DE");

    // 'custom' → email i shkruar me dorë nga paneli: subjekti dhe teksti vijnë me kërkesën,
    // por kalojnë nga E NJËJTA kornizë dhe i njëjti shpëtim si modelet (asnjë HTML i papërpunuar).
    let tpl: { subject?: string; body?: string; enabled?: boolean } | null;
    if (template === "custom") {
      const s = String(body.subject || "").trim();
      const b = String(body.body || "").trim();
      if (!s || !b) return json({ ok: false, error: "empty_custom" }, 400);
      tpl = { subject: s, body: b, enabled: true };
    } else {
      const { data: tplRow } = await db.from("email_templates").select("*").eq("key", template).maybeSingle();
      tpl = tplRow as typeof tpl;
    }
    if (!tpl) return json({ ok: false, error: "unknown_template" }, 400);

    // Modeli i çaktivizuar → mos dërgo (por lëre gjurmën). Prova kalon gjithmonë.
    if (tpl.enabled === false && template !== "test") {
      if (!preview) {
        await db.from("email_log").insert({
          to_email: to, template, subject: String(tpl.subject || ""), status: "skipped",
          error: "modeli është i çaktivizuar", user_id: body.user_id ?? null,
        }).then(() => {}, () => {});
      }
      return json({ ok: false, error: "disabled" });
    }

    const raw = (body.vars ?? {}) as Record<string, unknown>;
    const vars: Record<string, string> = {
      brand, site: SITE, support: SUPPORT,
      ...Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), String(v ?? "")])),
    };
    if (!vars.name) vars.name = "";

    const subject = fill(String(tpl.subject || ""), vars).trim() || brand;
    // "Përshëndetje ," kur s'ka emër → pastrohet.
    const filled = fill(String(tpl.body || ""), vars).replace(/([A-Za-zëçÇË])\s+,/g, "$1,");
    const html = layout(brand, logoUrl, renderBody(filled), legal, footNote);

    if (preview) return json({ ok: true, subject, html });

    const { data: sec } = await db.from("email_secrets").select("resend_api_key").eq("id", 1).maybeSingle();
    const key = ((sec as { resend_api_key?: string } | null)?.resend_api_key || "").trim();
    if (!key) {
      await db.from("email_log").insert({
        to_email: to, template, subject, status: "failed",
        error: "Çelësi i Resend nuk është vendosur ende", user_id: body.user_id ?? null,
      }).then(() => {}, () => {});
      return json({ ok: false, error: "not_configured" }, 400);
    }

    const fromEmail = String(cfg.from_email || "no-reply@goldsniper.vip");
    const replyTo = String(cfg.reply_to || SUPPORT);

    let status = "sent";
    let errText: string | null = null;
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${String(cfg.from_name || brand)} <${fromEmail}>`,
          to: [to], reply_to: replyTo, subject, html,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) {
        status = "failed";
        const j = await r.json().catch(() => ({}));
        errText = String((j as { message?: string }).message || `HTTP ${r.status}`);
      }
    } catch (e) {
      status = "failed";
      errText = (e as Error).message;
    }

    await db.from("email_log").insert({
      to_email: to, template, subject, status, error: errText, user_id: body.user_id ?? null,
    }).then(() => {}, () => {});

    return json(status === "sent" ? { ok: true } : { ok: false, error: errText }, status === "sent" ? 200 : 502);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
