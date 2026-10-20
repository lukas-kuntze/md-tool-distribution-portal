import { beforeEach, describe, expect, it, vi } from 'vitest';

import { required } from '../core/dom.js';
import { loadPage } from '../testing/page.js';
import { ArtifactUpload, validate, type UploadTarget } from './artifact-upload.js';

const RESULT = { releaseId: 'r-1', artifactId: 'a-1', releaseCreated: true };

function chooseFile(form: HTMLFormElement, file: File | null): void {
  const input = required<HTMLInputElement>('input[type="file"]', form);
  Object.defineProperty(input, 'files', { configurable: true, value: file === null ? [] : [file] });
  input.dispatchEvent(new Event('change'));
}

describe('ArtifactUpload', (): void => {
  let form: HTMLFormElement;

  beforeEach((): void => {
    loadPage('release', '/release.html?id=r-1');
    form = required<HTMLFormElement>('#upload-form');
  });

  const target = (overrides: Partial<UploadTarget> = {}): UploadTarget => ({
    title: 'Build hochladen',
    intro: 'Intro',
    mode: 'build',
    send: vi.fn(() => Promise.resolve(RESULT)),
    done: vi.fn(),
    ...overrides,
  });

  it('asks for the commit SHA of builds and for the kind of further release files', (): void => {
    ArtifactUpload.open(target());

    expect(required('[data-upload-commit]', form).hidden).toBe(false);
    expect(required('[data-upload-kind]', form).hidden).toBe(true);
    expect(required<HTMLInputElement>('input[type="file"]', form).accept).toBe('.apk,.aab,.ipa');

    ArtifactUpload.open(target({ mode: 'release', title: 'Datei hochladen' }));
    const kind = required<HTMLSelectElement>('select[name="kind"]', form);
    kind.value = 'dsym';
    kind.dispatchEvent(new Event('change'));

    expect(required('[data-upload-title]', form).textContent).toBe('Datei hochladen');
    expect(required('[data-upload-commit]', form).hidden).toBe(true);
    expect(required<HTMLInputElement>('input[type="file"]', form).accept).toBe('.zip');
  });

  it('requires a non-empty file and a well-formed commit SHA', (): void => {
    const file = new File(['apk'], 'app.apk');
    required<HTMLInputElement>('#upload-commit', form).value = 'abc';

    expect(validate(form, { mode: 'build' }, null)).toMatchObject({ file: 'Bitte wähle eine Datei aus.' });
    expect(validate(form, { mode: 'build' }, new File([], 'empty.apk'))).toMatchObject({ file: 'Die Datei ist leer.' });
    expect(validate(form, { mode: 'build' }, file).commitSha).toContain('40 oder 64');
    expect(validate(form, { mode: 'release' }, file)).toEqual({ file: null, commitSha: null });

    required<HTMLInputElement>('#upload-commit', form).value = 'A'.repeat(40);
    expect(validate(form, { mode: 'build' }, file)).toEqual({ file: null, commitSha: null });
  });

  it('sends the chosen file with the form values and hands the result on', async (): Promise<void> => {
    const upload = target();
    ArtifactUpload.open(upload);

    const file = new File(['android build'], 'app-release.apk');
    chooseFile(form, file);
    required<HTMLInputElement>('#upload-commit', form).value = 'b'.repeat(40);
    expect(required('[data-file-name]', form).textContent).toContain('app-release.apk');

    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(upload.done).toHaveBeenCalledWith(RESULT));

    expect(upload.send).toHaveBeenCalledWith({ file, kind: 'binary', commitSha: 'b'.repeat(40) }, expect.any(Function));
    expect(required('#upload-modal').hidden).toBe(true);
  });

  it('keeps the dialog open and shows the error when the upload is refused', async (): Promise<void> => {
    const { ApiError } = await import('../../services/api-client.js');
    const upload = target({
      send: () => Promise.reject(new ApiError(422, 'bundle_identifier_mismatch', 'mismatch')),
    });
    ArtifactUpload.open(upload);
    chooseFile(form, new File(['x'], 'other.apk'));

    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(form.querySelector('[data-form-alert]')).not.toBeNull());

    expect(form.querySelector('[data-form-alert]')?.textContent).toContain('passt zu keinem Flavor');
    expect(required('#upload-modal').hidden).toBe(false);
    expect(upload.done).not.toHaveBeenCalled();
  });
});
