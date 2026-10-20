import type { ApiErrorDto, UploadResultDto } from '../../shared/types/api.js';
import { ApiError, LOGIN_PAGE, withQuery } from './api-client.js';

/** Share of the file sent so far, between 0 and 1. */
export type ProgressListener = (fraction: number) => void;

export type ReleaseFileKind = 'binary' | 'dsym' | 'mapping' | 'metadata';

/**
 * Sends a file as raw request body (`application/octet-stream`), as the upload API expects. Uses
 * `XMLHttpRequest` because `fetch` reports no upload progress; the browser sets the `Origin` header itself.
 */
export function sendFile(path: string, file: Blob, onProgress: ProgressListener): Promise<UploadResultDto> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open('POST', path);
    request.withCredentials = true;
    request.responseType = 'json';
    request.setRequestHeader('accept', 'application/json');
    request.setRequestHeader('content-type', 'application/octet-stream');
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    });
    request.addEventListener('error', () =>
      reject(new ApiError(0, 'network_error', 'The server could not be reached.')),
    );
    request.addEventListener('abort', () => reject(new ApiError(0, 'aborted', 'The upload was cancelled.')));
    request.addEventListener('load', () => {
      if (request.status === 401) {
        window.location.assign(LOGIN_PAGE);
      }

      if (request.status >= 200 && request.status < 300) {
        resolve(request.response as UploadResultDto);
        return;
      }

      const body = request.response as Partial<ApiErrorDto> | null;
      const error = body?.error;
      reject(
        new ApiError(
          request.status,
          error?.code ?? (request.status === 413 ? 'upload_too_large' : 'internal_error'),
          error?.message ?? request.statusText,
          error?.issues ?? [],
        ),
      );
    });
    request.send(file);
  });
}

export const uploads = {
  /** APK, AAB or IPA; the release is found or created by the build number in the file. */
  build: (
    applicationId: string,
    file: File,
    commitSha: string,
    onProgress: ProgressListener,
  ): Promise<UploadResultDto> =>
    sendFile(
      withQuery(`/api/applications/${applicationId}/builds`, { fileName: file.name, commitSha }),
      file,
      onProgress,
    ),
  releaseFile: (
    releaseId: string,
    kind: ReleaseFileKind,
    file: File,
    onProgress: ProgressListener,
  ): Promise<UploadResultDto> =>
    sendFile(withQuery(`/api/releases/${releaseId}/artifacts`, { fileName: file.name, kind }), file, onProgress),
};
