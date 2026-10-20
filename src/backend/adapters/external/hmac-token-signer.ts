import { createHmac, timingSafeEqual } from 'node:crypto';

import type { TokenSigner } from '../../domain/ports/token-signer.js';

const MIN_SECRET_LENGTH = 32;

/** `<payload>.<signature>`, both base64url; the signature is an HMAC-SHA-256 over the encoded payload. */
export class HmacTokenSigner implements TokenSigner {
  private readonly secret: Buffer;

  public constructor(secret: string) {
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(`The signing secret needs at least ${MIN_SECRET_LENGTH} characters.`);
    }

    this.secret = Buffer.from(secret, 'utf8');
  }

  public sign(payload: string): string {
    const encoded = Buffer.from(payload, 'utf8').toString('base64url');
    return `${encoded}.${this.signatureOf(encoded).toString('base64url')}`;
  }

  public verify(token: string): string | null {
    const [encoded, signature, ...rest] = token.split('.');

    if (encoded === undefined || signature === undefined || rest.length > 0) {
      return null;
    }

    const expected = this.signatureOf(encoded);
    const actual = Buffer.from(signature, 'base64url');

    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return null;
    }

    return Buffer.from(encoded, 'base64url').toString('utf8');
  }

  private signatureOf(encoded: string): Buffer {
    return createHmac('sha256', this.secret).update(encoded).digest();
  }
}
