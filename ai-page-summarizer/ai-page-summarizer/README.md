# PageMind — AI Page Summariser Chrome Extension

A Manifest V3 Chrome Extension that extracts content from any webpage and generates structured AI summaries using the Anthropic Claude API.

---

## Features

- **Bullet-point summaries** with 4–7 key points
- **Key insights** — actionable takeaways
- **Reading time estimate** and word count
- **Sentiment analysis** and topic tags
- **Highlight mode** — marks key phrases on the page
- **Copy to clipboard** — formatted summary
- **Three summary modes**: Full, Brief (3 bullets), Insights-only
- **Result caching** — avoids duplicate API calls (30-minute TTL)
- **Dark / Light themes**

---

## Architecture

```
ai-page-summarizer/
├── manifest.json          # MV3 manifest
├── popup.html             # Extension popup UI
├── popup.css              # Styles (dark/light theme)
├── icons/                 # Extension icons (16/32/48/128px)
└── src/
    ├── popup.js           # Popup logic & UI controller
    ├── background.js      # Service worker — AI API calls, caching
    └── content.js         # Page content extraction & highlight injection
```

### Data Flow

```
User clicks icon
     │
     ▼
popup.js  ──EXTRACT_CONTENT──▶  content.js  (heuristic extraction)
     │
     ▼
popup.js  ──SUMMARISE──────▶  background.js
                                    │
                                    ├─ Check chrome.storage.local cache
                                    │
                                    └─ POST https://api.anthropic.com/v1/messages
                                            │
                                            ▼
                                    Parse JSON response
                                            │
                                            ▼
popup.js  ◀──summary data──  background.js
     │
     ▼
Render UI
```

---

## AI Integration

- **Model**: `claude-haiku-4-5-20251001` (fast, low-cost)
- **API**: Anthropic Messages API (`/v1/messages`)
- **Prompt**: Structured JSON output with schema validation
- **Location**: All API calls happen **exclusively** in `background.js` (service worker)
- **Key safety**: API key stored in `chrome.storage.local`, never in content scripts or popup JS

The AI is prompted to return a strict JSON schema:
```json
{
  "summary": ["..."],
  "keyInsights": ["..."],
  "readingTimeMinutes": 5,
  "wordCount": 1200,
  "highlightPhrases": ["..."],
  "topicTags": ["..."],
  "sentiment": "neutral"
}
```

---

## Security Decisions

| Decision | Rationale |
|---|---|
| API key stored in `chrome.storage.local` | Never exposed to page context or content scripts |
| All API calls in background service worker | Isolated from web page JS; no XSS risk |
| Sender ID validation in background | Only messages from own extension are processed |
| Content sanitised before DOM insertion | `textContent` assignment prevents XSS injection |
| `host_permissions` scoped to Anthropic only | Minimal blast radius |
| No external JS loaded | CSP restricts scripts to `'self'` only |

---

## Installation

1. **Clone or download** this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right)
4. Click **"Load unpacked"**
5. Select the `ai-page-summarizer` folder
6. The PageMind icon will appear in your toolbar

### First-time Setup

1. Click the PageMind icon
2. Click the **settings gear** (⚙) in the top right
3. Enter your **Anthropic API key** (get one at [console.anthropic.com](https://console.anthropic.com))
4. Choose your preferred theme
5. Click **Save Settings**
6. Navigate to any article page and click **Summarise Page**

---

## Trade-offs

| Trade-off | Decision |
|---|---|
| Speed vs. quality | Chose Haiku model for ~1–2s response time |
| Full page vs. article only | Heuristic scoring extracts best content block; falls back to full body |
| Token limits | Content truncated at ~8,000 words (~24k chars) |
| Cache TTL | 30 minutes — balances freshness vs. API cost |
| Highlight approach | innerHTML replacement is fast but resets on dynamic pages |
| Font loading | Google Fonts loaded at popup open time; cached by browser |

---

## Privacy

- No data is sent to any server except Anthropic's API
- Your API key never leaves your browser
- Summaries are cached locally only
- No analytics or tracking

---

## Requirements

- Chrome 109+ (Manifest V3 support)
- Anthropic API key

