// agent/llm.js
// Provider-agnostic LLM client using OpenAI-compatible APIs with exponential backoff and fallback failover.
// Ensures deterministic JSON structured outputs for agent reasoning and tool selection.

import "dotenv/config";
import OpenAI from "openai";

let totalCallCount = 0;

// Setup primary and fallback client configs from environment variables
const primaryConfig = {
  name: "Primary",
  baseURL: process.env.LLM_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/",
  apiKey: process.env.LLM_API_KEY || "",
  model: process.env.LLM_MODEL || "gemini-2.5-flash-lite"
};

const fallbackConfig = {
  name: "Fallback",
  baseURL: process.env.FALLBACK_BASE_URL || "https://api.groq.com/openai/v1",
  apiKey: process.env.FALLBACK_API_KEY || "",
  model: process.env.FALLBACK_MODEL || "llama-3.3-70b-versatile"
};

// Robust JSON extraction: handles markdown fences and extracts the outer JSON object
function extractJSON(rawText) {
  if (!rawText || typeof rawText !== "string") return null;

  // Strip markdown code fences if present
  let cleaned = rawText.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, "$1").trim();

  // Find boundaries of the first valid JSON object
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start !== -1 && end !== -1 && end > start) {
    const candidate = cleaned.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue to full string attempt
    }
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// Sleep helper for exponential backoff
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Execute a single completion request with exponential backoff for 429/5xx errors
async function executeWithRetry(config, messages) {
  if (!config.apiKey) {
    throw new Error(`API key is missing for provider ${config.name}`);
  }

  const client = new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey
  });

  const backoffDelays = [2000, 4000, 8000];

  for (let attempt = 0; attempt <= backoffDelays.length; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: config.model,
        messages,
        temperature: 0.2
      });

      totalCallCount++;
      const reply = response.choices?.[0]?.message?.content || "";
      console.log(`[LLM] Answered by ${config.name} (${config.model}) [Total calls: ${totalCallCount}]`);
      return reply;
    } catch (err) {
      const status = err.status || err.statusCode;
      const isRateOrServerError = status === 429 || (status >= 500 && status < 600);

      if (isRateOrServerError && attempt < backoffDelays.length) {
        const delay = backoffDelays[attempt];
        console.warn(`[LLM] Warning: ${config.name} returned status ${status}. Retrying in ${delay / 1000}s...`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

// Request LLM completion with automatic provider failover and single JSON retry
export async function chatJSON(messages) {
  let activeConfig = primaryConfig;
  let rawResponse = "";

  try {
    rawResponse = await executeWithRetry(activeConfig, messages);
  } catch (primaryErr) {
    console.error(`[LLM] Primary provider error (${primaryErr.message}).`);

    // Switch to fallback if configured and distinct
    if (fallbackConfig.apiKey && fallbackConfig.apiKey !== primaryConfig.apiKey) {
      console.log(`[LLM] Switching to Fallback provider (${fallbackConfig.model})...`);
      activeConfig = fallbackConfig;
      rawResponse = await executeWithRetry(activeConfig, messages);
    } else {
      throw primaryErr;
    }
  }

  let parsed = extractJSON(rawResponse);
  if (parsed) {
    return parsed;
  }

  // If initial response was not valid JSON, retry once with explicit corrective prompt
  console.warn("[LLM] Output was not valid JSON. Re-asking with correction prompt...");

  // Construct correction message preserving [system message + one user message] pattern
  const systemMsg = messages.find((m) => m.role === "system")?.content || "";
  const userMsg = messages.find((m) => m.role === "user")?.content || "";

  const retryMessages = [
    { role: "system", content: systemMsg },
    {
      role: "user",
      content: `${userMsg}\n\nCRITICAL ERROR: Your last response was not valid JSON.\nPrevious raw output:\n${rawResponse}\n\nPlease reply with valid JSON only. Begin your response with '{' and end with '}'.`
    }
  ];

  const retryRawResponse = await executeWithRetry(activeConfig, retryMessages);
  parsed = extractJSON(retryRawResponse);

  if (!parsed) {
    throw new Error(`Failed to parse LLM output as JSON after retry. Raw output was: ${retryRawResponse.slice(0, 300)}...`);
  }

  return parsed;
}

export function getLLMCallCount() {
  return totalCallCount;
}
