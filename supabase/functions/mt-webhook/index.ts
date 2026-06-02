import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface MTPayload {
  symbol: string;
  timeframe: string;
  current_price: number;
  bid?: number;
  ask?: number;
  spread?: number;
  ohlcv?: Array<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  indicators?: {
    ma20?: number;
    ma50?: number;
    rsi14?: number;
    atr14?: number;
  };
}

interface AIProvider {
  id: string;
  name: string;
  slug: string;
  api_key_encrypted: string;
  model: string;
  endpoint: string | null;
  system_prompt: string | null;
  is_active: boolean;
  priority: number;
}

interface AnalysisResult {
  signal: string;
  confidence: number;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  analysis_text: string;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are an expert gold (XAU/USD) and forex technical analyst with 20 years of experience.
You receive OHLCV market data and technical indicators from MetaTrader.
Analyze the data and return ONLY valid JSON:
{
  "signal": "buy" | "sell" | "hold",
  "confidence": <number 0-100>,
  "entry_price": <number or null>,
  "target_price": <number or null>,
  "stop_loss": <number or null>,
  "analysis_text": "<brief 1-2 sentence summary>",
  "reasoning": "<detailed technical reasoning based on price action, MA crossovers, RSI, ATR>"
}`;

async function analyzeWithGroq(apiKey: string, model: string, prompt: string): Promise<AnalysisResult> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 800,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) throw new Error(`Groq error: ${response.status}`);
  const data = await response.json();
  return JSON.parse(data.choices?.[0]?.message?.content);
}

async function analyzeWithOpenAI(apiKey: string, model: string, prompt: string): Promise<AnalysisResult> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 800,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI error: ${response.status}`);
  const data = await response.json();
  return JSON.parse(data.choices?.[0]?.message?.content);
}

async function analyzeWithGemini(apiKey: string, model: string, prompt: string): Promise<AnalysisResult> {
  const geminiModel = model || "gemini-1.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json" },
      }),
    }
  );
  if (!response.ok) throw new Error(`Gemini error: ${response.status}`);
  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in Gemini response");
  return JSON.parse(match[0]);
}

async function analyzeWithAnthropic(apiKey: string, model: string, prompt: string): Promise<AnalysisResult> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "claude-3-5-sonnet-20241022",
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic error: ${response.status}`);
  const data = await response.json();
  const content = data.content?.[0]?.text;
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in Anthropic response");
  return JSON.parse(match[0]);
}

async function runAIAnalysis(providers: AIProvider[], prompt: string): Promise<{ result: AnalysisResult; providerUsed: string }> {
  for (const provider of providers) {
    if (!provider.api_key_encrypted) continue;
    try {
      let result: AnalysisResult;
      switch (provider.slug) {
        case "groq":
          result = await analyzeWithGroq(provider.api_key_encrypted, provider.model, prompt);
          break;
        case "openai":
          result = await analyzeWithOpenAI(provider.api_key_encrypted, provider.model, prompt);
          break;
        case "gemini":
          result = await analyzeWithGemini(provider.api_key_encrypted, provider.model, prompt);
          break;
        case "anthropic":
          result = await analyzeWithAnthropic(provider.api_key_encrypted, provider.model, prompt);
          break;
        default:
          continue;
      }
      return { result, providerUsed: provider.slug };
    } catch (e) {
      console.error(`Provider ${provider.slug} failed:`, e);
      continue;
    }
  }
  throw new Error("All AI providers failed or have no API keys");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const apiKey = authHeader.replace("Bearer ", "").trim();

    const { data: connection, error: connError } = await supabase
      .from("metatrader_connections")
      .select("*, profiles(id)")
      .eq("api_key", apiKey)
      .eq("is_active", true)
      .maybeSingle();

    if (connError || !connection) {
      return new Response(JSON.stringify({ error: "Invalid or inactive API key" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = connection.user_id;

    await supabase
      .from("metatrader_connections")
      .update({ last_ping_at: new Date().toISOString() })
      .eq("id", connection.id);

    const payload: MTPayload = await req.json();

    await supabase.from("mt_market_data").insert({
      connection_id: connection.id,
      user_id: userId,
      symbol: payload.symbol || connection.symbol,
      timeframe: payload.timeframe || "60",
      open_price: payload.ohlcv?.[payload.ohlcv.length - 1]?.open ?? null,
      high_price: payload.ohlcv?.[payload.ohlcv.length - 1]?.high ?? null,
      low_price: payload.ohlcv?.[payload.ohlcv.length - 1]?.low ?? null,
      close_price: payload.current_price,
      volume: payload.ohlcv?.[payload.ohlcv.length - 1]?.volume ?? null,
      bar_time: payload.ohlcv?.[payload.ohlcv.length - 1]?.time ?? null,
      indicators: payload.indicators ?? {},
    });

    await supabase
      .from("metatrader_connections")
      .update({ last_data_at: new Date().toISOString() })
      .eq("id", connection.id);

    const { data: providers } = await supabase
      .from("ai_providers")
      .select("*")
      .eq("is_active", true)
      .order("priority", { ascending: true });

    if (!providers || providers.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "Data stored. No active AI providers for analysis." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ind = payload.indicators;
    const lastBar = payload.ohlcv?.[payload.ohlcv.length - 1];
    const analysisPrompt = `
MetaTrader Market Data:
Symbol: ${payload.symbol}
Timeframe: ${payload.timeframe} minutes
Current Price: ${payload.current_price}
Bid: ${payload.bid ?? "N/A"} | Ask: ${payload.ask ?? "N/A"} | Spread: ${payload.spread ?? "N/A"} pips

Latest OHLCV:
Open: ${lastBar?.open ?? "N/A"} | High: ${lastBar?.high ?? "N/A"} | Low: ${lastBar?.low ?? "N/A"} | Close: ${lastBar?.close ?? "N/A"} | Volume: ${lastBar?.volume ?? "N/A"}

Technical Indicators:
MA20: ${ind?.ma20 ?? "N/A"}
MA50: ${ind?.ma50 ?? "N/A"}
RSI(14): ${ind?.rsi14 ?? "N/A"}
ATR(14): ${ind?.atr14 ?? "N/A"}

Based on this live market data, provide your technical analysis and trading recommendation.
    `.trim();

    let analysisResult: AnalysisResult;
    let providerUsed: string;

    try {
      const res = await runAIAnalysis(providers as AIProvider[], analysisPrompt);
      analysisResult = res.result;
      providerUsed = res.providerUsed;
    } catch {
      return new Response(JSON.stringify({ success: true, message: "Data stored. AI analysis failed." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: asset } = await supabase
      .from("assets")
      .select("id")
      .eq("symbol", payload.symbol)
      .maybeSingle();

    await supabase.from("chart_analyses").insert({
      user_id: userId,
      asset_id: asset?.id ?? null,
      source: "metatrader",
      ai_provider: providerUsed,
      timeframe: payload.timeframe || "60",
      signal: analysisResult.signal?.toUpperCase(),
      confidence: analysisResult.confidence,
      entry_price: analysisResult.entry_price,
      target_price: analysisResult.target_price,
      stop_loss: analysisResult.stop_loss,
      analysis_text: analysisResult.analysis_text,
      reasoning: analysisResult.reasoning,
      status: "completed",
    });

    if (analysisResult.signal && analysisResult.signal.toLowerCase() !== "hold" && (analysisResult.confidence ?? 0) >= 70) {
      await supabase.from("signals").insert({
        asset_id: asset?.id ?? null,
        symbol: payload.symbol,
        type: analysisResult.signal.toLowerCase(),
        entry_price: analysisResult.entry_price,
        target_price: analysisResult.target_price,
        stop_loss: analysisResult.stop_loss,
        confidence: analysisResult.confidence,
        timeframe: payload.timeframe || "60",
        analysis: analysisResult.reasoning,
        status: "active",
        source: "metatrader_ai",
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        signal: analysisResult.signal,
        confidence: analysisResult.confidence,
        entry_price: analysisResult.entry_price,
        target_price: analysisResult.target_price,
        stop_loss: analysisResult.stop_loss,
        analysis: analysisResult.analysis_text,
        provider_used: providerUsed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const error = err as Error;
    console.error("mt-webhook error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
