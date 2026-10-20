import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  describeInstall,
  issueInstallLink,
  openInstallDownload,
  type InstallManifest,
} from '../../../application/install-ios-artifact.js';
import type { InstallLinkDto } from '../../../../shared/types/api.js';
import { rangeSelector, sendDownload } from '../download-response.js';
import { requestContextOf, requireSession, type HttpDependencies } from '../http-context.js';
import { parseRequest } from '../http-errors.js';
import { idOf } from '../schemas.js';

const ARTIFACT_PARAMS = z.object({ artifactId: idOf<'Artifact'>() });
const TOKEN_PARAMS = z.object({
  token: z
    .string()
    .max(1024)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
});

/**
 * iOS installation over `itms-services`. The page asks for a link with the session; the device then loads
 * manifest and IPA from `/install/<token>/…` without cookies. Both paths lie outside `/api/` on purpose.
 */
export function registerInstallRoutes(app: FastifyInstance, dependencies: HttpDependencies): void {
  app.post('/api/artifacts/:artifactId/install-link', (request): InstallLinkDto => {
    const { artifactId } = parseRequest(ARTIFACT_PARAMS, request.params);
    const link = issueInstallLink(dependencies, requireSession(request).actor, requestContextOf(request), {
      artifactId,
    });
    const manifestUrl = new URL(`/install/${link.token}/manifest.plist`, dependencies.publicUrl).toString();

    return {
      manifestUrl,
      installUrl: `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`,
      expiresAt: link.expiresAt.toISOString(),
    };
  });

  app.get('/install/:token/manifest.plist', async (request, reply) => {
    const { token } = parseRequest(TOKEN_PARAMS, request.params);
    const manifest = describeInstall(dependencies, token, requestContextOf(request));
    const ipaUrl = new URL(`/install/${token}/app.ipa`, dependencies.publicUrl).toString();

    return reply
      .header('content-type', 'text/xml; charset=utf-8')
      .header('cache-control', 'private, no-store')
      .send(manifestPlist(manifest, ipaUrl));
  });

  app.get('/install/:token/app.ipa', async (request, reply) => {
    const { token } = parseRequest(TOKEN_PARAMS, request.params);
    const download = await openInstallDownload(dependencies, token, requestContextOf(request), rangeSelector(request));

    return sendDownload(reply, download, 'application/octet-stream');
  });
}

export function manifestPlist(manifest: InstallManifest, ipaUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${xml(ipaUrl)}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${xml(manifest.bundleIdentifier)}</string>
        <key>bundle-version</key>
        <string>${xml(manifest.version)}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${xml(manifest.title)}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
