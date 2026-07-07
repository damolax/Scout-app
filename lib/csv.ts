import Papa from 'papaparse';
import { CsvBusinessInput, CsvInvalidRow } from './types';
import { cleanText, displayDomain, makeNormalizedKey, normalizeEmail, normalizePhone, normalizeWebsite } from './normalize';

const FIELD_ALIASES = {
  name: ['business name', 'business', 'company', 'company name', 'name', 'title', 'place name', 'organization', 'store', 'shop'],
  email: ['email', 'email address', 'e-mail', 'mail', 'contact email', 'verified email'],
  phone: ['phone', 'phone number', 'telephone', 'mobile', 'contact number', 'tel'],
  website: ['website', 'site', 'url', 'web', 'domain url', 'business website', 'website url'],
  domain: ['domain', 'website domain'],
  category: ['category', 'industry', 'niche', 'type', 'business category', 'segment'],
  location: ['location', 'city', 'state', 'country', 'address', 'area'],
  source: ['source', 'platform', 'origin']
} as const;

type FieldName = keyof typeof FIELD_ALIASES;
type RawRow = Record<string, unknown>;

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const URL_RE = /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s,;)]*/i;

function findField(headers: string[], field: FieldName): string | undefined {
  const normalizedHeaders = headers.map((h) => ({ raw: h, normalized: h.trim().toLowerCase() }));
  const aliases = FIELD_ALIASES[field];
  return normalizedHeaders.find((h) => aliases.includes(h.normalized as never))?.raw;
}

function get(row: RawRow, header: string | undefined): string {
  return header ? cleanText(row[header]) : '';
}

function allCellValues(row: RawRow): string[] {
  return Object.values(row).map((value) => cleanText(value)).filter(Boolean);
}

function firstEmailFromRow(row: RawRow): string {
  for (const value of allCellValues(row)) {
    const match = value.match(EMAIL_RE);
    if (match?.[0]) return normalizeEmail(match[0]);
  }
  return '';
}

function firstWebsiteFromRow(row: RawRow): string {
  for (const value of allCellValues(row)) {
    if (value.includes('@')) continue;
    const match = value.match(URL_RE);
    if (match?.[0] && match[0].includes('.')) return normalizeWebsite(match[0]);
  }
  return '';
}

function firstPhoneFromRow(row: RawRow): string {
  for (const value of allCellValues(row)) {
    if (value.includes('@') || /https?:\/\//i.test(value)) continue;
    const digits = value.replace(/[^+0-9]/g, '');
    if (digits.replace(/\D/g, '').length >= 7) return normalizePhone(value);
  }
  return '';
}

function firstNameFromRow(row: RawRow, headers: string[]): string {
  const preferred = ['business', 'business name', 'company', 'company name', 'name', 'store', 'shop', 'title'];
  for (const header of headers) {
    if (preferred.includes(header.trim().toLowerCase())) {
      const value = cleanText(row[header]);
      if (value) return value;
    }
  }
  for (const value of allCellValues(row)) {
    if (EMAIL_RE.test(value) || URL_RE.test(value)) continue;
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 7) continue;
    if (value.length >= 2 && value.length <= 120) return value;
  }
  return '';
}

export function parseCsvText(text: string): Promise<{ rows: CsvBusinessInput[]; invalidRows: CsvInvalidRow[]; headers: string[]; errors: string[] }> {
  return new Promise((resolve) => {
    Papa.parse<RawRow>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      complete: (result) => {
        const headers = result.meta.fields || [];
        const nameField = findField(headers, 'name');
        const emailField = findField(headers, 'email');
        const phoneField = findField(headers, 'phone');
        const websiteField = findField(headers, 'website');
        const domainField = findField(headers, 'domain');
        const categoryField = findField(headers, 'category');
        const locationField = findField(headers, 'location');
        const sourceField = findField(headers, 'source');

        const rows: CsvBusinessInput[] = [];
        const invalidRows: CsvInvalidRow[] = [];

        result.data.forEach((row, index) => {
          const email = normalizeEmail(get(row, emailField)) || firstEmailFromRow(row);
          const website = normalizeWebsite(get(row, websiteField)) || firstWebsiteFromRow(row);
          const domain = displayDomain({ domain: get(row, domainField), website, email });
          const name = get(row, nameField) || firstNameFromRow(row, headers);
          const phone = normalizePhone(get(row, phoneField)) || firstPhoneFromRow(row);
          const category = get(row, categoryField);
          const location = get(row, locationField);
          const source = get(row, sourceField) || 'csv_upload';
          const normalized_key = makeNormalizedKey({ email, domain, website, name, phone });
          const normalizedRow = { name, email, phone, website, domain, category, location, source, normalized_key, raw: row };
          if (normalized_key) rows.push(normalizedRow);
          else invalidRows.push({ rowNumber: index + 2, reason: 'No usable email, website/domain, phone, or business name found.', raw: row });
        });

        resolve({ rows, invalidRows, headers, errors: result.errors.map((error) => `${error.code}: ${error.message}`) });
      },
      error: (error: Error) => resolve({ rows: [], invalidRows: [], headers: [], errors: [error.message] })
    });
  });
}

export function csvColumnsLookDifferent(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  const clean = (cols: string[]) => new Set(cols.map((c) => c.trim().toLowerCase()).filter(Boolean));
  const setA = clean(a);
  const setB = clean(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 && intersection / union < 0.45;
}
