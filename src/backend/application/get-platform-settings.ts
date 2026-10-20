import { authorizedRead, GLOBAL_TARGET } from './authorization.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';

/**
 * The configuration the platform runs with, as far as it helps operating it. Secrets (OAuth client secret,
 * install link secret) never appear here, not even in part.
 */
export interface PlatformSettings {
  readonly version: string;
  readonly nodeVersion: string;
  readonly publicUrl: string;
  readonly gitHub: { readonly webUrl: string; readonly apiUrl: string; readonly organization: string };
  readonly bootstrapAdministrators: number;
  readonly ci: { readonly issuer: string; readonly audience: string };
  readonly storage: {
    readonly databasePath: string;
    readonly storageRoot: string;
    readonly servedAreas: readonly string[];
  };
  readonly limits: {
    readonly maxUploadBytes: number;
    readonly quarantineRetentionMs: number;
    readonly installLinkLifetimeMs: number;
    readonly sessionAbsoluteMs: number;
    readonly sessionIdleMs: number;
  };
  readonly worker: { readonly pollMs: number; readonly leaseMs: number; readonly reconcileMs: number };
}

/** Read-only view of the platform configuration for operators (`storage.manage` at platform scope). */
export function getPlatformSettings(
  dependencies: Pick<UseCaseDependencies, 'unitOfWork' | 'clock'> & { readonly settings: PlatformSettings },
  actor: Actor,
  request: RequestContext,
): PlatformSettings {
  return authorizedRead(contextOf(dependencies, actor, request), (_repositories, guard) => {
    guard.require('storage.manage', GLOBAL_TARGET, { type: 'platform_settings', id: null });
    return dependencies.settings;
  });
}
