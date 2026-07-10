export type SignatureIdentity = {
  signature_enabled?: boolean | null;
  signature_text?: string | null;
  signature_html?: string | null;
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

export function signatureText(identity: SignatureIdentity) {
  const rawText = String(identity.signature_text || '').trim();
  if (rawText) return rawText;
  return htmlToText(String(identity.signature_html || ''));
}

export function signatureHtml(identity: SignatureIdentity) {
  const rawHtml = String(identity.signature_html || '').trim();
  if (rawHtml) return rawHtml;
  const text = signatureText(identity);
  return text ? textToHtml(text) : '';
}

export function shouldAppendSignature(identity: SignatureIdentity) {
  return identity.signature_enabled !== false && Boolean(signatureText(identity) || signatureHtml(identity));
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
