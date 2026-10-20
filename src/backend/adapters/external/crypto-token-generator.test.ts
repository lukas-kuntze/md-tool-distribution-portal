import { describe, expect, it } from 'vitest';

import { CryptoTokenGenerator } from './crypto-token-generator.js';

describe('CryptoTokenGenerator', (): void => {
  it('issues unguessable tokens together with their SHA-256 hash', (): void => {
    const generator = new CryptoTokenGenerator();
    const first = generator.issue();
    const second = generator.issue();

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.token).not.toBe(second.token);
    expect(first.hash).toBe(generator.hash(first.token));
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
