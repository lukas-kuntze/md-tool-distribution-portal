import { DomainError } from '../value-objects/domain-error.js';
import type { ApplicationId, CiBindingId, UserId } from '../value-objects/identifier.js';

export const REF_PATTERN_MAX_LENGTH = 255;
export const ENVIRONMENT_MAX_LENGTH = 255;

/** `owner/name` as GitHub spells repositories; both parts consist of letters, digits, `-`, `_` and `.`. */
const REPOSITORY_NAME = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

/** Branches and tags only; `*` stands for any characters except `/`, `**` for any characters. */
const REF_PATTERN = /^refs\/(heads|tags)\/[A-Za-z0-9_.\-/*]+$/;

/**
 * Allows the workflows of one repository to upload builds into one application (concept 4.7). A job proves
 * where it runs with its OIDC token; the binding names the repository by its numeric id, which survives
 * renames and cannot be taken over by a new repository of the same name, and restricts branch or tag and,
 * optionally, the deployment environment.
 */
export interface CiBinding {
  readonly id: CiBindingId;
  readonly applicationId: ApplicationId;
  readonly repositoryId: number;
  /** `owner/name` when the binding was created; for display only, never for the check. */
  readonly repositoryName: string;
  /** E.g. `refs/heads/main` or `refs/tags/v*`. */
  readonly refPattern: string;
  /** When set, only jobs of this deployment environment are accepted, e.g. one with required reviewers. */
  readonly environment: string | null;
  readonly createdAt: Date;
  readonly createdBy: UserId;
  readonly revokedAt: Date | null;
  readonly revokedBy: UserId | null;
}

export interface NewCiBinding {
  readonly id: CiBindingId;
  readonly applicationId: ApplicationId;
  readonly repositoryId: number;
  readonly repositoryName: string;
  readonly refPattern: string;
  readonly environment: string | null;
}

/** What the OIDC token of a job says about where it runs. */
export interface CiJobIdentity {
  readonly repositoryId: number;
  readonly repository: string;
  /** Full ref, e.g. `refs/heads/main`. */
  readonly ref: string;
  readonly environment: string | null;
}

export function createCiBinding(input: NewCiBinding, now: Date, actor: UserId): CiBinding {
  const repositoryName = input.repositoryName.trim();
  const refPattern = input.refPattern.trim();
  const environment = input.environment?.trim() ?? '';

  if (!Number.isSafeInteger(input.repositoryId) || input.repositoryId <= 0) {
    throw new DomainError('invalid_ci_binding', 'The repository id must be a positive whole number.');
  }

  if (!REPOSITORY_NAME.test(repositoryName)) {
    throw new DomainError('invalid_ci_binding', 'The repository must be given as owner/name.');
  }

  if (refPattern.length > REF_PATTERN_MAX_LENGTH || !REF_PATTERN.test(refPattern) || refPattern.includes('***')) {
    throw new DomainError(
      'invalid_ci_binding',
      'The ref pattern must start with refs/heads/ or refs/tags/ and may only use * and ** as wildcards.',
    );
  }

  if (environment.length > ENVIRONMENT_MAX_LENGTH) {
    throw new DomainError(
      'invalid_ci_binding',
      `The environment may have at most ${ENVIRONMENT_MAX_LENGTH} characters.`,
    );
  }

  return {
    id: input.id,
    applicationId: input.applicationId,
    repositoryId: input.repositoryId,
    repositoryName,
    refPattern,
    environment: environment === '' ? null : environment,
    createdAt: now,
    createdBy: actor,
    revokedAt: null,
    revokedBy: null,
  };
}

export function revokeCiBinding(binding: CiBinding, now: Date, actor: UserId): CiBinding {
  if (binding.revokedAt !== null) {
    throw new DomainError('ci_binding_not_found', 'The CI binding does not exist or was already revoked.');
  }

  return { ...binding, revokedAt: now, revokedBy: actor };
}

/** Whether two bindings accept exactly the same jobs; such a duplicate would add nothing. */
export function sameCiBinding(
  a: CiBinding,
  b: Pick<CiBinding, 'repositoryId' | 'refPattern' | 'environment'>,
): boolean {
  return a.repositoryId === b.repositoryId && a.refPattern === b.refPattern && a.environment === b.environment;
}

export function acceptsJob(binding: CiBinding, job: CiJobIdentity): boolean {
  return (
    binding.revokedAt === null &&
    binding.repositoryId === job.repositoryId &&
    matchesRefPattern(binding.refPattern, job.ref) &&
    (binding.environment === null || binding.environment === job.environment)
  );
}

export function matchesRefPattern(pattern: string, ref: string): boolean {
  const source = pattern
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*'),
    )
    .join('.*');

  return new RegExp(`^${source}$`).test(ref);
}
