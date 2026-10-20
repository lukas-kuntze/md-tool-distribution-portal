import type {
  ArtifactDto,
  AuditEntryDto,
  LifecycleStateDto,
  PlatformDto,
  PublicationStatusDto,
  ScopeDto,
} from '../../../shared/types/api.js';
import type { Tone } from './dom.js';

/** German labels and badge tones for the states the API reports (concept 7.1). */
interface Label {
  readonly text: string;
  readonly tone: Tone;
}

export const PLATFORM_LABELS: Readonly<Record<PlatformDto, string>> = { android: 'Android', ios: 'iOS' };

export const FRAMEWORK_LABELS: Readonly<Record<'flutter' | 'dotnet_maui', string>> = {
  flutter: 'Flutter',
  dotnet_maui: '.NET MAUI',
};

export const VISIBILITY_LABELS: Readonly<Record<'private' | 'organization', string>> = {
  private: 'Privat',
  organization: 'Organisation',
};

export const PUBLICATION_LABELS: Readonly<Record<PublicationStatusDto, Label>> = {
  draft: { text: 'Entwurf', tone: 'neutral' },
  published: { text: 'Veröffentlicht', tone: 'success' },
  withdrawn: { text: 'Zurückgezogen', tone: 'warning' },
};

export const LIFECYCLE_LABELS: Readonly<Record<LifecycleStateDto, Label>> = {
  active: { text: 'Aktiv', tone: 'success' },
  pending_deletion: { text: 'Löschung ausstehend', tone: 'warning' },
  quarantined: { text: 'In Quarantäne', tone: 'warning' },
  purged: { text: 'Endgültig gelöscht', tone: 'neutral' },
};

export const STATUS_LABELS: Readonly<Record<'active' | 'archived' | 'disabled', Label>> = {
  active: { text: 'Aktiv', tone: 'success' },
  archived: { text: 'Archiviert', tone: 'neutral' },
  disabled: { text: 'Deaktiviert', tone: 'warning' },
};

export const DELETION_STATE_LABELS: Readonly<Record<string, Label>> = {
  requested: { text: 'Beantragt', tone: 'info' },
  quarantining: { text: 'Wird in Quarantäne verschoben', tone: 'info' },
  quarantined: { text: 'In Quarantäne', tone: 'warning' },
  restoring: { text: 'Wird wiederhergestellt', tone: 'info' },
  restored: { text: 'Wiederhergestellt', tone: 'success' },
  purging: { text: 'Wird gelöscht', tone: 'info' },
  completed: { text: 'Abgeschlossen', tone: 'neutral' },
  failed: { text: 'Fehlgeschlagen', tone: 'danger' },
  cancelled: { text: 'Abgebrochen', tone: 'neutral' },
};

export const OUTCOME_LABELS: Readonly<Record<AuditEntryDto['outcome'], Label>> = {
  success: { text: 'Erfolgreich', tone: 'success' },
  denied: { text: 'Verweigert', tone: 'danger' },
  failed: { text: 'Fehlgeschlagen', tone: 'warning' },
};

export const ARTIFACT_KIND_LABELS: Readonly<Record<ArtifactDto['kind'], string>> = {
  apk: 'APK',
  aab: 'AAB',
  ipa: 'IPA',
  dsym: 'dSYM',
  mapping: 'Mapping',
  metadata: 'Metadaten',
};

export function labelOf(labels: Readonly<Record<string, Label>>, key: string): Label {
  return labels[key] ?? { text: key, tone: 'neutral' };
}

export function scopeLabel(scope: ScopeDto): string {
  switch (scope.type) {
    case 'global':
      return 'Plattform';
    case 'project':
      return 'Projekt';
    case 'application':
      return 'Anwendung';
  }
}

/** What each permission of the catalog allows, as explained in docs/rollen-und-berechtigungen.md. */
export const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  'projects.read': 'Projekte und Stammdaten sehen',
  'projects.create': 'Projekte anlegen',
  'projects.update': 'Projekte bearbeiten, archivieren und wiederherstellen',
  'projects.delete': 'Leere Projekte endgültig löschen',
  'applications.manage': 'Anwendungen anlegen und bearbeiten (Plattformen, Kennungen, Sichtbarkeit)',
  'flavors.manage': 'Flavors anlegen, bearbeiten, deaktivieren und archivieren',
  'releases.read': 'Releases einschließlich Entwürfen sehen',
  'releases.create': 'Releases anlegen',
  'releases.update': 'Release Notes und Changelog bearbeiten',
  'releases.publish': 'Releases veröffentlichen und zurückziehen',
  'releases.delete': 'Löschung von Releases beantragen',
  'releases.restore': 'Releases aus der Quarantäne wiederherstellen',
  'releases.purge': 'Releases ohne Wartefrist endgültig löschen',
  'artifacts.upload': 'Artefakte hochladen',
  'artifacts.download': 'Artefakte herunterladen und installieren',
  'artifacts.delete': 'Einzelne Artefakte entfernen',
  'build_numbers.release': 'Build-Nummern endgültig gelöschter Releases freigeben',
  'permissions.manage': 'Rollen im eigenen Bereich vergeben und widerrufen',
  'audit.read': 'Audit-Log einsehen',
  'storage.manage': 'Speicher und Löschaufträge verwalten',
  'settings.manage': 'Plattform-Einstellungen ändern',
  'shares.manage': 'Freigabelinks für Kunden erstellen und widerrufen',
};

export const ROLE_LABELS: Readonly<Record<string, { readonly name: string; readonly summary: string }>> = {
  'platform-admin': { name: 'Plattform-Admin', summary: 'Darf alles, auf der gesamten Plattform.' },
  'project-admin': {
    name: 'Projekt-Admin',
    summary: 'Verwaltet ein Projekt vollständig, einschließlich Rechten und Freigaben.',
  },
  'release-manager': {
    name: 'Release Manager',
    summary: 'Lädt Releases hoch, veröffentlicht, zieht zurück, löscht und stellt wieder her.',
  },
  developer: { name: 'Entwickler', summary: 'Legt Releases an und lädt Artefakte hoch, veröffentlicht aber nicht.' },
  tester: { name: 'Tester', summary: 'Sieht alle Releases einschließlich Entwürfen und installiert sie.' },
  viewer: { name: 'Betrachter', summary: 'Sieht das Projekt und installiert veröffentlichte Releases.' },
};

export function roleName(key: string): string {
  return ROLE_LABELS[key]?.name ?? key;
}

/**
 * Roles ordered by what they allow: most permissions first, ties by German name. Puts the platform
 * administrator on top and the read-only roles last, as in docs/rollen-und-berechtigungen.md.
 */
export function byPermissions<Role extends { readonly key: string; readonly permissions: readonly string[] }>(
  roles: readonly Role[],
): Role[] {
  return [...roles].sort(
    (left, right) =>
      right.permissions.length - left.permissions.length || roleName(left.key).localeCompare(roleName(right.key), 'de'),
  );
}
