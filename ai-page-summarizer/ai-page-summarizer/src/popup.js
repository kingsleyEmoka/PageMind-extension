/**
 * PageMind Popup Script
 * Handles UI interactions and communicates with background service worker.
 */

"use strict";

// ── State ─────────────────────────────────────────────────────────────────────

let currentSummary = null;
let currentTab = null;
let highlightsActive = false;
let currentMode = "full";

// ── DOM Refs ──────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const states = {
  idle: $("state-idle"),
  loading: $("state-loading"),
  error: $("state-error"),
  result: $("state-result"),
};

// ── Utils ─────────────────────────────────────────────────────────────────────

function showState(name) {
  Object.entries(states).forEach(([key, el]) => {
    el.classList.toggle("hidden", key !== name);
  });
}

function sendToBackground(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp);
      }
    });
  });
}

function showToast(msg, duration = 2000) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), duration);
}

function sanitiseText(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ── Initialisation ────────────────────────────────────────────────────────────

async function init() {
  // Load settings for theme
  const settingsRes = await sendToBackground({ type: "GET_SETTINGS" });
  if (settingsRes?.success && settingsRes.data) {
    applySettings(settingsRes.data);
  }

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  if (tab) {
    // Set page title
    $("page-title").textContent = tab.title || tab.url || "Unknown Page";

    // Favicon
    if (tab.favIconUrl) {
      const img = document.createElement("img");
      img.src = tab.favIconUrl;
      img.alt = "";
      $("page-favicon").appendChild(img);
    }
  }

  showState("idle");
}

function applySettings(settings) {
  document.documentElement.setAttribute(
    "data-theme",
    settings.theme || "dark"
  );
  // Prefill mode
  if (settings.mode) {
    setMode(settings.mode);
  }
  // Prefill settings panel
  if ($("input-api-key") && settings.apiKey) {
    $("input-api-key").value = settings.apiKey;
  }
  if ($("select-theme")) {
    $("select-theme").value = settings.theme || "dark";
  }
}

// ── Mode ──────────────────────────────────────────────────────────────────────

function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

// ── Summarise Flow ────────────────────────────────────────────────────────────

async function injectContentScriptIfNeeded(tabId) {
  // Try pinging first — if content script is alive, we're good
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "PING" }, (resp) => {
      if (chrome.runtime.lastError || !resp?.pong) {
        // Not injected yet — inject now
        chrome.scripting.executeScript(
          { target: { tabId }, files: ["src/content.js"] },
          () => {
            if (chrome.runtime.lastError) {
              resolve(false); // e.g. chrome:// pages — can't inject
            } else {
              resolve(true);
            }
          }
        );
      } else {
        resolve(true); // Already alive
      }
    });
  });
}

async function runSummarise(forceRefresh = false) {
  if (!currentTab) return;

  // Block summarising browser internal pages
  const url = currentTab.url || "";
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("about:") || url.startsWith("edge://")) {
    showError("PageMind can't summarise browser internal pages. Navigate to a regular webpage.");
    return;
  }

  // Reset highlights
  if (highlightsActive) {
    await sendToTab(currentTab.id, { type: "REMOVE_HIGHLIGHTS" });
    highlightsActive = false;
  }

  showState("loading");
  $("loading-label").textContent = "Extracting content…";

  // Ensure content script is injected (handles pre-existing tabs)
  const injected = await injectContentScriptIfNeeded(currentTab.id);
  if (!injected) {
    showError("Can't access this page. Try a regular article or news page.");
    return;
  }

  // Small delay to let the script initialise after fresh injection
  await new Promise(r => setTimeout(r, 150));

  // 1. Extract content from the page
  const extractRes = await sendToTab(currentTab.id, { type: "EXTRACT_CONTENT" });

  if (!extractRes?.success) {
    showError(
      extractRes?.error || "Could not extract page content. Try refreshing the page."
    );
    return;
  }

  const { content, title, url: pageUrl, wordCount } = extractRes.data;

  $("loading-label").textContent = "Generating summary…";

  // 2. Send to background for AI call
  const summaryRes = await sendToBackground({
    type: "SUMMARISE",
    content,
    title,
    url: pageUrl,
    mode: currentMode,
    forceRefresh,
  });

  if (!summaryRes?.success) {
    showError(summaryRes?.error || "AI summarisation failed. Please try again.");
    return;
  }

  currentSummary = summaryRes.data;
  renderResult(summaryRes.data, summaryRes.fromCache, wordCount);
}

function showError(msg) {
  $("error-msg").textContent = msg;
  showState("error");
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderResult(data, fromCache, originalWordCount) {
  // Meta bar
  const reading = data.readingTimeMinutes || "—";
  $("meta-reading-val").textContent =
    reading === 1 ? `${reading} min read` : `${reading} mins read`;

  const words = data.wordCount || originalWordCount || "—";
  $("meta-words-val").textContent =
    typeof words === "number" ? `${words.toLocaleString()} words` : words;

  // Sentiment
  const sentEl = $("meta-sentiment");
  sentEl.textContent = data.sentiment || "—";
  sentEl.className = `meta-chip sentiment ${data.sentiment || ""}`;

  // Cache badge
  const cacheBadge = $("cache-badge");
  cacheBadge.classList.toggle("hidden", !fromCache);

  // Tags
  const tagsContainer = $("tags-container");
  tagsContainer.innerHTML = "";
  if (Array.isArray(data.topicTags)) {
    data.topicTags.forEach((tag) => {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = tag;
      tagsContainer.appendChild(span);
    });
  }

  // Summary bullets
  const summaryList = $("summary-list");
  summaryList.innerHTML = "";
  const sectionSummary = $("section-summary");
  if (Array.isArray(data.summary) && data.summary.length > 0) {
    data.summary.forEach((point) => {
      const li = document.createElement("li");
      li.innerHTML = sanitiseText(point);
      summaryList.appendChild(li);
    });
    sectionSummary.classList.remove("hidden");
  } else {
    sectionSummary.classList.add("hidden");
  }

  // Key insights
  const insightsList = $("insights-list");
  insightsList.innerHTML = "";
  const sectionInsights = $("section-insights");
  if (Array.isArray(data.keyInsights) && data.keyInsights.length > 0) {
    data.keyInsights.forEach((insight) => {
      const li = document.createElement("li");
      li.innerHTML = sanitiseText(insight);
      insightsList.appendChild(li);
    });
    sectionInsights.classList.remove("hidden");
  } else {
    sectionInsights.classList.add("hidden");
  }

  showState("result");
}

// ── Copy Summary ──────────────────────────────────────────────────────────────

function buildCopyText(data) {
  const lines = [];
  if (currentTab?.title) lines.push(`# ${currentTab.title}`, "");
  if (Array.isArray(data.summary) && data.summary.length > 0) {
    lines.push("## Summary", ...data.summary.map((s) => `• ${s}`), "");
  }
  if (Array.isArray(data.keyInsights) && data.keyInsights.length > 0) {
    lines.push(
      "## Key Insights",
      ...data.keyInsights.map((s) => `→ ${s}`),
      ""
    );
  }
  if (data.readingTimeMinutes) {
    lines.push(`Reading time: ~${data.readingTimeMinutes} min`);
  }
  if (currentTab?.url) lines.push(`Source: ${currentTab.url}`);
  return lines.join("\n");
}

// ── Event Listeners ───────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  init();

  // Mode buttons
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });

  // Summarise
  $("btn-summarise").addEventListener("click", () => runSummarise(false));

  // Retry
  $("btn-retry").addEventListener("click", () => runSummarise(false));

  // Refresh (force)
  $("btn-refresh").addEventListener("click", () => runSummarise(true));

  // Clear
  $("btn-clear").addEventListener("click", () => {
    currentSummary = null;
    if (highlightsActive && currentTab) {
      sendToTab(currentTab.id, { type: "REMOVE_HIGHLIGHTS" });
      highlightsActive = false;
    }
    showState("idle");
  });

  // Highlight toggle
  $("btn-highlight").addEventListener("click", async () => {
    if (!currentSummary || !currentTab) return;

    if (highlightsActive) {
      await sendToTab(currentTab.id, { type: "REMOVE_HIGHLIGHTS" });
      highlightsActive = false;
      $("btn-highlight").classList.remove("active");
      showToast("Highlights removed");
    } else {
      const phrases = currentSummary.highlightPhrases || [];
      if (phrases.length === 0) {
        showToast("No phrases to highlight");
        return;
      }
      const res = await sendToTab(currentTab.id, {
        type: "HIGHLIGHT_PHRASES",
        phrases,
      });
      if (res?.success) {
        highlightsActive = true;
        $("btn-highlight").classList.add("active");
        showToast("Key phrases highlighted");
      } else {
        showToast("Couldn't highlight — try refreshing the page");
      }
    }
  });

  // Copy
  $("btn-copy").addEventListener("click", async () => {
    if (!currentSummary) return;
    const text = buildCopyText(currentSummary);
    try {
      await navigator.clipboard.writeText(text);
      showToast("✓ Copied to clipboard");
    } catch {
      showToast("Clipboard access denied");
    }
  });

  // Settings open
  $("btn-settings").addEventListener("click", async () => {
    const panel = $("panel-settings");
    panel.classList.remove("hidden");

    const settingsRes = await sendToBackground({ type: "GET_SETTINGS" });
    if (settingsRes?.success && settingsRes.data) {
      $("input-api-key").value = settingsRes.data.apiKey || "";
      $("select-theme").value = settingsRes.data.theme || "dark";
    }

    $("btn-close-settings").focus();
  });

  // Settings close
  $("btn-close-settings").addEventListener("click", () => {
    $("panel-settings").classList.add("hidden");
  });

  // Toggle API key visibility
  $("btn-toggle-key").addEventListener("click", () => {
    const input = $("input-api-key");
    input.type = input.type === "password" ? "text" : "password";
  });

  // Save settings
  $("btn-save-settings").addEventListener("click", async () => {
    const apiKey = $("input-api-key").value.trim();
    const theme = $("select-theme").value;

    if (!apiKey) {
      showToast("Please enter an API key");
      return;
    }

    const res = await sendToBackground({
      type: "SAVE_SETTINGS",
      settings: { apiKey, theme, mode: currentMode },
    });

    if (res?.success) {
      document.documentElement.setAttribute("data-theme", theme);
      $("panel-settings").classList.add("hidden");
      showToast("✓ Settings saved");
    } else {
      showToast("Failed to save settings");
    }
  });

  // Clear cache
  $("btn-clear-cache").addEventListener("click", async () => {
    const res = await sendToBackground({ type: "CLEAR_CACHE" });
    if (res?.success) {
      showToast("✓ Cache cleared");
    } else {
      showToast("Failed to clear cache");
    }
  });

  // Keyboard: Escape closes settings
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const panel = $("panel-settings");
      if (!panel.classList.contains("hidden")) {
        panel.classList.add("hidden");
        $("btn-settings").focus();
      }
    }
  });
});
