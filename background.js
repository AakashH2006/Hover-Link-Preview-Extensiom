/**
 * background.js — Service Worker
 * Fetches and parses webpage metadata on behalf of the content script.
 * Handles caching, deduplication, and in-flight request cancellation.
 */

// In-memory metadata cache: url → { meta, timestamp }
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 200;

// Track in-flight fetches: url → AbortController
const inFlight = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_META') {
    handleFetchMeta(message.url, sendResponse);
    return true; // Keep channel open for async response
  }

  if (message.type === 'CANCEL_FETCH') {
    cancelFetch(message.url);
    return false;
  }
});

/**
 * Main handler: returns cached result or initiates fetch.
 */
async function handleFetchMeta(url, sendResponse) {
  // Return cached result if fresh
  const cached = cache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    sendResponse({ success: true, meta: cached.meta });
    return;
  }

  // Cancel any existing in-flight for this URL
  cancelFetch(url);

  const controller = new AbortController();
  inFlight.set(url, controller);

  try {
    const meta = await fetchMeta(url, controller.signal);
    
    // Evict oldest if cache is full
    if (cache.size >= MAX_CACHE_SIZE) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }

    cache.set(url, { meta, timestamp: Date.now() });
    sendResponse({ success: true, meta });
  } catch (err) {
    if (err.name === 'AbortError') {
      sendResponse({ success: false, aborted: true });
    } else {
      sendResponse({ success: false, error: err.message });
    }
  } finally {
    inFlight.delete(url);
  }
}

/**
 * Abort an in-flight fetch for a URL.
 */
function cancelFetch(url) {
  const controller = inFlight.get(url);
  if (controller) {
    controller.abort();
    inFlight.delete(url);
  }
}

/**
 * Fetch the URL and extract metadata from the HTML.
 */
async function fetchMeta(url, signal) {
  const response = await fetch(url, {
    signal,
    headers: {
      // Mimic a real browser to avoid bot-blocking
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    // Don't follow redirects to keep things fast
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  // Read only enough HTML to find meta tags (first 50KB is plenty)
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  let bytesRead = 0;
  const LIMIT = 50 * 1024; // 50KB

  while (bytesRead < LIMIT) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
    bytesRead += value.byteLength;

    // Stop early once we're past </head> — meta tags live in head
    if (html.toLowerCase().includes('</head>')) break;
  }

  // Cancel the rest of the stream
  reader.cancel();

  return parseMeta(html, url);
}

/**
 * Extract metadata fields from raw HTML string.
 */
function parseMeta(html, pageUrl) {
  // Use a lightweight regex approach — no DOM available in service worker
  const get = (pattern) => {
    const m = html.match(pattern);
    return m ? decodeHtmlEntities(m[1]?.trim()) : null;
  };

  const title =
    get(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    get(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
    get(/<title[^>]*>([^<]+)<\/title>/i) ||
    null;

  const description =
    get(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
    get(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i) ||
    get(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    get(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i) ||
    null;

  const ogImage =
    get(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    get(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
    null;

  const { hostname } = new URL(pageUrl);
  const domain = hostname.replace(/^www\./, '');

  // Resolve relative og:image URLs
  let image = null;
  if (ogImage) {
    try {
      image = new URL(ogImage, pageUrl).href;
    } catch {
      image = ogImage;
    }
  }

  // Standard favicon locations (try these in order)
  const faviconUrl = `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(pageUrl)}`;

  return {
    title: title ? truncate(title, 80) : null,
    description: description ? truncate(description, 160) : null,
    image,
    domain,
    favicon: faviconUrl,
  };
}

/**
 * Decode common HTML entities.
 */
function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

function truncate(str, max) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}
