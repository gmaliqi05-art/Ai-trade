import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface AnalysisResult {
  signal: "buy" | "sell" | "hold";
  confidence: number;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  sentiment: "bullish" | "bearish" | "neutral";
  analysis_text: string;
  reasoning: string;
  key_levels: string[];
  indicators_summary: string;
  provider_used: string;
}

interface AIProvider {
  id: string;
  name: string;
  slug: string;
  api_key_encrypted: string;
  model: string;
  system_prompt: string | null;
  is_active: boolean;
  priority: number;
}

interface MarketData {
  symbol: string;
  current_price: number;
  price_change_24h: number;
  price_change_pct: number;
  timeframe?: string;
  ohlcv?: Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>;
  indicators?: { ma20?: number; ma50?: number; rsi14?: number; atr14?: number };
  bid?: number;
  ask?: number;
  spread?: number;
  /** Dalja e motorit matematik (src/ai-trader) — indikatorë + verdikt për dy horizonte. */
  engine?: EngineInput;
}

/** Verdikti i një horizonti nga motori matematik i platformës. */
interface EngineHorizon {
  action: "BUY" | "SELL" | "HOLD";
  confidence: number; // 0..1
  reasons?: string[];
}

/** Snapshot i indikatorëve të llogaritur nga motori (qirinj realë/demo). */
interface EngineInput {
  source?: "live" | "demo";
  indicators?: {
    emaFast?: number; emaSlow?: number; rsi?: number;
    macd?: number; macdSignal?: number; macdHist?: number;
    bbUpper?: number; bbMiddle?: number; bbLower?: number; atr?: number;
  };
  short?: EngineHorizon;
  long?: EngineHorizon;
}

function buildSystemPrompt(customPrompt: string | null): string {
  if (customPrompt && customPrompt.trim().length > 20) return customPrompt;
  return `You are a professional trading analyst specializing in Forex, Gold (XAUUSD), and Cryptocurrencies.

You work ALONGSIDE a deterministic mathematical engine that has already computed the
technical indicators (EMA, RSI, MACD, Bollinger Bands, ATR) and a preliminary
BUY/SELL/HOLD verdict for short- and long-term horizons. When this engine output is
provided, your job is QUALITATIVE: confirm, refine, or push back on the engine's verdict
with clear reasoning about trend, momentum, volatility and risk. Do not silently ignore it.

STRICT RULES — NEVER VIOLATE:
1. Use ONLY the exact price/indicator data provided in the user message. NEVER use values from your training data.
2. The current_price in the message is the REAL live price — base all levels on it.
3. entry_price must be within 0.5% of the provided current_price.
4. target_price must be a realistic move (0.5-3% from entry for forex/gold, up to 5% for crypto).
5. stop_loss must be set — never return null for stop_loss if you give a signal. Prefer an ATR-based stop when ATR is provided.
6. If provided data is insufficient, return "hold" with confidence < 50.
7. NEVER fabricate indicator values — use only what is provided.
8. If you disagree with the engine's verdict, say so explicitly in "reasoning" and explain why.

Return ONLY valid JSON in this exact structure, no markdown, no extra text:
{
  "signal": "buy" | "sell" | "hold",
  "confidence": <integer 0-100>,
  "entry_price": <number — must be near the provided current_price>,
  "target_price": <number or null>,
  "stop_loss": <number — required if signal is buy or sell>,
  "sentiment": "bullish" | "bearish" | "neutral",
  "analysis_text": "<2-3 sentence summary using only the provided data>",
  "reasoning": "<detailed reasoning referencing actual price levels from the provided data>",
  "key_levels": ["<level 1>", "<level 2>", "<level 3>"],
  "indicators_summary": "<one sentence using only the provided indicator values>"
}`;
}

function buildUserMessage(data: MarketData): string {
  let msg = `LIVE MARKET DATA — Use ONLY these exact values for your analysis:\n\n`;
  msg += `Symbol: ${data.symbol}\n`;
  msg += `Current Price (LIVE): ${data.current_price}\n`;
  msg += `24h Change: ${data.price_change_24h >= 0 ? '+' : ''}${data.price_change_24h} (${data.price_change_pct >= 0 ? '+' : ''}${data.price_change_pct.toFixed(2)}%)\n`;

  if (data.bid && data.ask) {
    msg += `Bid: ${data.bid} | Ask: ${data.ask}`;
    if (data.spread) msg += ` | Spread: ${data.spread} pips`;
    msg += '\n';
  }

  if (data.timeframe) msg += `Timeframe: ${data.timeframe}\n`;

  if (data.ohlcv && data.ohlcv.length > 0) {
    msg += `\nRecent OHLCV bars (last ${Math.min(data.ohlcv.length, 5)}):\n`;
    for (const bar of data.ohlcv.slice(-5)) {
      msg += `  ${bar.time}: O=${bar.open} H=${bar.high} L=${bar.low} C=${bar.close} V=${bar.volume}\n`;
    }
  }

  if (data.indicators && Object.keys(data.indicators).length > 0) {
    msg += `\nTechnical Indicators (provided values only):\n`;
    if (data.indicators.ma20) msg += `  MA(20): ${data.indicators.ma20}\n`;
    if (data.indicators.ma50) msg += `  MA(50): ${data.indicators.ma50}\n`;
    if (data.indicators.rsi14 !== undefined) msg += `  RSI(14): ${data.indicators.rsi14.toFixed(1)}\n`;
    if (data.indicators.atr14) msg += `  ATR(14): ${data.indicators.atr14}\n`;
  }

  if (data.engine) {
    const e = data.engine;
    msg += `\n=== MATH ENGINE OUTPUT (deterministic, computed from ${e.source === 'live' ? 'LIVE' : 'demo'} candles) ===\n`;
    const ind = e.indicators;
    if (ind) {
      msg += `Engine indicators:\n`;
      const f = (n?: number) => (n === undefined || n === null || Number.isNaN(n) ? "n/a" : n);
      msg += `  EMA fast/slow: ${f(ind.emaFast)} / ${f(ind.emaSlow)}\n`;
      msg += `  RSI: ${ind.rsi !== undefined ? Number(ind.rsi).toFixed(1) : "n/a"}\n`;
      msg += `  MACD / signal / hist: ${f(ind.macd)} / ${f(ind.macdSignal)} / ${f(ind.macdHist)}\n`;
      msg += `  Bollinger up/mid/low: ${f(ind.bbUpper)} / ${f(ind.bbMiddle)} / ${f(ind.bbLower)}\n`;
      msg += `  ATR: ${f(ind.atr)}\n`;
    }
    const horizon = (label: string, h?: EngineHorizon) => {
      if (!h) return "";
      let s = `${label} verdict: ${h.action} (engine confidence ${(h.confidence * 100).toFixed(0)}%)\n`;
      if (h.reasons && h.reasons.length > 0) {
        s += `${label} reasons:\n` + h.reasons.map((r) => `    - ${r}`).join("\n") + "\n";
      }
      return s;
    };
    msg += horizon("SHORT-TERM", e.short);
    msg += horizon("LONG-TERM", e.long);
    msg += `\nAssess whether you AGREE with the engine. In "reasoning", state agreement or disagreement and why, and set "confidence" to reflect your own conviction.\n`;
  }

  msg += `\nIMPORTANT: The current price is ${data.current_price}. Your entry_price MUST be near ${data.current_price}. Do NOT use any other price range.`;
  return msg;
}

async function callGenericOpenAICompat(
  apiKey: string,
  model: string,
  endpoint: string,
  systemPrompt: string,
  userMessage: string,
  providerName: string
): Promise<AnalysisResult> {
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1500,
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`${providerName} error ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${providerName} returned empty content`);
  return JSON.parse(content) as AnalysisResult;
}

async function callAnthropic(apiKey: string, model: string, systemPrompt: string, userMessage: string): Promise<AnalysisResult> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "claude-3-haiku-20240307",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      temperature: 0.1,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic error ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  const content = data.content?.[0]?.text;
  if (!content) throw new Error("Anthropic returned empty content");
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in Anthropic response");
  return JSON.parse(match[0]) as AnalysisResult;
}

async function callGemini(apiKey: string, model: string, systemPrompt: string, userMessage: string): Promise<AnalysisResult> {
  const geminiModel = model || "gemini-1.5-flash";
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userMessage }] }],
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.1,
        },
      }),
    }
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini error ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error("Gemini returned empty content");
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in Gemini response");
  return JSON.parse(match[0]) as AnalysisResult;
}

const OPENAI_COMPAT_ENDPOINTS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  deepseek: "https://api.deepseek.com/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  together: "https://api.together.xyz/v1/chat/completions",
  perplexity: "https://api.perplexity.ai/chat/completions",
  cohere: "https://api.cohere.ai/compatibility/v1/chat/completions",
  xai: "https://api.x.ai/v1/chat/completions",
  fireworks: "https://api.fireworks.ai/inference/v1/chat/completions",
};

const DEFAULT_MODELS: Record<string, string> = {
  groq: "meta-llama/llama-4-scout-17b-16e-instruct",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-haiku-20240307",
  gemini: "gemini-1.5-flash",
  deepseek: "deepseek-chat",
  mistral: "mistral-small-latest",
  together: "meta-llama/Llama-3-70b-chat-hf",
  perplexity: "llama-3.1-sonar-small-128k-online",
  cohere: "command-r",
  xai: "grok-beta",
  fireworks: "accounts/fireworks/models/llama-v3p1-70b-instruct",
};

async function callProvider(provider: AIProvider, userMessage: string): Promise<AnalysisResult & { provider_used: string }> {
  const systemPrompt = buildSystemPrompt(provider.system_prompt);
  const apiKey = provider.api_key_encrypted;
  if (!apiKey || apiKey.trim() === '') throw new Error(`No API key for ${provider.slug}`);

  const model = provider.model || DEFAULT_MODELS[provider.slug] || "gpt-4o-mini";
  let result: AnalysisResult;

  if (provider.slug === "anthropic") {
    result = await callAnthropic(apiKey, model, systemPrompt, userMessage);
  } else if (provider.slug === "gemini") {
    result = await callGemini(apiKey, model, systemPrompt, userMessage);
  } else {
    const endpoint = OPENAI_COMPAT_ENDPOINTS[provider.slug] || `https://api.${provider.slug}.com/v1/chat/completions`;
    result = await callGenericOpenAICompat(apiKey, model, endpoint, systemPrompt, userMessage, provider.slug);
  }

  return { ...result, provider_used: provider.slug };
}

function enforceRealPrice(result: AnalysisResult, realCurrentPrice: number): AnalysisResult {
  const MAX_DEVIATION = 0.05;
  const entry = result.entry_price;

  if (entry !== null && Math.abs(entry - realCurrentPrice) / realCurrentPrice > MAX_DEVIATION) {
    result.entry_price = realCurrentPrice;
    result.analysis_text = `[Price corrected to live market price: ${realCurrentPrice}] ` + result.analysis_text;
  }

  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { symbol, asset_id, timeframe, preferred_provider, engine } = body;

    if (!symbol) {
      return new Response(JSON.stringify({ error: "symbol is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [assetResult, mtDataResult] = await Promise.all([
      db.from("assets").select("*").eq("symbol", symbol).maybeSingle(),
      db.from("mt_market_data")
        .select("*")
        .eq("symbol", symbol)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const asset = assetResult.data;
    if (!asset) {
      return new Response(JSON.stringify({ error: `Asset ${symbol} not found` }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mtRows = mtDataResult.data || [];
    const latestMT = mtRows[0] || null;

    const realCurrentPrice = latestMT?.close_price
      ? Number(latestMT.close_price)
      : Number(asset.current_price);

    const marketData: MarketData = {
      symbol,
      current_price: realCurrentPrice,
      price_change_24h: Number(asset.price_change_24h) || 0,
      price_change_pct: Number(asset.price_change_pct) || 0,
      timeframe: timeframe || (latestMT?.timeframe ? `${latestMT.timeframe}m` : "H1"),
      indicators: latestMT?.indicators || undefined,
      ohlcv: mtRows.length > 0 ? mtRows.reverse().map((r: {
        bar_time: string; open_price: number; high_price: number;
        low_price: number; close_price: number; volume: number;
      }) => ({
        time: r.bar_time,
        open: Number(r.open_price),
        high: Number(r.high_price),
        low: Number(r.low_price),
        close: Number(r.close_price),
        volume: Number(r.volume),
      })) : undefined,
      engine: engine && typeof engine === "object" ? (engine as EngineInput) : undefined,
    };

    // Nëse motori dha ATR dhe s'kemi indikatorë nga MetaTrader, përdor ATR-në e motorit.
    if (engine?.indicators?.atr && (!marketData.indicators || marketData.indicators.atr14 === undefined)) {
      marketData.indicators = { ...(marketData.indicators || {}), atr14: Number(engine.indicators.atr) };
    }

    const userMessage = buildUserMessage(marketData);

    const { data: providers } = await db
      .from("ai_providers")
      .select("*")
      .eq("is_active", true)
      .order("priority", { ascending: true });

    if (!providers || providers.length === 0) {
      return new Response(JSON.stringify({
        error: "no_active_providers",
        message: "No AI providers configured. Please add an API key in Admin → AI Providers.",
      }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let orderedProviders: AIProvider[] = [...providers];
    if (preferred_provider) {
      const pref = orderedProviders.find(p => p.slug === preferred_provider);
      if (pref) orderedProviders = [pref, ...orderedProviders.filter(p => p.slug !== preferred_provider)];
    }

    let result: (AnalysisResult & { provider_used: string }) | null = null;
    const errors: string[] = [];

    for (const provider of orderedProviders) {
      try {
        const raw = await callProvider(provider as AIProvider, userMessage);
        result = { ...enforceRealPrice(raw, realCurrentPrice), provider_used: raw.provider_used };
        break;
      } catch (err) {
        const msg = (err as Error).message;
        errors.push(`${provider.slug}: ${msg}`);
        console.error(`Provider ${provider.slug} failed:`, msg);
      }
    }

    if (!result) {
      return new Response(JSON.stringify({
        error: "all_providers_failed",
        message: "All AI providers failed. Check API keys in Admin → AI Providers.",
        details: errors,
      }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const analysisRecord = {
      user_id: user.id,
      asset_id: asset_id || asset.id,
      source: latestMT ? "metatrader" : "manual",
      ai_provider: result.provider_used,
      timeframe: timeframe || "H1",
      signal: result.signal,
      confidence: Math.min(100, Math.max(0, Math.round(result.confidence))),
      entry_price: result.entry_price || realCurrentPrice,
      target_price: result.target_price,
      stop_loss: result.stop_loss,
      analysis_text: result.analysis_text,
      reasoning: result.reasoning,
      status: "completed",
    };

    const { data: savedAnalysis } = await db
      .from("chart_analyses")
      .insert(analysisRecord)
      .select()
      .maybeSingle();

    await db.from("ai_analyses").insert({
      user_id: user.id,
      asset_id: asset_id || asset.id,
      analysis_text: `${result.analysis_text}\n\n${result.reasoning}`,
      sentiment: result.sentiment || (result.signal === "buy" ? "bullish" : result.signal === "sell" ? "bearish" : "neutral"),
      prediction: result.target_price
        ? `Target: ${result.target_price} — Stop: ${result.stop_loss}`
        : result.indicators_summary || "Monitor for signal",
      confidence: Math.min(100, Math.max(0, result.confidence)),
    });

    if ((result.signal === "buy" || result.signal === "sell") && result.confidence >= 65) {
      await db.from("signals").insert({
        user_id: user.id,
        asset_id: asset_id || asset.id,
        type: result.signal,
        symbol,
        confidence: Math.round(result.confidence),
        entry_price: result.entry_price || realCurrentPrice,
        target_price: result.target_price,
        stop_loss: result.stop_loss,
        timeframe: timeframe || "H1",
        analysis: result.analysis_text,
        source: "ai_analysis",
        status: "active",
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    return new Response(JSON.stringify({
      success: true,
      analysis: {
        ...result,
        current_price: realCurrentPrice,
        asset: { symbol: asset.symbol, name: asset.name },
        has_mt_data: mtRows.length > 0,
        data_points: mtRows.length,
        analysis_id: savedAnalysis?.id,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const error = err as Error;
    console.error("ai-analyze error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
