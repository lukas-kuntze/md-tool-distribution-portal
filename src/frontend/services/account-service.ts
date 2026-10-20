import type { AccountDto, PreferencesDto } from '../../shared/types/api.js';
import { api } from './api-client.js';

export const account = {
  get: (): Promise<AccountDto> => api.get('/api/account'),
  savePreferences: (changes: Partial<PreferencesDto>): Promise<PreferencesDto> =>
    api.patch('/api/account/preferences', changes),
  endSession: (sessionId: string): Promise<undefined> => api.post(`/api/account/sessions/${sessionId}/revoke`),
  endAllSessions: (): Promise<undefined> => api.post('/api/account/sessions/revoke-all'),
};
