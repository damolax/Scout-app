export type SignatureIdentity = {
  signature_enabled?: boolean | null;
  signature_text?: string | null;
  signature_html?: string | null;
  signature_logo_url?: string | null;
  raw?: Record<string, any> | null;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeNewlines(value: string) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function htmlToText(html: string) {
  return normalizeNewlines(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

export function textToHtml(text: string) {
  return escapeHtml(normalizeNewlines(text).trim()).replace(/\n/g, '<br />');
}

function rawIdentity(identity: SignatureIdentity) {
  const raw = identity.raw || {};
  const direct = (raw as any).email_identity || (raw as any).signature || {};
  return direct && typeof direct === 'object' ? direct as Record<string, any> : {};
}


function logoUrl(identity: SignatureIdentity) {
  const fallback = rawIdentity(identity);
  const url = String(identity.signature_logo_url || fallback.signature_logo_url || fallback.logo_url || '').trim();
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function logoHtml(identity: SignatureIdentity) {
  const url = logoUrl(identity);
  if (!url) return '';
  return `<br /><br /><img src="${escapeHtml(url)}" alt="Logo" width="160" style="display:block;max-width:160px;height:auto;border:0;outline:none;text-decoration:none;" />`;
}

export function signatureText(identity: SignatureIdentity) {
  const fallback = rawIdentity(identity);
  const rawText = String(identity.signature_text || fallback.signature_text || '').trim();
  if (rawText) return rawText;
  return htmlToText(String(identity.signature_html || fallback.signature_html || ''));
}

export function signatureHtml(identity: SignatureIdentity) {
  const fallback = rawIdentity(identity);
  const rawHtml = String(identity.signature_html || fallback.signature_html || '').trim();
  if (rawHtml) return `${rawHtml}${logoHtml(identity)}`;
  const text = signatureText(identity);
  return text ? `${textToHtml(text)}${logoHtml(identity)}` : logoHtml(identity).replace(/^<br \/><br \/>/, '');
}

export function shouldAppendSignature(identity: SignatureIdentity) {
  const fallback = rawIdentity(identity);
  const enabled = identity.signature_enabled !== undefined && identity.signature_enabled !== null ? identity.signature_enabled : fallback.signature_enabled;
  return enabled !== false && Boolean(signatureText(identity) || signatureHtml(identity) || logoUrl(identity));
}

export function appendSignatureToText(body: string, identity: SignatureIdentity) {
  const cleanBody = normalizeNewlines(body).trim();
  if (!shouldAppendSignature(identity)) return cleanBody;
  const sig = signatureText(identity);
  if (!sig) return cleanBody;
  if (cleanBody.includes(sig)) return cleanBody;
  return `${cleanBody}\n\n${sig}`.trim();
}

export function buildHtmlBody(body: string, identity: SignatureIdentity) {
  const bodyHtml = textToHtml(body);
  if (!shouldAppendSignature(identity)) return bodyHtml;
  const sig = signatureHtml(identity);
  if (!sig) return bodyHtml;
  return `${bodyHtml}<br /><br />${sig}`;
}

export function buildMimeMessage(input: { from: string; to: string; subject: string; body: string; identity?: SignatureIdentity | null; replyTo?: string | null }) {
  const identity = input.identity || {};
  const boundary = `scout_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const textBody = appendSignatureToText(input.body, identity);
  const htmlBody = buildHtmlBody(input.body, identity);
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    ...(input.replyTo ? [`Reply-To: ${input.replyTo}`] : []),
    `Subject: ${input.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ];
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    textBody,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    htmlBody,
    `--${boundary}--`,
    ''
  ];
  return { raw: [...headers, '', ...parts].join('\r\n'), textBody, htmlBody };
}
