# Link Preview — Chrome Extension

Hover over any link to instantly see a preview card with the page title, description, image, and a **relevance rating** based on what you're currently reading.

---

## Features

- **Hover preview** — shows title, description, and thumbnail after 500ms
- **Contextual relevance rating** — scores each link against your current page content
- **Selected text focus** — highlight text on the page to sharpen the relevance signal
- **No API keys** — fully local, nothing sent to any server
- **Dark mode** support
- **Glassmorphism UI** with smooth animations

---

## Relevance Ratings

| Badge | Label | Meaning |
|-------|-------|---------|
| ⚡ | **Relevant** | Strong keyword overlap with current page |
| ✓ | **Related** | Moderate overlap — likely worth a look |
| ~ | **Tangential** | Weak overlap — loosely connected |
| ✕ | **Off-topic** | No meaningful overlap — probably skip it |

The number of matched keywords is shown next to the badge so you know why it rated the way it did.

**Tip:** Select a sentence or phrase on the page before hovering links — the scorer will treat your selection as the primary focus and give sharper ratings.

---

## Installation

### 1. Get the files

Make sure your extension folder looks like this:

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

### 2. Load in Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select your `link-preview/` folder

### 3. Test it

- Open any webpage with links
- Hover over a link and wait ~0.5 seconds
- A preview card should appear near your cursor

---

## Troubleshooting

**No card appears:**
- Make sure the extension is enabled on `chrome://extensions`
- Hard refresh the page: `Ctrl+Shift+R`
- Check for errors: on `chrome://extensions`, click **service worker** under the extension → open the **Console** tab → hover a link → look for red errors

**Rating seems wrong:**
- The scorer reads your page title, headings, and first paragraph for context
- For better results, select text on the page that captures what you're focused on

**Card shows but no image:**
- Normal — many sites don't set an `og:image` tag, so the extension falls back to a colored letter icon

---

## How It Works

| File | Role |
|------|------|
| `background.js` | Service worker — fetches page HTML, parses metadata (title, description, image), caches results for 5 minutes |
| `content.js` | Injected into every page — handles hover detection, extracts current page context, scores link relevance, renders the card |
| `preview.css` | Styles for the preview card — scoped to `#lp-preview-card` so it never affects the host page |

### Relevance scoring (local, no API)

1. On page load, the content script extracts keywords from the current page (title, headings, meta description, first paragraph)
2. When you hover a link and metadata loads, its title + description are also tokenized
3. Keyword overlap is counted and normalized → mapped to a rating label
4. If you select text, that becomes the primary context signal

---

## Privacy

- No data leaves your browser except the fetch to the hovered URL itself (same as clicking the link)
- No analytics, no tracking, no API keys
- Cache is in-memory only and cleared when the browser closes
