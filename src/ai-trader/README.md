# AI Trader — Motori i analizës

Motor i pastër dhe i testueshëm për sinjale tregtimi, i ndarë nga UI dhe burimet e të dhënave.

## Struktura

```
src/ai-trader/
├── core/                  # Logjika e pastër (pa varësi UI)
│   ├── types.ts           # Candle, Signal, IndicatorSnapshot, Action, Horizon
│   ├── indicators.ts      # SMA, EMA, RSI (Wilder), MACD, Bollinger, ATR
│   ├── signal-engine.ts   # Indikatorë → BLEJ/SHIT/PRIT + confidence + arsyet
│   ├── risk.ts            # calcLotSize + canOpenTrade (mbrojtje rreziku)
│   └── trade-plan.ts      # Sinjal + ATR → hyrje / stop-loss / objektiv
├── market/
│   └── candles.ts         # Burimi i qirinjve (live crypto + demo i riprodhueshëm)
├── react/                 # Hooks + komponente UI
│   ├── useAssetAnalysis.ts    # Analizë për një aktiv
│   ├── useMarketAnalysis.ts   # Analizë për një listë aktivesh
│   ├── EngineSignalCard.tsx   # Kartë sinjali (short + long)
│   └── format.ts
├── analyze.ts             # Ura: të dhëna tregu → sinjale short + long + plane
└── index.ts               # Pika hyrëse publike
```

## Burimi i të dhënave (faza 1 — "demo i pari")

- **Crypto** → qirinj **realë** nga Binance (API publik, pa çelës).
- **Ari/Mallra, Indekse/Aksione, Forex** → qirinj **demo të riprodhueshëm**
  (random walk i mbjellë nga simboli), derisa të lidhet feed-i real në Fazën 3.

Kartat në UI shënojnë qartë `LIVE` ose `DEMO`.

## Parime
- **Asnjë garanci fitimi.** Çdo gjë testohet fillimisht në demo.
- Motori matematik është i shpejtë (ms); arsyetimi me Claude AI vjen në Fazën 4.
- Mbrojtje rreziku e detyrueshme: lot maksimal, stop-loss, limit humbjeje ditore, kill-switch.

## Testet

```bash
npm test            # ekzekuton të gjitha testet (Vitest)
npm run test:watch  # mënyrë watch
```
