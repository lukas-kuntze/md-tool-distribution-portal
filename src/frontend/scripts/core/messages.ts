import { ApiError } from '../../services/api-client.js';

/**
 * German texts for the error codes of the API. The API answers in English for logs and integrations; the
 * interface shows these instead and falls back to a neutral text for codes it does not know.
 */
const MESSAGES: Readonly<Record<string, string>> = {
  network_error: 'Der Server ist nicht erreichbar. Bitte prüfe die Verbindung und versuche es erneut.',
  internal_error: 'Auf dem Server ist ein unerwarteter Fehler aufgetreten.',
  invalid_request: 'Die Eingaben sind unvollständig oder ungültig.',
  unauthenticated: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.',
  permission_denied: 'Dafür fehlt dir die Berechtigung.',
  privilege_escalation: 'Du kannst nur Rollen vergeben, deren Rechte du im Zielbereich selbst besitzt.',
  concurrent_modification:
    'Der Datensatz wurde inzwischen von jemand anderem geändert. Lade die Seite neu und prüfe die Änderungen.',
  slug_taken: 'Dieser Slug ist bereits vergeben.',
  invalid_slug: 'Der Slug darf nur Kleinbuchstaben, Ziffern und einzelne Bindestriche enthalten.',
  invalid_name: 'Bitte gib einen Namen an.',
  invalid_flavor_key:
    'Der Schlüssel muss mit einem Kleinbuchstaben beginnen und darf nur Buchstaben und Ziffern enthalten.',
  flavor_key_taken: 'Diesen Flavor-Schlüssel gibt es in der Anwendung bereits.',
  flavor_key_locked: 'Der Schlüssel kann nach dem ersten Release nicht mehr geändert werden.',
  invalid_bundle_identifier: 'Die Kennung hat kein gültiges Format (z. B. de.firma.app).',
  bundle_identifier_taken: 'Diese Kennung ist bereits einer anderen Anwendung oder einem anderen Flavor zugeordnet.',
  bundle_identifier_locked: 'Kennungen können nach dem ersten Release nicht mehr geändert werden.',
  no_release_platforms: 'Mindestens eine Plattform muss aktiviert sein.',
  invalid_platform: 'Unbekannte Plattform.',
  flavors_not_enabled: 'Für diese Anwendung sind Flavors nicht aktiviert.',
  too_many_active_flavors: 'Flavors lassen sich nur abschalten, solange höchstens ein Flavor aktiv ist.',
  default_flavor_not_archivable: 'Der Standard-Flavor kann nicht archiviert werden, solange er der einzige aktive ist.',
  invalid_project_state: 'Das ist im aktuellen Zustand des Projekts nicht möglich.',
  invalid_release_state: 'Das ist im aktuellen Zustand des Releases nicht möglich.',
  release_incomplete: 'Das Release ist unvollständig: Für jede Plattform muss ein installierbares Artefakt vorliegen.',
  confirmation_mismatch: 'Der Bestätigungstext stimmt nicht überein.',
  reason_required: 'Bitte gib eine Begründung an.',
  deletion_already_requested: 'Für dieses Release läuft bereits ein Löschauftrag.',
  restore_failed: 'Die Wiederherstellung ist fehlgeschlagen. Details stehen im Audit-Log.',
  invalid_deletion_job_state: 'Der Löschauftrag ist nicht in einem Zustand, der das zulässt.',
  role_already_assigned: 'Diese Rolle ist dem Benutzer in diesem Bereich bereits zugewiesen.',
  role_not_applicable: 'Diese Rolle kann in diesem Bereich nicht vergeben werden.',
  last_platform_admin: 'Der letzte Plattform-Administrator kann nicht entfernt werden.',
  invalid_artifact: 'Dieses Artefakt lässt sich nicht installieren.',
  install_link_invalid: 'Der Installationslink ist abgelaufen. Bitte fordere einen neuen an.',
  share_link_not_found: 'Dieser Freigabelink ist ungültig, abgelaufen oder wurde widerrufen.',
  invalid_ci_binding: 'Bitte prüfe Repository, Repository-ID und Branch- oder Tag-Muster.',
  ci_binding_exists: 'Dieses Repository ist mit demselben Branch- oder Tag-Muster und Environment bereits verbunden.',
  ci_binding_not_found: 'Die CI-Anbindung existiert nicht oder wurde bereits getrennt.',
  invalid_user_state: 'Der Benutzer hat diesen Status bereits.',
  cannot_disable_self: 'Du kannst dein eigenes Konto nicht deaktivieren.',
  invalid_share_link:
    'Die Freigabe ist so nicht möglich: Das Ablaufdatum muss in der Zukunft liegen, archivierte Projekte und Anwendungen lassen sich nicht freigeben.',
  project_not_found: 'Das Projekt wurde nicht gefunden.',
  application_not_found: 'Die Anwendung wurde nicht gefunden.',
  flavor_not_found: 'Der Flavor wurde nicht gefunden.',
  release_not_found: 'Das Release wurde nicht gefunden.',
  artifact_not_found: 'Das Artefakt ist nicht mehr verfügbar.',
  unreadable_binary: 'Die Datei ist keine lesbare APK, AAB oder IPA.',
  upload_too_large: 'Die Datei ist größer als erlaubt.',
  bundle_identifier_missing:
    'Für diese Plattform ist noch kein Package-Name bzw. keine Bundle-ID hinterlegt. Trage sie in den Einstellungen ein.',
  bundle_identifier_mismatch:
    'Der Package-Name bzw. die Bundle-ID in der Datei passt zu keinem Flavor dieser Anwendung.',
  commit_sha_required: 'Dieser Build startet ein neues Release. Bitte gib den Commit-SHA an, aus dem er gebaut wurde.',
  invalid_commit_sha: 'Der Commit-SHA muss aus 40 oder 64 Hexadezimalzeichen bestehen.',
  invalid_version: 'Die Version in der Datei muss die Form 1.2.3 haben (optional mit Suffix wie -beta.1).',
  invalid_build_number: 'Die Build-Nummer in der Datei muss eine ganze Zahl sein.',
  artifact_version_mismatch: 'Die Version der Datei passt nicht zum Release mit dieser Build-Nummer.',
  artifact_build_number_mismatch: 'Die Build-Nummer der Datei passt nicht zu diesem Release.',
  artifact_commit_mismatch: 'Der Commit-SHA passt nicht zum bestehenden Release mit dieser Build-Nummer.',
  artifact_exists: 'Das Release enthält bereits eine Datei dieser Art.',
  artifact_locked_after_publication:
    'Einem veröffentlichten Release können keine Builds mehr hinzugefügt werden. Ziehe es vorher zurück.',
  platform_not_required: 'Das Release umfasst die Plattform dieser Datei nicht.',
  flavor_not_active: 'Der Flavor ist deaktiviert und nimmt keine neuen Releases an.',
  deletion_job_not_found: 'Der Löschauftrag wurde nicht gefunden.',
  role_not_found: 'Die Rolle wurde nicht gefunden.',
  user_not_found: 'Der Benutzer wurde nicht gefunden.',
  assignment_not_found: 'Die Zuweisung existiert nicht oder wurde bereits widerrufen.',
  not_found: 'Die angeforderte Ressource existiert nicht.',
  not_organization_member: 'Dein GitHub-Konto gehört nicht zur berechtigten Organisation.',
  user_disabled: 'Dein Benutzerkonto ist deaktiviert.',
  sign_in_failed: 'Die Anmeldung bei GitHub ist fehlgeschlagen. Bitte versuche es erneut.',
};

export function messageForCode(code: string): string {
  return MESSAGES[code] ?? 'Die Aktion ist fehlgeschlagen.';
}

export function describeError(error: unknown): string {
  return error instanceof ApiError ? messageForCode(error.code) : messageForCode('internal_error');
}
