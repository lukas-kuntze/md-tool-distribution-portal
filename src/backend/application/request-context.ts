import type { UserId } from '../domain/value-objects/identifier.js';

/** The authenticated user behind a request. `label` is the GitHub login at the time of the request. */
export interface Actor {
  readonly userId: UserId;
  readonly label: string;
}

/** Request metadata recorded in the audit log. */
export interface RequestContext {
  readonly correlationId: string | null;
  readonly clientIp: string | null;
  readonly userAgent: string | null;
}
