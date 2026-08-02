import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// DËRGUESI QENDROR I EMAIL-EVE (Resend).
//
// Çelësi i Resend NUK qëndron te variablat e mjedisit por te tabela 'email_secrets'
// (RLS pa asnjë politikë) — kështu pronari e ndryshon nga faqja e Adminit, pa rilëshim.
//
// Kush e thërret:
//   • funksionet e tjera (service-role) → stripe-webhook, subscription-reminder, auth-email
//   • admini nga faqja "Email" → vetëm 'test'
//
// Çdo dërgim regjistrohet te 'email_log' (edhe dështimet, me arsyen).

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SITE = "https://www.goldsniper.vip";
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Korniza e përbashkët — e njëjta pamje për çdo email. */
function layout(title: string, body: string, footNote = ""): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0b0f19;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0b0f19;padding:32px 12px;">
<tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111827;border:1px solid #1f2937;border-radius:18px;overflow:hidden;">
    <tr><td style="padding:26px 28px 18px;border-bottom:1px solid #1f2937;">
      <span style="display:inline-block;width:34px;height:34px;background:#f59e0b;border-radius:9px;text-align:center;line-height:34px;font-size:18px;">📈</span>
      <span style="color:#ffffff;font-size:17px;font-weight:800;letter-spacing:.5px;vertical-align:middle;margin-left:10px;">GOLDSNIPER</span>
    </td></tr>
    <tr><td style="padding:26px 28px;">
      <h1 style="margin:0 0 14px;color:#ffffff;font-size:19px;font-weight:800;">${esc(title)}</h1>
      ${body}
    </td></tr>
    <tr><td style="padding:16px 28px 24px;border-top:1px solid #1f2937;">
      <p style="margin:0 0 6px;color:#6b7280;font-size:11px;line-height:1.6;">${footNote}</p>
      <p style="margin:0;color:#4b5563;font-size:11px;line-height:1.6;">
        GoldSniper · <a href="${SITE}" style="color:#f59e0b;text-decoration:none;">goldsniper.vip</a> ·
        <a href="mailto:support@goldsniper.vip" style="color:#f59e0b;text-decoration:none;">support@goldsniper.vip</a><br>
        Tregtimi mbart rrezik. Nuk garantohet asnjë fitim.
      </p>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

const P = (s: string) => `<p style="margin:0 0 12px;color:#9ca3af;font-size:14px;line-height:1.7;">${s}</p>`;
const BTN = (href: string, label: string) =>
  `<p style="margin:20px 0;"><a href="${esc(href)}" style="display:inline-block;background:#f59e0b;color:#0b0f19;font-size:14px;font-weight:800;text-decoration:none;padding:12px 22px;border-radius:11px;">${esc(label)}</a></p>`;
const CODE = (code: string) =>
  `<p style="margin:20px 0;text-align:center;"><span style="display:inline-block;background:#0b0f19;border:1px solid #f59e0b;border-radius:13px;padding:16px 26px;color:#fbbf24;font-size:30px;font-weight:800;letter-spacing:9px;">${esc(code)}</span></p>`;

function rows(items: Array<[string, string]>): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid #1f2937;border-radius:12px;overflow:hidden;">${
    items.map(([k, v], i) =>
      `<tr style="background:${i % 2 ? "#0f1623" : "#0b0f19"};">
        <td style="padding:11px 14px;color:#6b7280;font-size:12px;">${esc(k)}</td>
        <td style="padding:11px 14px;color:#e5e7eb;font-size:13px;font-weight:600;text-align:right;">${esc(v)}</td>
      </tr>`).join("")
  }</table>`;
}

type Vars = Record<string, string | number | undefined>;

/** Ndërton subjektin + HTML-në sipas shabllonit. */
function render(template: string, v: Vars): { subject: string; html: string } | null {
  const name = String(v.name || "").trim();
  const hi = name ? `Përshëndetje ${esc(name)},` : "Përshëndetje,";

  switch (template) {
    case "verify":
      return {
        subject: `Kodi yt i verifikimit: ${v.code}`,
        html: layout("Verifiko llogarinë tënde", [
          P(`${hi} faleminderit që u regjistrove në GoldSniper.`),
          P("Vendos këtë kod 6-shifror në ekranin e verifikimit për të hapur platformën:"),
          CODE(String(v.code ?? "")),
          P("Kodi vlen vetëm për llogarinë tënde. Mos ia jep askujt."),
        ].join(""), "Nëse nuk je regjistruar ti, thjesht injoroje këtë email."),
      };

    case "reset":
      return {
        subject: "Rivendos fjalëkalimin tënd",
        html: layout("Rivendos fjalëkalimin", [
          P(`${hi} morëm një kërkesë për të rivendosur fjalëkalimin e llogarisë tënde.`),
          BTN(String(v.link ?? SITE), "Vendos fjalëkalim të ri"),
          P("Lidhja skadon brenda një ore dhe përdoret vetëm një herë."),
        ].join(""), "Nëse nuk e ke kërkuar ti, injoroje — fjalëkalimi yt nuk ndryshon."),
      };

    case "welcome":
      return {
        subject: "Mirë se erdhe në GoldSniper",
        html: layout("Llogaria jote është aktive", [
          P(`${hi} llogaria u verifikua me sukses.`),
          P("Tani ke qasje te Trade Live, Journal, kanali i sinjaleve në Telegram dhe konfigurimi i sinjaleve."),
          BTN(SITE, "Hap platformën"),
          P('Manuali i përdorimit gjendet brenda platformës te menyja "Manuali i përdorimit".'),
        ].join(""), "Për çdo pyetje: support@goldsniper.vip"),
      };

    case "billing":
      return {
        subject: "Abonimi yt është aktiv",
        html: layout("Faleminderit — abonimi është aktiv", [
          P(`${hi} pagesa u konfirmua dhe abonimi yt është aktivizuar.`),
          rows([
            ["Plani", String(v.plan ?? "—")],
            ["Shuma", String(v.amount ?? "—")],
            ["Data e fillimit", String(v.start ?? "—")],
            ["Vlen deri më", String(v.expires ?? "—")],
            ...(v.invoice ? [["Referenca", String(v.invoice)]] as Array<[string, string]> : []),
          ]),
          BTN(SITE, "Hap platformën"),
          P('Abonimin mund ta menaxhosh kurdo te "Cilësimet" brenda platformës.'),
        ].join(""), "Ky email shërben si konfirmim i abonimit."),
      };

    case "expiry":
      return {
        subject: `Abonimi yt skadon më ${v.expires}`,
        html: layout("Abonimi po skadon", [
          P(`${hi} abonimi yt skadon më <strong style="color:#fbbf24;">${esc(String(v.expires ?? ""))}</strong>.`),
          P("Rinovoje me kohë që sinjalet dhe tregtimi automatik të mos ndalen."),
          BTN(SITE, "Rinovo abonimin"),
        ].join(""), "Nëse e ke rinovuar tashmë, injoroje këtë kujtesë."),
      };

    case "test":
      return {
        subject: "Test — lidhja me Resend punon",
        html: layout("Lidhja u testua me sukses", [
          P("Ky është një email prove nga paneli i Adminit."),
          P("Nëse e sheh këtë mesazh, çelësi i Resend dhe domeni i dërgimit janë konfiguruar saktë."),
        ].join(""), ""),
      };

    default:
      return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE);

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ ok: false, error: "unauthorized" }, 401);

    // Thirrës i lejuar: service-role (funksionet e brendshme) OSE një admin (vetëm prova).
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
    if (!to || !template) return json({ ok: false, error: "bad_request" }, 400);

    const built = render(template, (body.vars ?? {}) as Vars);
    if (!built) return json({ ok: false, error: "unknown_template" }, 400);

    const { data: cfgRow } = await db.from("email_config").select("*").eq("id", 1).maybeSingle();
    const cfg = (cfgRow ?? {}) as Record<string, unknown>;

    // Ndalesa për lloj emaili (çelësat te faqja e Adminit). Prova kalon gjithmonë.
    const gate: Record<string, string> = {
      verify: "send_verify", reset: "send_reset", welcome: "send_welcome",
      billing: "send_billing", expiry: "send_expiry",
    };
    if (gate[template] && cfg[gate[template]] === false) {
      await db.from("email_log").insert({
        to_email: to, template, subject: built.subject, status: "skipped",
        error: "i çaktivizuar nga cilësimet", user_id: body.user_id ?? null,
      }).then(() => {}, () => {});
      return json({ ok: false, error: "disabled" });
    }

    const { data: sec } = await db.from("email_secrets").select("resend_api_key").eq("id", 1).maybeSingle();
    const key = ((sec as { resend_api_key?: string } | null)?.resend_api_key || "").trim();
    if (!key) {
      await db.from("email_log").insert({
        to_email: to, template, subject: built.subject, status: "failed",
        error: "Çelësi i Resend nuk është vendosur ende", user_id: body.user_id ?? null,
      }).then(() => {}, () => {});
      return json({ ok: false, error: "not_configured" }, 400);
    }

    const fromName = String(cfg.from_name || "GoldSniper");
    const fromEmail = String(cfg.from_email || "no-reply@goldsniper.vip");
    const replyTo = String(cfg.reply_to || "support@goldsniper.vip");

    let status = "sent";
    let errText: string | null = null;
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [to],
          reply_to: replyTo,
          subject: built.subject,
          html: built.html,
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
      to_email: to, template, subject: built.subject, status, error: errText,
      user_id: body.user_id ?? null,
    }).then(() => {}, () => {});

    return json(status === "sent" ? { ok: true } : { ok: false, error: errText }, status === "sent" ? 200 : 502);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
