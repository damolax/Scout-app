import crypto from 'node:crypto';

type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  tag: string;
};

function keyMaterial() {
  const value = String(process.env.SCOUT_CREDENTIAL_ENCRYPTION_KEY || process.env.SCHEDULE_WORKER_SECRET || '').trim();
  if (value.length < 24) {
    throw new Error('SCOUT_CREDENTIAL_ENCRYPTION_KEY must be set to a long random secret before SMTP senders can be stored.');
  }
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

export function encryptSenderSecret(secret: string): EncryptedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial(), iv);
  const encrypted = Buffer.concat([cipher.update(String(secret || ''), 'utf8'), cipher.final()]);
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptSenderSecret(input: EncryptedSecret) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    keyMaterial(),
    Buffer.from(input.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(input.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(input.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
