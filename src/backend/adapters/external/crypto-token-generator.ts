import { createHash, randomBytes } from 'node:crypto';

import type { IssuedToken, TokenGenerator } from '../../domain/ports/token-generator.js';

/** 256 random bits, URL-safe; stored only as SHA-256 hex digest. */
export class CryptoTokenGenerator implements TokenGenerator {
  public issue(): IssuedToken {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  public hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
