import type { ApplicationId, AssetId, ProjectId } from '../value-objects/identifier.js';
import type { StorageKey } from '../value-objects/storage-key.js';

/** Largest accepted icon; store icons are 1024 × 1024 PNGs of a few hundred kilobytes. */
export const MAX_ICON_BYTES = 512 * 1024;

export const ICON_FORMATS = {
  png: { contentType: 'image/png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  jpg: { contentType: 'image/jpeg', signature: [0xff, 0xd8, 0xff] },
} as const;

export type IconFormat = keyof typeof ICON_FORMATS;

/** Whom an asset belongs to; its file lives below the owner's directory in `assets/`. */
export type AssetOwner =
  { readonly type: 'application'; readonly id: ApplicationId } | { readonly type: 'project'; readonly id: ProjectId };

/** An icon of an application or a project (concept 4.2, table `assets`); stored as a file like the artifacts. */
export interface Asset {
  readonly id: AssetId;
  readonly owner: AssetOwner;
  readonly kind: 'icon';
  readonly contentType: (typeof ICON_FORMATS)[IconFormat]['contentType'];
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly storageKey: StorageKey;
  readonly createdAt: Date;
}

/** How the application is shown on download pages (`applications.public_page`, concept 7.3 "Darstellung"). */
export interface ApplicationPresentation {
  /** Plain text, e.g. which devices are supported or whom to ask for access; shown above the downloads. */
  readonly installNotes: string;
  readonly icon: Asset | null;
}

export const MAX_INSTALL_NOTES_LENGTH = 5000;

/**
 * Recognises PNG and JPEG by their magic bytes; the file name and the declared content type are not trusted,
 * because the icon is later served with the content type derived here.
 */
export function iconFormatOf(head: Uint8Array): IconFormat | null {
  for (const [format, { signature }] of Object.entries(ICON_FORMATS) as [
    IconFormat,
    (typeof ICON_FORMATS)[IconFormat],
  ][]) {
    if (signature.every((byte, index) => head[index] === byte)) {
      return format;
    }
  }

  return null;
}
