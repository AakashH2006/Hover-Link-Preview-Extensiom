/**
 * content.js — Content Script
 * Detects link hovers, requests metadata, and renders the preview card.
 * Scores link relevance against current page context — no API needed.
 */

const HOVER_DELAY_MS = 500;
const CARD_OFFSET_X = 16;
const CARD_OFFSET_Y = 16;
const CARD_WIDTH = 340;
const VIEWPORT_MARGIN = 12;

let hoverTimer = null;
let currentLink = null;
let currentUrl = null;
let card = null;
let mouseX = 0;
let mouseY = 0;
let isCardVisible = false;

// Extract page context once on load, refresh if user selects text
let pageContext = extractPageContext();
document.addEventListener('mouseup', () => {
  const sel = window.getSelection()?.toString().trim();
  if (sel && sel.length > 10) pageContext = extractPageContext(sel);
});

// ── Page Context Extraction ───────────────────────────────────────────────────

/**
 * Pull keywords from the current page: title, headings, selected text, meta.
 * Returns a Set of lowercased meaningful tokens.
 */
function extractPageContext(selectedText) {
  const parts = [];

  // Page title
  parts.push(document.title || '');

  // Selected text (highest signal — user is focused on this)
  if (selectedText) parts.push(selectedText);

  // Meta description
  const metaDesc = document.querySelector('meta[name="description"]')?.content;
  if (metaDesc) parts.push(metaDesc);

  // Headings h1–h3
  document.querySelectorAll('h1, h2, h3').forEach(h => parts.push(h.textContent));

  // First visible paragraph (body context)
  const firstP = document.querySelector('article p, main p, .content p, p');
  if (firstP) parts.push(firstP.textContent.slice(0, 300));

  return tokenize(parts.join(' '));
}

/**
 * Convert text to a Set of meaningful lowercase tokens (3+ chars, no stopwords).
 */
function tokenize(text) {
  const stopwords = new Set([
    'the','and','for','are','but','not','you','all','can','her','was','one',
    'our','out','day','get','has','him','his','how','its','let','may','new',
    'now','old','see','two','who','boy','did','its','put','say','she','too',
    'use','with','this','that','from','they','will','have','been','more',
    'when','what','your','also','into','then','than','some','over','just',
    'about','after','where','their','there','these','would','could','should',
    'which','other','being','those','make','time','very','well','back','even',
    'here','only','such','take','each','much','come','like','know','good',
  ]);

  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !stopwords.has(w))
  );
}

/**
 * Score how much a link's metadata overlaps with the current page context.
 * Returns { label, emoji, color, matchCount }
 */
function scoreContextRelevance(meta) {
  const { title = '', description = '' } = meta;
  const linkTokens = tokenize(`${title} ${description}`);
  const ctx = pageContext;

  if (ctx.size === 0 || linkTokens.size === 0) {
    return { label: 'No context', emoji: '?', color: '#888' };
  }

  // Count overlapping tokens
  let matches = 0;
  for (const token of linkTokens) {
    if (ctx.has(token)) matches++;
  }

  // Also check link anchor text as a bonus signal
  const anchorText = currentLink?.textContent?.trim() || '';
  const anchorTokens = tokenize(anchorText);
  for (const token of anchorTokens) {
    if (ctx.has(token) && !linkTokens.has(token)) matches += 0.5;
  }

  // Normalize: what % of link tokens matched page context
  const ratio = matches / Math.min(linkTokens.size, 20);

  if (ratio >= 0.35 || matches >= 6)
    return { label: 'Relevant', emoji: '⚡', color: '#16a34a', matches: Math.round(matches) };
  if (ratio >= 0.18 || matches >= 3)
    return { label: 'Related',  emoji: '✓',  color: '#2563eb', matches: Math.round(matches) };
  if (ratio >= 0.07 || matches >= 1)
    return { label: 'Tangential', emoji: '~', color: '#d97706', matches: Math.round(matches) };

  return { label: 'Off-topic', emoji: '✕', color: '#dc2626', matches: 0 };
}

// ── Event Handlers ────────────────────────────────────────────────────────────

document.addEventListener('mouseover', onMouseOver, { passive: true });
document.addEventListener('mouseout', onMouseOut, { passive: true });
document.addEventListener('mousemove', onMouseMove, { passive: true });
document.addEventListener('scroll', hideCard, { passive: true, capture: true });
document.addEventListener('keydown', hideCard, { passive: true });

function onMouseOver(e) {
  const link = e.target.closest('a[href]');
  if (!link) return;
  const href = link.href;
  if (!isValidUrl(href)) return;
  if (link === currentLink) return;
  clearHoverTimer();
  currentLink = link;
  currentUrl = href;
  hoverTimer = setTimeout(() => showPreview(href), HOVER_DELAY_MS);
}

function onMouseOut(e) {
  const link = e.target.closest('a[href]');
  if (!link) return;
  if (card && card.contains(e.relatedTarget)) return;
  clearHoverTimer();
  if (currentLink === link) {
    currentLink = null;
    cancelCurrentFetch();
    hideCard();
  }
}

function onMouseMove(e) {
  mouseX = e.clientX;
  mouseY = e.clientY;
  if (isCardVisible && card) positionCard();
}

// ── Preview Logic ─────────────────────────────────────────────────────────────

async function showPreview(url) {
  ensureCard();
  renderSkeleton(url);
  showCard();

  try {
    const response = await chrome.runtime.sendMessage({ type: 'FETCH_META', url });
    if (currentUrl !== url) return;

    if (response?.success && response.meta) {
      // Score relevance in content script where we have page context
      const rating = scoreContextRelevance(response.meta);
      renderMeta({ ...response.meta, rating }, url);
    } else if (!response?.aborted) {
      renderFallback(url);
    }
  } catch {
    if (currentUrl === url) renderFallback(url);
  }
}

function cancelCurrentFetch() {
  if (currentUrl) {
    chrome.runtime.sendMessage({ type: 'CANCEL_FETCH', url: currentUrl }).catch(() => {});
    currentUrl = null;
  }
}

// ── Card DOM ──────────────────────────────────────────────────────────────────

function ensureCard() {
  if (card) return;
  card = document.createElement('div');
  card.id = 'lp-preview-card';
  card.setAttribute('role', 'tooltip');
  card.setAttribute('aria-live', 'polite');
  card.addEventListener('mouseenter', () => clearHoverTimer());
  card.addEventListener('mouseleave', hideCard);
  document.documentElement.appendChild(card);
}

function showCard() {
  if (!card) return;
  positionCard();
  requestAnimationFrame(() => {
    card.classList.add('lp-visible');
    isCardVisible = true;
  });
}

function hideCard() {
  if (!card) return;
  card.classList.remove('lp-visible');
  isCardVisible = false;
  setTimeout(() => { if (!isCardVisible && card) card.innerHTML = ''; }, 200);
}

function positionCard() {
  if (!card) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardH = card.offsetHeight || 240;

  let x = mouseX + CARD_OFFSET_X;
  let y = mouseY + CARD_OFFSET_Y;

  if (x + CARD_WIDTH + VIEWPORT_MARGIN > vw) x = mouseX - CARD_WIDTH - CARD_OFFSET_X;
  if (y + cardH + VIEWPORT_MARGIN > vh) y = mouseY - cardH - CARD_OFFSET_Y;

  x = Math.max(VIEWPORT_MARGIN, Math.min(x, vw - CARD_WIDTH - VIEWPORT_MARGIN));
  y = Math.max(VIEWPORT_MARGIN, y);

  card.style.left = `${x + window.scrollX}px`;
  card.style.top = `${y + window.scrollY}px`;
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function renderSkeleton(url) {
  const domain = getDomain(url);
  card.innerHTML = `
    <div class="lp-skeleton">
      <div class="lp-skel-image"></div>
      <div class="lp-skel-body">
        <div class="lp-skel-line lp-skel-title"></div>
        <div class="lp-skel-line lp-skel-desc"></div>
        <div class="lp-skel-line lp-skel-desc lp-skel-desc-short"></div>
        <div class="lp-skel-domain">${escHtml(domain)}</div>
      </div>
    </div>
  `;
}

function renderMeta(meta, url) {
  const { title, description, image, domain, rating } = meta;

  const imageHtml = image
    ? `<div class="lp-image-wrap">
         <img class="lp-image" src="${escHtml(image)}" alt=""
              onerror="this.closest('.lp-image-wrap').style.display='none'">
       </div>`
    : `<div class="lp-image-wrap lp-image-fallback">${generateFallbackIconHTML(domain)}</div>`;

  const ratingHtml = rating ? `
    <div class="lp-rating">
      <span class="lp-rating-pill" style="color:${escHtml(rating.color)};border-color:${escHtml(rating.color)}">
        <span class="lp-rating-emoji">${escHtml(rating.emoji)}</span>
        <span class="lp-rating-label">${escHtml(rating.label)}</span>
      </span>
      ${rating.matches > 0 ? `<span class="lp-match-count">${rating.matches} keyword${rating.matches !== 1 ? 's' : ''} matched</span>` : ''}
    </div>` : '';

  card.innerHTML = `
    ${imageHtml}
    <div class="lp-body">
      ${ratingHtml}
      ${title ? `<div class="lp-title">${escHtml(title)}</div>` : ''}
      ${description ? `<div class="lp-desc">${escHtml(description)}</div>` : ''}
    </div>
  `;
}

function renderFallback(url) {
  const domain = getDomain(url);
  const shortUrl = url.length > 60 ? url.slice(0, 57) + '…' : url;
  card.innerHTML = `
    <div class="lp-body lp-fallback-body">
      <div class="lp-fallback-row">
        ${generateFallbackIconHTML(domain)}
        <div>
          <div class="lp-domain lp-domain-large">${escHtml(domain)}</div>
          <div class="lp-url">${escHtml(shortUrl)}</div>
        </div>
      </div>
    </div>
  `;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateFallbackIconHTML(domain) {
  const letter = (domain[0] || '?').toUpperCase();
  const color = domainColor(domain);
  return `<div class="lp-icon" style="background:${color}">${escHtml(letter)}</div>`;
}

function domainColor(domain) {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) hash = (hash * 31 + domain.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, ${55 + (hash % 20)}%, ${40 + (hash % 15)}%)`;
}

function clearHoverTimer() {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
}

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function isValidUrl(href) {
  try { const u = new URL(href); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
