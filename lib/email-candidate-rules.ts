import { cleanText, displayDomain, domainFromWebsite } from './normalize';

const EMAIL_RE = /(?:mailto:)?([a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)/gi;
const STRICT_EMAIL_RE = /^[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com', 'outlook.com', 'hotmail.com',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'zoho.com', 'gmx.com', 'mail.com', 'hey.com', 'fastmail.com'
]);

const DISPOSABLE_OR_TEST_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'test.com', 'test.org', 'localhost', 'local', 'domain.com',
  'email.com', 'yourdomain.com', 'company.com', 'website.com', 'mysite.com', 'sample.com', 'invalid.com'
]);

const BAD_LOCAL_PARTS = new Set([
  'noreply', 'no-reply', 'do-not-reply', 'donotreply', 'mailer-daemon', 'postmaster', 'abuse', 'bounce',
  'privacy', 'legal', 'unsubscribe', 'notification', 'notifications', 'automated', 'robot', 'daemon'
]);

const GOOD_ROLE_PARTS = new Set(['info', 'contact', 'hello', 'sales', 'support', 'office', 'admin', 'team', 'service', 'booking', 'bookings', 'enquiries', 'inquiries']);
const ASSET_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'css', 'js', 'ico', 'woff', 'woff2', 'ttf', 'eot', 'map']);

type BusinessLike = {
  email?: unknown;
  website?: unknown;
  domain?: unknown;
  name?: unknown;
  raw?: unknown;
};

export type EmailCandidateDecision = {
  email: string;
  valid: boolean;
  promote: boolean;
  score: number;
  quality: 'source_seen' | 'domain_match' | 'free_mailbox_seen' | 'unverified_candidate' | 'rejected';
  sourceEvidence: string;
  sourceField: string;
  reasons: string[];
  rejected?: Array<{ email: string; reason: string; sourceField: string }>;
};

function normalizeObfuscations(value: string) {
  return value
    .replace(/\s*(\[at\]|\(at\)|\{at\}|\sat\s)\s*/gi, '@')
    .replace(/\s*(\[dot\]|\(dot\)|\{dot\}|\sdot\s)\s*/gi, '.')
    .replace(/\s*@\s*/g, '@')
    .replace(/\s*\.\s*/g, '.')
    .replace(/^mailto:/i, '');
}

function rootDomain(value: string) {
  const host = domainFromWebsite(value).toLowerCase().replace(/^www\./, '');
  if (!host) return '';
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join('.');
}

function localDomain(email: string) {
  const [local = '', domain = ''] = String(email).toLowerCase().split('@');
  return { local, domain };
}

function domainMatches(emailDomain: string, businessDomain: string) {
  if (!emailDomain || !businessDomain) return false;
  const emailRoot = rootDomain(emailDomain);
  const businessRoot = rootDomain(businessDomain);
  return Boolean(emailRoot && businessRoot && emailRoot === businessRoot);
}

function collectStrings(value: unknown, path = 'payload', depth = 0, out: Array<{ value: string; path: string }> = []) {
  if (depth > 5 || out.length > 250) return out;
  if (value == null) return out;
  if (typeof value === 'string' || typeof value === 'number') {
    const text = cleanText(value);
    if (text) out.push({ value: text, path });
    return out;
  }
  if (Array.isArray(value)) {
    value.slice(0, 80).forEach((item, index) => collectStrings(item, `${path}[${index}]`, depth + 1, out));
    return out;
  }
  if (typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).slice(0, 120).forEach(([key, item]) => collectStrings(item, `${path}.${key}`, depth + 1, out));
  }
  return out;
}

export function findEmailCandidates(value: unknown) {
  const strings = collectStrings(value);
  const seen = new Set<string>();
  const results: Array<{ email: string; sourceField: string; sourceText: string }> = [];
  for (const item of strings) {
    const normalizedText = normalizeObfuscations(item.value).toLowerCase();
    const matches = normalizedText.matchAll(EMAIL_RE);
    for (const match of matches) {
      const email = String(match[1] || '').toLowerCase().replace(/[>),.;:'"\]\}]+$/g, '').replace(/^[<({\['"]+/g, '');
      const key = `${email}|${item.path}`;
      if (!email || seen.has(key)) continue;
      seen.add(key);
      results.push({ email, sourceField: item.path, sourceText: item.value.slice(0, 240) });
    }
  }
  return results;
}

function isLikelyAssetOrCode(email: string, sourceText: string) {
  const { local, domain } = localDomain(email);
  const tld = domain.split('.').pop() || '';
  const compact = `${sourceText}`.toLowerCase();
  if (ASSET_TLDS.has(tld)) return true;
  if (/[@][0-9]+x\.(png|jpg|jpeg|webp|gif|svg)/i.test(compact)) return true;
  if (/\.(png|jpg|jpeg|webp|gif|svg|css|js|ico|woff2?|ttf|eot|map)(\?|#|$)/i.test(compact)) return true;
  if (local.length <= 1) return true;
  return false;
}

export function validateEmailCandidate(candidate: { email: string; sourceText?: string; sourceField?: string }, business?: BusinessLike, sourceEvidence = '', generated = false): EmailCandidateDecision {
  const email = cleanText(candidate.email).toLowerCase().replace(/^mailto:/, '').trim();
  const sourceText = candidate.sourceText || '';
  const reasons: string[] = [];
  const { local, domain } = localDomain(email);
  const businessDomain = rootDomain(String(business?.domain || displayDomain({ domain: business?.domain, website: business?.website, email: business?.email }) || ''));
  let score = 0;

  if (!email || email.split('@').length !== 2) return { email, valid: false, promote: false, score: 0, quality: 'rejected', sourceEvidence, sourceField: candidate.sourceField || '', reasons: ['Not a complete email address.'] };
  if (!STRICT_EMAIL_RE.test(email)) return { email, valid: false, promote: false, score: 0, quality: 'rejected', sourceEvidence, sourceField: candidate.sourceField || '', reasons: ['Failed strict email format check.'] };
  if (!local || !domain || local.length > 64 || email.length > 254) reasons.push('Invalid local/domain length.');
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) reasons.push('Bad local part punctuation.');
  if (domain.includes('..') || domain.startsWith('.') || domain.endsWith('.') || domain.includes('_')) reasons.push('Bad domain punctuation.');
  const labels = domain.split('.');
  const tld = labels[labels.length - 1] || '';
  if (labels.length < 2 || !/^[a-z]{2,24}$/.test(tld)) reasons.push('Domain/TLD does not look deliverable.');
  if (DISPOSABLE_OR_TEST_DOMAINS.has(domain) || DISPOSABLE_OR_TEST_DOMAINS.has(rootDomain(domain))) reasons.push('Test/disposable/placeholder domain.');
  if (BAD_LOCAL_PARTS.has(local)) reasons.push('Non-contact mailbox like no-reply/postmaster/abuse.');
  if (isLikelyAssetOrCode(email, sourceText)) reasons.push('Looks like an asset/code string, not a contact email.');

  if (reasons.length) return { email, valid: false, promote: false, score: 0, quality: 'rejected', sourceEvidence, sourceField: candidate.sourceField || '', reasons };

  score = 35;
  const match = domainMatches(domain, businessDomain);
  const freeMailbox = FREE_EMAIL_DOMAINS.has(domain);
  if (sourceEvidence) { score += 45; reasons.push('Seen with source evidence.'); }
  if (match) { score += 25; reasons.push('Email domain matches business website/domain.'); }
  if (freeMailbox) { score += 8; reasons.push('Personal/free mailbox accepted but needs normal bounce tracking.'); }
  if (GOOD_ROLE_PARTS.has(local)) { score += 10; reasons.push('Useful role mailbox.'); }
  if (generated) { score -= 40; reasons.push('Backend marked this as generated/guessed.'); }

  const quality: EmailCandidateDecision['quality'] = sourceEvidence ? 'source_seen' : match ? 'domain_match' : freeMailbox ? 'free_mailbox_seen' : 'unverified_candidate';
  const promote = Boolean(sourceEvidence || (match && !generated) || (freeMailbox && sourceEvidence));
  if (!promote) reasons.push('Not promoted because there is no source evidence or safe domain match.');

  return { email, valid: true, promote, score: Math.max(0, Math.min(100, score)), quality, sourceEvidence, sourceField: candidate.sourceField || '', reasons };
}

export function chooseBestEmailCandidate(payload: unknown, business?: BusinessLike, sourceEvidence = '', generated = false): EmailCandidateDecision {
  const candidates = findEmailCandidates(payload);
  const decisions = candidates.map((candidate) => validateEmailCandidate(candidate, business, sourceEvidence, generated));
  const valid = decisions.filter((item) => item.valid).sort((a, b) => Number(b.promote) - Number(a.promote) || b.score - a.score);
  const rejected = decisions.filter((item) => !item.valid).map((item) => ({ email: item.email, reason: item.reasons.join(' '), sourceField: item.sourceField })).slice(0, 20);
  if (valid[0]) return { ...valid[0], rejected };
  return { email: '', valid: false, promote: false, score: 0, quality: 'rejected', sourceEvidence, sourceField: '', reasons: ['No valid email candidate found after strict filtering.'], rejected };
}
