# Rollen und Berechtigungen

Diese Seite erklärt, wer in der App-Distribution was darf. Sie richtet sich an alle, die Rollen vergeben oder verstehen wollen, warum jemand eine Aktion ausführen darf oder nicht. Die technische Herleitung steht im [Architekturkonzept, Kapitel 4](architecture/architekturkonzept.md#4-berechtigungskonzept).

## Das Wichtigste in Kürze

- **Anmelden heißt noch nicht dürfen.** Die Anmeldung läuft über GitHub. Die Mitgliedschaft in der GitHub-Organisation entscheidet nur, _ob_ sich jemand anmelden kann. Rechte gibt es ausschließlich über Rollen in der Plattform.
- **Rollen gelten für einen Bereich:** die ganze Plattform, ein Projekt oder eine Anwendung.
- **Rechte vererben sich nach unten:** Plattform → Projekt → Anwendung. Eine Rolle auf einem Projekt gilt für alle Anwendungen des Projekts, auch für später angelegte. Flavors, Releases und Artefakte gehören immer zu ihrer Anwendung.
- **Es gibt nur Erlaubnisse, keine Verbote.** Hat jemand mehrere Rollen, gilt die Summe.
- **Zuordnung über die GitHub-ID, nicht den Login.** Benennt jemand seinen GitHub-Account um, bleiben die Rechte erhalten.
- Die Oberfläche blendet Aktionen aus, die jemand nicht darf. Maßgeblich ist aber immer die Prüfung auf dem Server; jede abgelehnte Aktion steht im Audit-Log.

## Die Rollen

| Rolle               | Schlüssel         | Typischer Bereich      | Kurz gesagt                                                                                      |
| ------------------- | ----------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| **Plattform-Admin** | `platform-admin`  | Plattform              | Darf alles. Verwaltet Projekte, Rechte, Speicher und Löschaufträge plattformweit.                |
| **Projekt-Admin**   | `project-admin`   | Projekt                | Verwaltet ein Projekt vollständig: Anwendungen, Flavors, Releases, Rechte, Freigaben, Audit-Log. |
| **Release Manager** | `release-manager` | Projekt oder Anwendung | Kümmert sich um Releases: hochladen, veröffentlichen, zurückziehen, löschen, wiederherstellen.   |
| **Entwickler**      | `developer`       | Projekt oder Anwendung | Legt Releases an und lädt Artefakte hoch, veröffentlicht aber nicht.                             |
| **Tester**          | `tester`          | Projekt oder Anwendung | Sieht alle Releases einschließlich Entwürfen und installiert sie.                                |
| **Betrachter**      | `viewer`          | Projekt oder Anwendung | Sieht das Projekt und installiert veröffentlichte Releases.                                      |

### Berechtigungen je Rolle

✓ = enthalten.

| Berechtigung            | Bedeutung                                                                 | Plattform-Admin | Projekt-Admin | Release Manager | Entwickler | Tester | Betrachter |
| ----------------------- | ------------------------------------------------------------------------- | :-------------: | :-----------: | :-------------: | :--------: | :----: | :--------: |
| `projects.read`         | Projekte und Stammdaten sehen                                             |        ✓        |       ✓       |                 |            |        |     ✓      |
| `projects.create`       | Projekte anlegen                                                          |        ✓        |               |                 |            |        |            |
| `projects.update`       | Projekte bearbeiten, archivieren und wiederherstellen                     |        ✓        |       ✓       |                 |            |        |            |
| `projects.delete`       | Leere Projekte endgültig löschen ¹                                        |        ✓        |               |                 |            |        |            |
| `applications.manage`   | Anwendungen anlegen und bearbeiten (Plattformen, Kennungen, Sichtbarkeit) |        ✓        |       ✓       |                 |            |        |            |
| `flavors.manage`        | Flavors anlegen, bearbeiten, deaktivieren und archivieren                 |        ✓        |       ✓       |                 |            |        |            |
| `releases.read`         | Releases einschließlich Entwürfen sehen                                   |        ✓        |       ✓       |        ✓        |     ✓      |   ✓    |            |
| `releases.create`       | Releases anlegen                                                          |        ✓        |       ✓       |        ✓        |     ✓      |        |            |
| `releases.update`       | Release Notes und Changelog bearbeiten                                    |        ✓        |       ✓       |        ✓        |     ✓      |        |            |
| `releases.publish`      | Releases veröffentlichen und zurückziehen                                 |        ✓        |       ✓       |        ✓        |            |        |            |
| `releases.delete`       | Löschung von Releases beantragen                                          |        ✓        |       ✓       |        ✓        |            |        |            |
| `releases.restore`      | Releases aus der Quarantäne wiederherstellen                              |        ✓        |       ✓       |        ✓        |            |        |            |
| `releases.purge`        | Releases ohne Wartefrist endgültig löschen ¹                              |        ✓        |               |                 |            |        |            |
| `artifacts.upload`      | Artefakte hochladen                                                       |        ✓        |       ✓       |        ✓        |     ✓      |        |            |
| `artifacts.download`    | Artefakte herunterladen und installieren                                  |        ✓        |       ✓       |        ✓        |     ✓      |   ✓    |     ✓      |
| `artifacts.delete`      | Einzelne Artefakte entfernen                                              |        ✓        |       ✓       |        ✓        |            |        |            |
| `build_numbers.release` | Build-Nummern endgültig gelöschter Releases freigeben                     |        ✓        |       ✓       |                 |            |        |            |
| `permissions.manage`    | Rollen im eigenen Bereich vergeben und widerrufen                         |        ✓        |       ✓       |                 |            |        |            |
| `audit.read`            | Audit-Log einsehen                                                        |        ✓        |       ✓       |        ✓        |            |        |            |
| `storage.manage`        | Speicher und Löschaufträge verwalten                                      |        ✓        |               |                 |            |        |            |
| `settings.manage`       | Plattform-Einstellungen ändern (Löschfristen, Sitzungen, Vorgaben)        |        ✓        |               |                 |            |        |            |
| `shares.manage`         | Freigabelinks für Kunden erstellen und widerrufen                         |        ✓        |       ✓       |                 |            |        |            |

¹ Im Katalog vorgesehen, in der Oberfläche noch ohne Funktion.

Einige Berechtigungen wirken nur auf Plattformebene, egal wo die Rolle vergeben ist: `projects.create`, `projects.delete`, `releases.purge`, `storage.manage` und `settings.manage`. Ein Projekt-Admin kann deshalb keine neuen Projekte anlegen.

## Wer darf was in der Oberfläche?

| Aktion                                                     | Benötigt                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| Projekt sehen                                              | `projects.read` oder Zugriff auf mindestens eine seiner Anwendungen |
| Projekt anlegen                                            | `projects.create` (Plattform)                                       |
| Projekt bearbeiten, archivieren, wiederherstellen          | `projects.update`                                                   |
| Anwendung anlegen und Einstellungen ändern                 | `applications.manage`                                               |
| Flavors verwalten                                          | `flavors.manage`                                                    |
| Entwürfe, zurückgezogene und gelöschte Releases sehen      | `releases.read`                                                     |
| Release Notes bearbeiten                                   | `releases.update`                                                   |
| Release veröffentlichen oder zurückziehen                  | `releases.publish`                                                  |
| Release löschen (Quarantäne)                               | `releases.delete`                                                   |
| Release aus der Quarantäne wiederherstellen                | `releases.restore`                                                  |
| Build-Nummer eines endgültig gelöschten Releases freigeben | `build_numbers.release`                                             |
| Herunterladen und auf iOS installieren                     | `artifacts.download`, bei Entwürfen zusätzlich `releases.read`      |
| Tab „Freigaben“, Kundenlinks erstellen und widerrufen      | `shares.manage`                                                     |
| Tab „Zugriff“, Rollen vergeben und widerrufen              | `permissions.manage`                                                |
| Benutzerverwaltung, Konten deaktivieren und aktivieren     | `permissions.manage` (Plattform)                                    |
| Tab „CI“, Repositories für Uploads verbinden und trennen   | `applications.manage`                                               |
| Endgültig löschen vor Ablauf der Quarantäne                | `releases.purge` (Plattform)                                        |
| Tab „Audit“ und Audit-Log                                  | `audit.read` (plattformweites Audit-Log nur auf Plattformebene)     |
| Speicher und Löschaufträge                                 | `storage.manage` (Plattform)                                        |
| Einstellungen ändern                                       | `settings.manage` (Plattform)                                       |
| Übersicht (Dashboard)                                      | jede angemeldete Person; sie zeigt nur, was die Person sehen darf   |

## Besondere Regeln

### Sichtbarkeit „Organisation“

Steht eine Anwendung auf der Sichtbarkeit _Organisation_, sehen **alle angemeldeten Mitglieder** ihre veröffentlichten Releases und dürfen sie herunterladen und installieren, auch ohne Rolle. Entwürfe, zurückgezogene und gelöschte Releases bleiben Personen mit `releases.read` vorbehalten. Weitere Rechte entstehen dadurch nicht.

### Download-Seite „Apps installieren“

Unter `/apps.html` sieht jede angemeldete Person die aktuelle Version aller Apps, die sie installieren darf: Anwendungen mit Sichtbarkeit _Organisation_ und solche, für die sie `artifacts.download` hat. Wer keine Rolle mit Rechten über Sehen und Herunterladen hinaus hat, landet nach der Anmeldung direkt dort statt in der Verwaltung. Alle anderen erreichen die Seite über „Apps installieren“ in der Navigation.

### Schutz vor Rechteausweitung

- Wer `permissions.manage` hat, darf Rollen nur **im eigenen Bereich oder darunter** vergeben, und nur Rollen, deren Berechtigungen er dort selbst besitzt. Ein Projekt-Admin kann also niemanden zum Plattform-Admin machen.
- Rollen mit administrativen Rechten (alles außer Sehen und Herunterladen) dürfen nur Personen mit `permissions.manage` auf Plattform- oder auf der betreffenden Projektebene vergeben.
- Widerrufen erfordert dieselbe Stellung wie Vergeben.
- Der **letzte Plattform-Admin** kann nicht entfernt werden.
- Jede Vergabe und jeder Widerruf braucht eine Begründung und steht im Audit-Log. Zuweisungen werden widerrufen, nie gelöscht, damit die Historie erhalten bleibt. Sie können optional befristet werden.

### Administratoren aus der Konfiguration

Die ersten Plattform-Admins stehen als numerische GitHub-IDs in der Server-Konfiguration (`BOOTSTRAP_ADMIN_GITHUB_IDS`). Sie erhalten die Rolle bei der Anmeldung automatisch; in der Oberfläche sind diese Zuweisungen als „durch Konfiguration“ markiert und lassen sich dort nicht widerrufen.

### Freigabelinks für Kunden

Personen ohne Konto erhalten Releases über einen Freigabelink (Tab „Freigaben“). Ein Link verleiht **keine Rolle**: Er zeigt nur veröffentlichte Releases des freigegebenen Projekts oder der Anwendung (alle oder nur die neueste Version) und erlaubt Herunterladen und iOS-Installation. Links lassen sich befristen und jederzeit widerrufen. Details im [Architekturkonzept, Abschnitt 4.8](architecture/architekturkonzept.md).

### Uploads aus GitHub Actions

Workflows laden Releases mit dem OIDC-Token ihres Laufs hoch. Welche Repositories, Branches oder Tags und Environments das dürfen, legt der Tab „CI“ der Anwendung fest. Sie dürfen ausschließlich Releases anlegen und Artefakte hochladen, und nur für die Anwendung, mit der ihr Repository verbunden ist. Löschen und Rechte vergeben ist für Workflows nie möglich.

### Konten deaktivieren

In der Benutzerverwaltung (Plattformebene, `permissions.manage`) lässt sich ein Konto deaktivieren: Die Person wird sofort abgemeldet und kann sich nicht mehr anmelden; Rollen und Audit-Historie bleiben erhalten. Das eigene Konto und der letzte aktive Plattform-Admin lassen sich nicht deaktivieren.

## Beispiele

**Ein Release Manager für eine App.** Anna soll Releases von _K Mobile_ verwalten, aber nichts an _Doku AirPad_ ändern. Sie erhält `release-manager` mit Bereich _Anwendung K Mobile_. Sie darf Releases von K Mobile veröffentlichen, zurückziehen und löschen; bei Doku AirPad wird jeder Versuch abgelehnt und als `authz.denied` protokolliert.

**Ein Projekt an ein Team übergeben.** Ben leitet das Projekt _MD Ambulant_. Er erhält `project-admin` mit Bereich _Projekt MD Ambulant_. Er kann dort Anwendungen anlegen, Rechte an sein Team vergeben und Kundenlinks erstellen, aber keine neuen Projekte anlegen.

**Tester mit Zugriff auf Entwürfe.** Das QA-Team soll Builds vor der Veröffentlichung prüfen. Es erhält `tester` auf dem Projekt und sieht damit auch Entwürfe; veröffentlichen kann es nicht.

**Wer darf Releases löschen?** In der Zugriffsseite den Bereich wählen: Alle Zuweisungen mit Plattform-Admin, Projekt-Admin oder Release Manager, die auf diesen Bereich oder darüber wirken, erlauben das Löschen. Über „Effektive Rechte“ lässt sich das für eine einzelne Person nachprüfen; die Plattform nennt dort auch, über welche Rolle und welchen Bereich jedes Recht kommt.
