import { z } from 'zod';

import { DomainError, type DomainErrorCode } from '../../domain/value-objects/domain-error.js';
import type { ApiErrorDto } from '../../../shared/types/api.js';

/** Request input that does not match its schema; reported with the offending paths, never the values. */
export class RequestValidationError extends Error {
  public constructor(public readonly issues: readonly { readonly path: string; readonly message: string }[]) {
    super('The request is invalid.');
    this.name = 'RequestValidationError';
  }
}

export function parseRequest<Schema extends z.ZodType>(schema: Schema, value: unknown): z.infer<Schema> {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new RequestValidationError(
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }

  return result.data;
}

const STATUS_BY_CODE: Partial<Record<DomainErrorCode, number>> = {
  unauthenticated: 401,
  ci_token_invalid: 401,
  ci_not_bound: 403,
  permission_denied: 403,
  privilege_escalation: 403,
  not_organization_member: 403,
  user_disabled: 403,
  concurrent_modification: 409,
  slug_taken: 409,
  build_number_taken: 409,
  bundle_identifier_taken: 409,
  flavor_key_taken: 409,
  artifact_exists: 409,
  deletion_already_requested: 409,
  role_already_assigned: 409,
  ci_binding_exists: 409,
  restore_failed: 409,
  upload_too_large: 413,
  unreadable_binary: 415,
  range_not_satisfiable: 416,
  install_link_invalid: 404,
  sign_in_failed: 502,
};

export interface HttpError {
  readonly status: number;
  readonly body: ApiErrorDto;
}

/** Maps an error to its HTTP representation; `null` for errors that are not the client's to see. */
export function toHttpError(error: unknown): HttpError | null {
  if (error instanceof RequestValidationError) {
    return { status: 400, body: { error: { code: 'invalid_request', message: error.message, issues: error.issues } } };
  }

  if (error instanceof DomainError) {
    const status = STATUS_BY_CODE[error.code] ?? (error.code.endsWith('_not_found') ? 404 : 422);
    return { status, body: { error: { code: error.code, message: error.message } } };
  }

  return null;
}
