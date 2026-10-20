import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getBranding, getSettingPresets, getSettings, updateSettings } from '../../../application/manage-settings.js';
import type { Settings } from '../../../domain/entities/settings.js';
import type { Stored } from '../../../domain/ports/stored.js';
import type { BrandingDto, SettingPresetsDto, SettingsDto } from '../../../../shared/types/api.js';
import { requestContextOf, requireSession, type HttpDependencies } from '../http-context.js';
import { parseRequest } from '../http-errors.js';
import { rowVersion } from '../schemas.js';

const whole = z.number().int();
const days = whole.nullable();

/** Shape only; ranges and the rules between values are checked by the domain. */
const SETTINGS_BODY = z.object({
  rowVersion,
  quarantineDays: whole,
  sessionAbsoluteHours: whole,
  sessionIdleMinutes: whole,
  installLinkMinutes: whole,
  shareLinkDefaultDays: days,
  shareLinkMaxDays: days,
  shareLinkDefaultReleases: z.enum(['all', 'latest']),
  defaultVisibility: z.enum(['private', 'organization']),
  reconcileHours: whole,
  dashboardDownloadDays: whole,
  dashboardQuarantineDays: whole,
  dashboardShareExpiryDays: whole,
  portalName: z.string().max(200),
  supportContact: z.string().max(1000),
  publicNotice: z.string().max(5000),
  footerText: z.string().max(1000),
});

export function registerSettingsRoutes(app: FastifyInstance, dependencies: HttpDependencies): void {
  app.get('/api/settings', (request): SettingsDto =>
    presentSettings(getSettings(dependencies, requireSession(request).actor, requestContextOf(request))),
  );

  app.put('/api/settings', (request): SettingsDto => {
    const { rowVersion: expectedRowVersion, ...settings } = parseRequest(SETTINGS_BODY, request.body);
    return presentSettings(
      updateSettings(dependencies, requireSession(request).actor, requestContextOf(request), {
        settings,
        expectedRowVersion,
      }),
    );
  });

  app.get('/api/settings/presets', (request): SettingPresetsDto =>
    getSettingPresets(dependencies, requireSession(request).actor, requestContextOf(request)),
  );

  // Public: the share page and the sign-in page show name and texts of the portal without a session.
  app.get('/public/branding', (): BrandingDto => getBranding(dependencies.unitOfWork));
}

function presentSettings({ value, rowVersion: version }: Stored<Settings>): SettingsDto {
  return { ...value, rowVersion: version };
}
