# Telegram Sin — userbot kopjues (forwarder)

Lexon kanalin e trejderave (ku je abonent) me llogarinë TËnde dhe ia përcjell çdo sinjal
sistemit Telegram Sin — 24/7, në mënyrë të padukshme për pronarin e kanalit.

> **Privatësia:** vetëm LEXON. S'poston, s'jep reagime, s'shton bot te kanali. Pronari i
> kanalit s'ka si ta marrë vesh — ti mbetesh një abonent normal.

## 1. Merr api_id / api_hash (një herë)
1. Hyr te **https://my.telegram.org** → *API development tools*.
2. Krijo një aplikacion (emër çfarëdo). Merr **api_id** dhe **api_hash**.

## 2. Krijo session string (një herë, në kompjuterin tënd)
```bash
pip install -r requirements.txt
python login.py
```
Fut api_id, api_hash, numrin e telefonit dhe kodin që të vjen në Telegram.
Kopjo vargun e gjatë në fund → ky është **TG_SESSION** (sekret; mos ia jep askujt).

## 3. Gjej ID-në e kanalit
```bash
TG_API_ID=... TG_API_HASH=... TG_SESSION=... python list_chats.py
```
Gjej rreshtin "FX+ | XNINE LEVEL 2" (kanal) dhe kopjo **ID-në** (p.sh. `-1001234567890`).

## 4. Merr WEBHOOK_URL
Nga faqja **Telegram Sin** në aplikacion → fusha "URL-ja e webhook-ut" → butoni kopjo.
(është `https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/telegram-signals?key=...`)

## 5. Vendose të punojë 24/7
Kërkohen këto env variabla:
```
TG_API_ID=123456
TG_API_HASH=abc...
TG_SESSION=1Ab2...   (nga hapi 2)
TG_SOURCE=-1001234567890   (ID e kanalit; mund të vendosësh disa me presje)
WEBHOOK_URL=https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/telegram-signals?key=...
```
Pastaj:
```bash
python forwarder.py
```

### Ku ta mbash gjithmonë të ndezur (zgjidh njërën)
- **Railway.app / Render.com / Fly.io** (rekomandohet, ka plan falas gjithmonë-aktiv):
  ngarko këtë folder, vendos 5 env variablat lart, komanda e nisjes: `python forwarder.py`.
- **Kompjuteri yt** (nëse rri gjithmonë online): thjesht `python forwarder.py`.
- **VPS i vogël** (p.sh. me `systemd` ose `pm2`): njësoj.

Kur punon, do shohësh `✓ Në pritje të sinjaleve…` dhe pastaj `⇢ sinjal …` sa herë poston trejderi.
Sinjali shfaqet menjëherë te faqja Telegram Sin dhe hyn në trade sipas cilësimeve.

## Shënime
- `TG_SESSION` = qasje e plotë në llogarinë tënde Telegram. Ruaje si sekret, mos e ngarko në git.
- Nëse ndryshon fjalëkalimin ose çkyçesh, krijo session-in nga fillimi (hapi 2).
