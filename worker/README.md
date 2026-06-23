# FastT worker — kohë reale E VËRTETË (MetaApi streaming, ~250ms)

Ky është roboti **FastT** si proces **always-on** (gjithmonë i ndezur): lidhet me MetaApi me
**streaming (WebSocket)** dhe arsyeton çdo **~250ms** mbi tick-un live — shumë më shpejt se edge
function-i (~1–1.5s). Truri është **i njëjti tick-driven** si edge function-i:

- **HYRJE (`tickStart`):** vetëm në trend real (ADX + ndarje EMA), me drejtim nga **tick-u LIVE** —
  shpejtësi + përshpejtim + efikasitet (anti-chop) + freski + thyerje mikro-strukture. Kap fillimin
  e lëvizjes, **jo** majën; nuk hyn kundër lëvizjes.
- **DALJE (`reversalExit`):** del **në çastin që çmimi tenton kthesën** (kap fitimin te ndalesa,
  pret humbjen shpejt), por **lë fituesit të vrapojnë**. Parashutë + qirinj + EMA si rezervë.
- **SL "katastrofe"** i gjerë te brokeri si rrjetë sigurie.
- Regjistron te Supabase me emrin **FastT** (UI/Raportet e tregojnë me badge). Respekton
  `scalp_live_enabled` / `kill_switch` / `max_daily_loss` nga `metaapi_config`.

---

## ⚠️ Çfarë është "host" (dhe pse domain-i NUK mjafton)

- **Domain** (p.sh. `faqja-ime.com`) = vetëm një **emër/adresë**. NUK ekzekuton kod. Nuk hyn në punë këtu.
- **Host** = një **kompjuter që punon 24/7** dhe mban lidhjen WebSocket me MetaApi gjithë kohën.
  Supabase/Vercel s'e mbajnë dot (funksionet janë jetëshkurtra) → prandaj duhet një host always-on.

Kosto tipike: ~**5 $/muaj** (Railway/Render/Fly). Domain-in s'e ke nevojë për worker-in.

---

## 🟢 Rruga më e LEHTË — Railway (rekomanduar, pa skedarë config)

1. Hyr te **railway.app** → **New Project** → **Deploy from GitHub repo** → zgjidh këtë repo.
2. Te **Settings → Root Directory** shkruaj: `worker`
3. Railway e gjen vetë `Dockerfile`-in dhe e ndërton.
4. Te **Variables** shto çelësat (nga `.env.example`):
   `METAAPI_TOKEN`, `METAAPI_ACCOUNT_ID`, `METAAPI_REGION`, `FASTT_SYMBOL`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FASTT_USER_ID`.
5. **Deploy**. Te **Logs** duhet të shohësh: `✅ FastT worker LIVE — streaming ... Arsyeton çdo 250ms`.

E ndez/fik nga butoni **AKTIV/JOAKTIV** në app (worker lexon `scalp_live_enabled`).

---

## Alternativa

| Host | Si |
|---|---|
| **Render** | New → **Background Worker** → ky repo → **Root Directory: `worker`** → Runtime **Docker** → shto Environment vars |
| **Fly.io** | `cd worker && fly launch --no-deploy` (pranon `fly.toml`) → `fly secrets set KEY=val ...` → `fly deploy` |
| **VPS** (DigitalOcean/Hetzner) | `cd worker && docker build -t fastt . && docker run -d --env-file .env --restart=always fastt` |

---

## Provë lokale (në kompjuterin tënd, para hostit)
```bash
cd worker
cp .env.example .env      # plotëso vlerat
npm install
npm start                  # duhet: "✅ FastT worker LIVE — streaming ..."
```

## Nga i marr çelësat?
- **METAAPI_TOKEN / METAAPI_ACCOUNT_ID / METAAPI_REGION** → nga paneli MetaApi i app-it (i njëjti që përdor app-i).
- **SUPABASE_SERVICE_ROLE_KEY** → Supabase → Project Settings → API → `service_role` (sekret!).
- **FASTT_USER_ID** → UUID-ja jote e përdoruesit (nga tabela `auth.users` / profili).
- **FASTT_SYMBOL** → simboli i arit te brokeri yt (p.sh. `XAUUSD+`).

> Sigurohu që për këtë llogari të mos jetë ndezur edhe roboti normal në të njëjtin simbol — që të
> mos luftojnë me njëri-tjetrin (FastT + roboti normal = pozicione të kundërta).
