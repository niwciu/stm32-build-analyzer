import { randomBytes } from 'crypto';

export function createNonce(): string {
  return randomBytes(16).toString('hex');
}
