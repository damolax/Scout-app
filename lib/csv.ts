import Papa from 'papaparse';
import { CsvBusinessInput } from './types';
import { cleanText, displayDomain, makeNormalizedKey, normalizeEmail, normalizePhone, normalizeWebsite } from './normalize';

const FIELD_ALIASES = {
  name: ['business name', 'business', 'company', 'company name', 'name', 'title', 'place name', 'organization'],
  email: ['email', 'email address', 'e-mail', 'mail', 'contact email'],
  phone: ['phone', 'phone number', 'telephone', 'mobile', 'contact number'],
  website: ['website', 'site', 'url', 'web', 'domain url', 'business website'],
  domain: ['domain', 'website domain'],
  category: ['category', 'industry', 'niche', 'type', 'business category'],
  location: ['location', 'city', 'state', 'country', 'address', 'area'],
  source: ['source', 'platform', 'origin']
} as const;

type FieldName = keyof typeof FIELD_ALIASES;

type RawRow = Record<string, unknown>;

function findField(headers: string[], field: FieldName): string | undefined {
  const normalizedHeaders = headers.map((h) => ({ raw: h, normalized: h.trim().toLowerCase() }));
  const aliases = FIELD_ALIASES[field];
  return normalizedHeaders.find((h) => aliases.includes(h.normalized as never))?.raw;
}

function get(row: RawRow, header: string | undefined): string {
  return header ? cleanText(row[header]) : '';
}

export function parseCsvText(text: string): Promise<{ rows: CsvBusinessInput[]; headers: string[]; errors: string[] }> {
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

        const rows = result.data.map((row) => {
          const email = normalizeEmail(get(row, emailField));
          const website = normalizeWebsite(get(row, websiteField));
          const domain = displayDomain({ domain: get(row, domainField), website, email });
          const name = get(row, nameField);
          const phone = normalizePhone(get(row, phoneField));
          const category = get(row, categoryField);
          const location = get(row, locationField);
          const source = get(row, sourceField) || 'csv_upload';
          return {
            name,
            email,
            phone,
            website,
            domain,
            category,
            location,
            source,
            normalized_key: makeNormalizedKey({ email, domain, website, name, phone }),
            raw: row
          };
        }).filter((row) => row.normalized_key);

        resolve({
          rows,
          headers,
          errors: result.errors.map((error) => `${error.code}: ${error.message}`)
        });
      },
      error: (error: Error) => resolve({ rows: [], headers: [], errors: [error.message] })
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
