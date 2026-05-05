/**
 * PageMind Content Script
 * Extracts readable page content using heuristic filtering.
 * Runs in the context of the web page.
 */

(function () {
  "use strict";

  // ─── Readability Heuristics ────────────────────────────────────────────────

  const CONTENT_SELECTORS = [
    "article",
    '[role="main"]',
    "main",
    ".article-body",
    ".post-content",
    ".entry-content",
    ".content-body",
    ".story-body",
    "#article-body",
    "#main-content",
    ".article__body",
    ".post__content",
    ".prose",
  ];

  const NOISE_SELECTORS = [
    "nav",
    "header",
    "footer",
    "aside",
    ".sidebar",
    ".navigation",
    ".nav",
    ".menu",
    ".advertisement",
    ".ads",
    ".ad",
    '[class*="cookie"]',
    '[class*="banner"]',
    '[class*="popup"]',
    '[class*="modal"]',
    "script",
    "style",
    "noscript",
    "iframe",
    "form",
    ".social-share",
    ".related-posts",
    ".comments",
    "#comments",
    '[aria-hidden="true"]',
  ];

  /**
   * Scores a DOM element for content likelihood.
   * Higher = more likely to be main content.
   */
  function scoreElement(el) {
    let score = 0;
    const tag = el.tagName.toLowerCase();
    const text = el.innerText || "";
    const wordCount = text.trim().split(/\s+/).length;

    // Tag scoring
    const tagScores = {
      article: 30,
      main: 25,
      section: 10,
      div: 5,
      p: 3,
    };
    score += tagScores[tag] || 0;

    // Word count bonus
    if (wordCount > 100) score += 20;
    if (wordCount > 300) score += 15;
    if (wordCount > 600) score += 10;

    // Density: paragraph children
    const paragraphs = el.querySelectorAll("p");
    score += Math.min(paragraphs.length * 3, 30);

    // Penalise noise class names
    const classId = `${el.className} ${el.id}`.toLowerCase();
    const noiseTerms = [
      "sidebar",
      "comment",
      "footer",
      "header",
      "nav",
      "menu",
      "ad",
      "banner",
      "widget",
      "share",
      "social",
    ];
    for (const term of noiseTerms) {
      if (classId.includes(term)) score -= 20;
    }

    // Boost terms
    const boostTerms = [
      "article",
      "content",
      "post",
      "story",
      "body",
      "text",
      "main",
      "entry",
      "prose",
    ];
    for (const term of boostTerms) {
      if (classId.includes(term)) score += 10;
    }

    return score;
  }

  /**
   * Cleans extracted text: removes excess whitespace, very short lines.
   */
  function cleanText(text) {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 20) // drop very short lines (nav crumbs etc)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /**
   * Main extraction function.
   * Returns { title, content, url, wordCount }
   */
  function extractContent() {
    // Try explicit content selectors first
    for (const selector of CONTENT_SELECTORS) {
      const el = document.querySelector(selector);
      if (el) {
        const text = cleanText(el.innerText || "");
        if (text.length > 200) {
          return buildResult(text);
        }
      }
    }

    // Heuristic scoring fallback
    const candidates = Array.from(
      document.querySelectorAll("div, article, section, main")
    ).filter((el) => {
      // Exclude obvious noise
      for (const sel of NOISE_SELECTORS) {
        if (el.matches && el.matches(sel)) return false;
      }
      return true;
    });

    if (candidates.length > 0) {
      const scored = candidates
        .map((el) => ({ el, score: scoreElement(el) }))
        .sort((a, b) => b.score - a.score);

      const best = scored[0];
      if (best.score > 10) {
        const text = cleanText(best.el.innerText || "");
        if (text.length > 200) return buildResult(text);
      }
    }

    // Last resort: body text minus noise elements
    const clone = document.body.cloneNode(true);
    for (const sel of NOISE_SELECTORS) {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    }
    const fallbackText = cleanText(clone.innerText || "");
    return buildResult(fallbackText);
  }

  function buildResult(content) {
    // Truncate to ~8000 words to keep API costs reasonable
    const words = content.split(/\s+/);
    const truncated =
      words.length > 8000 ? words.slice(0, 8000).join(" ") + "…" : content;

    return {
      title: document.title || "Untitled Page",
      url: window.location.href,
      content: truncated,
      wordCount: words.length,
    };
  }

  // ─── Highlight Feature ─────────────────────────────────────────────────────

  function highlightPhrases(phrases) {
    if (!phrases || phrases.length === 0) return;

    // Remove existing highlights first
    removeHighlights();

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (
        parent &&
        !["SCRIPT", "STYLE", "TEXTAREA", "INPUT"].includes(
          parent.tagName
        ) &&
        !parent.classList.contains("pagemind-highlight")
      ) {
        textNodes.push(node);
      }
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent;
      for (const phrase of phrases) {
        if (!phrase || phrase.length < 10) continue;
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`(${escaped})`, "gi");
        if (regex.test(text)) {
          const span = document.createElement("span");
          span.className = "pagemind-highlight";
          span.style.cssText =
            "background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #1a1a1a; border-radius: 3px; padding: 1px 3px; font-weight: 500;";
          textNode.parentElement.innerHTML =
            textNode.parentElement.innerHTML.replace(
              regex,
              '<span class="pagemind-highlight" style="background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#1a1a1a;border-radius:3px;padding:1px 3px;font-weight:500">$1</span>'
            );
          break;
        }
      }
    }
  }

  function removeHighlights() {
    document.querySelectorAll(".pagemind-highlight").forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent), el);
        parent.normalize();
      }
    });
  }

  // ─── Message Listener ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "PING") {
      sendResponse({ pong: true });
      return true;
    }

    if (message.type === "EXTRACT_CONTENT") {
      try {
        const result = extractContent();
        sendResponse({ success: true, data: result });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }

    if (message.type === "HIGHLIGHT_PHRASES") {
      try {
        highlightPhrases(message.phrases);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }

    if (message.type === "REMOVE_HIGHLIGHTS") {
      try {
        removeHighlights();
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }

    return true; // Keep message channel open for async
  });
})();
