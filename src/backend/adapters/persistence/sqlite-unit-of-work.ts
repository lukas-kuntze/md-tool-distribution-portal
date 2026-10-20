import type { Database } from 'better-sqlite3';

import type { Repositories, UnitOfWork } from '../../domain/ports/unit-of-work.js';
import { SqliteAccessRepository } from './sqlite-access-repository.js';
import { SqliteApplicationRepository } from './sqlite-application-repository.js';
import { SqliteAuditLog } from './sqlite-audit-log.js';
import { SqliteCiBindingRepository } from './sqlite-ci-binding-repository.js';
import { SqliteDeletionJobRepository } from './sqlite-deletion-job-repository.js';
import { SqliteProjectRepository } from './sqlite-project-repository.js';
import { SqliteReleaseRepository } from './sqlite-release-repository.js';
import { SqliteSessionRepository } from './sqlite-session-repository.js';
import { SqliteShareLinkRepository } from './sqlite-share-link-repository.js';
import { SqliteStatisticsQueries } from './sqlite-statistics-queries.js';
import { SqliteSettingsRepository } from './sqlite-settings-repository.js';
import { SqliteStorageReportRepository } from './sqlite-storage-report-repository.js';
import { SqliteUserRepository } from './sqlite-user-repository.js';

export class SqliteUnitOfWork implements UnitOfWork {
  private readonly repositories: Repositories;

  public constructor(private readonly database: Database) {
    this.repositories = {
      users: new SqliteUserRepository(database),
      sessions: new SqliteSessionRepository(database),
      projects: new SqliteProjectRepository(database),
      applications: new SqliteApplicationRepository(database),
      releases: new SqliteReleaseRepository(database),
      deletionJobs: new SqliteDeletionJobRepository(database),
      access: new SqliteAccessRepository(database),
      shareLinks: new SqliteShareLinkRepository(database),
      ciBindings: new SqliteCiBindingRepository(database),
      statistics: new SqliteStatisticsQueries(database),
      storageReports: new SqliteStorageReportRepository(database),
      settings: new SqliteSettingsRepository(database),
      auditLog: new SqliteAuditLog(database),
    };
  }

  public transaction<Result>(work: (repositories: Repositories) => Result): Result {
    // BEGIN IMMEDIATE takes the write lock up front, so a transaction never fails half-way on a busy database.
    return this.database.transaction(() => work(this.repositories)).immediate();
  }

  public read<Result>(work: (repositories: Repositories) => Result): Result {
    return this.database.transaction(() => work(this.repositories)).deferred();
  }
}
