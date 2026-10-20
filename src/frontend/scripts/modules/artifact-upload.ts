import type { UploadResultDto } from '../../../shared/types/api.js';
import type { ProgressListener, ReleaseFileKind } from '../../services/upload-service.js';
import { required } from '../core/dom.js';
import { formatBytes } from '../core/format.js';
import { submit, value } from '../core/forms.js';
import { Overlays } from './overlays.js';

export interface UploadRequest {
  readonly file: File;
  readonly kind: ReleaseFileKind;
  readonly commitSha: string;
}

export interface UploadTarget {
  readonly title: string;
  readonly intro: string;
  /** `build` asks for the commit SHA, `release` for the kind of file. */
  readonly mode: 'build' | 'release';
  readonly send: (request: UploadRequest, onProgress: ProgressListener) => Promise<UploadResultDto>;
  readonly done: (result: UploadResultDto) => Promise<void> | void;
}

const ACCEPT: Readonly<Record<ReleaseFileKind, string>> = {
  binary: '.apk,.aab,.ipa',
  dsym: '.zip',
  mapping: '.txt',
  metadata: '.json',
};

const HINTS: Readonly<Record<ReleaseFileKind, string>> = {
  binary: 'APK, AAB oder IPA. Package-Name bzw. Bundle-ID, Version und Build-Nummer werden aus der Datei gelesen.',
  dsym: 'Gezipptes dSYM-Bundle des iOS-Builds.',
  mapping: 'R8-/ProGuard-Mapping des Android-Builds.',
  metadata: 'JSON mit Angaben zum Build, z. B. der Flutter-Version.',
};

const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

let current: UploadTarget | null = null;

/**
 * The upload dialog shared by the application page (new builds) and the release page (further files). The
 * file goes to the API as raw body with a progress bar; the dialog stays open on errors, so the user can
 * correct the input and retry.
 */
export const ArtifactUpload = {
  open(target: UploadTarget, trigger?: HTMLElement): void {
    const overlay = required('#upload-modal');
    const form = required<HTMLFormElement>('#upload-form', overlay);

    if (form.dataset['bound'] !== 'true') {
      bind(form);
      form.dataset['bound'] = 'true';
    }

    current = target;
    form.reset();
    required('[data-upload-title]', form).textContent = target.title;
    required('[data-upload-intro]', form).textContent = target.intro;
    required('[data-upload-kind]', form).hidden = target.mode !== 'release';
    required('[data-upload-commit]', form).hidden = target.mode !== 'build';
    syncKind(form);
    showFile(form, null);
    showProgress(form, null);
    Overlays.open(overlay, trigger);
  },
};

function bind(form: HTMLFormElement): void {
  const input = required<HTMLInputElement>('input[type="file"]', form);
  const zone = required('[data-file-drop]', form);

  input.addEventListener('change', () => showFile(form, input.files?.[0] ?? null));
  required<HTMLSelectElement>('select[name="kind"]', form).addEventListener('change', () => syncKind(form));

  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('is-dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-dragover'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('is-dragover');

    if (event.dataTransfer !== null && event.dataTransfer.files.length > 0) {
      input.files = event.dataTransfer.files;
      showFile(form, input.files[0] ?? null);
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const target = current;
    const file = input.files?.[0] ?? null;

    if (target === null) {
      return;
    }

    void submit(
      form,
      async () => {
        showProgress(form, 0);

        try {
          const result = await target.send(
            { file: file as File, kind: value(form, 'kind') as ReleaseFileKind, commitSha: value(form, 'commitSha') },
            (fraction) => showProgress(form, fraction),
          );
          Overlays.close(required('#upload-modal'));
          await target.done(result);
        } finally {
          showProgress(form, null);
        }
      },
      () => validate(form, target, file),
    );
  });
}

/** Client-side checks; everything about the content itself is decided by the server. */
export function validate(
  form: HTMLFormElement,
  target: Pick<UploadTarget, 'mode'>,
  file: File | null,
): Readonly<Record<string, string | null>> {
  const commitSha = value(form, 'commitSha');

  return {
    file: file === null ? 'Bitte wähle eine Datei aus.' : file.size === 0 ? 'Die Datei ist leer.' : null,
    commitSha:
      target.mode === 'build' && commitSha !== '' && !COMMIT_SHA.test(commitSha)
        ? 'Der Commit-SHA besteht aus 40 oder 64 Hexadezimalzeichen.'
        : null,
  };
}

function syncKind(form: HTMLFormElement): void {
  const kind = (value(form, 'kind') || 'binary') as ReleaseFileKind;
  required<HTMLInputElement>('input[type="file"]', form).accept = ACCEPT[kind];
  required('[data-file-hint]', form).textContent = HINTS[kind];
}

function showFile(form: HTMLFormElement, file: File | null): void {
  const label = required('[data-file-name]', form);

  if (file === null) {
    label.replaceChildren(
      'Datei hierher ziehen oder ',
      Object.assign(document.createElement('u'), { textContent: 'auswählen' }),
    );
    return;
  }

  label.textContent = `${file.name} · ${formatBytes(file.size)}`;
}

function showProgress(form: HTMLFormElement, fraction: number | null): void {
  const box = required('[data-upload-progress]', form);
  const percent = Math.round((fraction ?? 0) * 100);

  box.hidden = fraction === null;
  required<HTMLProgressElement>('progress', box).value = percent;
  required('[data-upload-percent]', box).textContent = percent === 100 ? 'Wird geprüft …' : `${percent} %`;
}
