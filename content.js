/**
 * content.js — Content Script
 * Detects link hovers, requests metadata, and renders the preview card.
 */

// ── Constants ─────────────────────────────────────────────────────────────────
const HOVER_DELAY_MS = 500;      // Wait before showing preview
const CARD_OFFSET_X = 16;        // Pixels from cursor
const CARD_OFFSET_Y = 16;
const CARD_WIDTH = 320;
const VIEWPORT_MARGIN = 12;      // Min distance from viewport edges

// ── State ─────────────────────────────────────────────────────────────────────
let hoverTimer = null;
let currentLink = null;
let currentUrl = null;
let card = null;
let mouseX = 0;
let mouseY = 0;
let isCardVisible = false;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('mouseover', onMouseOver, { passive: true });
document.addEventListener('mouseout', onMouseOut, { passive: true });
document.addEventListener('mousemove', onMouseMove, { passive: true });
document.addEventListener('scroll', hideCard, { passive: true, capture: true });
document.addEventListener('keydown', hideCard, { passive: true });

// ── Event Handlers ────────────────────────────────────────────────────────────

function onMouseOver(e) {
  const link = e.target.closest('a[href]');
  if (!link) return;

  const href = link.href;
  if (!isValidUrl(href)) return;

  // Same link — do nothing
  if (link === currentLink) return;

  clearHoverTimer();
  currentLink = link;
  currentUrl = href;

  hoverTimer = setTimeout(() => showPreview(href), HOVER_DELAY_MS);
}

function onMouseOut(e) {
  const link = e.target.closest('a[href]');
  if (!link) return;

  // Moved to card itself — keep showing
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
  if (isCardVisible && card) {
    positionCard();
  }
}

// ── Preview Logic ─────────────────────────────────────────────────────────────

async function showPreview(url) {
  // Show skeleton immediately
  ensureCard();
  renderSkeleton(url);
  showCard();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'FETCH_META',
      url,
    });

    // URL changed while fetching
    if (currentUrl !== url) return;

    if (response?.success && response.meta) {
      renderMeta(response.meta, url);
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

  // Prevent card hover from dismissing preview
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
  // Clear content after fade-out
  setTimeout(() => {
    if (!isCardVisible && card) card.innerHTML = '';
  }, 200);
}

function positionCard() {
  if (!card) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardH = card.offsetHeight || 240;

  let x = mouseX + CARD_OFFSET_X;
  let y = mouseY + CARD_OFFSET_Y;

  // Flip left if overflows right
  if (x + CARD_WIDTH + VIEWPORT_MARGIN > vw) {
    x = mouseX - CARD_WIDTH - CARD_OFFSET_X;
  }
  // Flip above if overflows bottom
  if (y + cardH + VIEWPORT_MARGIN > vh) {
    y = mouseY - cardH - CARD_OFFSET_Y;
  }

  // Hard clamp to viewport
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
  const { title, description, image, domain, favicon } = meta;

  const imageHtml = image
    ? `<div class="lp-image-wrap">
         <img class="lp-image" src="${escHtml(image)}" alt=""
              onerror="this.closest('.lp-image-wrap').replaceWith(generateFallbackIcon('${escHtml(domain)}'))">
       </div>`
    : `<div class="lp-image-wrap lp-image-fallback">${generateFallbackIconHTML(domain)}</div>`;

  const faviconHtml = favicon
    ? `<img class="lp-favicon" src="${escHtml(favicon)}" alt=""
            onerror="this.style.display='none'">`
    : '';

  card.innerHTML = `
    ${imageHtml}
    <div class="lp-body">
      ${title ? `<div class="lp-title">${escHtml(title)}</div>` : ''}
      ${description ? `<div class="lp-desc">${escHtml(description)}</div>` : ''}
      <div class="lp-footer">
        <span class="lp-dot" style="background:${domainColor(domain)}"></span>
        ${faviconHtml}
        <span class="lp-domain">${escHtml(domain)}</span>
      </div>
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

// ── Fallback Icon ─────────────────────────────────────────────────────────────

/**
 * Generate a colored square icon with the first letter of the domain.
 * Color is deterministic from domain hash.
 */
function generateFallbackIconHTML(domain) {
  const letter = (domain[0] || '?').toUpperCase();
  const color = domainColor(domain);
  return `<div class="lp-icon" style="background:${color}">${escHtml(letter)}</div>`;
}

function domainColor(domain) {
  // Simple hash → hue in HSL
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = (hash * 31 + domain.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  const sat = 55 + (hash % 20); // 55–75%
  const lit = 40 + (hash % 15); // 40–55%
  return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function clearHoverTimer() {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function isValidUrl(href) {
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function escHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
