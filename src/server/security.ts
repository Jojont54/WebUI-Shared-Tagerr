import crypto from 'node:crypto';

const devSecret = 'tagarr-development-secret-change-in-production';
const appSecret = process.env.APP_SECRET || devSecret;

if (process.env.NODE_ENV === 'production' && appSecret === devSecret) {
  throw new Error('APP_SECRET doit être défini en production.');
}

const encryptionKey = crypto.scryptSync(appSecret, 'tagarr-config-v1', 32);

export function encrypt(value: string): string {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decrypt(value: string): string {
  if (!value) return '';
  const [ivPart, tagPart, dataPart] = value.split('.');
  if (!ivPart || !tagPart || !dataPart) throw new Error('Secret chiffré invalide.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function signSession(payload: object, maxAgeSeconds = 7 * 24 * 60 * 60): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + maxAgeSeconds })).toString('base64url');
  const signature = crypto.createHmac('sha256', appSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifySession<T>(token?: string): T | undefined {
  if (!token) return undefined;
  const [body, signature] = token.split('.');
  if (!body || !signature) return undefined;
  const expected = crypto.createHmac('sha256', appSecret).update(body).digest();
  const received = Buffer.from(signature, 'base64url');
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
    return payload.exp > Math.floor(Date.now() / 1000) ? payload : undefined;
  } catch {
    return undefined;
  }
}
