import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nextId } from '../adapters/persistence/testing/sqlite-fixtures.js';
import type { Release } from '../domain/entities/release.js';
import type { Stored } from '../domain/ports/stored.js';
import { submitReleaseDeletion, type SubmitReleaseDeletionInput } from './submit-release-deletion.js';
import { auditActions, createDeletionScenario, type DeletionScenario } from './testing/deletion-scenario.js';

const errorCode = (code: string): unknown => expect.objectContaining({ code });

describe('submitReleaseDeletion', (): void => {
  let scenario: DeletionScenario;

  beforeEach(async (): Promise<void> => {
    scenario = await createDeletionScenario();
  });

  afterEach(async (): Promise<void> => {
    await scenario.cleanup();
  });

  const submit = (overrides: Partial<SubmitReleaseDeletionInput> = {}): ReturnType<typeof submitReleaseDeletion> =>
    submitReleaseDeletion(
      { unitOfWork: scenario.test.unitOfWork, clock: scenario.clock, ids: scenario.ids },
      {
        actor: scenario.actor,
        request: scenario.request,
        releaseId: scenario.release.id,
        expectedRowVersion: 1,
        confirmation: scenario.confirmation,
        reason: 'Absturz beim Start',
        ...overrides,
      },
    );

  const currentRelease = (): Stored<Release> | null =>
    scenario.test.unitOfWork.read(({ releases }) => releases.findById(scenario.release.id));

  it('hides the release and queues a deletion job with a snapshot of its files', (): void => {
    const { deletionJobId } = submit();
    const job = scenario.test.unitOfWork.read(({ deletionJobs }) => deletionJobs.findById(deletionJobId))?.value;

    expect(
      scenario.test.unitOfWork.read(({ releases }) => releases.findById(scenario.release.id))?.value,
    ).toMatchObject({
      lifecycleState: 'pending_deletion',
      deletionRequestedBy: scenario.actor.userId,
    });
    expect(job).toMatchObject({ state: 'requested', reason: 'Absturz beim Start', requestedBy: scenario.actor.userId });
    expect(job?.artifactSnapshot.map((entry) => entry.storageKey)).toEqual(
      scenario.artifacts.map((artifact) => artifact.storageKey),
    );
    expect(auditActions(scenario)).toEqual(['release.delete.requested:success']);
  });

  it('refuses users without the delete permission and records the attempt', async (): Promise<void> => {
    await scenario.cleanup();
    scenario = await createDeletionScenario('developer');

    expect(() => submit()).toThrow(errorCode('permission_denied'));
    expect(
      scenario.test.unitOfWork.read(({ releases }) => releases.findById(scenario.release.id))?.value.lifecycleState,
    ).toBe('active');
    expect(auditActions(scenario)).toEqual(['authz.denied:denied']);
  });

  it.each([
    ['a wrong confirmation', { confirmation: 'yes' }, 'confirmation_mismatch'],
    ['an outdated version', { expectedRowVersion: 0 }, 'concurrent_modification'],
    ['a missing reason', { reason: '  ' }, 'reason_required'],
    ['an unknown release', { releaseId: nextId<'Release'>() }, 'release_not_found'],
  ] as const)('changes nothing on %s', (_case, overrides, code): void => {
    expect(() => submit(overrides)).toThrow(errorCode(code));
    expect(currentRelease()).toMatchObject({ value: { lifecycleState: 'active' }, rowVersion: 1 });
    expect(auditActions(scenario)).toEqual([]);
  });

  it('cannot request the deletion twice', (): void => {
    submit();

    expect(() => submit({ expectedRowVersion: 2 })).toThrow(errorCode('invalid_release_state'));
  });
});
