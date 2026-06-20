import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface AnalysisResult {
  signal: string;
  confidence: number;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  analysis_text: string;
  reasoning: string;
  raw_response: Record<string, unknown>;
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
  is_default: boolean;
  priority: number;
}

const VISION_SYSTEM_PROMPT = `You are an expert technical analyst. You are analyzing a chart screenshot uploaded by a trader.

CRITICAL RULES — NEVER VIOLATE:
1. Read ALL prices ONLY from the chart image itself. Look at the Y-axis price scale on the right side of the chart.
2. NEVER use prices from your training data or memory. If you cannot clearly read the price scale, return null for entry_price, target_price, and stop_loss.
3. The current price is visible on the chart — it is typically shown as the last price on the right Y-axis or the most recent candle's close.
4. All entry, target, and stop loss levels must be derived from the actual price levels visible in the chart.
5. If the chart shows prices in the range 4800-5000, your output MUST reflect that range. If 2300-2400, then that range.
6. Do not hallucinate or estimate prices from asset name alone.

Your response MUST be valid JSON in this exact format:
{
  "signal": "BUY" | "SELL" | "HOLD",
  "confidence": <integer 0-100>,
  "entry_price": <number read from chart Y-axis, or null if not readable>,
  "target_price": <number read from chart Y-axis at a resistance/support level, or null>,
  "stop_loss": <number read from chart Y-axis below/above entry, or null>,
  "analysis_text": "<2-3 sentence summary of what you see in the chart>",
  "reasoning": "<detailed explanation of the pattern, key levels visible in the chart, and why this signal was generated>"
}

Return ONLY the JSON object. No markdown, no code blocks, no extra text.`;

const TEXT_SYSTEM_PROMPT = `You are an expert technical analyst providing a signal based on chart context description.

CRITICAL: You do NOT have access to the chart image. Provide analysis based on provided context only.
Return ONLY valid JSON:
{
  "signal": "BUY" | "SELL" | "HOLD",
  "confidence": <integer 0-100>,
  "entry_price": null,
  "target_price": null,
  "stop_loss": null,
  "analysis_text": "<analysis based on context>",
  "reasoning": "<reasoning based on timeframe and asset>"
}`;

async function callOpenAI(
  apiKey: string,
  model: string,
  imageBase64: string,
  imageType: string,
  userMessage: string
): Promise<AnalysisResult> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "gpt-4o",
      messages: [
        { role: "system", content: VISION_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: userMessage },
            {
              type: "image_url",
              image_url: {
                url: `data:${imageType};base64,${imageBase64}`,
                detail: "high",
              },
            },
          ],
        },
      ],
      max_tokens: 1500,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI");
  const parsed = JSON.parse(content);
  return { ...parsed, raw_response: data };
}

async function callAnthropic(
  apiKey: string,
  model: string,
  imageBase64: string,
  imageType: string,
  userMessage: string
): Promise<AnalysisResult> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "claude-3-5-sonnet-20241022",
      max_tokens: 1500,
      system: VISION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: imageType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                data: imageBase64,
              },
            },
            { type: "text", text: userMessage },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text;
  if (!content) throw new Error("Empty response from Anthropic");
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in Anthropic response");
  const parsed = JSON.parse(jsonMatch[0]);
  return { ...parsed, raw_response: data };
}

async function callGemini(
  apiKey: string,
  model: string,
  imageBase64: string,
  imageType: string,
  userMessage: string
): Promise<AnalysisResult> {
  const geminiModel = model || "gemini-1.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: VISION_SYSTEM_PROMPT }] },
        contents: [
          {
            parts: [
              { text: userMessage },
              { inline_data: { mime_type: imageType, data: imageBase64 } },
            ],
          },
        ],
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.1,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error("Empty response from Gemini");
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in Gemini response");
  const parsed = JSON.parse(jsonMatch[0]);
  return { ...parsed, raw_response: data };
}

async function callGroqTextOnly(
  apiKey: string,
  model: string,
  userMessage: string
): Promise<AnalysisResult> {
  const groqModel = model || "meta-llama/llama-4-scout-17b-16e-instruct";
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: groqModel,
      messages: [
        { role: "system", content: TEXT_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            userMessage +
            "\n\nIMPORTANT: You cannot see the chart image. Do NOT invent prices. Return null for all price fields (entry_price, target_price, stop_loss).",
        },
      ],
      max_tokens: 800,
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from Groq");
  const parsed = JSON.parse(content);
  return {
    ...parsed,
    entry_price: null,
    target_price: null,
    stop_loss: null,
    raw_response: data,
  };
}

async function analyzeWithProvider(
  provider: AIProvider,
  imageBase64: string,
  imageType: string,
  userMessage: string,
  isVisionRequired: boolean
): Promise<AnalysisResult> {
  const apiKey = provider.api_key_encrypted;
  if (!apiKey) throw new Error(`No API key for provider: ${provider.slug}`);

  switch (provider.slug) {
    case "openai":
      return callOpenAI(apiKey, provider.model, imageBase64, imageType, userMessage);
    case "anthropic":
      return callAnthropic(apiKey, provider.model, imageBase64, imageType, userMessage);
    case "gemini":
      return callGemini(apiKey, provider.model, imageBase64, imageType, userMessage);
    case "groq":
      if (isVisionRequired) {
        throw new Error("Groq does not support image analysis. Use OpenAI, Anthropic, or Gemini for chart image analysis.");
      }
      return callGroqTextOnly(apiKey, provider.model, userMessage);
    default:
      return callOpenAI(apiKey, provider.model, imageBase64, imageType, userMessage);
  }
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
    let userId: string | null = null;

    if (authHeader) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
      } = await userClient.auth.getUser();
      if (user) userId = user.id;
    }

    const body = await req.json();
    const {
      imageBase64,
      imageType = "image/jpeg",
      provider: requestedProvider,
      assetSymbol,
      assetId,
      timeframe,
      chartType,
      currentPrice,
      testMode,
    } = body;

    if (testMode) {
      return new Response(
        JSON.stringify({ success: true, message: "Provider test successful", testMode: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "imageBase64 is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // KËRKO përdorues të vlefshëm para thirrjes së paguar të AI-së (mos lejo abuzim/kosto pa kontroll).
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized", message: "Kyçu për të analizuar grafikun." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: providers, error: providerError } = await supabase
      .from("ai_providers")
      .select("*")
      .eq("is_active", true)
      .order("priority", { ascending: true });

    if (providerError || !providers || providers.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "No active AI providers configured. Please activate at least one provider in the Admin panel.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const VISION_PROVIDERS = ["openai", "anthropic", "gemini"];

    let orderedProviders: AIProvider[] = [...providers];

    if (requestedProvider && requestedProvider !== "groq") {
      const preferred = orderedProviders.find((p) => p.slug === requestedProvider);
      if (preferred) {
        orderedProviders = [preferred, ...orderedProviders.filter((p) => p.slug !== requestedProvider)];
      }
    } else if (requestedProvider === "groq") {
      const visionProviders = orderedProviders.filter((p) => VISION_PROVIDERS.includes(p.slug));
      const groqProviders = orderedProviders.filter((p) => p.slug === "groq");
      orderedProviders = [...visionProviders, ...groqProviders];
    } else {
      orderedProviders = [
        ...orderedProviders.filter((p) => VISION_PROVIDERS.includes(p.slug)),
        ...orderedProviders.filter((p) => !VISION_PROVIDERS.includes(p.slug)),
      ];
    }

    const userMessage = `Analyze this ${chartType || "candlestick"} chart for ${assetSymbol || "the asset"} on the ${timeframe || "H1"} timeframe. Read the current price and all price levels DIRECTLY from the chart's Y-axis scale. Provide technical analysis and a trading signal.`;

    let lastError: Error | null = null;
    let result: AnalysisResult | null = null;
    let providerUsed: string | null = null;

    for (const provider of orderedProviders) {
      const isVision = VISION_PROVIDERS.includes(provider.slug);
      try {
        result = await analyzeWithProvider(
          provider as AIProvider,
          imageBase64,
          imageType,
          userMessage,
          true
        );
        providerUsed = provider.slug;
        break;
      } catch (err) {
        lastError = err as Error;
        console.error(`Provider ${provider.slug} failed:`, (err as Error).message);
        if (!isVision) continue;
        continue;
      }
    }

    if (!result || !providerUsed) {
      return new Response(
        JSON.stringify({
          error: "All AI providers failed to analyze the chart image.",
          details: lastError?.message,
          hint: "For chart image analysis, activate OpenAI (gpt-4o), Anthropic (claude), or Gemini in Admin → AI Providers. Groq does not support image analysis.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedSignal = (result.signal || "HOLD").toUpperCase();
    const confidence = Math.min(100, Math.max(0, Math.round(result.confidence || 0)));

    const entryPrice = result.entry_price ?? null;
    const targetPrice = result.target_price ?? null;
    const stopLoss = result.stop_loss ?? null;

    if (userId) {
      const sentiment =
        normalizedSignal === "BUY" ? "bullish" : normalizedSignal === "SELL" ? "bearish" : "neutral";

      await supabase.from("ai_analyses").insert({
        user_id: userId,
        asset_id: assetId || null,
        analysis_text:
          `${result.analysis_text || ""}\n\n${result.reasoning || ""}`.trim(),
        sentiment,
        prediction: targetPrice
          ? `Target: ${targetPrice} — Stop: ${stopLoss}`
          : "No price levels extracted — check chart image quality",
        confidence,
      });

      if (
        (normalizedSignal === "BUY" || normalizedSignal === "SELL") &&
        confidence >= 65
      ) {
        const assetResult = assetId
          ? await supabase
              .from("assets")
              .select("id, symbol")
              .eq("id", assetId)
              .maybeSingle()
          : assetSymbol
          ? await supabase
              .from("assets")
              .select("id, symbol")
              .eq("symbol", assetSymbol)
              .maybeSingle()
          : { data: null };

        const asset = assetResult.data;

        await supabase.from("signals").insert({
          user_id: userId,
          asset_id: asset?.id || assetId || null,
          symbol: asset?.symbol || assetSymbol || "UNKNOWN",
          type: normalizedSignal.toLowerCase(),
          confidence,
          entry_price: entryPrice || currentPrice || null,
          target_price: targetPrice || null,
          stop_loss: stopLoss || null,
          timeframe: timeframe || "H1",
          analysis: result.analysis_text || "",
          source: "ai_chart",
          status: "active",
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
      }
    }

    return new Response(
      JSON.stringify({
        signal: normalizedSignal,
        confidence,
        entry_price: entryPrice,
        target_price: targetPrice,
        stop_loss: stopLoss,
        analysis_text: result.analysis_text,
        reasoning: result.reasoning,
        provider_used: providerUsed,
        raw_response: result.raw_response,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const error = err as Error;
    console.error("analyze-chart fatal error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
