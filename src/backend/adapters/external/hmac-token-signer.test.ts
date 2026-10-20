import { describe, expect, it } from 'vitest';

import { HmacTokenSigner } from './hmac-token-signer.js';

const SECRET = 'a-signing-secret-of-at-least-32-characters';

describe('HmacTokenSigner', (): void => {
  it('returns the payload of an intact token', (): void => {
    const signer = new HmacTokenSigner(SECRET);
    const token = signer.sign('{"a":"Ä"}');

    expect(token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(signer.verify(token)).toBe('{"a":"Ä"}');
  });

  it('rejects changed payloads, foreign secrets and malformed tokens', (): void => {
    const signer = new HmacTokenSigner(SECRET);
    const [, signature] = signer.sign('original').split('.');
    const changed = `${Buffer.from('changed').toString('base64url')}.${signature ?? ''}`;

    expect(signer.verify(changed)).toBeNull();
    expect(new HmacTokenSigner(`${SECRET}-other`).verify(signer.sign('original'))).toBeNull();
    expect(signer.verify('no-separator')).toBeNull();
    expect(signer.verify('a.b.c')).toBeNull();
  });

  it('requires a long secret', (): void => {
    expect(() => new HmacTokenSigner('short')).toThrow('at least 32 characters');
  });
});
