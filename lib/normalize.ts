export function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeEmail(value: unknown): string {
  return cleanText(value).toLowerCase();
}

export function normalizeWebsite(value: unknown): string {
  const raw = cleanText(value).toLowerCase();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

export function domainFromWebsite(value: unknown): string {
  const raw = cleanText(value).toLowerCase();
  if (!raw) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

export function normalizePhone(value: unknown): string {
  return cleanText(value).replace(/[^+0-9]/g, '');
}

export function makeNormalizedKey(input: {
  email?: unknown;
  domain?: unknown;
  website?: unknown;
  name?: unknown;
  phone?: unknown;
}): string {
  const email = normalizeEmail(input.email);
  if (email) return `email:${email}`;

  const domain = domainFromWebsite(input.domain || input.website);
  if (domain) return `domain:${domain}`;

  const phone = normalizePhone(input.phone);
  if (phone) return `phone:${phone}`;

  const name = cleanText(input.name).toLowerCase().replace(/\s+/g, ' ');
  if (name) return `name:${name}`;

  return '';
}

export function displayDomain(input: { domain?: unknown; website?: unknown; email?: unknown }): string {
  const direct = domainFromWebsite(input.domain || input.website);
  if (direct) return direct;
  const email = normalizeEmail(input.email);
  return email.includes('@') ? email.split('@')[1] : '';
}
