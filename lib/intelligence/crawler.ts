// @ts-nocheck
import { assertPublicUrl, normalizeWebsiteUrl } from './security';

const DEFAULT_MAX_PAGES = 8;
const MAX_HTML_BYTES = 1500000;
const REQUEST_TIMEOUT_MS = 12000;
const USER_AGENT = process.env.ANALYZER_USER_AGENT || 'ScoutOpportunityIntelligence/1.3 (+public website analysis)';

const PAGE_TYPE_RULES = [
  ['booking', ['booking','book-now','schedule','appointment','reservation','availability']],
  ['pricing', ['pricing','prices','packages','plans','rates']],
  ['contact', ['contact','enquire','inquiry','get-in-touch','request-quote']],
  ['service', ['service','solutions','what-we-do','treatments']],
  ['product', ['product','shop','collection','store']],
  ['listing', ['property','listing','for-sale','for-rent','inventory']],
  ['proof', ['reviews','testimonials','case-study','portfolio','gallery']],
  ['team', ['team','agent','practitioner','staff','about-us']],
  ['faq', ['faq','questions','help']],
  ['policy', ['privacy','returns','shipping','terms','cancellation']],
  ['education', ['blog','guide','resources','academy']],
];

export async function crawlWebsite(inputUrl, options = {}) {
  const startUrl = normalizeWebsiteUrl(inputUrl);
  await assertPublicUrl(startUrl);
  const homepage = await fetchHtmlSafe(startUrl);
  const origin = new URL(homepage.finalUrl).origin;
  const first = parsePage(homepage.finalUrl, homepage.html, homepage.headers, homepage.durationMs, 'homepage');
  const maxPages = clamp(Number(options.maxPages || process.env.ANALYZER_MAX_PAGES || DEFAULT_MAX_PAGES), 3, 12);
  const selected = chooseRepresentativePages(rankInternalLinks(first.links, origin), maxPages - 1);
  const pages = [first];
  const failures = [];

  for (let i = 0; i < selected.length; i += 3) {
    const batch = selected.slice(i, i + 3);
    const settled = await Promise.allSettled(batch.map(async (entry) => {
      const response = await fetchHtmlSafe(new URL(entry.url));
      return parsePage(response.finalUrl, response.html, response.headers, response.durationMs, entry.pageType);
    }));
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') pages.push(result.value);
      else failures.push({ url: batch[index]?.url || '', error: result.reason?.message || 'Page could not be analyzed.' });
    });
  }

  return {
    requestedUrl: startUrl.toString(),
    finalUrl: homepage.finalUrl,
    origin,
    pages: dedupePages(pages).slice(0, maxPages),
    robotsFound: false,
    sitemapUrlCount: 0,
    failures,
    crawledAt: new Date().toISOString(),
  };
}

async function fetchHtmlSafe(initialUrl) {
  let current = new URL(initialUrl);
  for (let hop = 0; hop < 4; hop += 1) {
    await assertPublicUrl(current);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const started = Date.now();
    try {
      const response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'accept-language': 'en-US,en;q=0.8',
        },
        cache: 'no-store',
      });
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('The website returned an invalid redirect.');
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) {
        if (response.status === 403) throw new Error('The website blocked automated public-page access (HTTP 403).');
        if (response.status === 429) throw new Error('The website temporarily rate-limited the analyzer (HTTP 429).');
        throw new Error('The website returned HTTP ' + response.status + '.');
      }
      const contentType = response.headers.get('content-type') || '';
      if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error('The submitted URL did not return an HTML website.');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_HTML_BYTES) throw new Error('The website page is too large to analyze safely.');
      return {
        finalUrl: current.toString(),
        html: buffer.toString('utf8'),
        headers: Object.fromEntries(response.headers.entries()),
        durationMs: Date.now() - started,
      };
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('The website took too long to respond: ' + current.hostname);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('The website redirected too many times.');
}

function parsePage(url, html, headers, durationMs, pageType = 'other') {
  const cleanHtml = String(html || '');
  const title = cleanText(firstMatch(cleanHtml, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const metaTag = firstTag(cleanHtml, /<meta\b[^>]*name=["']description["'][^>]*>/i) || firstTag(cleanHtml, /<meta\b[^>]*content=["'][^"']*["'][^>]*name=["']description["'][^>]*>/i);
  const metaDescription = cleanText(attrFromAttrs(metaTag, 'content'));
  const lang = cleanText(attrFromAttrs(firstTag(cleanHtml, /<html\b[^>]*>/i), 'lang'));

  const headings = [];
  for (const match of cleanHtml.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = cleanText(stripTags(match[2]));
    if (text) headings.push({ level: Number(match[1]), text });
    if (headings.length >= 100) break;
  }

  const links = [];
  for (const match of cleanHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const absolute = safeAbsolute(attrFromAttrs(match[1], 'href'), url);
    if (absolute) links.push({ url: absolute, text: cleanText(stripTags(match[2])).slice(0,180) });
    if (links.length >= 1200) break;
  }

  const scripts = [];
  for (const match of cleanHtml.matchAll(/<script\b([^>]*)>/gi)) {
    const absolute = safeAbsolute(attrFromAttrs(match[1], 'src'), url);
    if (absolute) scripts.push(absolute);
    if (scripts.length >= 200) break;
  }

  const jsonLd = [];
  for (const match of cleanHtml.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    jsonLd.push(String(match[1] || '').slice(0,100000));
    if (jsonLd.length >= 30) break;
  }

  const images = [];
  for (const match of cleanHtml.matchAll(/<img\b([^>]*)>/gi)) {
    const src = attrFromAttrs(match[1], 'src') || attrFromAttrs(match[1], 'data-src');
    const absolute = safeAbsolute(src, url);
    if (absolute) images.push({ src: absolute, alt: cleanText(attrFromAttrs(match[1], 'alt')) });
    if (images.length >= 250) break;
  }

  const buttons = [];
  for (const match of cleanHtml.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const label = cleanText(stripTags(match[2])) || cleanText(attrFromAttrs(match[1], 'aria-label'));
    if (label) buttons.push(label.slice(0,180));
    if (buttons.length >= 300) break;
  }
  for (const match of cleanHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (String(attrFromAttrs(match[1], 'role')).toLowerCase() !== 'button') continue;
    const label = cleanText(stripTags(match[2])) || cleanText(attrFromAttrs(match[1], 'aria-label'));
    if (label) buttons.push(label.slice(0,180));
    if (buttons.length >= 300) break;
  }
  for (const match of cleanHtml.matchAll(/<input\b([^>]*)>/gi)) {
    if (String(attrFromAttrs(match[1], 'type')).toLowerCase() !== 'submit') continue;
    const value = cleanText(attrFromAttrs(match[1], 'value'));
    if (value) buttons.push(value.slice(0,180));
  }

  const forms = [];
  for (const match of cleanHtml.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const formHtml = match[2] || '';
    const inputs = [];
    for (const field of formHtml.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
      inputs.push({
        name: cleanText(attrFromAttrs(field[2], 'name')),
        type: cleanText(attrFromAttrs(field[2], 'type') || field[1]),
        placeholder: cleanText(attrFromAttrs(field[2], 'placeholder')),
        label: '',
        required: /\brequired\b/i.test(field[2]),
      });
      if (inputs.length >= 80) break;
    }
    forms.push({
      action: safeAbsolute(attrFromAttrs(match[1], 'action'), url),
      method: cleanText(attrFromAttrs(match[1], 'method') || 'get').toLowerCase(),
      text: cleanText(stripTags(formHtml)).slice(0,1200),
      inputs,
    });
    if (forms.length >= 30) break;
  }

  const visible = cleanHtml
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<template\b[\s\S]*?<\/template>/gi, ' ');
  const text = cleanText(stripTags(visible)).slice(0,160000);

  return {
    url,
    path: new URL(url).pathname,
    pageType,
    title,
    metaDescription,
    generator: '',
    lang,
    text,
    headings,
    links,
    scripts,
    forms,
    images,
    buttons,
    jsonLd,
    htmlSample: cleanHtml.slice(0,450000),
    headers,
    responseMs: durationMs,
    htmlBytes: Buffer.byteLength(cleanHtml),
  };
}

function rankInternalLinks(links, origin) {
  const ignored = /\.(?:jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js|xml)(?:\?|$)/i;
  const seen = new Set();
  return links.map((link) => {
    try {
      const url = new URL(link.url);
      if (url.origin !== origin || ignored.test(url.pathname)) return null;
      url.hash = '';
      ['utm_source','utm_medium','utm_campaign','gclid','fbclid'].forEach((key) => url.searchParams.delete(key));
      const key = url.toString().replace(/\/$/, '');
      if (seen.has(key) || url.pathname === '/') return null;
      seen.add(key);
      const haystack = (url.pathname + ' ' + link.text).toLowerCase();
      const pageType = inferPageType(haystack);
      const score = (pageType === 'other' ? 0 : 12) + keywordScore(haystack) - url.pathname.split('/').length;
      return { url: url.toString(), pageType, score };
    } catch { return null; }
  }).filter(Boolean).sort((a,b) => b.score - a.score);
}

function chooseRepresentativePages(candidates, limit) {
  const selected = [];
  const usedTypes = new Set();
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (candidate.pageType !== 'other' && !usedTypes.has(candidate.pageType)) {
      selected.push(candidate);
      usedTypes.add(candidate.pageType);
    }
  }
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (!selected.some((item) => item.url === candidate.url)) selected.push(candidate);
  }
  return selected;
}

function inferPageType(haystack) {
  for (const [type, terms] of PAGE_TYPE_RULES) if (terms.some((term) => haystack.includes(term))) return type;
  return 'other';
}
function keywordScore(haystack) {
  return PAGE_TYPE_RULES.flatMap(([,terms]) => terms).reduce((sum,term) => sum + (haystack.includes(term) ? 4 : 0),0);
}
function firstMatch(value, pattern) {
  const match = String(value || '').match(pattern);
  return match?.[1] || '';
}
function firstTag(value, pattern) {
  return String(value || '').match(pattern)?.[0] || '';
}
function attrFromAttrs(attrs, wanted) {
  const text = String(attrs || '');
  const regex = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of text.matchAll(regex)) {
    if (String(match[1]).toLowerCase() === String(wanted).toLowerCase()) return decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return '';
}
function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ');
}
function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, function(_, n) { return String.fromCodePoint(Number(n) || 32); });
}
function cleanText(value) {
  return decodeEntities(String(value || '')).replace(/\s+/g, ' ').trim();
}
function safeAbsolute(value, base) {
  if (!value || /^(?:mailto:|tel:|javascript:|data:)/i.test(value)) return '';
  try { return new URL(value, base).toString(); } catch { return ''; }
}
function dedupePages(pages) {
  const seen = new Set();
  return pages.filter((page) => {
    const key = page.url.replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
