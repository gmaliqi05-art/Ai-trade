# Dhoma e Ekspertëve — Hulumtim i Jashtëm (Batch 1)
**Qëllimi:** përforcimi i robotit XAUUSD që të REDUKTOJË HUMBJET. 10 agjentë, burime publike të verifikuara.
**Data:** 2026-06-15

---

## 🔑 10 ndryshimet me ndikim më të lartë (konsensus i 10 agjentëve)

Renditur sipas ndikimit te "më pak humbje" për robotin tonë aktual (scalp + swing, ar):

| # | Ndryshimi | Pse (problemi që zgjidh) | Ku |
|---|-----------|--------------------------|-----|
| 1 | **Spread-guard** — mos hap kur spread-i > ~2.0 pip (20 cent) | Humbjet scalp në orë të holla/lajme vijnë nga spread i gjerë + slippage | scalp + swing |
| 2 | **Filtër cilësie sesioni** — prefero London/NY overlap **13:00–17:00 UTC**; bllok/zvogëlo orët e holla aziatike **22:00–06:00 UTC** | SL-të e fundit ndodhën pikërisht në orë të holla (Frankfurt ~02:00) | scalp |
| 3 | **Stop-e ATR (jo $ fiks)** — scalp 1.5×ATR, swing 2–3×ATR | SL fiks $2 pritet nga zhurma normale e arit | të dyja |
| 4 | **Cool-off + ndalim serie** — ndal për ditën pas 3 humbjeve radhazi; pauzë 15–30 min pas 2 | Pengon "churn"-in që mbushi limitin bruto €10 me net ~flat | disiplinë |
| 5 | **Regjim ER/ADX për scalp** — scalp vetëm kur ADX>22 dhe Efficiency Ratio>0.35 | "Lëvizje të vogla" hyn në chop → shumë sinjale fallco | scalp |
| 6 | **Porta R:R** — scalp ≥1.5R, swing ≥2R; nëse stop-i e ul nën pragun, anashkalo | Mos merr trade me payoff të dobët | të dyja |
| 7 | **Break-and-retest** në vend të breakout-it të papërpunuar (mbyllje bari + retest) | Hyrjet në breakout të dobët = R:R i keq | swing |
| 8 | **News blackout i zgjeruar** — ±15 min NFP/CPI/PCE, ±30 min FOMC | Spike 300–1000 pip, spread 50+ pip | të dyja |
| 9 | **Over-extension veto** — anashkalo kur çmimi > ~1.5×ATR nga EMA-ja | Hyrje pas lëvizjes = rrezik kthimi | të dyja |
| 10 | **Drawdown floor statik + lot anti-martingale** — kufi total 8–10%; ½ lot pas serie humbëse | Mbrojtje kapitali afatgjatë; mos shto te humbësit | rrezik |

---

## 📚 Përmbledhje sipas fushës (rregulla konkrete + burime)

### 1) Hyrjet & timing
- Trade vetëm me trendin e HTF (EMA200 4h/1h); hyr në mid-TF (EMA50/S-R); kohëzo në LTF.
- **Prefero pullback/retest, jo breakout të freskët**; kërko mbyllje bari përtej nivelit + qiri konfirmimi.
- ADX > 25 (zona 25–40 ideale për pullback); RSI 40–50 në uptrend.
- Konfluencë: EMA200 + 50% Fib + S/R.
- Burime: [Tradeciety MTF](https://tradeciety.com/how-to-perform-a-multiple-time-frame-analysis) · [FXOpen break&retest](https://fxopen.com/blog/en/how-can-you-use-a-break-and-retest-strategy-in-trading/) · [NordFX XAUUSD](https://nordfx.com/traders-guide/gold-trading-strategies-day-trading-swing-trend-following-xauusd)

### 2) Rreziku & madhësia
- **Rrezik 1%/trade (max 2%)**; mat në R-multiples; target ≥2R.
- **¼–½ Kelly**, kurrë full Kelly (ruin risk i lartë).
- Limit ditor 2–5% (equity-based); heat total ≤6%; trajto scalp+swing si NJË bast ari (i korreluar).
- **Stop ATR**, lot = (equity×risk%)/(k×ATR×pip_value).
- Burime: [Van Tharp](https://vantharpinstitute.com/van-tharp-teaches-position-sizing-strategies-and-risk-management/) · [Elder 6%](http://adiscountedview.blogspot.com/2016/03/minimizing-portfolio-risk-with-dr.html) · [QuantVPS Kelly](https://www.quantvps.com/blog/trading-risk-management)

### 3) SL/TP
- ATR: scalp 1.5×, intraday 2–2.5×, swing 3×; Chandelier trail 3×ATR(22).
- Stop te swing low/high real + buffer spread-i; **wider(struktura, ATR)**.
- BE te +1R me offset = spread + pak pad; trailing pas ~2R; shtrëngo te ~4R.
- Burime: [StockCharts Chandelier](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/chandelier-exit) · [Van Tharp stops](https://the7circles.uk/van-tharp-7-stops-and-exits/) · [LuxAlgo ATR](https://www.luxalgo.com/blog/5-atr-stop-loss-strategies-for-risk-control/)

### 4) Trend-following (Turtles/Donchian/ADX)
- Donchian 20 (scalp) / 55 (swing) breakout; stop 2N (ATR); trail me kanal të kundërt (10/20).
- ADX>25 trade trend; <20 range; 20–25 = dead-zone (anashkalo). +DI/−DI për drejtim.
- Supertrend (10,3) si konfirmim; EMA200 + slope filtër.
- Burime: [Turtle Trading Blox](https://www.tradingblox.com/Manuals/UsersGuideHTML/turtlesystem.htm) · [ADX StockCharts](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)

### 5) Ari (XAUUSD) specifik
- **Trade 13:00–17:00 UTC** (London/NY); shmang **22:00–06:00 UTC** (Azia e hollë) dhe **rollover 20:45–22:15 UTC**.
- DXY korrelacion **negativ ~ -0.5/-0.8**; yields reale lart → presion mbi arin.
- News: NFP (Pre 1, 12:30 UTC), CPI (12:30/13:30), FOMC (18:00–18:30), PCE.
- Nivele: hapësirë $50/$100; mijëshe = magnet.
- Burime: [TMGM hours](https://www.tmgm.com/en/academy/trading-academy/gold-trading-hours) · [Vantage news](https://www.vantagemarkets.com/academy/news-trading-gold/) · [LBMA yields](https://www.lbma.org.uk/alchemist/issue-90/an-update-on-gold-real-interest-rates-and-the-dollar)

### 6) Scalping (Volman)
- **Kosto ≤ ~1 pip e targetit**; mos scalp kur spread > 2.0 pip; target ~10 pip, stop 6–7.
- Trade me trendin, hyr në pullback te EMA20 (chart i shpejtë); trail në BE shpejt.
- Kap trade/sesion; ndalim ditor; rregulli 15-min i lajmeve.
- Burime: [Volman summary](https://www.daytradingbias.com/forex-price-action-scalping-an-in-depth-look-into-the-field-of-professional-scalping-by-bob-volman/) · [XS gold scalp](https://www.xs.com/en/blog/gold-scalping-trading-strategy/)

### 7) Disiplina (FTMO/Douglas)
- Limit ditor 2–5% (equity); max drawdown 10% (floor statik).
- **Ndal pas 3 humbjeve radhazi**; cool-off pas 2; max 3–5 trade/ditë.
- Rrezik fiks; **prag besueshmërie adaptiv** (rrit pas humbjeve).
- Burime: [FTMO objectives](https://ftmo.com/en/trading-objectives/) · [Mark Douglas](https://tradethatswing.com/key-takeaways-from-trading-in-the-zone-by-mark-douglas/) · [Revenge trading](https://www.tradezella.com/blog/revenge-trading)

### 8) Struktura & price action
- Nivele nga pivot të konfirmuar (zona, jo vija); supply/demand nga origjina e lëvizjes; zona të freskëta.
- **Kërko "room to move"** te niveli i kundërt; BOS me mbyllje trupi (jo fitil); kujdes nga sweep-et.
- Burime: [Sam Seiden](https://forexmentoronline.com/4-supply-demand-trading-rules-you-must-follow/) · [Al Brooks](https://arongroups.co/technical-analyze/al-brooks-trading-ranges/) · [ICT OB](https://innercircletrader.net/tutorials/ict-order-block/)

### 9) Filtra quant
- **ADX regjim split** (trend>25, range<20, dead 20–25); **ER>0.35**; **ATR-percentile** (skip <P50 dhe >P90).
- Confluence score ≥3/5 (grumbullo trend-indikatorët si NJË votë); squeeze gate; anti-overfit (walk-forward, plateau).
- Burime: [QuantifiedStrategies ER](https://www.quantifiedstrategies.com/efficiency-ratio/) · [Desire To Trade ATR%](https://www.desiretotrade.com/docs/volatility-filter-indicator-atr-percentile-volatility/) · [Walk-forward](https://en.wikipedia.org/wiki/Walk_forward_optimization)

### 10) Kontroll drawdown / shmangie humbjesh
- Limit ditor equity-based 2–3%; floor total statik 10%; expectancy E=(W×AvgWin)−(L×AvgLoss)>0.
- **Lot anti-martingale** (½ pas 3 humbjeve / −10% equity-curve); equity-curve gate (pauzë nën MA të vetes).
- Asnjë trade pa SL; asnjë averaging-down; një ekspozim neto ari.
- Burime: [FTMO drawdowns](https://ftmo.com/en/blog/drawdowns/) · [TradeZella expectancy](https://www.tradezella.com/blog/trading-expectancy) · [Anti-Martingale FXOpen](https://fxopen.com/blog/en/martingale-and-anti-martingale-strategies-in-trading/)

---

## ⚖️ Tension i rëndësishëm për të vendosur
Hulumtimi thotë **shmang orët e holla aziatike (22:00–06:00 UTC)** për scalp — pikërisht kur ti kërkove që roboti të fillojë të dielën në mbrëmje. Opsionet:
- (a) Bllok i plotë i orëve të holla (cilësi maksimale, më pak trade), ose
- (b) Lejo por me **filtra më strikt + lot të reduktuar** në orët e holla (kompromis), ose
- (c) Lëre 24/5 si tani (më shumë trade, më shumë zhurmë).
