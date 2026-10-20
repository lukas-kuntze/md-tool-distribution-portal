import { defaultOidcIssuer } from '../adapters/external/github-oidc-verifier.js';
import { z } from 'zod';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

const list = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(/[,;]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

const ENVIRONMENT = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  PUBLIC_URL: z.url(),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  DATABASE_PATH: z.string().min(1),
  STORAGE_ROOT: z.string().min(1),
  /** Directories served by IIS; the storage root must not overlap with any of them. */
  SERVED_AREAS: list,

  /** `https://github.com` or a GitHub Enterprise host. */
  GITHUB_WEB_URL: z.url().default('https://github.com'),
  /** Only needed when the API does not follow the usual scheme, see `defaultApiUrl`. */
  GITHUB_API_URL: z.url().optional(),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_ORGANIZATION: z.string().min(1),
  /** Issuer of GitHub Actions OIDC tokens; derived from `GITHUB_WEB_URL`, see `defaultOidcIssuer`. */
  CI_OIDC_ISSUER: z.url().optional(),
  /** Audience the GitHub Action requests; the origin of `PUBLIC_URL` unless set. */
  CI_OIDC_AUDIENCE: z.string().min(1).optional(),
  /** Numeric GitHub user ids, never logins: logins can be renamed and re-registered by someone else. */
  BOOTSTRAP_ADMIN_GITHUB_IDS: list.pipe(z.array(z.string().regex(/^\d+$/, 'Expected numeric GitHub user ids.'))),

  /** Signs iOS installation links; at least 32 random characters, e.g. `openssl rand -base64 48`. */
  INSTALL_LINK_SECRET: z.string().min(32),
  INSTALL_LINK_MINUTES: z.coerce.number().positive().default(10),

  /** Largest accepted artifact; IIS `maxAllowedContentLength` must allow at least as much (E13). */
  UPLOAD_MAX_MEGABYTES: z.coerce.number().int().positive().max(4096).default(2048),

  SESSION_ABSOLUTE_HOURS: z.coerce.number().positive().default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().positive().default(120),
  QUARANTINE_RETENTION_DAYS: z.coerce.number().positive().default(7),
  WORKER_POLL_SECONDS: z.coerce.number().positive().default(30),
  WORKER_LEASE_MINUTES: z.coerce.number().positive().default(15),
  /** Interval of the database-to-file-system reconciliation run by the worker (concept 5.6). */
  RECONCILE_HOURS: z.coerce.number().positive().default(24),
});

export interface Configuration {
  readonly host: string;
  readonly port: number;
  readonly publicUrl: string;
  readonly trustProxy: boolean;
  readonly databasePath: string;
  readonly storageRoot: string;
  readonly servedAreas: readonly string[];
  readonly gitHub: {
    readonly webUrl: string;
    readonly apiUrl: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly organization: string;
  };
  readonly ci: { readonly issuer: string; readonly audience: string };
  readonly bootstrapAdminGitHubIds: ReadonlySet<string>;
  readonly session: { readonly absoluteMs: number; readonly idleMs: number };
  readonly installLink: { readonly secret: string; readonly lifetimeMs: number };
  readonly maxUploadBytes: number;
  readonly quarantineRetentionMs: number;
  readonly worker: { readonly pollMs: number; readonly leaseMs: number; readonly reconcileMs: number };
}

/**
 * REST API base derived from the web address: github.com and GHE.com data residency (`*.ghe.com`) use an `api.`
 * subdomain, GitHub Enterprise Server serves the API under `/api/v3`.
 */
export function defaultApiUrl(webUrl: string): string {
  const { origin, host } = new URL(webUrl);

  if (host === 'github.com' || host.endsWith('.ghe.com')) {
    return `https://api.${host}`;
  }

  return `${origin}/api/v3`;
}

/**
 * The only place that reads environment variables. Invalid configuration stops the process at startup with
 * the names of the offending variables, never their values (they may be secrets).
 */
export function loadConfiguration(environment: NodeJS.ProcessEnv = process.env): Configuration {
  const result = ENVIRONMENT.safeParse(environment);

  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))].sort();
    throw new Error(`Invalid configuration: ${names.join(', ')}`);
  }

  const env = result.data;

  return {
    host: env.HOST,
    port: env.PORT,
    publicUrl: new URL(env.PUBLIC_URL).origin,
    trustProxy: env.TRUST_PROXY,
    databasePath: env.DATABASE_PATH,
    storageRoot: env.STORAGE_ROOT,
    servedAreas: env.SERVED_AREAS,
    gitHub: {
      webUrl: env.GITHUB_WEB_URL,
      apiUrl: env.GITHUB_API_URL ?? defaultApiUrl(env.GITHUB_WEB_URL),
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      organization: env.GITHUB_ORGANIZATION,
    },
    ci: {
      issuer: env.CI_OIDC_ISSUER ?? defaultOidcIssuer(env.GITHUB_WEB_URL),
      audience: env.CI_OIDC_AUDIENCE ?? new URL(env.PUBLIC_URL).origin,
    },
    bootstrapAdminGitHubIds: new Set(env.BOOTSTRAP_ADMIN_GITHUB_IDS),
    session: { absoluteMs: env.SESSION_ABSOLUTE_HOURS * HOUR, idleMs: env.SESSION_IDLE_MINUTES * 60_000 },
    installLink: { secret: env.INSTALL_LINK_SECRET, lifetimeMs: env.INSTALL_LINK_MINUTES * 60_000 },
    maxUploadBytes: env.UPLOAD_MAX_MEGABYTES * 1024 * 1024,
    quarantineRetentionMs: env.QUARANTINE_RETENTION_DAYS * DAY,
    worker: {
      pollMs: env.WORKER_POLL_SECONDS * 1000,
      leaseMs: env.WORKER_LEASE_MINUTES * 60_000,
      reconcileMs: env.RECONCILE_HOURS * HOUR,
    },
  };
}
