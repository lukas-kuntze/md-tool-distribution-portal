<div align="center">

# Softwareentwicklung & IT-Dienstleistungen Kuntze <br> UI Styleguide

Verbindliche visuelle und funktionale Referenz für alle Produkte von Softwareentwicklung & IT-Dienstleistungen Kuntze:  
Farben, Typografie, Abstände, Komponenten und Interaktionsmuster.

</div>

---

## Schnellstart

Der Styleguide ist eine statische Seite ohne Build-Schritt. Zum Ansehen genügt:

- **Direkt öffnen:** `src/index.html` im Browser öffnen, **oder**
- **Lokaler Server (empfohlen):** aus `src/` heraus einen statischen Server
  starten, z. B. `python -m http.server`, und `http://localhost:8000` öffnen.

Ein Server ist nur nötig, falls ein Browser das Kopieren in die Zwischenablage
(`navigator.clipboard`) über `file://` einschränkt. CSS und JavaScript laden in
beiden Fällen. Es werden **keine** externen CDNs kontaktiert (DSGVO-konform).

---

## Projektstruktur

```text
src/
├─ index.html                    # Das Styleguide-Dokument (nur Struktur, kein CSS/JS inline)
├─ login.html                    # Eigenständiges Auth-Seiten-Template (nutzt die Library-CSS)
├─ assets/
│  ├─ fonts/                     # Selbst gehostete Schriften (Roboto Slab, Material Icons; WOFF2)
│  └─ logos/                     # Logo-Varianten (SVG)
├─ styles/
│  ├─ index.css                  # Einstiegspunkt: importiert alles in Kaskaden-Reihenfolge
│  ├─ tokens.css                 # 1. Design-Tokens — Primitives + semantische, theme-aware Rollen
│  ├─ theme.css                  # 2. Dark-Mode-Overrides (nur der semantischen Tokens)
│  ├─ base.css                   # 3. Fonts, Reset, Roh-Elemente (body, a, code, kbd)
│  ├─ icons.css                  # 4. Material Icons Outlined (@font-face, self-hosted)
│  ├─ layout.css                 # 5. App-Shell (Sidebar, Topbar, Sections, Responsive)
│  ├─ typography.css             # 6. Wiederverwendbare Typo-Skala (.t-h1 … .t-kicker)
│  ├─ components/                # 7. Ausgelieferte, wiederverwendbare UI-Bibliothek
│  │  ├─ accordion.css
│  │  ├─ alerts.css
│  │  ├─ badges.css
│  │  ├─ breadcrumb.css
│  │  ├─ buttons.css
│  │  ├─ cards.css
│  │  ├─ code.css
│  │  ├─ content-states.css      # Leer- (.empty-state) + Fehlerzustand (.error-state)
│  │  ├─ cookie.css              # Cookie-Consent: Variante A (Banner) + B (Modal-Dialog)
│  │  ├─ dropdown.css
│  │  ├─ feedback.css
│  │  ├─ forms.css
│  │  ├─ login.css               # Auth-Seiten-Template (Layout; Felder aus forms.css)
│  │  ├─ overlays.css
│  │  ├─ pagination.css
│  │  ├─ stats.css
│  │  ├─ switch.css
│  │  ├─ tables.css
│  │  └─ tabs.css
│  └─ docs/
│     └─ styleguide.css          # 8. NUR zur Darstellung dieses Dokuments (nicht ausliefern)
├─ scripts/
│  ├─ app.js                     # Namespace `App`, Modul-Registry, init()
│  └─ modules/                   # Je Interaktionsmuster ein Modul (registriert sich bei App)
│     ├─ accordion.js
│     ├─ clipboard.js
│     ├─ cookie-consent.js       # Variante A (Banner)
│     ├─ cookie-modal.js         # Variante B (Modal-Dialog, nutzt App.Overlays)
│     ├─ dropdown.js
│     ├─ forms.js
│     ├─ overlays.js
│     ├─ scroll-spy.js
│     ├─ tabs.js
│     ├─ theme.js
│     └─ toast.js
└─ tokens/
   └─ design-tokens.json         # Optionaler, maschinenlesbarer Spiegel von tokens.css
```

---

## Leitideen der Struktur

1. **Tokens sind die einzige Quelle der Wahrheit.** `tokens.css` trennt
   **Primitives** (rohe Werte wie `--gray-500`, `--space-lg`) von **semantischen,
   theme-aware Rollen** (`--color-surface`, `--color-text`, `--color-border` …).
   Komponenten referenzieren die **semantischen** Tokens — dadurch genügt
   `theme.css`, um per Dark Mode das gesamte System umzufärben, ohne eine einzige
   Komponentenregel anzufassen.
2. **Bibliothek ≠ Dokumentation.** `styles/components/*` ist das Produkt, das in
   Anwendungen eingesetzt wird. `styles/docs/*` existiert nur, um den Styleguide
   selbst darzustellen (Swatches, Spec-Zeilen, Do/Don't-Raster) und wird **nicht**
   mit ausgeliefert.
3. **Verhalten ist modular.** Jedes Interaktionsmuster ist ein eigenständiges,
   framework-freies Modul auf dem globalen `App`-Namespace und wird zentral über
   `App.init()` beim `DOMContentLoaded` gestartet.
4. **Kaskade explizit.** `styles/index.css` definiert die Import-Reihenfolge
   (ITCSS-artig: Tokens → Base → Layout → Typo → Komponenten → Docs).

---

## In einem Produkt verwenden

```html
<!-- Tokens + Dark-Theme + Basis + benötigte Komponenten -->
<link rel="stylesheet" href="styles/tokens.css">
<link rel="stylesheet" href="styles/theme.css">   <!-- optional: Dark Mode -->
<link rel="stylesheet" href="styles/base.css">
<link rel="stylesheet" href="styles/icons.css">   <!-- optional: Icons -->
<link rel="stylesheet" href="styles/components/buttons.css">
<link rel="stylesheet" href="styles/components/forms.css">

<!-- Verhalten (nur die genutzten Module) -->
<script src="scripts/app.js"></script>
<script src="scripts/modules/theme.js"></script>
<script src="scripts/modules/overlays.js"></script>
```

**Dark Mode:** Standard ist stets das **helle** Theme. Der Dark Mode ist ein
manueller Opt-in — `theme.css` + `theme.js` und ein Button mit
`data-theme-toggle` genügen; die Wahl wird in `localStorage` gespeichert und über
`[data-theme="dark"]` angewandt. Die Systemeinstellung (`prefers-color-scheme`)
wird bewusst **nicht** automatisch übernommen. Zur Vermeidung eines Theme-Flashs
das kleine Inline-Script aus dem `<head>` der `index.html` übernehmen (liest
`localStorage` vor dem ersten Paint).

Die `docs/`-Schicht wird dabei weggelassen. Für Produktion sollten die CSS-Dateien
gebündelt und minifiziert werden (die `@import`-Kette in `index.css` lädt sonst
sequenziell).

---

## Neue Komponente hinzufügen

1. `styles/components/<name>.css` anlegen, ausschließlich Tokens referenzieren.
2. Import in `styles/index.css` im Abschnitt „Components" ergänzen.
3. Falls interaktiv: `scripts/modules/<name>.js` anlegen und via
   `App.register('Name', { init() { … } })` registrieren, Script-Tag in
   `index.html` ergänzen.
4. Abschnitt im Styleguide (`index.html`) mit Beispiel + Codeblock ergänzen.

---

## Theming

Das **helle** Theme ist der verbindliche Standard. Der Dark Mode liegt als
**einzelner** Override-Block (`[data-theme="dark"]`) in `styles/theme.css` und
greift ausschließlich manuell über den Umschalter (`data-theme-toggle`,
persistiert in `localStorage`). Da die frühere `prefers-color-scheme`-Dublette
entfallen ist, entfällt auch der zuvor nötige Paritäts-Check — es gibt nur noch
eine Quelle für die Dark-Mode-Werte.

---

## Versionierung

Lebendes Dokument. Änderungen als Pull Request.
