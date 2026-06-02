# AI Trader — Plani Real i Platformës

> Platformë tregtimi me një "robot" inteligjent që analizon tregun me indikatorë
> teknikë + algoritma + Claude AI, jep sinjale BLEJ/SHIT dhe (opsionalisht) lidhet
> me MetaTrader 5 për ekzekutim automatik.

## ⚠️ Parime kryesore (mos i harro kurrë)
1. **Asnjë garanci fitimi.** Tregu rrezikon humbje reale. Sistemi nis gjithmonë në
   **modalitet DEMO** dhe me mbrojtje rreziku të detyrueshme.
2. **Ndarja e shpejtësisë:** motori matematik (TypeScript) llogarit në milisekonda;
   Claude AI shton arsyetim cilësor (sekonda), jo vendimmarrje me frekuencë të lartë.
3. **Siguria e parë:** lot maksimal, stop-loss i detyruar, limit humbjeje ditore,
   kill-switch.

## Tregjet e synuara (faza 1)
- Crypto (BTC, ETH, ...)
- Ari / Mallra (XAU/USD)
- Indekse / Aksione (US30, NAS100, ...)

## Arkitektura

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React + TS + Tailwind)                             │
│  - Login / Auth (Supabase)                                    │
│  - Dashboard raporte real-time                                │
│  - Konfigurim roboti (lot 0.01, auto-trade on/off, rreziku)   │
│  - Faqe sinjalesh (afatshkurtër + afatgjatë)                  │
└───────────────┬───────────────────────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────────────────┐
│  Backend / Edge Functions (Supabase)                          │
│  - Marrja e të dhënave të tregut (REST/WebSocket)             │
│  - Motori i sinjaleve (core/ — i ndarë, i testueshëm)         │
│  - Arsyetimi me Claude AI (Anthropic API)                     │
│  - Ura me MetaTrader 5 (MetaApi.cloud ose EA MQL5)            │
└───────────────────────────────────────────────────────────────┘
```

## Motori i analizës (`core/`) — ZEMRA, ndërtohet i pari
- `indicators.ts` — SMA, EMA, RSI (Wilder), MACD, Bollinger, ATR
- `signal-engine.ts` — kombinon indikatorët → BUY/SELL/HOLD + confidence + arsyet,
  me profile afatshkurtër dhe afatgjatë
- `risk.ts` — madhësia e lotit nga rreziku, kufijtë e mbrojtjes

## Fazat
| Fazë | Përmbajtja | Statusi |
|------|-----------|---------|
| **1** | Motori `core/` (indikatorë + sinjale + rrezik) me teste | ✅ në punim |
| 2 | UI: Login, Dashboard, faqe sinjalesh (të dhëna demo) | ⏳ |
| 3 | Feed real i tregut (crypto via API publike, etj.) | ⏳ |
| 4 | Integrim Claude AI për arsyetim mbi sinjalet | ⏳ |
| 5 | Ura MetaTrader 5 (MetaApi.cloud) + auto-trade me mbrojtje | ⏳ |
| 6 | Backtesting + raporte performance | ⏳ |

## Lidhja me MetaTrader 5 (rekomandim)
**MetaApi.cloud** — shërbim cloud që lidh llogarinë MT5 të përdoruesit dhe lejon
ekzekutim urdhrash via REST/WebSocket nga platforma jonë. Fillojmë: sinjale + demo;
auto-trade aktivizohet vetëm me pëlqim eksplicit dhe limite rreziku.
