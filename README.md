# Link Preview — Chrome Extension

Hover any link to see a preview card with title, description, image, relevance rating, and a **local safety score** — no API keys, no data leaving your browser.

---

## Features

- **Hover preview** — title, description, thumbnail after 500ms
- **Safety score** — rates URL risk 0–100 using local heuristics
- **Expandable breakdown** — click `?` to see exactly why a score was given
- **Contextual relevance** — scores links against what you're currently reading
- **Selected text focus** — highlight text to sharpen relevance signal
- **Dark mode** support
- **No API keys, no accounts, no network calls for safety**

---

## Safety Scores

| Badge | Label | Score |
|-------|-------|-------|
| 🟢 | **Safe to Open** | 80–100 |
| 🟡 | **Use Caution** | 50–79 |
| 🔴 | **Potentially Unsafe** | 0–49 |

Click the `?` button on the badge to expand the full breakdown:

```
🟢 Safe to Open   94/100  [?]
  +20  HTTPS enabled
  +20  Trusted domain
  +10  Trusted .com TLD
  +5   Short domain name
  +5   Clean domain format
  ──────────────────────
  Final score: 94
```

### Scoring Rules

Starts at **50 points**, then:

**Add points for:**
- HTTPS → +20
- Known trusted domain → +20
- Trusted TLD (.com .org .edu .gov .io) → +10
- Short domain name (<25 chars) → +5
- Clean domain format → +5

**Subtract points for:**
- No HTTPS → −15
- URL shortener (bit.ly, t.co, etc.) → −25
- IP address URL → −30
- Suspicious TLD (.xyz .tk .top .click) → −20
- Brand impersonation (paypa1, g00gle) → −40
- Excessive hyphens → −10
- Many numbers in domain → −10
- Too many subdomains → −10
- Very long URL (>150 chars) → −10

---

## Relevance Ratings

| Badge | Label | Meaning |
|-------|-------|---------|
| ⚡ | **Relevant** | Strong keyword overlap with current page |
| ✓ | **Related** | Moderate overlap |
| ~ | **Tangential** | Weak overlap |
| ✕ | **Off-topic** | No meaningful overlap |

**Tip:** Select text on the page before hovering — the scorer uses your selection as the primary focus signal.

---

## Installation

### Folder structure

```
link-preview/
├── manifest.json
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── src/
    ├── background.js
    ├── content.js
    └── preview.css
```

### Load in Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select your `link-preview/` folder
4. Open any webpage and hover a link

### Updating files

After replacing any file, go to `chrome://extensions` → click the **refresh icon** on the extension → hard refresh the page (`Ctrl+Shift+R`).

---

## Troubleshooting

**No card appears**
- Check extension is enabled on `chrome://extensions`
- Hard refresh: `Ctrl+Shift+R`
- Open service worker console: `chrome://extensions` → click **service worker** → **Console** tab → hover a link → look for red errors

**Safety score seems off**
- Score is based on URL structure only, not page content
- Unknown domains start at 50 and score from there — not every unfamiliar domain is unsafe

**No image in card**
- Normal — many sites don't set `og:image`, falls back to a colored letter icon

---

## File Reference

| File | Role |
|------|------|
| `background.js` | Service worker — fetches HTML, parses metadata, runs safety scorer, caches results 5 min |
| `content.js` | Content script — hover detection, page context extraction, relevance scoring, card rendering |
| `preview.css` | Card styles — scoped to `#lp-preview-card`, never leaks into host page |
| `manifest.json` | Extension config — permissions, entry points |

---

## Privacy

- Safety scoring is **100% local** — URLs never leave your browser for safety checks
- Metadata fetch is a direct request to the hovered URL (same as clicking it)
- Cache is in-memory only, cleared when browser closes
- No analytics, no telemetry, no accounts
