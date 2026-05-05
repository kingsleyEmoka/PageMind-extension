/**
 * PageMind Background Service Worker (Manifest V3)
 * AI Provider: OpenRouter (free tier, no region restrictions)
 */

"use strict";

const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CONTENT_CHARS = 24000;
const OPENROUTER_MODEL = "openrouter/free"; // Free, no credit card

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sanitiseCacheKey(url) {
  try {
    const u = new URL(url);
    return `cache::${u.origin}${u.pathname}`.slice(0, 200);
  } catch {
    return `cache::${url}`.slice(0, 200);
  }
}

async function getCachedSummary(url) {
  const key = sanitiseCacheKey(url);
  const result = await chrome.storage.local.get(key);
  const entry = result[key];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return entry.summary;
}

async function cacheSummary(url, summary) {
  const key = sanitiseCacheKey(url);
  await chrome.storage.local.set({
    [key]: { summary, timestamp: Date.now() },
  });
}

// ─── OpenRouter API Call ──────────────────────────────────────────────────────

async function callOpenRouterAPI(apiKey, content, title, mode) {
  const truncated = content.length > MAX_CONTENT_CHARS
    ? content.slice(0, MAX_CONTENT_CHARS) + "\n\n[Content truncated]"
    : content;

  const modeInstructions = {
    full: "Provide a comprehensive summary with all sections.",
    brief: "Provide exactly 3 concise bullet points in the summary array only.",
    insights: "Focus on keyInsights and keep summary to 2 points.",
  };

  const prompt = `You are PageMind, an expert content analyst. Summarise the following webpage.

CRITICAL: Respond with ONLY valid JSON — no markdown, no backticks, no explanation whatsoever. Use exactly this schema:
{
  "summary": ["bullet point", "bullet point"],
  "keyInsights": ["insight", "insight"],
  "readingTimeMinutes": 5,
  "wordCount": 1200,
  "highlightPhrases": ["exact short phrase from text"],
  "topicTags": ["tag1", "tag2"],
  "sentiment": "neutral"
}

Rules:
- summary: 4–7 complete sentence bullet points
- keyInsights: 3–5 actionable insights
- readingTimeMinutes: integer at 200 words/minute
- wordCount: approximate integer
- highlightPhrases: 3–6 exact phrases (10–50 chars) from the original text
- topicTags: 2–5 short labels
- sentiment: "positive", "neutral", "negative", or "mixed"
${modeInstructions[mode] || modeInstructions.full}

Page title: ${title}

Page content:
${truncated}`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://pagemind-extension",
      "X-Title": "PageMind",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const errorMsg = body?.error?.message || `HTTP ${response.status}`;
    if (response.status === 401) throw new Error("Invalid API key. Please check your OpenRouter key in Settings.");
    if (response.status === 429) throw new Error("Rate limit reached. Please wait a moment and try again.");
    throw new Error(`API error: ${errorMsg}`);
  }

  const data = await response.json();
  const rawText = data?.choices?.[0]?.message?.content || "";

  // Strip accidental markdown fences
  const cleaned = rawText.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.summary)) throw new Error("Invalid structure");
    return parsed;
  } catch {
    throw new Error("AI returned an unexpected format. Please try again.");
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function getSettings() {
  const result = await chrome.storage.local.get("pagemind_settings");
  return result.pagemind_settings || { apiKey: "", theme: "dark", mode: "full" };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ pagemind_settings: settings });
}

// ─── Message Handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: "Unauthorised sender." });
    return false;
  }

  if (message.type === "SUMMARISE") {
    handleSummarise(message).then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (message.type === "GET_SETTINGS") {
    getSettings().then((s) => sendResponse({ success: true, data: s }))
      .catch(() => sendResponse({ success: false, error: "Failed to load settings." }));
    return true;
  }

  if (message.type === "SAVE_SETTINGS") {
    saveSettings(message.settings).then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false, error: "Failed to save settings." }));
    return true;
  }

  if (message.type === "CLEAR_CACHE") {
    chrome.storage.local.clear().then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false, error: "Failed to clear cache." }));
    return true;
  }

  return false;
});

async function handleSummarise({ content, title, url, mode, forceRefresh }) {
  const settings = await getSettings();

  if (!settings.apiKey || settings.apiKey.trim() === "") {
    throw new Error("No API key configured. Open Settings to add your OpenRouter API key.");
  }

  if (!content || content.trim().length < 100) {
    throw new Error("Not enough content found on this page to summarise.");
  }

  if (!forceRefresh) {
    const cached = await getCachedSummary(url);
    if (cached) return { success: true, data: cached, fromCache: true };
  }

  const summary = await callOpenRouterAPI(settings.apiKey, content, title, mode || settings.mode || "full");
  await cacheSummary(url, summary);
  return { success: true, data: summary, fromCache: false };
}
