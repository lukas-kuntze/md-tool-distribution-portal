import { describe, expect, it } from 'vitest';

import { parseCommitSha } from './commit-sha.js';

describe('parseCommitSha', (): void => {
  it('accepts SHA-1 and SHA-256 object names', (): void => {
    expect(parseCommitSha('a'.repeat(40))).toHaveLength(40);
    expect(parseCommitSha('b'.repeat(64))).toHaveLength(64);
  });

  it.each(['abc123', 'A'.repeat(40), 'g'.repeat(40)])('rejects %s', (value): void => {
    expect((): string => parseCommitSha(value)).toThrow(expect.objectContaining({ code: 'invalid_commit_sha' }));
  });
});
