# FastT worker — kohë reale e vërtetë (MetaApi streaming)

Ky është roboti **FastT** si proces **always-on**: lidhet me MetaApi me **streaming (WebSocket)**,
ndjek pamjen **1-minutëshe live** dhe arsyeton si njeri që shikon ekranin:

- **Hyrje:** vetëm **në drejtim të trendit 1m**, dhe vetëm pas një **pullback-u te EMA9** (jo në çdo dridhje, jo duke ndjekur majat/fundet).
- **Dalje:** **nuk del** për një kthim të vogël — e **mban** pozicionin sa kohë trendi është i paprekur (çmimi në anën e duhur të EMA9). Del **vetëm në kthesë reale** (çmimi thyen mbrapsht EMA9), ose kur siguron një fitim të madh.
- **SL "katastrofe"** i gjerë te brokeri vetëm si rrjetë sigurie.
- Regjistron trade-t te Supabase me emrin **FastT** (UI/Raportet i tregojnë me badge "FastT").
- Respekton `scalp_live_enabled`, `kill_switch`, `max_daily_loss` nga `metaapi_config`.

> ⚠️ **Pse jo Supabase/Vercel?** Kjo kërkon një lidhje WebSocket të **përhershme** — funksionet *cron* serverless (Supabase Edge) janë jetëshkurtra dhe s'mund ta mbajnë. Prandaj duhet një host always-on.

## Si ta nisësh lokalisht
```bash
cd worker
cp .env.example .env      # plotëso vlerat
npm install
npm start
```

## Hostimi always-on (zgjidh njërin)
Të gjitha mbështesin `Dockerfile`-in këtu:

| Host | Si |
|---|---|
| **Railway** | New Project → Deploy from repo → root `worker/` → shto Variables nga `.env.example` |
| **Render** | New → Background Worker → root `worker/` → Docker → Environment vars |
| **Fly.io** | `cd worker && fly launch` (Dockerfile auto) → `fly secrets set KEY=val ...` |
| **VPS** | `docker build -t fastt . && docker run --env-file .env --restart=always fastt` |

Vendos të gjitha çelësat nga `.env.example` te "Environment Variables / Secrets" të host-it.
Roboti niset vetë dhe rri online; e ndez/fik nga butoni **AKTIV/JOAKTIV** në app (lexon `scalp_live_enabled`).

## Variablat kryesore
Shih `.env.example`. Token-in dhe Account ID-në e MetaApi i merr nga paneli MetaApi i app-it;
`SUPABASE_SERVICE_ROLE_KEY` nga Supabase → Project Settings → API.
