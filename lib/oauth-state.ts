import { createHmac, timingSafeEqual } from 'crypto';

export type GmailOauthState = {
  workspace_id: string;
  user_id: string;
  return_to: string;
  created_at: number;
  nonce: string;
  authorization_mode: 'send_only_verification';
};

function secret() {
  return process.env.GOOGLE_CLIENT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

export function encodeOauthState(payload: GmailOauthState) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function decodeAndVerifyOauthState(value: string): GmailOauthState | null {
  try {
    const [body, signature] = String(value || '').split('.');
    if (!body || !signature || !secret()) return null;
    const expected = createHmac('sha256', secret()).update(body).digest('base64url');
    const suppliedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) return null;
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as GmailOauthState;
    if (!parsed.workspace_id || !parsed.user_id || !parsed.created_at || Date.now() - parsed.created_at > 15 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}
