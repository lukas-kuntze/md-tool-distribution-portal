import type {
  AuditEntryDto,
  DeletionJobDto,
  ScopeDto,
  StorageOverviewDto,
  StorageReportDto,
} from '../../shared/types/api.js';
import { scopeQuery } from './access-service.js';
import { api, apiPage, type Page } from './api-client.js';

export interface AuditFilter {
  readonly action?: string;
  readonly outcome?: AuditEntryDto['outcome'];
  readonly from?: string;
  readonly to?: string;
  readonly limit: number;
  readonly offset: number;
}

export const operations = {
  auditLog: (scope: ScopeDto, filter: AuditFilter): Promise<Page<AuditEntryDto>> =>
    apiPage('/api/audit-logs', { ...scopeQuery(scope), ...filter }),
  deletionJobs: (states?: readonly string[]): Promise<DeletionJobDto[]> =>
    api.get('/api/deletion-jobs', { state: states?.join(',') }),
  retryDeletionJob: (jobId: string): Promise<DeletionJobDto> => api.post(`/api/deletion-jobs/${jobId}/retry`),
  purgeDeletionJobNow: (jobId: string): Promise<DeletionJobDto> => api.post(`/api/deletion-jobs/${jobId}/purge-now`),
  storage: (): Promise<StorageOverviewDto> => api.get('/api/storage'),
  reconcileStorage: (): Promise<StorageReportDto> => api.post('/api/storage/reconcile'),
};
