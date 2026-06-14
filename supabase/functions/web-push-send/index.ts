import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// web-push-send — dërgon njoftime Web Push (web + PWA) me VAPID + enkriptim aes128gcm (RFC 8291/8188),
// vetëm me Web Crypto native (pa varësi të jashtme). Thirret:
//  - INTERNE (me service-role bearer): nga auto-trade-runner (hap/mbyll trade) & engine-scan (sinjale).
//    Body: { title, body, url?, tag?, user_id?  |  audience:'all' }
//  - PËRDORUES (me JWT): butoni "Provo" te Cilësimet → { self:true, title, body, url? } (vetëm te vetja).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const enc = new TextEncoder();
const b64urlEncode = (buf: ArrayBuffer | Uint8Array): string => {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlDecode = (str: string): Uint8Array => {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64); const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};
const concat = (...arrs: Uint8Array[]): Uint8Array => {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len); let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
};

interface Sub { endpoint: string; p256dh: string; auth: string; }

// VAPID JWT (ES256) për një origjinë (aud).
async function vapidJwt(aud: string, subject: string, pubB64: string, privB64: string): Promise<string> {
  const pub = b64urlDecode(pubB64); // 0x04 || X(32) || Y(32)
  const jwk = {
    kty: "EC", crv: "P-256", ext: true, key_ops: ["sign"],
    d: privB64, x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)),
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64urlEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput));
  return `${signingInput}.${b64urlEncode(sig)}`; // Web Crypto kthen r||s (64B) — pikërisht ES256
}

// Enkriptimi i payload-it sipas aes128gcm (RFC 8188) me derivim çelësash RFC 8291.
async function encryptPayload(sub: Sub, plaintext: Uint8Array): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(sub.p256dh);   // 65B
  const authSecret = b64urlDecode(sub.auth);   // 16B

  const asPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asPair.publicKey)); // 65B
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPair.privateKey, 256));

  // RFC 8291: IKM = HKDF(salt=auth, ikm=ecdh, info="WebPush: info\0"||ua||as, L=32)
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikmKey = await crypto.subtle.importKey("raw", ecdhSecret, "HKDF", false, ["deriveBits"]);
  const ikm = new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: authSecret, info: keyInfo }, ikmKey, 256));

  // RFC 8188: salt i rastësishëm → CEK(16) + NONCE(12)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prkKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const cek = new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode("Content-Encoding: aes128gcm\0") }, prkKey, 128));
  const nonce = new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode("Content-Encoding: nonce\0") }, prkKey, 96));

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const record = concat(plaintext, new Uint8Array([0x02])); // delimiter për rekordin e fundit
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record));

  // Header aes128gcm: salt(16) || rs(4 BE) || idlen(1) || keyid(as_public 65) || ciphertext
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096, false);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    const auth = req.headers.get("Authorization") || "";
    const bearer = auth.replace(/^Bearer\s+/i, "");
    const internal = bearer && bearer === serviceKey;

    const body = await req.json().catch(() => ({}));
    const title = String(body.title || "ProTrade");
    const text = String(body.body || "");
    const url = String(body.url || "/");
    const tag = body.tag ? String(body.tag) : undefined;

    // Përcakto marrësit (user_ids) sipas autoritetit.
    let userIds: string[] = [];
    if (internal) {
      if (body.audience === "all") {
        const { data } = await db.from("push_tokens").select("user_id").eq("is_active", true);
        userIds = [...new Set((data ?? []).map((r) => (r as { user_id: string }).user_id))];
      } else if (body.user_id) {
        userIds = [String(body.user_id)];
      }
    } else {
      // Përdorues i loguar → vetëm te vetja (butoni "Provo").
      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "unauthorized" }, 401);
      userIds = [user.id];
    }
    if (userIds.length === 0) return json({ sent: 0, note: "no recipients" });

    // Çelësat VAPID nga app_config.
    const { data: cfg } = await db.from("app_config").select("key, value").in("key", ["vapid_public", "vapid_private", "vapid_subject"]);
    const kv = Object.fromEntries((cfg ?? []).map((r) => [(r as { key: string }).key, (r as { value: string }).value]));
    const pub = kv["vapid_public"], priv = kv["vapid_private"], subject = kv["vapid_subject"] || "mailto:admin@protrade.app";
    if (!pub || !priv) return json({ error: "vapid_not_configured" }, 500);

    const { data: tokens } = await db.from("push_tokens")
      .select("user_id, token, p256dh, auth").in("user_id", userIds).eq("is_active", true);
    const subs = (tokens ?? []) as Array<{ token: string; p256dh: string; auth: string }>;
    if (subs.length === 0) return json({ sent: 0, note: "no subscriptions" });

    const plaintext = enc.encode(JSON.stringify({ title, body: text, url, tag }));
    let sent = 0, removed = 0;
    const jwtCache = new Map<string, string>();

    for (const s of subs) {
      if (!s.token || !s.p256dh || !s.auth) continue;
      try {
        const origin = new URL(s.token).origin;
        let jwt = jwtCache.get(origin);
        if (!jwt) { jwt = await vapidJwt(origin, subject, pub, priv); jwtCache.set(origin, jwt); }
        const payload = await encryptPayload(s, plaintext);
        const resp = await fetch(s.token, {
          method: "POST",
          headers: {
            "TTL": "86400",
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "Authorization": `vapid t=${jwt}, k=${pub}`,
          },
          body: payload,
          signal: AbortSignal.timeout(10000),
        });
        if (resp.status === 201 || resp.status === 200 || resp.status === 202) sent++;
        else if (resp.status === 404 || resp.status === 410) {
          // Abonim i skaduar → fshije.
          await db.from("push_tokens").delete().eq("token", s.token); removed++;
        }
      } catch { /* anashkalo këtë abonim */ }
    }
    return json({ sent, removed, recipients: userIds.length });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
