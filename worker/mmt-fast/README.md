# MMT-FAST — roboti tik-pas-tiku (Rruga A)

Robot gjithmonë-ndezur që ndjek **çdo tik** të arit live (Binance PAXG websocket) dhe
hyn **brenda sekondash** kur nis një shpërthim i konfirmuar (ngritje → BUY, rënie → SELL),
me bracket të plotë (SL+TP), mbrojtje të çastit (+0.4R → SL te hyrja), trailing, dalje në
burst të kundërt dhe në ngecje. Kontrollohet nga faqja **MMT** (çelësi FAST ON/OFF).

## Ç'të duhet
- Një server i vogël gjithmonë-ndezur (~$5/muaj): **Railway**, **Fly.io**, **Render**,
  ose çdo VPS (Hetzner/DigitalOcean) me **Node 20+**.
- Dy variabla mjedisi (i merr te Supabase → Project Settings → API):
  - `SUPABASE_URL` = `https://zwyuscgqacfpjafznybg.supabase.co`
  - `SUPABASE_SERVICE_ROLE_KEY` = çelësi *service_role* (SEKRET — mos e vendos askund tjetër)

## Nisja në VPS (Ubuntu/Debian)
```bash
# 1) Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs

# 2) Kodi
git clone https://github.com/gmaliqi05-art/Ai-trade.git && cd Ai-trade/worker/mmt-fast
npm install

# 3) Variablat + nisja
export SUPABASE_URL="https://zwyuscgqacfpjafznybg.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"
npm start
```

### Që të rrijë ndezur përgjithmonë (systemd)
```bash
sudo tee /etc/systemd/system/mmt-fast.service > /dev/null <<'EOF'
[Unit]
Description=MMT-FAST tick robot
After=network.target
[Service]
WorkingDirectory=/root/Ai-trade/worker/mmt-fast
Environment=SUPABASE_URL=https://zwyuscgqacfpjafznybg.supabase.co
Environment=SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
ExecStart=/usr/bin/node index.mjs
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now mmt-fast
journalctl -u mmt-fast -f   # logu live
```

## Nisja në Railway (pa VPS, më e thjeshta)
1. railway.app → New Project → **Deploy from GitHub repo** → zgjidh `Ai-trade`
2. Settings → **Root Directory**: `worker/mmt-fast` · Start command: `npm start`
3. Variables → shto `SUPABASE_URL` dhe `SUPABASE_SERVICE_ROLE_KEY`
4. Deploy — kaq.

## Si e di që punon
- Te faqja **MMT → Historiku i skanimeve** çdo 5 min shfaqet rreshti **FAST → fast_alive**
  (ose `fast_pozicion_BUY/SELL` kur ka pozicion hapur).
- Trade-t e tij dalin te **Tregtimet** me strategjinë **fast** (dhe te Tregto Live kur janë reale).
- Ndizet/fiket nga faqja MMT → çelësi **FAST** (worker-i e lexon çdo 15s).

## Siguria
- `fast_on` default **OFF** — s'tregton pa e ndezur ti.
- Respekton: kill-switch pas N SL, stop-in ditor, sesionet, blackout-in, 1 pozicion njëherësh,
  max N trade/ditë, cooldown pas çdo daljeje, kill_switch të llogarisë MT5.
- Loti live = `live_lots` (i njëjti i MMT, 0.01 nis).
