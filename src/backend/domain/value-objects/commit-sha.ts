import { DomainError } from './domain-error.js';

declare const commitShaBrand: unique symbol;

/** Full, lowercase Git object name (SHA-1, or SHA-256 for repositories using the newer object format). */
export type CommitSha = string & { readonly [commitShaBrand]: 'CommitSha' };

const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function parseCommitSha(value: string): CommitSha {
  if (!COMMIT_SHA.test(value)) {
    throw new DomainError('invalid_commit_sha', 'Commit SHA must be a full lowercase hexadecimal object name.');
  }

  return value as CommitSha;
}
