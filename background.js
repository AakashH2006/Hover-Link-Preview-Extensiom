/**
 * background.js — Service Worker
 * Fetches and parses webpage metadata on behalf of the content script.
 * Handles caching, deduplication, and in-flight request cancellation.
 */

const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 200;
const inFlight = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_META') {
    handleFetchMeta(message.url, sendResponse);
    return true;
  }
  if (message.type === 'CANCEL_FETCH') {
    cancelFetch(message.url);
    return false;
  }
});

async function handleFetchMeta(url, sendResponse) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    sendResponse({ success: true, meta: cached.meta });
    return;
  }

  cancelFetch(url);
  const controller = new AbortController();
  inFlight.set(url, controller);

  try {
    const meta = await fetchMeta(url, controller.signal);
    

    if (cache.size >= MAX_CACHE_SIZE) {
      cache.delete(cache.keys().next().value);
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


function cancelFetch(url) {
  const controller = inFlight.get(url);
  if (controller) { controller.abort(); inFlight.delete(url); }
}

async function fetchMeta(url, signal) {
  const response = await fetch(url, {
    signal,
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  let bytesRead = 0;
  const LIMIT = 50 * 1024;

  while (bytesRead < LIMIT) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
    bytesRead += value.byteLength;
    if (html.toLowerCase().includes('</head>')) break;
  }
  reader.cancel();
  return parseMeta(html, url);
}

function parseMeta(html, pageUrl) {
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

  let image = null;
  if (ogImage) {
    try { image = new URL(ogImage, pageUrl).href; } catch { image = ogImage; }
  }

  const faviconUrl = `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(pageUrl)}`;

  return {
    title: title ? truncate(title, 80) : null,
    description: description || null,
    image,
    domain,
    favicon: faviconUrl,
    rating: null,
  };
}

function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

function truncate(str, max) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}
