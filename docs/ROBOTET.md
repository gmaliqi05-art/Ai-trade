# Robotët e platformës — emërtimi zyrtar

Ky dokument fikson **emrat zyrtarë** të robotëve dhe shërbimeve të platformës, që kur
të bëjmë ndryshime të dimë saktë **për cilin robot** po flasim.

> Konventë: kur kërkohet një ndryshim, përdor emrin me **shkronja të mëdha** (p.sh.
> "te ROBOTI LIVE") → kjo tregon edge-function-in përkatës më poshtë.

---

## 🤖 Robotët tregtarë (vendosin / hapin trade)

| Emri zyrtar | Edge function | Roli |
|---|---|---|
| **MOTORI** (Truri) | `engine-scan` | Gjeneron sinjalet e arit (XAUUSD) çdo 5 min: BUY/SELL + besueshmëri. **Nuk tregton vetë** — vendos drejtimin. **Indikatorët dhe logjika e krijimit të sinjaleve janë KËTU** (i ndjeshëm — preket vetëm me kujdes maksimal). |
| **ROBOTI LIVE I SINJALEVE** | `auto-trade-runner` (blloku *swing*) | Ekzekuton sinjalet e MOTORIT në MT5 real (afatgjatë). Këtu rrinë **portat/veto-t e hyrjes**: orari/para-mbyllja, max pozicione, shkallëzimi sipas besueshmërisë, pozicion aktiv në humbje, ri-analiza e tregut, rejection/sweep, lot-i. |
| **FastT** (scalping) | `scalp-live` + blloku *scalp* te `auto-trade-runner` | Scalping real-time mbi tick (~çdo 1.5s), afatshkurtër. |
| **ROBOTI DEMO** | `demo-trade-runner` | Paper-trading (para virtuale) që pasqyron robotin live (swing + scalp). |

**Në thelb:** 2 vendimmarrës — **MOTORI** (jep sinjalin) + **ROBOTI LIVE** (e ekzekuton).
FastT dhe DEMO janë variante.

---

## 🔧 Shërbime ndihmëse (nuk vendosin — mbështesin robotët)

| Edge function | Roli |
|---|---|
| `metaapi-trade` | Ura me MT5 — ekzekuton urdhra, trade manuale, regjistron mbylljet (RECORD_CLOSE). |
| `metaapi-watchdog` | Vigjilenti i lidhjes MT5 + gjurmuesi i mbylljeve (close-tracker, çdo 2 min). |
| `signal-eval` | Vlerëson sinjalet (TP/SL/expired) → lista "Completed signals". |
| `web-push-send` | Dërgon njoftimet Web Push. |
| `update-prices` | Përditëson çmimet. |
| `demo-trade-action` | Hapje/mbyllje manuale te DEMO (nga klienti). |
| `mt-webhook` | Webhook nga MT5. |
| `ai-analyze` / `analyze-chart` | Analizë AI me kërkesë (butoni "AI analysis"). |

---

## 🧠 Mjete admin / vetë-mësim (vetëm super-admin, NUK tregtojnë)

| Edge function | Roli |
|---|---|
| `mmti-shadow` | Test "shadow" i strategjisë së optimizuar mbi sinjalet reale. |
| `lab-trades` | Mëson nga trade-t reale të llogarisë (statistika win-rate/expectancy). |
| `strategy-advisor` | Sistemi vetë-mësues → sugjerime rregullimesh (pa overfitting). |
| `expert-room` | "Dhoma e ekspertëve" — analizë pas çdo 20 trade auto. |
| `admin-change-password`, `admin-delete-user` | Administrim llogarish. |

---

## Shënime për ndryshimet

- Ndryshimet te **hyrjet/ekzekutimi i robotit** bëhen te **ROBOTI LIVE** (`auto-trade-runner`),
  pa prekur **MOTORIN** (`engine-scan`).
- Kur një rregull duhet të vlejë edhe për paper-trading, përditësohet edhe **ROBOTI DEMO**.
- Deploy: `deploy-auto-trade-runner.yml` (ROBOTI LIVE + shërbime), `deploy-demo-trade-runner.yml`
  (ROBOTI DEMO), `deploy-engine-scan.yml` (MOTORI).
