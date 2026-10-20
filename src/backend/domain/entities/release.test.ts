import { describe, expect, it } from 'vitest';

import { parseBuildNumber } from '../value-objects/build-number.js';
import { parseCommitSha } from '../value-objects/commit-sha.js';
import { parseId } from '../value-objects/identifier.js';
import { parseVersion } from '../value-objects/version.js';
import {
  assertArtifactAcceptable,
  assertDeletionConfirmed,
  cancelReleaseDeletion,
  createRelease,
  deletionConfirmationPhrase,
  isDownloadable,
  markReleasePurged,
  markReleaseQuarantined,
  missingPlatforms,
  publishRelease,
  releaseBuildNumber,
  requestReleaseDeletion,
  restoreRelease,
  RELEASE_TEXT_MAX_LENGTH,
  updateReleaseTexts,
  withdrawRelease,
  type ArtifactOrigin,
  type Release,
  type ReleaseMetadata,
} from './release.js';

const now = new Date('2026-10-17T10:00:00Z');
const commit = parseCommitSha('a'.repeat(40));
const actor = parseId<'User'>('0192f3a4-0000-7000-8000-000000000001');
const decision = { at: now, by: actor, reason: 'Build was replaced by a hotfix with the same number.' };

const metadata: ReleaseMetadata = {
  releaseNotes: 'Fehlerbehebungen',
  changelog: '',
  gitRepository: 'md/k-mobile',
  gitBranch: 'main',
  gitTag: 'v4.13.0',
  workflowRun: { id: 4711, attempt: 1, url: 'https://github.example.com/md/k-mobile/actions/runs/4711' },
  importedFrom: null,
};

function draft(overrides: Partial<Parameters<typeof createRelease>[0]> = {}): Release {
  return createRelease({
    id: parseId('0192f3a4-0000-7000-8000-000000000100'),
    applicationId: parseId('0192f3a4-0000-7000-8000-000000000020'),
    flavorId: parseId('0192f3a4-0000-7000-8000-000000000030'),
    version: parseVersion('4.13.0'),
    buildNumber: parseBuildNumber(125),
    requiredPlatforms: ['ios', 'android'],
    gitCommitSha: commit,
    metadata,
    ...overrides,
  });
}

function origin(overrides: Partial<ArtifactOrigin> = {}): ArtifactOrigin {
  return {
    kind: 'apk',
    version: parseVersion('4.13.0'),
    buildNumber: parseBuildNumber(125),
    gitCommitSha: commit,
    ...overrides,
  };
}

function published(): Release {
  return publishRelease(draft(), ['apk', 'ipa'], now, actor);
}

const errorCode = (code: string): unknown => expect.objectContaining({ code });

describe('createRelease', (): void => {
  it('creates an active, unpublished draft that reserves its build number', (): void => {
    expect(draft()).toMatchObject({
      publicationStatus: 'draft',
      lifecycleState: 'active',
      buildNumberReserved: true,
      requiredPlatforms: ['android', 'ios'],
    });
  });

  it('deduplicates the required platforms', (): void => {
    expect(draft({ requiredPlatforms: ['ios', 'ios'] }).requiredPlatforms).toEqual(['ios']);
  });

  it('requires at least one platform', (): void => {
    expect((): Release => draft({ requiredPlatforms: [] })).toThrow(errorCode('invalid_required_platforms'));
  });

  it('limits the length of release notes', (): void => {
    expect((): Release =>
      draft({ metadata: { ...metadata, releaseNotes: 'x'.repeat(RELEASE_TEXT_MAX_LENGTH + 1) } }),
    ).toThrow(errorCode('invalid_release_notes'));
  });
});

describe('updateReleaseTexts', (): void => {
  it('changes release notes and changelog but keeps the origin', (): void => {
    const updated = updateReleaseTexts(draft(), { releaseNotes: 'Neu', changelog: '- fix' });

    expect(updated.metadata).toEqual({ ...metadata, releaseNotes: 'Neu', changelog: '- fix' });
  });

  it('rejects texts that are too long and releases that are being deleted', (): void => {
    expect((): Release => updateReleaseTexts(draft(), { changelog: 'x'.repeat(RELEASE_TEXT_MAX_LENGTH + 1) })).toThrow(
      errorCode('invalid_release_notes'),
    );
    expect((): Release => updateReleaseTexts(requestReleaseDeletion(draft(), now, actor), { changelog: '' })).toThrow(
      errorCode('invalid_release_state'),
    );
  });
});

describe('assertArtifactAcceptable', (): void => {
  it('accepts artifacts of every required platform built from the same state', (): void => {
    expect((): void => assertArtifactAcceptable(draft(), origin({ kind: 'apk' }))).not.toThrow();
    expect((): void => assertArtifactAcceptable(draft(), origin({ kind: 'ipa' }))).not.toThrow();
    expect((): void => assertArtifactAcceptable(draft(), origin({ kind: 'metadata' }))).not.toThrow();
  });

  it('rejects artifacts of a different version, build number or commit', (): void => {
    expect((): void => assertArtifactAcceptable(draft(), origin({ version: parseVersion('4.13.1') }))).toThrow(
      errorCode('artifact_version_mismatch'),
    );
    expect((): void => assertArtifactAcceptable(draft(), origin({ buildNumber: parseBuildNumber(126) }))).toThrow(
      errorCode('artifact_build_number_mismatch'),
    );
    expect((): void =>
      assertArtifactAcceptable(draft(), origin({ gitCommitSha: parseCommitSha('b'.repeat(40)) })),
    ).toThrow(errorCode('artifact_commit_mismatch'));
  });

  it('rejects artifacts of a platform the release does not cover', (): void => {
    expect((): void =>
      assertArtifactAcceptable(draft({ requiredPlatforms: ['ios'] }), origin({ kind: 'aab' })),
    ).toThrow(errorCode('platform_not_required'));
  });

  it('locks platform builds once the release is published but still accepts debug symbols', (): void => {
    expect((): void => assertArtifactAcceptable(published(), origin({ kind: 'apk' }))).toThrow(
      errorCode('artifact_locked_after_publication'),
    );
    expect((): void => assertArtifactAcceptable(published(), origin({ kind: 'dsym' }))).not.toThrow();
  });

  it('rejects artifacts for a release that is being deleted', (): void => {
    expect((): void => assertArtifactAcceptable(requestReleaseDeletion(draft(), now, actor), origin())).toThrow(
      errorCode('invalid_release_state'),
    );
  });
});

describe('publishing', (): void => {
  it('lists the platforms that still lack a build', (): void => {
    expect(missingPlatforms(draft(), [])).toEqual(['android', 'ios']);
    expect(missingPlatforms(draft(), ['ipa', 'dsym', 'mapping'])).toEqual(['android']);
    expect(missingPlatforms(draft(), ['aab', 'ipa'])).toEqual([]);
  });

  it('refuses to publish an incomplete release', (): void => {
    expect((): Release => publishRelease(draft(), ['ipa'], now, actor)).toThrow(errorCode('release_incomplete'));
  });

  it('publishes a complete release and makes it downloadable', (): void => {
    const release = published();

    expect(release).toMatchObject({ publicationStatus: 'published', publishedAt: now, publishedBy: actor });
    expect(isDownloadable(release)).toBe(true);
    expect(isDownloadable(draft())).toBe(false);
  });

  it('does not publish twice', (): void => {
    expect((): Release => publishRelease(published(), ['apk', 'ipa'], now, actor)).toThrow(
      errorCode('invalid_release_state'),
    );
  });

  it('withdraws published releases only', (): void => {
    expect(withdrawRelease(published()).publicationStatus).toBe('withdrawn');
    expect((): Release => withdrawRelease(draft())).toThrow(errorCode('invalid_release_state'));
  });
});

describe('deletion confirmation', (): void => {
  const subject = {
    applicationSlug: 'k-mobile',
    flavorKey: 'production',
    version: parseVersion('4.13.0'),
    buildNumber: parseBuildNumber(125),
  };

  it('names application, flavor, version and build number', (): void => {
    expect(deletionConfirmationPhrase(subject)).toBe('k-mobile/production 4.13.0 (125)');
  });

  it('omits the flavor while the application does not use flavors', (): void => {
    expect(deletionConfirmationPhrase({ ...subject, applicationSlug: 'doku-airpad', flavorKey: null })).toBe(
      'doku-airpad 4.13.0 (125)',
    );
  });

  it('accepts the exact phrase and rejects anything else', (): void => {
    expect((): void => assertDeletionConfirmed(subject, ' k-mobile/production 4.13.0 (125) ')).not.toThrow();
    expect((): void => assertDeletionConfirmed(subject, 'k-mobile 4.13.0 (125)')).toThrow(
      errorCode('confirmation_mismatch'),
    );
  });
});

describe('deletion lifecycle', (): void => {
  it('takes a release through pending deletion and quarantine to purged', (): void => {
    const pending = requestReleaseDeletion(published(), now, actor);
    const quarantined = markReleaseQuarantined(pending);
    const purged = markReleasePurged(quarantined, now);

    expect(pending).toMatchObject({
      lifecycleState: 'pending_deletion',
      deletionRequestedAt: now,
      deletionRequestedBy: actor,
    });
    expect(isDownloadable(pending)).toBe(false);
    expect(quarantined.lifecycleState).toBe('quarantined');
    expect(purged).toMatchObject({ lifecycleState: 'purged', purgedAt: now, buildNumberReserved: true });
  });

  it('only deletes active releases', (): void => {
    expect((): Release => requestReleaseDeletion(requestReleaseDeletion(draft(), now, actor), now, actor)).toThrow(
      errorCode('invalid_release_state'),
    );
  });

  it('can cancel a deletion that has not reached quarantine', (): void => {
    expect(cancelReleaseDeletion(requestReleaseDeletion(draft(), now, actor))).toMatchObject({
      lifecycleState: 'active',
      deletionRequestedAt: null,
    });
  });

  it('restores a published release as withdrawn and a draft as draft', (): void => {
    const restore = (release: Release): Release =>
      restoreRelease(markReleaseQuarantined(requestReleaseDeletion(release, now, actor)));

    expect(restore(published())).toMatchObject({ lifecycleState: 'active', publicationStatus: 'withdrawn' });
    expect(restore(draft()).publicationStatus).toBe('draft');
  });

  it('cannot restore a purged release', (): void => {
    const purged = markReleasePurged(markReleaseQuarantined(requestReleaseDeletion(draft(), now, actor)), now);

    expect((): Release => restoreRelease(purged)).toThrow(errorCode('invalid_release_state'));
  });
});

describe('releaseBuildNumber', (): void => {
  const quarantined = markReleaseQuarantined(requestReleaseDeletion(draft(), now, actor));

  it('frees the build number of a purged release once', (): void => {
    const released = releaseBuildNumber(markReleasePurged(quarantined, now), {
      ...decision,
      reason: ` ${decision.reason} `,
    });

    expect(released).toMatchObject({ buildNumberReserved: false, buildNumberRelease: decision });
    expect((): Release => releaseBuildNumber(released, decision)).toThrow(errorCode('invalid_release_state'));
  });

  it('requires a reason', (): void => {
    expect((): Release =>
      releaseBuildNumber(markReleasePurged(quarantined, now), { ...decision, reason: '  ' }),
    ).toThrow(errorCode('reason_required'));
  });

  it('keeps the build number of a quarantined release reserved', (): void => {
    expect((): Release => releaseBuildNumber(quarantined, decision)).toThrow(errorCode('invalid_release_state'));
  });
});
