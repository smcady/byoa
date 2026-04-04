import crypto from 'node:crypto';

const TOKEN_PREFIX = 'agora_tok_';

export function generateToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(24).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
