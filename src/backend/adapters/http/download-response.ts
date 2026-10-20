import { Readable } from 'node:stream';

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { Download } from '../../application/download-artifact.js';
import type { ByteRange } from '../../domain/ports/artifact-storage.js';
import { DomainError } from '../../domain/value-objects/domain-error.js';

/** Picks the byte range of the `Range` header once the size of the file is known. */
export function rangeSelector(request: FastifyRequest): (sizeBytes: number) => ByteRange | null {
  return (sizeBytes) => {
    const range = parseRange(request.headers.range, sizeBytes);

    if (range === 'unsatisfiable') {
      throw new DomainError('range_not_satisfiable', 'The requested byte range lies outside the file.');
    }

    return range;
  };
}

/** Streams an artifact with range support; the SHA-256 digest serves as ETag. */
export function sendDownload(reply: FastifyReply, download: Download, contentType: string): FastifyReply {
  const size = download.artifact.sizeBytes;
  const { range } = download;

  reply
    .header('content-type', contentType)
    .header('content-disposition', contentDisposition(download.fileName))
    .header('accept-ranges', 'bytes')
    .header('etag', `"${download.artifact.sha256}"`)
    .header('cache-control', 'private, no-store');

  if (range === null) {
    reply.header('content-length', String(size));
  } else {
    reply
      .status(206)
      .header('content-range', `bytes ${range.start}-${range.end}/${size}`)
      .header('content-length', String(range.end - range.start + 1));
  }

  return reply.send(Readable.from(download.content));
}

/** Single byte range per RFC 9110; multiple ranges are not supported and answered with the full content. */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'unsatisfiable' {
  if (header === undefined) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());

  if (match === null || (match[1] === '' && match[2] === '')) {
    return null;
  }

  const [, from = '', to = ''] = match;
  const start = from === '' ? Math.max(0, size - Number(to)) : Number(from);
  const end = from === '' || to === '' ? size - 1 : Math.min(Number(to), size - 1);

  if (size === 0 || start >= size || start > end) {
    return 'unsatisfiable';
  }

  return { start, end };
}

/** ASCII fallback plus RFC 5987 encoding, so that no header injection is possible through file names. */
function contentDisposition(fileName: string): string {
  if (/[\r\n]/.test(fileName)) {
    throw new DomainError('invalid_request', 'Invalid file name.');
  }

  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
