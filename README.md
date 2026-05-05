[README (1).md](https://github.com/user-attachments/files/27401633/README.1.md)
# PageMind-extension
this is an AI page summarizer chrome extension
# PageMind — AI Page Summarizer Chrome Extension

> **Read less. Understand more.**  
> A Manifest V3 Chrome Extension that extracts content from any webpage and delivers structured AI summaries — bullet points, key insights, reading time — right in your browser.

---

## Table of Contents

- [Demo](#demo)
- [Features](#features)
- [Setup Instructions](#setup-instructions)
- [Architecture](#architecture)
- [AI Integration](#ai-integration)
- [Security Decisions](#security-decisions)
- [Trade-offs](#trade-offs)

---

## Demo

![PageMind Extension Popup](https://YOUR_USERNAME.github.io/pagemind-extension)

Live landing page: **https://YOUR_USERNAME.github.io/pagemind-extension**

---

## Features

- **Bullet-point summary** — 4–7 key points extracted from any article
- **Key insights** — 3–5 actionable takeaways you might otherwise miss
- **Reading time estimate** — calculated at 200 words/minute
- **Word count** — of the original page content
- **Sentiment analysis** — positive, neutral, negative, or mixed
- **Topic tags** — 2–5 auto-generated labels
- **Highlight mode** — marks key phrases directly on the webpage
- **Copy to clipboard** — formatted summary ready to paste anywhere
- **Three summary modes** — Full, Brief (3 bullets), Insights-only
- **Smart caching** — results cached per URL for 30 minutes, no duplicate API calls
- **Dark / Light theme** — toggle in settings
- **Auto content script injection** — works on tabs opened before the extension was installed

---

## Setup Instructions

### Prerequisites

- Google Chrome (version 109 or later)
- A free [OpenRouter](https://openrouter.ai) account and API key

### Step 1 — Get a Free API Key

1. Go to **openrouter.ai** and sign up (no credit card required)
2. Click **Keys** in the left sidebar
3. Click **Create Key**
4. Copy the key — it starts with `sk-or-...`

### Step 2 — Download the Extension

1. Download the `ai-page-summarizer.zip` from this repository
2. Unzip it — you'll get a folder called `ai-page-summarizer`

### Step 3 — Install in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Toggle on **Developer mode** in the top right corner
3. Click **Load unpacked**
4. Select the `ai-page-summarizer` folder
5. The PageMind icon will appear in your Chrome toolbar

### Step 4 — Add Your API Key

1. Click the **PageMind icon** in your toolbar
2. Click the **⚙ gear icon** in the top right of the popup
3. Paste your OpenRouter API key into the field
4. Choose your preferred theme (Dark or Light)
5. Click **Save Settings**

### Step 5 — Summarise Any Page

1. Navigate to any article or webpage
2. Click the PageMind icon
3. Hit **Summarise Page**
4. Your summary appears in 2–5 seconds

> **Note:** PageMind cannot summarise browser internal pages like `chrome://` or `chrome-extension://` pages. It works on any regular http/https webpage.

---

## Architecture

PageMind follows a clean three-layer architecture required by Chrome's Manifest V3 specification.

```
ai-page-summarizer/
├── manifest.json          # Extension config, permissions, entry points
├── popup.html             # Extension popup UI structure
├── popup.css              # Styles — dark/light themes, animations
├── icons/                 # Extension icons (16, 32, 48, 128px)
└── src/
    ├── popup.js           # UI controller — state machine, events, rendering
    ├── background.js      # Service worker — AI API calls, caching, settings
    └── content.js         # Content extractor — runs inside the webpage
```

### How the layers communicate

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Browser                        │
│                                                         │
│  ┌──────────────┐         ┌──────────────────────────┐  │
│  │  popup.html  │         │     background.js        │  │
│  │  popup.js    │◄───────►│   (Service Worker)       │  │
│  │  (UI Layer)  │         │   - AI API calls         │  │
│  └──────┬───────┘         │   - Cache management     │  │
│         │                 │   - Settings storage     │  │
│         │ chrome.tabs     └──────────────────────────┘  │
│         │ .sendMessage                                   │
│         ▼                                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │              content.js                          │   │
│  │         (Runs inside the webpage)                │   │
│  │   - Extracts readable page content               │   │
│  │   - Injects highlight markers                    │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
                          │
                          │ HTTPS
                          ▼
              ┌───────────────────────┐
              │  openrouter.ai API    │
              │  (Free AI Models)     │
              └───────────────────────┘
```

### Data flow — step by step

1. User clicks **Summarise Page** in the popup
2. `popup.js` checks if the tab is a valid http/https page
3. `popup.js` pings `content.js` — if not alive, injects it dynamically via `chrome.scripting.executeScript()`
4. `popup.js` sends `EXTRACT_CONTENT` message to `content.js`
5. `content.js` scores and extracts the main article body, returns `{ title, content, url, wordCount }`
6. `popup.js` sends `SUMMARISE` message to `background.js`
7. `background.js` checks `chrome.storage.local` for a cached result
8. If no cache hit, `background.js` calls the OpenRouter API with the content
9. Response is parsed, validated, cached, and returned to `popup.js`
10. `popup.js` renders the summary in the UI

### Content Extraction — Heuristic Scoring

`content.js` uses a two-pass approach to find the main article body:

**Pass 1 — Semantic selectors**  
Tries known content selectors in order of reliability:
`article`, `[role="main"]`, `main`, `.article-body`, `.post-content`, `.entry-content`, and more.

**Pass 2 — Scoring algorithm**  
If no semantic match is found, every `div`, `section`, and `main` element is scored:

| Signal | Score |
|---|---|
| Tag is `article` | +30 |
| Tag is `main` | +25 |
| Word count > 300 | +15 |
| Many `<p>` children | up to +30 |
| Class contains "sidebar", "nav", "ad" | -20 each |
| Class contains "article", "content", "post" | +10 each |

The highest-scoring element wins. If nothing scores well enough, the full body text is used as a fallback after stripping all noise elements.

---

## AI Integration

### Provider

PageMind uses **OpenRouter** (`openrouter.ai`) as the AI gateway, with the `openrouter/free` router — which automatically selects the best available free model. This means:

- No credit card required
- No region restrictions
- No single model dependency — if one model is removed, it automatically uses another

### API Call

All AI calls are made exclusively from `background.js` (the service worker). The API call is a standard POST request to OpenRouter's OpenAI-compatible endpoint:

```
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer sk-or-...
```

### Prompt Design

The model is prompted to return **only valid JSON** matching a strict schema:

```json
{
  "summary": ["bullet point", "..."],
  "keyInsights": ["insight", "..."],
  "readingTimeMinutes": 5,
  "wordCount": 1200,
  "highlightPhrases": ["exact phrase from text", "..."],
  "topicTags": ["tag1", "tag2"],
  "sentiment": "neutral"
}
```

The prompt explicitly forbids markdown fences, preamble, or any text outside the JSON. The response is then validated — if `summary` is not an array, the response is rejected and an error is shown.

### Content Truncation

Page content is truncated to **24,000 characters** (~6,000 tokens) before being sent to the API. This keeps costs at zero on the free tier and ensures the request stays within model context limits.

### Caching

Once a page is summarised, the result is cached in `chrome.storage.local` keyed by the page's origin + pathname for **30 minutes**. Revisiting the same page within that window returns the cached result instantly with zero API calls.

---

## Security Decisions

### 1. API Key never leaves the background service worker

The API key is stored in `chrome.storage.local` and is only ever read inside `background.js`. The popup and content scripts never have access to it. This means even if a malicious page somehow compromised the content script, the API key would remain safe.

### 2. Sender ID validation

Every message received by `background.js` is validated against `chrome.runtime.id`. Messages from any sender other than the extension itself are immediately rejected. This prevents spoofed messages from web pages or other extensions.

### 3. XSS prevention

All AI-generated text is inserted into the DOM using `textContent` assignment, never `innerHTML`. This makes XSS injection from AI output structurally impossible — no matter what the AI returns, it cannot execute as code or HTML.

### 4. Minimal permissions

The extension requests only the minimum permissions needed:

| Permission | Why it's needed |
|---|---|
| `activeTab` | Read the current tab's URL and title |
| `storage` | Save API key, settings, and cached summaries |
| `scripting` | Inject content script into tabs opened before installation |

`host_permissions` is scoped only to `https://openrouter.ai/*` — the extension cannot make network requests to any other domain.

### 5. Content Security Policy

The extension's CSP is set to `script-src 'self'` — no inline scripts, no external scripts, no eval. All JavaScript must be bundled with the extension.

### 6. No secret committed to repository

The API key is entered by the user at runtime and stored locally in their browser. There are no secrets, tokens, or credentials anywhere in the source code.

---

## Trade-offs

| Decision | Trade-off | Reasoning |
|---|---|---|
| **OpenRouter free router** | No control over which model runs; quality may vary | Removes cost barrier entirely — works for anyone without a credit card |
| **Content truncation at 24k chars** | Very long pages (books, transcripts) get cut off | Keeps API usage within free tier limits; covers 99% of normal articles |
| **30-minute cache TTL** | Live-updating pages may show stale summaries | Balances freshness vs. API call reduction; user can force refresh |
| **Heuristic extraction** | May miss content on unusual page layouts | Avoids adding a heavy Readability.js dependency; works well on most article sites |
| **No build step** | Less code optimisation, no tree shaking | Zero setup friction — works immediately after unzipping, no Node.js required |
| **chrome.storage.local for API key** | Key is accessible to any JS running in the extension's context | Unavoidable in a local extension; mitigated by sender ID validation and minimal permissions |
| **Single file architecture** | All logic in three JS files | Easier to audit, review, and understand for a project of this scope |
| **Highlight via innerHTML replacement** | Highlights may break on dynamic/React pages | Fast and simple; more robust approaches require a MutationObserver which adds significant complexity |

---

## Built With

- Chrome Extensions Manifest V3
- Vanilla JavaScript (no framework, no build step)
- [OpenRouter](https://openrouter.ai) — free AI API gateway
- Google Fonts — Syne + DM Mono

---

*Built for the Frontend Wizards Stage 4A Challenge — May 2026*
