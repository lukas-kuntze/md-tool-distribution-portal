import type { BrandingDto, SettingPresetsDto, SettingsDto } from '../../shared/types/api.js';
import { api } from './api-client.js';

let branding: Promise<BrandingDto> | null = null;

export const settingsService = {
  get: (): Promise<SettingsDto> => api.get('/api/settings'),
  save: (settings: SettingsDto): Promise<SettingsDto> => api.put('/api/settings', settings),
  presets: (): Promise<SettingPresetsDto> => api.get('/api/settings/presets'),
  /** Public and the same for every page; loaded once per page. */
  branding: (): Promise<BrandingDto> => (branding ??= api.get('/public/branding')),
};

/** Forgets the loaded branding; for tests that switch between settings. */
export function resetBranding(): void {
  branding = null;
}
