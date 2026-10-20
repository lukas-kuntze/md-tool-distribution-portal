import type { AccessRepository } from './access-repository.js';
import type { ApplicationRepository } from './application-repository.js';
import type { AuditLog } from './audit-log.js';
import type { CiBindingRepository } from './ci-binding-repository.js';
import type { DeletionJobRepository } from './deletion-job-repository.js';
import type { ProjectRepository } from './project-repository.js';
import type { ReleaseRepository } from './release-repository.js';
import type { SessionRepository } from './session-repository.js';
import type { ShareLinkRepository } from './share-link-repository.js';
import type { StatisticsQueries } from './statistics-queries.js';
import type { SettingsRepository } from './settings-repository.js';
import type { StorageReportRepository } from './storage-report-repository.js';
import type { UserRepository } from './user-repository.js';

export interface Repositories {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly projects: ProjectRepository;
  readonly applications: ApplicationRepository;
  readonly releases: ReleaseRepository;
  readonly deletionJobs: DeletionJobRepository;
  readonly access: AccessRepository;
  readonly shareLinks: ShareLinkRepository;
  readonly ciBindings: CiBindingRepository;
  readonly statistics: StatisticsQueries;
  readonly storageReports: StorageReportRepository;
  readonly settings: SettingsRepository;
  readonly auditLog: AuditLog;
}

/**
 * Runs work against the repositories inside one database transaction: everything is committed together
 * or not at all. The work is synchronous on purpose — the embedded database executes statements
 * synchronously, and keeping a transaction open across `await` would let unrelated requests write into it.
 * File system operations therefore never happen inside `transaction`.
 */
export interface UnitOfWork {
  /** Read-write transaction that takes the write lock immediately. */
  transaction<Result>(work: (repositories: Repositories) => Result): Result;
  /** Consistent read without taking the write lock. */
  read<Result>(work: (repositories: Repositories) => Result): Result;
}
