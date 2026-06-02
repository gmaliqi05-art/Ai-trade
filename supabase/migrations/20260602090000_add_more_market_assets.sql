/*
  # Add more market assets for the AI engine

  Faza 1 e motorit AI shfaq sinjale për tre tregje: Crypto, Ari/Mallra, Indekse/Aksione.
  Seed-i bazë kishte vetëm 6 aktive (vetëm 1 crypto dhe asnjë indeks/aksion), prandaj
  tregu "Indekse/Aksione" dilte bosh. Ky migrim shton aktive shtesë në mënyrë që të tri
  tregjet të kenë përmbajtje. Crypto-t marrin qirinj realë nga Binance; të tjerët demo.

  Çmimet janë vlera fillestare orientuese; përditësohen nga edge function `update-prices`.
*/

INSERT INTO assets (symbol, name, type, base_currency, quote_currency, current_price, price_change_24h, price_change_pct_24h) VALUES
  -- Crypto (marrin qirinj realë nga Binance)
  ('ETHUSD',  'Ethereum / US Dollar',   'crypto', 'ETH', 'USD', 3520.00,  45.00,  1.29),
  ('SOLUSD',  'Solana / US Dollar',     'crypto', 'SOL', 'USD', 152.30,   3.20,   2.15),
  ('BNBUSD',  'BNB / US Dollar',        'crypto', 'BNB', 'USD', 605.00,  -4.50,  -0.74),
  ('XRPUSD',  'XRP / US Dollar',        'crypto', 'XRP', 'USD', 0.5240,   0.012,  2.35),
  -- Indekse (tregu "Indekse/Aksione")
  ('US30',    'Dow Jones 30',           'stock',  'US30',  'USD', 39150.00, 120.00, 0.31),
  ('NAS100',  'Nasdaq 100',             'stock',  'NAS100','USD', 18230.00, 95.00,  0.52),
  ('SPX500',  'S&P 500',                'stock',  'SPX500','USD', 5235.00,  18.00,  0.34),
  ('GER40',   'DAX 40 (Germany)',       'stock',  'GER40', 'EUR', 18420.00, -60.00, -0.32),
  -- Aksione
  ('AAPL',    'Apple Inc.',             'stock',  'AAPL', 'USD', 191.50,   1.80,   0.95),
  ('MSFT',    'Microsoft Corp.',        'stock',  'MSFT', 'USD', 421.30,   2.40,   0.57),
  ('TSLA',    'Tesla Inc.',             'stock',  'TSLA', 'USD', 181.20,  -3.10,  -1.68)
ON CONFLICT (symbol) DO NOTHING;
