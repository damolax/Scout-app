// @ts-nocheck
import dns from 'node:dns/promises';
import net from 'node:net';

const blockedHosts = new Set(['localhost', 'localhost.localdomain', '0.0.0.0']);
const ALLOWED_PORTS = new Set(['', '80', '443']);
const MAX_URL_LENGTH = 2048;

export function normalizeWebsiteUrl(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('Enter a website URL.');
  if (value.length > MAX_URL_LENGTH) throw new Error('The website URL is too long.');
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) {
    throw new Error('Only HTTP and HTTPS websites can be analyzed.');
  }
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS websites can be analyzed.');
  if (url.username || url.password) throw new Error('Website URLs containing embedded credentials are not allowed.');
  if (!ALLOWED_PORTS.has(url.port)) throw new Error('Only standard website ports 80 and 443 can be analyzed.');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname.length > 253) throw new Error('The website hostname is invalid.');
  url.hostname = hostname;
  url.hash = '';
  return url;
}

export async function assertPublicUrl(url) {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (blockedHosts.has(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost')) {
    throw new Error('Private or local network addresses cannot be analyzed.');
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('Private or local network addresses cannot be analyzed.');
    return;
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('The website hostname could not be resolved.');
  }
  if (!records.length) throw new Error('The website hostname could not be resolved.');
  for (const record of records) {
    if (isPrivateIp(record.address)) throw new Error('Private or local network addresses cannot be analyzed.');
  }
}

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  const normalized = String(ip || '').toLowerCase().split('%')[0];
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8')
  );
}
