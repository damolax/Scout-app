import { cleanText, normalizeWebsite } from './normalize';

const BLOCKED_HOSTS = [
  'yelp.com', 'www.yelp.com', 'google.com', 'www.google.com', 'maps.google.com', 'bing.com', 'www.bing.com',
  'facebook.com', 'www.facebook.com', 'instagram.com', 'www.instagram.com', 'linkedin.com', 'www.linkedin.com',
  'trustpilot.com', 'www.trustpilot.com', 'yellowpages.com', 'www.yellowpages.com', 'yell.com', 'www.yell.com',
  'duckduckgo.com', 'www.duckduckgo.com', 'tiktok.com', 'www.tiktok.com', 'youtube.com', 'www.youtube.com',
  'twitter.com', 'www.twitter.com', 'x.com', 'www.x.com', 'reddit.com', 'www.reddit.com', 'pinterest.com', 'www.pinterest.com',
  'linktr.ee', 'www.linktr.ee',
  'wikipedia.org', 'www.wikipedia.org', 'wikimedia.org', 'www.wikimedia.org', 'forbes.com', 'www.forbes.com',
  'shopify.com', 'www.shopify.com', 'medium.com', 'www.medium.com', 'reddit.com', 'www.reddit.com',
  'quora.com', 'www.quora.com', 'crunchbase.com', 'www.crunchbase.com', 'bloomberg.com', 'www.bloomberg.com',
  'reuters.com', 'www.reuters.com', 'github.com', 'www.github.com', 'npmjs.com', 'www.npmjs.com',
  'themeforest.net', 'www.themeforest.net', 'wordpress.org', 'www.wordpress.org', 'creativecommons.org', 'www.creativecommons.org'
];

const BLOCKED_SUFFIXES = [
  '.yelp.com', '.google.com', '.facebook.com', '.instagram.com', '.linkedin.com', '.trustpilot.com', '.yellowpages.com',
  '.yell.com', '.bing.com', '.duckduckgo.com', '.tiktok.com', '.youtube.com', '.twitter.com', '.reddit.com', '.pinterest.com',
  '.wikipedia.org', '.wikimedia.org', '.forbes.com', '.shopify.com', '.medium.com', '.quora.com', '.crunchbase.com',
  '.bloomberg.com', '.reuters.com', '.github.com', '.npmjs.com', '.themeforest.net', '.wordpress.org', '.creativecommons.org'
];

function rawWebsiteValues(row: any) {
  const raw = row?.raw && typeof row.raw === 'object' ? row.raw : {};
  return [
    row?.website,
    row?.domain,
    row?.url,
    raw.website,
    raw.domain,
    raw.url,
    raw.company_url,
    raw.business_url,
    raw.store_url,
    raw.site,
    raw.web,
    raw.homepage
  ];
}

export function hostFromWebsite(value: unknown) {
  const normalized = normalizeWebsite(value);
  if (!normalized) return '';
  try {
    return new URL(normalized).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function isBlockedAutoScoutHost(host: string) {
  const clean = cleanText(host).toLowerCase().replace(/^www\./, '');
  if (!clean || !clean.includes('.')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) return true;
  if (clean === 'localhost' || clean.endsWith('.local')) return true;
  if (BLOCKED_HOSTS.includes(clean)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => clean.endsWith(suffix))) return true;
  return false;
}

export function normalizeAutoScoutWebsite(row: any) {
  for (const value of rawWebsiteValues(row)) {
    const normalized = normalizeWebsite(value);
    const host = hostFromWebsite(normalized);
    if (normalized && host && !isBlockedAutoScoutHost(host)) return normalized;
  }
  return '';
}

export function hasUsableWebsiteTarget(row: any) {
  return Boolean(normalizeAutoScoutWebsite(row));
}
