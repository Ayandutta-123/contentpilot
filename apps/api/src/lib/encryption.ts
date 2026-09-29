import crypto from 'crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  return crypto.createHash('sha256').update(config.ENCRYPTION_KEY).digest();
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decrypt(ciphertext: string): string {
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function generateSignedUrl(filePath: string, ttlSeconds?: number): string {
  const ttl = ttlSeconds ?? config.MEDIA_SIGNED_URL_TTL_SECONDS;
  const expires = Math.floor(Date.now() / 1000) + ttl;
  const signature = crypto
    .createHmac('sha256', config.SESSION_SECRET)
    .update(`${filePath}:${expires}`)
    .digest('hex');
  return `/api/media/${encodeURIComponent(filePath)}?expires=${expires}&sig=${signature}`;
}

export function verifySignedUrl(filePath: string, expires: number, signature: string): boolean {
  if (Math.floor(Date.now() / 1000) > expires) return false;
  const expected = crypto
    .createHmac('sha256', config.SESSION_SECRET)
    .update(`${filePath}:${expires}`)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
