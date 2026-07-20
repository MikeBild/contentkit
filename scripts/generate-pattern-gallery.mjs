import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { patternRegistry } from '../src/composition-registry.mjs'
import { publishingGuideRegistry } from '../src/publishing-guides.mjs'
import { contentkitFontFaceCss, contentkitFontFamilyCompact, contentkitFontFile } from '../src/typography.mjs'
import { compileCompositionMarkdown } from '../src/composition-output.mjs'
import { renderMarkdown } from '../src/markdown.mjs'
import { renderReportChartSvg } from '../src/report-charts.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const gallery = join(root, 'examples/pattern-gallery')
const assetDir = join(gallery, 'assets')
const exampleDir = join(root, 'examples/compositions')
const sourcesOnly = process.env.CONTENTKIT_GALLERY_SOURCES_ONLY === '1'
const skipAssets = process.env.CONTENTKIT_GALLERY_SKIP_ASSETS === '1'
const assetPattern = process.env.CONTENTKIT_GALLERY_PATTERN || ''
const galleryFont = (await readFile(contentkitFontFile)).toString('base64')
const galleryFontCss = contentkitFontFaceCss(`data:font/woff2;base64,${galleryFont}`)

const themes = {
  'neutral-editorial': {
    background: { light: '#ffffff', dark: '#09090b' },
    card: { light: '#ffffff', dark: '#111113' },
    foreground: { light: '240 10% 3.9%', dark: '0 0% 98%' },
    muted: { light: '240 4.8% 95.9%', dark: '240 3.7% 15.9%' },
    muted_foreground: { light: '240 3.8% 32%', dark: '240 5% 64.9%' },
    border: { light: '#d4d4d8', dark: '#3f3f46' },
    primary: { light: '240 5.9% 10%', dark: '0 0% 98%' },
    primary_foreground: { light: '0 0% 98%', dark: '240 5.9% 10%' },
  },
}

const topics = {
  'editorial-poster': ['MCP auf einen Blick', 'Ein gemeinsamer Vertrag für AI-Tools.'],
  'stratified-story': ['Von der Session zum System', 'Wiederholbare KI-Arbeit statt einzelner Chats.'],
  'bento-summary': ['ContentKit-Architektur', 'Semantik, Komposition, Layout und Rendering.'],
  'grouped-dashboard': ['Plattformzustand', 'Betrieb, Delivery und Qualität auf einen Blick.'],
  'table-dashboard': ['Umgebungsvergleich', 'Dev, Staging und Produktion entlang gemeinsamer Kriterien.'],
  'executive-brief': ['Entscheidungsvorlage', 'Empfehlung, Belege und nächste Schritte in einer Seite.'],
  'magazine-story': ['Warum Semantik gewinnt', 'Eine redaktionelle Geschichte über verständliches Publishing.'],
  'hero-banner': ['Composition Engine', 'Semantische Inhalte werden deterministisch publiziert.'],
  'metric-card': ['Build-Zeit', 'Reproduzierbare Performance eines Release-Builds.'],
  'metric-wall': ['Publishing-Kennzahlen', 'Releases, Latenz und Fehlerrate im Überblick.'],
  scorecard: ['Release-Bereitschaft', 'Qualitätskriterien vor der Aktivierung.'],
  'kpi-strip': ['Betrieb heute', 'Fünf gleichrangige Signale im kompakten Überblick.'],
  'progress-rings': ['Programmfortschritt', 'Abschlussgrad der wichtigsten Arbeitsströme.'],
  'bullet-scoreboard': ['Ziele und Ist-Werte', 'Fortschritt im Verhältnis zur gemeinsamen Zielmarke.'],
  'connected-process': ['MCP Tool Call', 'Client, Server und Tool in gerichteter Folge.'],
  'vertical-journey': ['Artikel-Pipeline', 'Von Research über Review bis Veröffentlichung.'],
  'circular-lifecycle': ['Delivery-Lernzyklus', 'Beobachten, entscheiden, handeln und lernen.'],
  funnel: ['Geprüftes Wissen', 'Viele Quellen werden zu wenigen freigegebenen Claims.'],
  'chevron-process': ['Release-Handoffs', 'Vier Stufen übergeben ein geprüftes Artefakt.'],
  'swimlane-process': ['Review im Wechsel', 'Produkt und Plattform arbeiten in klaren Übergaben.'],
  'split-comparison': ['REST und MCP', 'Individuelle Integrationen gegenüber gemeinsamem Vertrag.'],
  'before-after': ['Publishing vorher und nachher', 'Manuelle Schritte werden zu einem reproduzierbaren System.'],
  'comparison-matrix': ['Integrationsansätze', 'Drei Ansätze entlang gemeinsamer Qualitätskriterien.'],
  'feature-table': ['Plattformvergleich', 'Drei Optionen entlang wiederholbarer Dimensionen.'],
  'spectrum-comparison': ['Betriebsmodelle im Spektrum', 'Relative Positionen entlang qualitativer Skalen.'],
  'horizontal-timeline': ['Publishing-Pipeline', 'Die wichtigsten Entwicklungsstufen in zeitlicher Folge.'],
  'vertical-timeline': ['Incident-Chronologie', 'Erkennung, Eingrenzung, Behebung und Nachbereitung.'],
  roadmap: ['Composition-Roadmap', 'Semantik, Patterns, Renderer und Headless-Vertrag.'],
  'milestone-roadmap': ['Programm-Meilensteine', 'Gates und Ergebnisse auf dem Weg zur Freigabe.'],
  'phase-timeline': ['Fünf Lieferphasen', 'Ein Programm von Forschung bis Betrieb.'],
  'tree-hierarchy': ['Dokumentationsnavigation', 'Produkt, Bereiche, Kapitel und Seiten.'],
  'layer-stack': ['Rendering-Schichten', 'Von der Bedeutung bis zur Ausgabe.'],
  pyramid: ['Informationshierarchie', 'Kernaussage, Belege und Details.'],
  'hub-and-spoke': ['AI Tool-Ökosystem', 'Ein Client verbindet mehrere spezialisierte Tools.'],
  'concentric-layers': ['Sicherheitsgrenzen', 'Kontrollen vom Kern bis zum äußeren Kontext.'],
  'architecture-map': ['Publishing-Systemkontext', 'Eingänge, zentrale Komposition und Ausgaben.'],
  'detailed-chart': ['Release-Latenz', 'Build-Dauer in Sekunden nach Monat.'],
  'ranked-bars': ['Nutzung nach Bereich', 'Dokumentaufrufe in absteigender Reihenfolge.'],
  'lollipop-chart': ['Antwortzeit nach Region', 'Direkter Vergleich mit reduzierter visueller Tinte.'],
  'slope-chart': ['Vorher und nachher', 'Veränderung mehrerer Qualitätswerte zwischen zwei Releases.'],
  'small-multiples': ['Service-Signale', 'Mehrere Zeitreihen auf einer gemeinsamen Skala.'],
  'range-dot-plot': ['Lieferkorridore', 'Erwartete Laufzeiten mit unterer und oberer Grenze.'],
  'dumbbell-change': ['Qualität im Vergleich', 'Veränderung je Qualitätsmerkmal zwischen zwei Releases.'],
  'diverging-bars': ['Abweichung vom Plan', 'Positive und negative Beiträge relativ zur Nulllinie.'],
  'likert-distribution': ['Team-Feedback', 'Zustimmung und Ablehnung entlang einer geordneten Skala.'],
  'scatter-correlation': ['Last und Latenz', 'Zusammenhang zweier Messgrößen mit benannten Ausreißern.'],
  'distribution-boxplot': ['Build-Verteilung', 'Median, Quartile und Spannweite nach Umgebung.'],
  'data-heatmap': ['Service-Aktivität', 'Intensität nach Service und Wochentag.'],
  waterfall: ['Release-Budget', 'Beiträge erklären die Veränderung vom Ausgangswert zum Ergebnis.'],
  treemap: ['Speichernutzung', 'Hierarchische Anteile am gesamten Speicherbedarf.'],
  'sankey-flow': ['Anfragen im System', 'Quantitative Flüsse von Eingang über Verarbeitung bis Ergebnis.'],
  'uncertainty-band': ['Kapazitätsprognose', 'Schätzung mit expliziter Unter- und Obergrenze.'],
  'calendar-heatmap': ['Publishing-Aktivität', 'Tägliche Veröffentlichungen über vier Wochen.'],
  'coordinate-map': ['Europäische Knoten', 'Standorte und relative Last anhand echter Koordinaten.'],
  'tile-choropleth': ['Regionale Nutzung', 'Vergleich deutscher Regionen auf gleich großen Kacheln.'],
  'beeswarm-distribution': ['Antwortzeiten', 'Einzelne Messungen zeigen Form und Ausreißer der Verteilung.'],
}

const extraDirectives = {
  'executive-brief': `:::hero{role="primary"}
# Infrastruktur jetzt erweitern

Die Nachfrage überschreitet im August die sichere Kapazität.
:::

::metric{label="Auslastung" value="87 %" trend="+11 pp"}

:::card{title="Beleg"}
Drei Wochen über der internen Warnschwelle.
:::

:::card{title="Risiko"}
Ohne Ausbau steigt die P95-Latenz über 800 ms.
:::

:::card{title="Nächster Schritt"}
Budget freigeben und Rollout am Montag beginnen.
:::`,
  'magazine-story': `:::hero{role="primary"}
# Bedeutung vor Pixeln

Gute visuelle Kommunikation beginnt mit der Aussage, nicht mit Dekoration.
:::

:::card{title="Erst verstehen"}
Beziehungen entscheiden über die passende visuelle Form.
:::

:::card{title="Dann komponieren"}
Patterns übersetzen Bedeutung in eine erkennbare Erzählstruktur.
:::

:::card{title="Schließlich rendern"}
Geometrie und Theme werden deterministisch aufgelöst.
:::`,
  'kpi-strip': `::::group{columns="4" role="primary"}
::metric{label="Verfügbarkeit" value="99,98 %" trend="im Ziel"}

::metric{label="P95-Latenz" value="184 ms" trend="−12 %"}

::metric{label="Releases" value="7" trend="heute"}

::metric{label="Fehlerrate" value="0,08 %" trend="−0,03 pp"}

::metric{label="Queue" value="14" trend="stabil"}
::::`,
  'progress-rings': `::::group{columns="4" role="primary"}
::progress{label="Semantik" value="96" max="100"}

::progress{label="Patterns" value="84" max="100"}

::progress{label="Renderer" value="91" max="100"}

::progress{label="Dokumentation" value="78" max="100"}
::::`,
  'bullet-scoreboard': `::::group{columns="1" role="primary"}
::progress{label="Performance" value="94" max="100"}

::progress{label="Zugänglichkeit" value="91" max="100"}

::progress{label="Testabdeckung" value="86" max="100"}

::progress{label="Dokumentation" value="82" max="100"}

::progress{label="Security" value="97" max="100"}
::::`,
  'chevron-process': `:::process{title="Release-Handoffs" role="primary"}
- Build · unveränderliches Artefakt erzeugen
- Prüfen · Tests und Richtlinien anwenden
- Freigeben · Entscheidung dokumentieren
- Aktivieren · Release atomar umschalten
:::`,
  'swimlane-process': `:::process{title="Review im Wechsel" role="primary"}
- Briefing · Produkt
- Datenprüfung · Plattform
- Aussage · Produkt
- Rendering · Plattform
- Freigabe · Produkt
- Veröffentlichung · Plattform
:::`,
  'feature-table': `::::comparison{title="Plattformvergleich" role="primary"}
:::side{label="Basis"}
- Semantik · Dokumente
- Responsive · manuell
- Export · HTML
- Agent-Vertrag · nein
:::
:::side{label="Erweitert"}
- Semantik · Komponenten
- Responsive · Regeln
- Export · HTML und SVG
- Agent-Vertrag · teilweise
:::
:::side{label="ContentKit"}
- Semantik · Beziehungen
- Responsive · Fallbacks
- Export · HTML, SVG und PNG
- Agent-Vertrag · vollständig
:::
::::`,
  'spectrum-comparison': `::::comparison{title="Betriebsmodelle" role="primary"}
:::side{label="Direkt"}
- Kopplung · hoch
- Wiederverwendung · gering
- Standardisierung · gering
:::
:::side{label="Gateway"}
- Kopplung · mittel
- Wiederverwendung · mittel
- Standardisierung · mittel
:::
:::side{label="Vertrag"}
- Kopplung · gering gekoppelt
- Wiederverwendung · hoch
- Standardisierung · hoch
:::
::::`,
  'milestone-roadmap': `:::timeline{title="Programm-Meilensteine" role="primary"}
- M1 · Problem validiert
- M2 · Vertrag freigegeben
- M3 · Pilot produktiv
- M4 · Qualitätsgate bestanden
- M5 · Rollout abgeschlossen
:::`,
  'phase-timeline': `:::timeline{title="Lieferphasen" role="primary"}
- Research · Bedarf und Quellen
- Modell · Semantik und Narrative
- Build · Layout und Renderer
- Validate · Desktop und Mobile
- Operate · Messen und verbessern
:::`,
  'concentric-layers': `:::hierarchy{title="Sicherheitsgrenzen" role="primary"}
- Inhalt · validierte Semantik
- Komposition · erlaubte Patterns
- Rendering · kontrollierte Ausgabe
- Release · unveränderliche Artefakte
- Zugriff · autorisierte Auslieferung
:::`,
  'architecture-map': `:::relationship{title="Publishing-Systemkontext" role="primary"}
- ContentKit · semantische Komposition
- Markdown · Autoreneingang
- Daten · geprüfte Evidenz
- AI Agent · Headless Planung
- HTML · responsive Veröffentlichung
- SVG · eigenständige Grafik
- PNG · reproduzierbarer Export
:::`,
  'ranked-bars': `:::chart{type="bar" orientation="horizontal" title="Nutzung nach Bereich" description="Dokumentaufrufe der sechs meistgenutzten Bereiche"}
| Bereich | Aufrufe |
|---|---:|
| API | 18400 |
| Grundlagen | 15300 |
| Tutorials | 12100 |
| Betrieb | 9800 |
| Sicherheit | 7400 |
| Referenz | 6100 |
:::`,
  'lollipop-chart': `:::chart{type="bar" orientation="horizontal" title="Antwortzeit nach Region" description="P95-Antwortzeit in Millisekunden" unit="ms"}
| Region | P95 |
|---|---:|
| Frankfurt | 142 |
| London | 168 |
| Virginia | 214 |
| Singapore | 286 |
| Sydney | 312 |
:::`,
  'slope-chart': `:::chart{type="line" title="Vorher und nachher" description="Qualitätswerte zwischen Release 1 und Release 2" unit="%"}
| Release | Zugänglichkeit | Performance | Abdeckung |
|---|---:|---:|---:|
| Release 1 | 78 | 84 | 81 |
| Release 2 | 94 | 91 | 88 |
:::`,
  'small-multiples': `:::chart{type="line" title="Service-Signale" description="Vier normalisierte Servicesignale über sechs Wochen"}
| Woche | API | Build | Suche | Publishing |
|---|---:|---:|---:|---:|
| W1 | 68 | 74 | 61 | 70 |
| W2 | 72 | 71 | 65 | 73 |
| W3 | 76 | 78 | 69 | 77 |
| W4 | 79 | 82 | 74 | 80 |
| W5 | 83 | 86 | 78 | 84 |
| W6 | 88 | 90 | 82 | 89 |
:::`,
  'range-dot-plot': `:::chart{type="bar" shape="range" orientation="horizontal" title="Lieferkorridore" description="Erwartete Dauer je Arbeitsstrom mit unterer und oberer Grenze" unit="Tage"}
| Arbeitsstrom | Untergrenze | Obergrenze |
|---|---:|---:|
| Semantik | 8 | 12 |
| Renderer | 11 | 17 |
| API | 6 | 10 |
| Dokumentation | 5 | 9 |
| Validierung | 9 | 14 |
:::`,
  'dumbbell-change': `:::chart{type="bar" shape="change" orientation="horizontal" title="Qualität im Vergleich" description="Werte vor und nach der Überarbeitung" unit="%"}
| Merkmal | Vorher | Nachher |
|---|---:|---:|
| Zugänglichkeit | 72 | 94 |
| Performance | 81 | 91 |
| Verständlichkeit | 68 | 89 |
| Konsistenz | 76 | 93 |
| Abdeckung | 79 | 88 |
:::`,
  'diverging-bars': `:::chart{type="bar" shape="diverging" orientation="horizontal" title="Abweichung vom Plan" description="Abweichung in Personentagen gegenüber dem Plan" unit="PT"}
| Bereich | Abweichung |
|---|---:|
| Research | -4 |
| Semantik | 6 |
| Renderer | 9 |
| API | -3 |
| Dokumentation | 2 |
| Review | -5 |
:::`,
  'likert-distribution': `:::chart{type="bar" shape="likert" stacked="true" title="Team-Feedback" description="Anteile je Aussage in Prozent" unit="%"}
| Aussage | Ablehnung | Neutral | Zustimmung |
|---|---:|---:|---:|
| Semantik ist verständlich | 12 | 18 | 70 |
| Patterns sind unterscheidbar | 16 | 21 | 63 |
| Mobile Ausgabe überzeugt | 9 | 17 | 74 |
| Dokumentation hilft | 7 | 15 | 78 |
:::`,
  'scatter-correlation': `:::chart{type="line" shape="xy" title="Last und Latenz" description="Anfragen pro Sekunde und P95-Latenz je Service" unit="ms"}
| Service | Anfragen/s | P95-Latenz |
|---|---:|---:|
| Auth | 240 | 128 |
| Content | 420 | 166 |
| Search | 690 | 238 |
| Media | 330 | 312 |
| Build | 180 | 196 |
| Publish | 510 | 204 |
| Analytics | 760 | 286 |
:::`,
  'distribution-boxplot': `:::chart{type="bar" shape="boxplot" orientation="horizontal" title="Build-Verteilung" description="Build-Dauer nach Umgebung als Fünf-Punkte-Zusammenfassung" unit="s"}
| Umgebung | Minimum | Q1 | Median | Q3 | Maximum |
|---|---:|---:|---:|---:|---:|
| Development | 1.2 | 1.7 | 2.1 | 2.8 | 4.2 |
| Staging | 1.8 | 2.4 | 2.9 | 3.6 | 5.1 |
| Production | 2.0 | 2.7 | 3.2 | 3.9 | 5.8 |
:::`,
  'data-heatmap': `:::chart{type="bar" shape="matrix" title="Service-Aktivität" description="Normalisierte Aktivität je Service und Wochentag"}
| Service | Mo | Di | Mi | Do | Fr |
|---|---:|---:|---:|---:|---:|
| API | 72 | 81 | 88 | 79 | 66 |
| Build | 48 | 65 | 91 | 74 | 57 |
| Search | 68 | 73 | 77 | 84 | 71 |
| Publishing | 35 | 58 | 82 | 69 | 93 |
| Media | 55 | 62 | 70 | 76 | 64 |
:::`,
  waterfall: `:::chart{type="bar" shape="waterfall" title="Release-Budget" description="Beiträge zur Veränderung des verfügbaren Budgets" unit="Tsd. €"}
| Beitrag | Wert |
|---|---:|
| Ausgangswert | 120 |
| Infrastruktur | -28 |
| Automatisierung | 18 |
| Qualität | -16 |
| Einsparungen | 24 |
| Schuldenabbau | -12 |
:::`,
  treemap: `:::chart{type="bar" shape="hierarchy" title="Speichernutzung" description="Speicherbedarf nach Bereich und Artefakttyp" unit="GB"}
| Element | Übergeordnet | Wert |
|---|---|---:|
| Bilder | Medien | 38 |
| Audio | Medien | 24 |
| Videos | Medien | 18 |
| Releases | Builds | 31 |
| Vorschauen | Builds | 14 |
| Quellen | Inhalte | 20 |
| Revisionen | Inhalte | 12 |
:::`,
  'sankey-flow': `:::chart{type="bar" shape="flow" title="Anfragen im System" description="Anzahl der Anfragen zwischen Verarbeitungsschritten"}
| Quelle | Ziel | Anzahl |
|---|---|---:|
| Eingang | Validiert | 920 |
| Eingang | Abgelehnt | 80 |
| Validiert | Cache | 310 |
| Validiert | Renderer | 610 |
| Cache | Ausgeliefert | 300 |
| Renderer | Ausgeliefert | 590 |
| Renderer | Fehler | 20 |
:::`,
  'uncertainty-band': `:::chart{type="line" shape="uncertainty" title="Kapazitätsprognose" description="Erwartete Last mit 80-Prozent-Prognoseintervall" unit="%"}
| Monat | Untergrenze | Schätzung | Obergrenze |
|---|---:|---:|---:|
| August | 61 | 68 | 75 |
| September | 64 | 72 | 81 |
| Oktober | 67 | 77 | 87 |
| November | 70 | 81 | 92 |
| Dezember | 72 | 84 | 96 |
:::`,
  'calendar-heatmap': `:::chart{type="bar" shape="calendar" title="Publishing-Aktivität" description="Veröffentlichungen pro Tag im Juni 2026"}
| Datum | Veröffentlichungen |
|---|---:|
| 2026-06-01 | 2 |
| 2026-06-02 | 4 |
| 2026-06-03 | 3 |
| 2026-06-04 | 6 |
| 2026-06-05 | 5 |
| 2026-06-06 | 1 |
| 2026-06-07 | 2 |
| 2026-06-08 | 7 |
| 2026-06-09 | 4 |
| 2026-06-10 | 8 |
| 2026-06-11 | 6 |
| 2026-06-12 | 3 |
| 2026-06-13 | 2 |
| 2026-06-14 | 1 |
| 2026-06-15 | 5 |
| 2026-06-16 | 9 |
| 2026-06-17 | 7 |
| 2026-06-18 | 8 |
| 2026-06-19 | 4 |
| 2026-06-20 | 3 |
| 2026-06-21 | 2 |
| 2026-06-22 | 6 |
| 2026-06-23 | 10 |
| 2026-06-24 | 8 |
| 2026-06-25 | 5 |
| 2026-06-26 | 7 |
| 2026-06-27 | 2 |
| 2026-06-28 | 4 |
:::`,
  'coordinate-map': `:::chart{type="bar" shape="geo-point" title="Europäische Knoten" description="Standorte nach Koordinaten und normalisierter Auslastung" unit="%"}
| Standort | Breitengrad | Längengrad | Auslastung |
|---|---:|---:|---:|
| Dublin | 53.35 | -6.26 | 62 |
| London | 51.51 | -0.13 | 78 |
| Frankfurt | 50.11 | 8.68 | 94 |
| Stockholm | 59.33 | 18.07 | 71 |
| Madrid | 40.42 | -3.70 | 56 |
| Warschau | 52.23 | 21.01 | 67 |
| Mailand | 45.46 | 9.19 | 73 |
:::`,
  'tile-choropleth': `:::chart{type="bar" shape="geo-region" title="Regionale Nutzung" description="Aktive Dokumente je Bundesland"}
| Region | Dokumente |
|---|---:|
| Schleswig-Holstein | 84 |
| Hamburg | 132 |
| Mecklenburg-Vorpommern | 88 |
| Bremen | 73 |
| Niedersachsen | 118 |
| Berlin | 176 |
| Brandenburg | 102 |
| Nordrhein-Westfalen | 164 |
| Hessen | 141 |
| Sachsen-Anhalt | 91 |
| Sachsen | 109 |
| Rheinland-Pfalz | 96 |
| Thüringen | 99 |
| Saarland | 68 |
| Baden-Württemberg | 153 |
| Bayern | 169 |
:::`,
  'beeswarm-distribution': `:::chart{type="bar" shape="samples" title="Antwortzeiten" description="Einzelmessungen der P95-Antwortzeit nach Umgebung" unit="ms"}
| Umgebung | Messwert |
|---|---:|
| Dev | 118 |
| Dev | 126 |
| Dev | 131 |
| Dev | 134 |
| Dev | 142 |
| Dev | 151 |
| Dev | 166 |
| Staging | 139 |
| Staging | 148 |
| Staging | 154 |
| Staging | 161 |
| Staging | 169 |
| Staging | 181 |
| Staging | 204 |
| Produktion | 152 |
| Produktion | 159 |
| Produktion | 167 |
| Produktion | 174 |
| Produktion | 186 |
| Produktion | 198 |
| Produktion | 236 |
:::`,
}

function directive(pattern) {
  if (extraDirectives[pattern.id]) return extraDirectives[pattern.id]
  if (pattern.id === 'editorial-poster')
    return `:::hero{role="primary"}\n# Ein Vertrag. Viele Tools.\n\nMCP trennt AI-Anwendungen von einzelnen Integrationen.\n:::\n\n::metric{label="Schnittstelle" value="1 Vertrag" trend="für alle Tools"}\n\n::metric{label="Server" value="Wiederverwendbar" trend="über Clients hinweg"}\n\n::metric{label="Integration" value="Entkoppelt" trend="klar testbar"}`
  if (pattern.id === 'stratified-story')
    return `:::hero{role="primary"}\n# Von Einzelschritten zum System\n\nWiederholbare Publishing-Arbeit braucht klare Schichten.\n:::\n\n:::card{title="Bedeutung"}\nSemantik beschreibt, was eine Aussage meint.\n:::\n\n:::card{title="Erzählform"}\nKomposition wählt das passende visuelle Muster.\n:::\n\n:::card{title="Ausgabe"}\nLayout und Rendering erzeugen reproduzierbare Artefakte.\n:::`
  if (pattern.id === 'bento-summary')
    return `:::hero{role="primary"}\n# ContentKit\n\nHeadless Publishing mit semantischer visueller Komposition.\n:::\n\n::metric{label="Patterns" value="${patternRegistry.length}" trend="deklarativ"}\n\n:::card{title="Semantic AST"}\nBedeutung bleibt unabhängig vom Renderer.\n:::\n\n:::card{title="Headless"}\nAgents können planen, kompilieren und prüfen.\n:::\n\n:::card{title="Ausgaben"}\nResponsive HTML, SVG und PNG.\n:::`
  if (pattern.id === 'grouped-dashboard')
    return `::::group{columns="2" role="primary"}\n:::card{title="Betrieb"}\n99,98 % Verfügbarkeit · keine aktive Störung\n:::\n\n:::card{title="Delivery"}\n42 Releases · Median 2,4 Sekunden\n:::\n\n:::card{title="Qualität"}\n366 Unit-Tests · 94 % Abdeckung\n:::\n\n:::card{title="Inhalt"}\n1.284 Dokumente · 86 neu im Quartal\n:::\n::::`
  if (pattern.id === 'table-dashboard')
    return `::::group{columns="3" role="primary"}\n:::card{title="Development"}\nSchnelle Iteration · Beispieldaten · täglich\n:::\n\n:::card{title="Staging"}\nProduktionsnah · anonymisierte Daten · pro Release\n:::\n\n:::card{title="Production"}\nHochverfügbar · echte Daten · kontrollierte Freigabe\n:::\n::::`
  if (pattern.id === 'hero-banner')
    return `:::hero{role="primary"}\n# Composition Engine\n\nSemantische Inhalte werden deterministisch publiziert.\n:::`
  if (pattern.id === 'metric-card')
    return `::metric{label="Build-Zeit" value="2,4 s" trend="−18 %" tone="positive" role="primary"}`
  if (pattern.id === 'metric-wall')
    return `::::group{columns="3" role="primary"}\n::metric{label="Releases" value="42" trend="+12 %" tone="positive"}\n\n::metric{label="Build-Zeit" value="2,4 s" trend="−18 %" tone="positive"}\n\n::metric{label="Fehlerrate" value="0,08 %" trend="−0,03 pp" tone="positive"}\n\n::metric{label="Abdeckung" value="94 %" trend="+3 pp" tone="positive"}\n\n::metric{label="Dokumente" value="1.284" trend="+86" tone="neutral"}\n\n::metric{label="Verfügbarkeit" value="99,98 %" tone="neutral"}\n::::`
  if (pattern.id === 'scorecard')
    return `::::group{columns="1" role="primary"}\n::progress{label="Tests" value="98" max="100"}\n\n::progress{label="Barrierefreiheit" value="92" max="100"}\n\n::progress{label="Dokumentation" value="87" max="100"}\n\n::progress{label="Performance" value="95" max="100"}\n\n::progress{label="Security Review" value="90" max="100"}\n::::`
  if (pattern.id === 'split-comparison')
    return `::::comparison{title="REST und MCP" role="primary"}\n:::side{label="REST"}\n- Integration · individuell pro API\n- Kopplung · häufig hoch\n- Wiederverwendung · begrenzt\n:::\n:::side{label="MCP"}\n- Integration · gemeinsamer Vertrag\n- Kopplung · klar getrennt\n- Wiederverwendung · serverübergreifend\n:::\n::::`
  if (pattern.id === 'before-after')
    return `::::comparison{title="Publishing-Transformation" role="primary"}\n:::side{label="Vorher"}\n- Layout wird pro Seite entschieden\n- Ausgaben unterscheiden sich\n- Mobile braucht Handarbeit\n:::\n:::side{label="Nachher"}\n- Semantik wählt passende Patterns\n- Ausgabe ist reproduzierbar\n- Responsive Fallbacks sind geprüft\n:::\n::::`
  if (pattern.id === 'comparison-matrix')
    return `::::comparison{title="Integrationsansätze" role="primary"}\n:::side{label="Direkt"}\n- Vertrag · proprietär\n- Wiederverwendung · gering\n- Kopplung · hoch\n:::\n:::side{label="Gateway"}\n- Vertrag · intern\n- Wiederverwendung · mittel\n- Kopplung · mittel\n:::\n:::side{label="MCP"}\n- Vertrag · gemeinsam\n- Wiederverwendung · hoch\n- Kopplung · gering\n:::\n::::`
  if (pattern.id === 'connected-process')
    return `:::process{title="MCP Tool Call" role="primary"}\n- Client · stellt eine strukturierte Anfrage\n- Server · prüft Vertrag und Berechtigung\n- Tool · führt die Aktion aus\n- Ergebnis · fließt zum Client zurück\n:::`
  if (pattern.id === 'vertical-journey')
    return `:::process{title="Artikel-Pipeline" role="primary"}\n- Research · Quellen sammeln und prüfen\n- Entwurf · Aussage und Belege strukturieren\n- Review · Fakten, Sprache und Zugänglichkeit testen\n- Freigabe · reproduzierbar publizieren\n:::`
  if (pattern.id === 'circular-lifecycle')
    return `:::process{title="Delivery-Lernzyklus" role="primary"}\n- Beobachten · messbare Signale erfassen\n- Entscheiden · nächste Hypothese wählen\n- Handeln · kleine Änderung liefern\n- Lernen · Wirkung mit Erwartung vergleichen\n:::`
  if (pattern.id === 'funnel')
    return `:::process{title="Wissensverdichtung" role="primary"}\n- 120 Quellen · breites Ausgangsmaterial\n- 48 relevante Fundstellen · thematisch passend\n- 16 belegte Aussagen · quellenübergreifend bestätigt\n- 5 freigegebene Claims · klar und publizierbar\n:::`
  if (pattern.category === 'comparison')
    return `::::comparison{title="Vergleich" role="primary"}\n:::side{label="Individuell"}\n- einzelne Integration\n- manuelle Layoutentscheidungen\n- uneinheitliche Ausgabe\n:::\n:::side{label="Pattern-basiert"}\n- gemeinsamer Vertrag\n- geprüfte Patterns\n- reproduzierbare Ausgabe\n:::\n::::`
  if (pattern.id === 'horizontal-timeline')
    return `:::timeline{title="Publishing-Pipeline" role="primary"}\n- 09.00 Uhr · Datenimport\n- 09.08 Uhr · Validierung\n- 09.14 Uhr · Komposition\n- 09.17 Uhr · Freigabe\n- 09.20 Uhr · Veröffentlichung\n:::`
  if (pattern.id === 'vertical-timeline')
    return `:::timeline{title="Incident-Chronologie" role="primary"}\n- 10.04 Uhr · Alarm ausgelöst\n- 10.11 Uhr · Ursache eingegrenzt\n- 10.23 Uhr · Korrektur ausgerollt\n- 10.31 Uhr · Dienst stabil\n- 14.00 Uhr · Nachbereitung abgeschlossen\n:::`
  if (pattern.id === 'roadmap')
    return `:::timeline{title="Composition-Roadmap" role="primary"}\n- Q1 · Semantic AST stabilisieren\n- Q2 · Pattern-Verträge ausbauen\n- Q3 · Renderer und Export härten\n- Q4 · Headless Agent-Nutzung validieren\n:::`
  if (pattern.id === 'hub-and-spoke')
    return `:::relationship{title="Tool-Ökosystem" role="primary"}\n- AI Client · gemeinsamer Einstieg\n- WikiKit · Wissen und Quellen\n- SubKit · Daten und Verdichtung\n- ContentKit · Komposition und Publishing\n- Tool Server · ausführbare Fähigkeiten\n:::`
  if (pattern.id === 'tree-hierarchy')
    return `:::hierarchy{title="Dokumentationsnavigation" role="primary"}\n- ContentKit\n- Grundlagen\n- Autoren\n- Betreiber\n- API-Referenz\n:::`
  if (pattern.id === 'layer-stack')
    return `:::hierarchy{title="Rendering-Schichten" role="primary"}\n- Semantik · Bedeutung und Beziehungen\n- Narrative · Aussage und Reihenfolge\n- Komposition · visuelle Erzählform\n- Layout · konkrete Geometrie\n- Rendering · HTML, SVG und PNG\n:::`
  if (pattern.id === 'pyramid')
    return `:::hierarchy{title="Informationshierarchie" role="primary"}\n- Kernaussage · muss ohne Kontext verständlich sein\n- Hauptbelege · tragen die zentrale Aussage\n- Einordnung · erklärt Bedeutung und Grenzen\n- Detaildaten · ermöglichen Prüfung und Vertiefung\n:::`
  if (pattern.category === 'data')
    return `:::chart{type="line" title="Release-Latenz sinkt" description="Median der Build-Dauer von Januar bis Juni" unit="s"}\n| Monat | Dauer |\n|---|---:|\n| Januar | 4.8 |\n| Februar | 4.1 |\n| März | 3.6 |\n| April | 3.1 |\n| Mai | 2.7 |\n| Juni | 2.4 |\n:::`
  return `:::hero{role="primary"}\n# Semantische Komposition\n\nEine klare Aussage führt durch die Seite.\n:::\n\n::metric{label="Reproduzierbar" value="100 %" tone="positive"}\n\n:::process{title="Pipeline"}\n- Semantic AST\n- Composition\n- Rendering\n:::`
}

function markdown(pattern) {
  const [title, summary] = topics[pattern.id]
  const canvas = pattern.selection.canvases.includes('landscape') ? 'landscape' : pattern.selection.canvases[0]
  return `---\nkind: page\nlayout: composition\ntitle: ${title}\nsummary: ${summary}\nlocale: de\nslug: pattern-${pattern.id}\ntranslationKey: pattern-${pattern.id}\ncomposition:\n  format: infographic\n  canvas: ${canvas}\n  intent: ${pattern.selection.intents[0]}\n  density: ${pattern.selection.densities[0]}\n  preferredPattern: ${pattern.id}\n---\n\n${directive(pattern)}\n`
}

const englishPhrases = [
  ['Ein gemeinsamer Vertrag für AI-Tools.', 'A shared contract for AI tools.'],
  ['Ein Vertrag. Viele Tools.', 'One contract. Many tools.'],
  ['Von Einzelschritten zum System', 'From isolated steps to a system'],
  ['Wiederholbare KI-Arbeit statt einzelner Chats.', 'Repeatable AI work instead of isolated chats.'],
  ['Semantik, Komposition, Layout und Rendering.', 'Semantics, composition, layout, and rendering.'],
  [
    'Headless Publishing mit semantischer visueller Komposition.',
    'Headless publishing with semantic visual composition.',
  ],
  ['Bedeutung bleibt unabhängig vom Renderer.', 'Meaning remains independent of the renderer.'],
  ['Agenten können planen, kompilieren und prüfen.', 'Agents can plan, compile, and validate.'],
  ['Responsive HTML, SVG und PNG.', 'Responsive HTML, SVG, and PNG.'],
  ['Betrieb, Delivery und Qualität auf einen Blick.', 'Operations, delivery, and quality at a glance.'],
  [
    'Dev, Staging und Produktion entlang gemeinsamer Kriterien.',
    'Development, staging, and production along shared criteria.',
  ],
  ['Empfehlung, Belege und nächste Schritte in einer Seite.', 'Recommendation, evidence, and next steps on one page.'],
  ['Eine redaktionelle Geschichte über verständliches Publishing.', 'An editorial story about clear publishing.'],
  ['Semantische Inhalte werden deterministisch publiziert.', 'Semantic content is published deterministically.'],
  ['Reproduzierbare Performance eines Release-Builds.', 'Reproducible performance of a release build.'],
  ['Releases, Latenz und Fehlerrate im Überblick.', 'Releases, latency, and error rate at a glance.'],
  ['Qualitätskriterien vor der Aktivierung.', 'Quality criteria before activation.'],
  ['Fünf gleichrangige Signale im kompakten Überblick.', 'Five equal signals in a compact overview.'],
  ['Abschlussgrad der wichtigsten Arbeitsströme.', 'Completion of the most important workstreams.'],
  ['Fortschritt im Verhältnis zur gemeinsamen Zielmarke.', 'Progress against a shared target.'],
  ['Client, Server und Tool in gerichteter Folge.', 'Client, server, and tool in a directed sequence.'],
  ['Von Research über Review bis Veröffentlichung.', 'From research through review to publication.'],
  ['Beobachten, entscheiden, handeln und lernen.', 'Observe, decide, act, and learn.'],
  ['Viele Quellen werden zu wenigen freigegebenen Claims.', 'Many sources become a small set of approved claims.'],
  ['Vier Stufen übergeben ein geprüftes Artefakt.', 'Four stages hand off a validated artifact.'],
  ['Produkt und Plattform arbeiten in klaren Übergaben.', 'Product and platform work through clear handoffs.'],
  [
    'Individuelle Integrationen gegenüber gemeinsamem Vertrag.',
    'Individual integrations compared with a shared contract.',
  ],
  ['Manuelle Schritte werden zu einem reproduzierbaren System.', 'Manual steps become a reproducible system.'],
  ['Drei Ansätze entlang gemeinsamer Qualitätskriterien.', 'Three approaches along shared quality criteria.'],
  ['Drei Optionen entlang wiederholbarer Dimensionen.', 'Three options along repeatable dimensions.'],
  ['Relative Positionen entlang qualitativer Skalen.', 'Relative positions along qualitative scales.'],
  ['Die wichtigsten Entwicklungsstufen in zeitlicher Folge.', 'The most important development stages over time.'],
  ['Erkennung, Eingrenzung, Behebung und Nachbereitung.', 'Detection, containment, resolution, and follow-up.'],
  ['Gates und Ergebnisse auf dem Weg zur Freigabe.', 'Gates and outcomes on the path to approval.'],
  ['Ein Programm von Forschung bis Betrieb.', 'A program from research to operations.'],
  ['Produkt, Bereiche, Kapitel und Seiten.', 'Product, areas, chapters, and pages.'],
  ['Von der Bedeutung bis zur Ausgabe.', 'From meaning to output.'],
  ['Kernaussage, Belege und Details.', 'Key message, evidence, and details.'],
  ['Ein Client verbindet mehrere spezialisierte Tools.', 'One client connects several specialized tools.'],
  ['Kontrollen vom Kern bis zum äußeren Kontext.', 'Controls from the core to the surrounding context.'],
  ['Eingänge, zentrale Komposition und Ausgaben.', 'Inputs, central composition, and outputs.'],
  ['Build-Dauer in Sekunden nach Monat.', 'Build duration in seconds by month.'],
  ['Dokumentaufrufe in absteigender Reihenfolge.', 'Document views in descending order.'],
  ['Direkter Vergleich mit reduzierter visueller Tinte.', 'Direct comparison with reduced visual ink.'],
  [
    'Veränderung mehrerer Qualitätswerte zwischen zwei Releases.',
    'Change in several quality values between two releases.',
  ],
  ['Mehrere Zeitreihen auf einer gemeinsamen Skala.', 'Several time series on a shared scale.'],
  ['Erwartete Laufzeiten mit unterer und oberer Grenze.', 'Expected durations with lower and upper bounds.'],
  ['Positive und negative Beiträge relativ zur Nulllinie.', 'Positive and negative contributions relative to zero.'],
  ['Zustimmung und Ablehnung entlang einer geordneten Skala.', 'Agreement and disagreement on an ordered scale.'],
  [
    'Zusammenhang zweier Messgrößen mit benannten Ausreißern.',
    'Relationship between two measures with labeled outliers.',
  ],
  ['Median, Quartile und Spannweite nach Umgebung.', 'Median, quartiles, and range by environment.'],
  ['Intensität nach Service und Wochentag.', 'Intensity by service and weekday.'],
  [
    'Beiträge erklären die Veränderung vom Ausgangswert zum Ergebnis.',
    'Contributions explain the change from baseline to result.',
  ],
  ['Hierarchische Anteile am gesamten Speicherbedarf.', 'Hierarchical shares of total storage use.'],
  [
    'Quantitative Flüsse von Eingang über Verarbeitung bis Ergebnis.',
    'Quantitative flows from input through processing to result.',
  ],
  ['Schätzung mit expliziter Unter- und Obergrenze.', 'Estimate with explicit lower and upper bounds.'],
  ['Tägliche Veröffentlichungen über vier Wochen.', 'Daily publications across four weeks.'],
  ['Standorte und relative Last anhand echter Koordinaten.', 'Locations and relative load using real coordinates.'],
  ['Vergleich deutscher Regionen auf gleich großen Kacheln.', 'Comparison of regions using equal-sized tiles.'],
  [
    'Einzelne Messungen zeigen Form und Ausreißer der Verteilung.',
    'Individual observations reveal distribution shape and outliers.',
  ],
  ['Kennzahlen führen zu Analyse und vollständiger Evidenz.', 'Metrics lead to analysis and complete evidence.'],
  ['Jede Abbildung behält Beschriftung und Alternative.', 'Every figure retains its caption and text alternative.'],
  ['Drei vollständige API-Schritte in einer lesbaren Folge.', 'Three complete API steps in a readable sequence.'],
  ['Ein Dienst mit Kennzahlen und Belegen.', 'One service with metrics and evidence.'],
  [
    'Ein Hauptmotiv führt durch unterstützende Produktoberflächen.',
    'A lead visual guides through supporting product surfaces.',
  ],
  [
    'Fragen werden über ausschließlich authored Kategorien gruppiert.',
    'Questions are grouped by explicitly authored categories.',
  ],
  [
    'Kurze unabhängige Antworten in einer scanbaren Anordnung.',
    'Short independent answers in a scannable arrangement.',
  ],
  ['Häufige Fragen zur deterministischen Veröffentlichung.', 'Common questions about deterministic publishing.'],
  [
    'Eine zentrale Kennzahl wird durch drei Werte eingeordnet.',
    'One primary metric is contextualized by three values.',
  ],
  [
    'Mehrere authored Dateien bilden eine nachvollziehbare Implementierung.',
    'Several authored files form a traceable implementation.',
  ],
  ['Gleichwertige Medien in einem ruhigen Kontaktbogen.', 'Equal media items in a calm contact sheet.'],
  [
    'Betriebsdaten tragen authored Umgebungen und Zustände.',
    'Operational data retains authored environments and states.',
  ],
  [
    'Aktueller Zustand, Fortschritt und Ausnahmen in einer Oberfläche.',
    'Current state, progress, and exceptions in one surface.',
  ],
  [
    'Ein Grundangebot und optionale Erweiterungen bleiben getrennt.',
    'A base offer and optional add-ons remain separate.',
  ],
  [
    'Drei vergleichbare Pläne mit authored Preisen und Leistungen.',
    'Three comparable plans with authored prices and features.',
  ],
  ['Gemeinsame Feature-Identitäten werden als Matrix ausgerichtet.', 'Shared feature identities align as a matrix.'],
  [
    'Eine authored Empfehlung führt, Alternativen bleiben sichtbar.',
    'An authored recommendation leads while alternatives remain visible.',
  ],
  ['Tabellenzeilen werden zu klar beschrifteten Datensätzen.', 'Table rows become clearly labeled records.'],
  [
    'Stabile Datensätze bleiben als Tabelle und mobile Record Cards lesbar.',
    'Stable records remain readable as a table and mobile record cards.',
  ],
  [
    'Kontrollierte Anwendungsregionen mit persistenter Navigation.',
    'Controlled application regions with persistent navigation.',
  ],
  [
    'Navigation, Hauptarbeit und Vorschau bleiben gleichzeitig sichtbar.',
    'Navigation, primary work, and preview remain visible together.',
  ],
  ['Authored Zeiträume ordnen gleichartige Messwerte.', 'Authored periods order comparable measurements.'],
  [
    'Vier gleichrangige Betriebskennzahlen mit authored Kontext.',
    'Four equal operational metrics with authored context.',
  ],
  ['Gleichwertige API-Aufrufe als vollständige Codevarianten.', 'Equivalent API calls as complete code variants.'],
  [
    'Navigation und Hauptinhalt stapeln auf schmalen Containern.',
    'Navigation and primary content stack in narrow containers.',
  ],
  ['Infrastruktur jetzt erweitern', 'Expand infrastructure now'],
  ['Die Nachfrage überschreitet im August die sichere Kapazität.', 'Demand exceeds safe capacity in August.'],
  ['Drei Wochen über der internen Warnschwelle.', 'Three weeks above the internal warning threshold.'],
  ['Ohne Ausbau steigt die P95-Latenz über 800 ms.', 'Without expansion, P95 latency rises above 800 ms.'],
  ['Budget freigeben und Rollout am Montag beginnen.', 'Approve the budget and begin rollout on Monday.'],
  ['Bedeutung vor Pixeln', 'Meaning before pixels'],
  [
    'Gute visuelle Kommunikation beginnt mit der Aussage, nicht mit Dekoration.',
    'Good visual communication begins with the message, not decoration.',
  ],
  ['Beziehungen entscheiden über die passende visuelle Form.', 'Relationships determine the appropriate visual form.'],
  [
    'Patterns übersetzen Bedeutung in eine erkennbare Erzählstruktur.',
    'Patterns translate meaning into a recognizable narrative structure.',
  ],
  ['Geometrie und Theme werden deterministisch aufgelöst.', 'Geometry and theme are resolved deterministically.'],
]

const englishTerms = [
  [
    'Der PNG Worker liegt über dem Latenzziel. Eine Veröffentlichung wartet auf Freigabe.',
    'The PNG worker is above its latency target. One publication is waiting for approval.',
  ],
  [
    'Die wichtigsten Veröffentlichungsdaten mit vollständigem Zugriff auf Detailansichten.',
    'The most important publishing data with complete access to detail views.',
  ],
  ['Zwei Entwürfe warten auf redaktionelle Review.', 'Two drafts are waiting for editorial review.'],
  [
    'Semantisches Markdown mit Patternpräferenz und vollständigen Inhaltsbudgets.',
    'Semantic Markdown with a pattern preference and complete content budgets.',
  ],
  ['Responsive HTML-Vorschau der aktuellen Composition.', 'Responsive HTML preview of the current composition.'],
  [
    'Deterministische Transformation von Markdown in alle visuellen Repräsentationen.',
    'Deterministic transformation from Markdown into every visual representation.',
  ],
  ['Agenten können planen, kompilieren und review.', 'Agents can plan, compile, and validate.'],
  ['Build · unveränderliches Artefakt erzeugen', 'Build · create an immutable artifact'],
  ['Prüfen · Tests und Richtlinien anwenden', 'Validate · apply tests and policies'],
  ['Layout wird pro Seite entschieden', 'Layout is decided separately for each page'],
  ['Semantik wählt passende Patterns', 'Semantics selects appropriate patterns'],
  ['Responsive Fallbacks sind geprüft', 'Responsive fallbacks are validated'],
  ['Release · unveränderliche Artefakte', 'Release · immutable artifacts'],
  ['Zugriff · autorisierte Auslieferung', 'Access · authorized delivery'],
  ['Druckansicht mit vollständigen Antworten', 'Print view with complete answers'],
  ['Print · vollständig', 'Print · complete'],
  ['Einzelmessungen der P95-Antwortzeit nach Environment', 'Individual P95 response-time observations by environment'],
  ['Daten · geprüfte Evidenz', 'Data · validated evidence'],
  ['HTML · responsive Veröffentlichung', 'HTML · responsive publishing'],
  ['SVG · eigenständige Grafik', 'SVG · standalone visual'],
  ['Zugänglichkeit', 'Accessibility'],
  ['Entscheiden · nächste Hypothese wählen', 'Decide · choose the next hypothesis'],
  ['Handeln · kleine Änderung liefern', 'Act · deliver a small change'],
  ['Lernen · Wirkung mit Erwartung vergleichen', 'Learn · compare impact with expectations'],
  ['Server · prüft Vertrag und Berechtigung', 'Server · validates contract and authorization'],
  ['Tool · führt die Aktion aus', 'Tool · performs the action'],
  ['Ergebnis · fließt zum Client zurück', 'Result · returns to the client'],
  ['Europäische Knoten', 'European nodes'],
  ['Locatione nach Koordinaten und normalisierter Utilization', 'Locations by coordinates and normalized utilization'],
  ['Service-Activeität', 'Service activity'],
  ['Normalisierte Activeität je Service und weekday', 'Normalized activity by service and weekday'],
  ['Quality im Vergleich', 'Quality comparison'],
  ['Werte vor und nach der Überarbeitung', 'Values before and after the revision'],
  ['Verständlichkeit', 'Clarity'],
  ['Integrationsansätze', 'Integration approaches'],
  ['Vertrag · proprietär', 'Contract · proprietary'],
  ['Vertrag · intern', 'Contract · internal'],
  ['Vertrag · gemeinsam', 'Contract · shared'],
  ['Wiederverwendung · gering', 'Reuse · low'],
  ['Wiederverwendung · mittel', 'Reuse · medium'],
  ['Wiederverwendung · hoch', 'Reuse · high'],
  ['Wiederverwendung · begrenzt', 'Reuse · limited'],
  ['Wiederverwendung · serverübergreifend', 'Reuse · across servers'],
  ['Kopplung · hoch', 'Coupling · high'],
  ['Kopplung · mittel', 'Coupling · medium'],
  ['Kopplung · gering', 'Coupling · low'],
  ['Kopplung · häufig hoch', 'Coupling · often high'],
  ['Kopplung · klar getrennt', 'Coupling · clearly separated'],
  ['Kopplung · gering gekoppelt', 'Coupling · loosely coupled'],
  ['Release-Latenz sinkt', 'Release latency declines'],
  ['Median der Build-Duration von January bis June', 'Median build duration from January to June'],
  [
    'Vollständige ContentKit Overview mit Kennzahlen und Analyse',
    'Complete ContentKit overview with metrics and analysis',
  ],
  ['Die Overview führt', 'The overview leads'],
  ['Mobile Darstellung mit gestapelten Areaen', 'Mobile view with stacked areas'],
  ['Mobiler Kontext', 'Mobile context'],
  ['SVG und PNG Exportansicht', 'SVG and PNG export view'],
  ['Statische Output', 'Static output'],
  ['Tool-Ökosystem', 'Tool ecosystem'],
  ['Wissen und Sourcen', 'knowledge and sources'],
  ['Daten und Verdichtung', 'data and reduction'],
  ['Komposition und Publishing', 'composition and publishing'],
  ['ausführbare Fähigkeiten', 'executable capabilities'],
  [
    'HTML, SVG, PNG und eine druckoptimierte HTML-Repräsentation.',
    'HTML, SVG, PNG, and a print-optimized HTML representation.',
  ],
  [
    'SVG und PNG benötigen beim Anzeigen keine entfernten Ressourcen.',
    'SVG and PNG require no remote resources when displayed.',
  ],
  ['Wie wird Mobile gewählt?', 'How is mobile selected?'],
  ['Viewport und Container werden getrennt berücksichtigt.', 'Viewport and container are considered separately.'],
  [
    'Eine strukturierte Diagnose erklärt die gewählte Stapelstrategie.',
    'A structured diagnostic explains the selected stacking strategy.',
  ],
  ['Wie wählen Agents?', 'How do agents choose?'],
  [
    'Sie lesen Slots, Fähigkeiten, Budgets und positive sowie negative Auswahlhinweise.',
    'They read slots, capabilities, budgets, and positive and negative selection guidance.',
  ],
  ['Dürfen Agents CSS liefern?', 'May agents provide CSS?'],
  [
    'Nein. Pattern Packages bleiben nicht ausführbar und streng validiert.',
    'No. Pattern Packages remain non-executable and strictly validated.',
  ],
  [
    'MCP trennt AI-Anwendungen von einzelnen Integrationen.',
    'MCP separates AI applications from individual integrations.',
  ],
  ['1 Vertrag', '1 contract'],
  ['Vertrag freigegeben', 'Contract approved'],
  ['16 belegte Statementn · quellenübergreifend bestätigt', '16 supported statements · confirmed across sources'],
  ['5 freigegebene Claims · klar und publizierbar', '5 approved claims · clear and publishable'],
  ['Kernaussage · muss ohne Kontext verständlich sein', 'Key message · must be clear without context'],
  ['Hauptbelege · tragen die zentrale Statement', 'Primary evidence · supports the key message'],
  ['Einordnung · erklärt Meaning und Grenzen', 'Context · explains meaning and boundaries'],
  ['Detaildaten · ermöglichen Review und Vertiefung', 'Detailed data · enables review and exploration'],
  ['Semantik · Meaning und Beziehungen', 'Semantics · meaning and relationships'],
  ['Narrative · Statement und Reihenfolge', 'Narrative · message and sequence'],
  ['Rendering · HTML, SVG und PNG', 'Rendering · HTML, SVG, and PNG'],
  ['Build-Verteilung', 'Build distribution'],
  [
    'Build-Duration nach Environment als Fünf-Punkte-Zusammenfassung',
    'Build duration by environment as a five-number summary',
  ],
  ['Research · Bedarf und Sourcen', 'Research · needs and sources'],
  ['Modell · Semantik und Narrative', 'Model · semantics and narrative'],
  ['Build · Layout und Renderer', 'Build · layout and renderer'],
  ['Validate · Desktop und Mobile', 'Validate · desktop and mobile'],
  ['Operate · Messen und verbessern', 'Operate · measure and improve'],
  ['Abweichung vom Plan', 'Variance from plan'],
  ['Abweichung in Personentagen gegenüber dem Plan', 'Variance from plan in person-days'],
  ['Output und Operations', 'Output and operations'],
  [
    'Semantisch, responsiv und ohne JavaScript vollständig lesbar.',
    'Semantic, responsive, and fully readable without JavaScript.',
  ],
  ['Eigenständig, deterministisch und für Druck geeignet.', 'Standalone, deterministic, and suitable for print.'],
  [
    'Reproduzierbar aus derselben SVG-Repräsentation erzeugt.',
    'Reproducibly generated from the same SVG representation.',
  ],
  ['Light und Dark verwenden dieselben aufgelösten Layoutdaten.', 'Light and dark use the same resolved layout data.'],
  ['Die tatsächliche Einbettungsbreite steuert den Fallback.', 'The actual embedding width controls the fallback.'],
  [
    'Agenten erhalten Eignungsgründe, Budgets und Diagnosen.',
    'Agents receive eligibility reasons, budgets, and diagnostics.',
  ],
  ['Dokumentaufrufe der sechs meistgenutzten Areae', 'Document views for the six most-used areas'],
  ['Agent-Vertrag · nein', 'Agent contract · no'],
  ['Agent-Vertrag · teilweise', 'Agent contract · partial'],
  ['Agent-Vertrag · vollständig', 'Agent contract · complete'],
  ['Export · HTML und SVG', 'Export · HTML and SVG'],
  ['Export · HTML, SVG und PNG', 'Export · HTML, SVG, and PNG'],
  ['09.17 Uhr · Freigabe', '09.17 · approval'],
  ['09.20 Uhr · Veröffentlichung', '09.20 · publication'],
  ['keine aktive Störung', 'no active incident'],
  ['Oberflächen', 'Product surfaces'],
  ['Dashboard mit Kennzahlen und Hauptdiagramm', 'Dashboard with metrics and primary chart'],
  ['Gestapelte Berichtskarten auf einem Smartphone', 'Stacked report cards on a phone'],
  ['Datentabelle mit Statusspalten', 'Data table with status columns'],
  ['Geöffnete Fragen und Antworten', 'Expanded questions and answers'],
  ['Codebeispiel mit Dateiliste', 'Code example with file list'],
  ['Kann ContentKit ohne Browser genutzt werden?', 'Can ContentKit be used without a browser?'],
  [
    'Ja. Semantic AST, Empfehlungen, Validierung und alle statischen Outputs sind über die Headless API available.',
    'Yes. The Semantic AST, recommendations, validation, and all static outputs are available through the headless API.',
  ],
  ['Bleibt SVG eigenständig?', 'Does SVG remain standalone?'],
  [
    'Ja. Schrift, Geometrie, Farben und zugängliche Textäquivalente sind vollständig eingebettet.',
    'Yes. Font, geometry, colors, and accessible text equivalents are fully embedded.',
  ],
  ['Was passiert auf kleinen Displays?', 'What happens on small displays?'],
  [
    'Das Pattern wird anhand der Containerbreite auf eine lesbare Stapelstruktur aufgelöst.',
    'The pattern resolves to a readable stacked structure based on container width.',
  ],
  ['Wer entscheidet über Fallbacks?', 'Who decides on fallbacks?'],
  [
    'ContentKit prüft die declarativeen Regeln deterministisch. Ein Agent darf Präferenzen äußern, aber keine Geometrie einschleusen.',
    'ContentKit validates declarative rules deterministically. An agent may express preferences but cannot inject geometry.',
  ],
  ['Before und nachher', 'Before and after'],
  ['Qualityswerte zwischen Release 1 und Release 2', 'Quality values between Release 1 and Release 2'],
  ['Pattern-Verträge ausbauen', 'Expand pattern contracts'],
  ['Renderer und Export härten', 'Harden renderer and export'],
  ['Datenprüfung · Plattform', 'Data review · platform'],
  ['Freigabe · Produkt', 'Approval · product'],
  ['Veröffentlichung · Plattform', 'Publication · platform'],
  ['Sourcen sammeln und review', 'Collect and validate sources'],
  ['Entwurf · Statement und Evidencee strukturieren', 'Draft · structure message and evidence'],
  ['Review · Fakten, Sprache und Zugänglichkeit testen', 'Review · test facts, language, and accessibility'],
  ['Freigabe · reproduzierbar publizieren', 'Approval · publish reproducibly'],
  ['Semantik ist verständlich', 'Semantics is understandable'],
  ['Mobile Output überzeugt', 'Mobile output is convincing'],
  ['Speicherbedarf nach Area und Artefakttyp', 'Storage use by area and artifact type'],
  ['Sourcen | Inhalte', 'Sources | Content'],
  ['Revisionen | Inhalte', 'Revisions | Content'],
  ['Pläne', 'Plans'],
  ['Komposition wählt das passende visuelle Muster.', 'Composition selects the appropriate visual pattern.'],
  ['Layout und Rendering erzeugen reproduzierbare Artefakte.', 'Layout and rendering produce reproducible artifacts.'],
  ['Current state der Publishing-Dienste', 'Current state of publishing services'],
  ['REST und MCP', 'REST and MCP'],
  ['Integration · gemeinsamer Vertrag', 'Integration · shared contract'],
  ['Last und Latenz', 'Load and latency'],
  ['Anfragen pro Sekunde und P95-Latenz je Service', 'Requests per second and P95 latency by service'],
  ['Lieferkorridore', 'Delivery ranges'],
  [
    'Erwartete Duration je Arbeitsstrom mit unterer und oberer Grenze',
    'Expected duration by workstream with lower and upper bounds',
  ],
  ['Kapazitätsprognose', 'Capacity forecast'],
  ['Erwartete Last mit 80-percent-Prognoseintervall', 'Expected load with an 80 percent forecast interval'],
  ['Betriebsmodelle', 'Operating models'],
  ['Vier normalisierte Servicesignale über sechs Weekn', 'Four normalized service signals across six weeks'],
  ['Speichern · Validieren · Veröffentlichen', 'Save · validate · publish'],
  ['Die vollständige Publishing-Pipeline für Teams', 'The complete publishing pipeline for teams'],
  ['Light und Dark Exporte', 'Light and dark exports'],
  ['Für den Einstieg', 'For getting started'],
  ['Overview · Inhalte · Releases', 'Overview · Content · Releases'],
  ['Overview · Inhalte · Releases · Assets · Einstellungen', 'Overview · Content · Releases · Assets · Settings'],
  [
    'Aktuelle Publications, Success rate und Latenz der Compile API.',
    'Current publications, success rate, and Compile API latency.',
  ],
  ['Activeität', 'Activity'],
  ['10.04 Uhr · Alarm ausgelöst', '10.04 · alert triggered'],
  ['Schnelle Iteration · Beispieldaten · täglich', 'Fast iteration · sample data · daily'],
  ['Productionsnah · anonymisierte Daten · pro Release', 'Production-like · anonymized data · per release'],
  ['Hochavailable · echte Daten · kontrollierte Freigabe', 'Highly available · real data · controlled approval'],
  ['Anfragen im System', 'Requests through the system'],
  ['Count der Anfragen zwischen Verarbeitungsschritten', 'Request count between processing steps'],
  ['Beiträge zur Veränderung des availableen Budgets', 'Contributions to the change in available budget'],
  ['locale: de', 'locale: en'],
  ['Übersicht', 'Overview'],
  ['Aktueller Befund', 'Current finding'],
  ['Nächster Schritt', 'Next step'],
  ['Erst verstehen', 'Understand first'],
  ['Dann komponieren', 'Then compose'],
  ['Schließlich rendern', 'Finally render'],
  ['Erzählform', 'Narrative form'],
  ['Bedeutung', 'Meaning'],
  ['Beleg', 'Evidence'],
  ['Ausgaben', 'Outputs'],
  ['Ausgabe', 'Output'],
  ['Betrieb', 'Operations'],
  ['Qualität', 'Quality'],
  ['Risiko', 'Risk'],
  ['Zwei Warnungen', 'Two warnings'],
  ['Häufige Fragen', 'Frequently asked questions'],
  ['Schnelle Antworten', 'Quick answers'],
  ['Hilfe nach Themen', 'Help by topic'],
  ['Betrieb ohne Rätsel', 'Straightforward operations'],
  ['Pläne ohne Kleingedrucktes', 'Plans without fine print'],
  ['Leistungen im Vergleich', 'Feature comparison'],
  ['Basis und Erweiterungen', 'Base plan and add-ons'],
  ['Der passende Teamplan', 'The right team plan'],
  ['Produktoberflächen', 'Product surfaces'],
  ['Bilder mit Kontext', 'Media with context'],
  ['Eine visuelle Produktreise', 'A visual product journey'],
  ['Von der Übersicht zum Detail', 'From overview to detail'],
  ['Validierungsansichten', 'Validation views'],
  ['Compile-Zeit im Verlauf', 'Compile time over time'],
  ['Veröffentlichung heute', 'Publishing today'],
  ['Zuverlässig ausgeliefert', 'Delivered reliably'],
  ['Mobile Servicekarten', 'Mobile service cards'],
  ['Dienste im Betrieb', 'Services in operation'],
  ['Releases nach Umgebung', 'Releases by environment'],
  ['Operations heute', 'Operations today'],
  ['Kompaktes Cockpit', 'Compact workspace'],
  ['Inhalt und Vorschau', 'Content and preview'],
  ['Publishing Cockpit', 'Publishing workspace'],
  ['Abdeckung', 'Coverage'],
  ['Auslastung', 'Utilization'],
  ['Build-Zeit', 'Build time'],
  ['Dokumente', 'Documents'],
  ['Erfolgreiche Builds', 'Successful builds'],
  ['Erfolgsquote', 'Success rate'],
  ['Fehlerbudget', 'Error budget'],
  ['Fehlerrate', 'Error rate'],
  ['Offene Fehler', 'Open errors'],
  ['Verfügbarkeit', 'Availability'],
  ['Publikationen', 'Publications'],
  ['Schnittstelle', 'Interface'],
  ['Wiederverwendbar', 'Reusable'],
  ['Heute', 'Today'],
  ['Letzte 30 Tage', 'Last 30 days'],
  ['24 Stunden', '24 hours'],
  ['30 Tage', '30 days'],
  ['Monat', 'Month'],
  ['Juli', 'July'],
  ['Juni', 'June'],
  ['Mai', 'May'],
  ['April', 'April'],
  ['| Januar |', '| January |'],
  ['| Februar |', '| February |'],
  ['März', 'March'],
  ['August', 'August'],
  ['September', 'September'],
  ['Oktober', 'October'],
  ['November', 'November'],
  ['Dezember', 'December'],
  ['Produktion', 'Production'],
  ['Entwicklung', 'Development'],
  ['Prüfung', 'Review'],
  ['Bereit', 'Ready'],
  ['Aktiv', 'Active'],
  ['Stabil', 'Stable'],
  ['Beobachten', 'Monitor'],
  ['verbessert', 'improved'],
  ['stabil', 'stable'],
  ['verfügbar', 'available'],
  ['prüfen', 'review'],
  ['über Ziel', 'above target'],
  ['im Ziel', 'on target'],
  ['Bestwert', 'best value'],
  ['für alle Tools', 'for all tools'],
  ['über Clients hinweg', 'across clients'],
  ['klar testbar', 'clearly testable'],
  ['deklarativ', 'declarative'],
  ['Unbegrenzte Projekte', 'Unlimited projects'],
  ['Priorisierter Support', 'Priority support'],
  ['Dedizierter Support', 'Dedicated support'],
  ['Für persönliche Projekte', 'For personal projects'],
  ['Für produktive Teams', 'For productive teams'],
  ['Für regulierte Organisationen', 'For regulated organizations'],
  ['Individuell', 'Custom'],
  ['pro Monat', 'per month'],
  ['pro month', 'per month'],
  ['Aktuelle Veröffentlichungsleistung', 'Current publishing performance'],
  ['Vollständig abgeschlossene Veröffentlichungen', 'Completed publications'],
  ['Publikationen pro Woche', 'Publications per week'],
  ['Woche', 'Week'],
  ['Dokumente', 'Documents'],
  ['Aktueller Zustand', 'Current state'],
  ['Stand 14:00 UTC', 'As of 14:00 UTC'],
  ['Service Status', 'Service status'],
  ['Release Status', 'Release status'],
  ['Umgebung', 'Environment'],
  ['Dauer', 'Duration'],
  ['Regionale Nutzung', 'Regional usage'],
  ['Antwortzeiten', 'Response times'],
  ['Antwortzeit nach Region', 'Response time by region'],
  ['Nutzung nach Bereich', 'Usage by area'],
  ['Bereich', 'Area'],
  ['Aufrufe', 'Views'],
  ['Standort', 'Location'],
  ['Breitengrad', 'Latitude'],
  ['Längengrad', 'Longitude'],
  ['Messwert', 'Measurement'],
  ['Minimum', 'Minimum'],
  ['Maximum', 'Maximum'],
  ['Merkmal', 'Attribute'],
  ['Vorher', 'Before'],
  ['Nachher', 'After'],
  ['Untergrenze', 'Lower bound'],
  ['Obergrenze', 'Upper bound'],
  ['Schätzung', 'Estimate'],
  ['Aussage', 'Statement'],
  ['Ablehnung', 'Disagreement'],
  ['Zustimmung', 'Agreement'],
  ['Quelle', 'Source'],
  ['Ziel', 'Target'],
  ['Anzahl', 'Count'],
  ['Eingang', 'Input'],
  ['Validiert', 'Validated'],
  ['Ausgeliefert', 'Delivered'],
  ['Abgelehnt', 'Rejected'],
  ['Fehler', 'Errors'],
  ['Beitrag', 'Contribution'],
  ['Ausgangswert', 'Baseline'],
  ['Speichernutzung', 'Storage usage'],
  ['Element', 'Element'],
  ['Übergeordnet', 'Parent'],
  ['Wochentag', 'weekday'],
  ['Suche', 'Search'],
  ['Veröffentlichungen', 'Publications'],
  ['Tage', 'days'],
  ['Sekunden', 'seconds'],
  ['Millisekunden', 'milliseconds'],
  ['Prozent', 'percent'],
  ['Latenz', 'Latency'],
  ['Besitzer', 'Owner'],
  ['Status', 'Status'],
  ['Daten', 'Data'],
  ['Inhalte', 'Content'],
  ['Vertrag', 'Contract'],
  ['Freigabe', 'Approval'],
  ['Veröffentlichung', 'Publication'],
  ['Verarbeitung', 'Processing'],
  ['Ergebnis', 'Result'],
  ['Quelle', 'Source'],
  ['Belege', 'Evidence'],
  ['Schritte', 'Steps'],
  ['Fähigkeiten', 'Capabilities'],
  ['Einstellungen', 'Settings'],
  ['Plattform', 'Platform'],
  ['Produkt', 'Product'],
  ['gemeinsam', 'shared'],
  ['vollständig', 'complete'],
  ['geprüft', 'validated'],
  ['veröffentlichen', 'publish'],
  ['Validieren', 'Validate'],
  ['Speichern', 'Save'],
  [
    'Keine fehlerhaften Outputs. Zwei langsame Eingaben wurden durch Inhaltsbudgets abgefangen.',
    'No invalid outputs. Content budgets caught two slow inputs.',
  ],
  ['Agents können planen, kompilieren und review.', 'Agents can plan, compile, and validate.'],
  ['Semantik beschreibt, was eine Statement meint.', 'Semantics describes what a statement means.'],
  ['Client · stellt eine strukturierte Anfrage', 'Client · sends a structured request'],
  ['Release 2026.07.19-2 wurde vor acht Minuten aktiviert.', 'Release 2026.07.19-2 was activated eight minutes ago.'],
  ['Publications pro Tag im June 2026', 'Publications per day in June 2026'],
  ['1.284 Documents · 86 neu im Quartal', '1,284 documents · 86 new this quarter'],
  ['Anteile je Statement in percent', 'Share per statement in percent'],
  ['Output ist reproduzierbar', 'Output is reproducible'],
  ['Die vollständige Publishing-Pipeline für Teams', 'The complete publishing pipeline for teams'],
  ['Für den Einstieg', 'For getting started'],
  ['Welche Formate gibt es?', 'Which formats are available?'],
  ['Sind Dateien eingebettet?', 'Are files embedded?'],
  ['Agenten?', 'Agents?'],
  ['category="Agenten"', 'category="Agents"'],
  ['label="Werkzeuge"', 'label="Tools"'],
  ['label="Arbeitsbereich"', 'label="Workspace"'],
  ['Zeitraum: 30 days', 'Period: 30 days'],
  ['P95-Antwortzeit', 'P95 response time'],
  ['Rendering-Schichten', 'Rendering layers'],
  ['konkrete Geometrie', 'resolved geometry'],
  ['validierte Semantik', 'validated semantics'],
  ['Rendering · kontrollierte Output', 'Rendering · controlled output'],
  ['individuell pro API', 'individual per API'],
  ['Dokumentation hilft', 'Documentation helps'],
  ['Arbeitsstrom', 'Workstream'],
  ['Anfragen/s', 'Requests/s'],
  ['Dokumentation', 'Documentation'],
  ['Semantik', 'Semantics'],
  ['Geometrie', 'Geometry'],
  ['Entkoppelt', 'Decoupled'],
  ['Werkzeuge', 'Tools'],
  ['Arbeitsbereich', 'Workspace'],
  ['Agenten', 'Agents'],
  ['Standardisierung', 'Standardization'],
  ['proprietär', 'proprietary'],
  ['Thüringen', 'Thuringia'],
  ['Baden-Württemberg', 'Baden-Wuerttemberg'],
  ['Freigeben · Entscheidung dokumentieren', 'Approve · record the decision'],
  ['Activeieren · Release atomar umschalten', 'Activate · switch the release atomically'],
  ['Sicherheitsgrenzen', 'Security boundaries'],
  ['Inhalt · validated semantics', 'Content · validated semantics'],
  ['Komposition · erlaubte Patterns', 'Composition · allowed patterns'],
  ['Drei vergleichbare Preiskarten', 'Three comparable pricing cards'],
  ['ContentKit Hilfe', 'ContentKit help'],
  ['Was meldet Reflow?', 'What does reflow report?'],
  ['Outputs unterscheiden sich', 'Outputs are inconsistent'],
  ['Mobile braucht Handarbeit', 'Mobile requires manual work'],
  ['Publishing-Systemkontext', 'Publishing system context'],
  ['ContentKit · semantische Komposition', 'ContentKit · semantic composition'],
  ['AI Agent · Headless Planung', 'AI agent · headless planning'],
  ['label="Direkt"', 'label="Direct"'],
  ['Delivery-Lernzyklus', 'Delivery learning cycle'],
  ['Monitor · messbare Signale erfassen', 'Monitor · capture measurable signals'],
  ['label="Entdecken"', 'label="Discover"'],
  ['label="Empfehlen"', 'label="Recommend"'],
  ['label="Kompilieren"', 'label="Compile"'],
  ['120 Sourcen · breites Ausgangsmaterial', '120 sources · broad input material'],
  ['| Area | Abweichung |', '| Area | Variance |'],
  ['366 Unit-Tests · 94 % Coverage', '366 unit tests · 94% coverage'],
  ['title="Inhalt"', 'title="Content"'],
  ['Januaryyyy', 'January'],
  ['Januaryyy', 'January'],
  ['Januaryy', 'January'],
  ['Februaryyyyyyyyy', 'February'],
  ['Februaryyyyyyyy', 'February'],
  ['Februaryyyyyyy', 'February'],
  ['Februaryyyyyy', 'February'],
  ['Februaryyyyy', 'February'],
  ['Februaryyyy', 'February'],
  ['Februaryyy', 'February'],
  ['Februaryy', 'February'],
  ['Testabdeckung', 'Test coverage'],
  ['label="Basis"', 'label="Basic"'],
  ['Responsive · manuell', 'Responsive · manual'],
  ['label="Erweitert"', 'label="Advanced"'],
  ['Semantics · Komponenten', 'Semantics · components'],
  ['Responsive · Regeln', 'Responsive · rules'],
  ['Semantics · Beziehungen', 'Semantics · relationships'],
  ['Komposition · visuelle Narrative form', 'Composition · visual narrative form'],
  ['09.14 Uhr · Komposition', '09.14 · composition'],
  ['Detailseite eines einzelnen Berichts', 'Detail view of an individual report'],
  ['Berichtsdetail', 'Report detail'],
  ['Standardization · gering', 'Standardization · low'],
  ['Standardization · mittel', 'Standardization · medium'],
  ['Standardization · hoch', 'Standardization · high'],
  ['label="Konfiguration"', 'label="Configuration"'],
  ['Activee Documents je Bundesland', 'Active documents by state'],
  ['Review im Wechsel', 'Alternating review'],
  ['daysskontingent', 'Monthly budget'],
  ['Komposition kompilieren', 'Compile a composition'],
  ['trend="heute"', 'trend="today"'],
  ['Patterns sind unterscheidbar', 'Patterns are distinguishable'],
  ['Publishing-Transformation', 'Publishing transformation'],
  ['Platformvergleich', 'Platform comparison'],
]

function englishExampleSource(source, pattern) {
  let result = source
    .replace(/^title: .*$/m, `title: ${pattern.title}`)
    .replace(/^summary: .*$/m, `summary: ${pattern.summary}`)
  for (const [from, to] of [...englishPhrases, ...englishTerms].sort(
    (left, right) => right[0].length - left[0].length,
  )) {
    result = result.replaceAll(from, to)
  }
  return result
}

await mkdir(assetDir, { recursive: true })
await mkdir(exampleDir, { recursive: true })
if (!sourcesOnly && !skipAssets && !assetPattern) {
  for (const entry of await readdir(assetDir)) {
    if (/\.(?:svg|png)$/.test(entry)) await unlink(join(assetDir, entry))
  }
}
const cards = []
const viewports = {
  320: { width: 320, height: 900 },
  390: { width: 390, height: 844 },
  768: { width: 768, height: 1024 },
  1024: { width: 1024, height: 1024 },
  1440: { width: 1440, height: 1024 },
  1600: { width: 1600, height: 900 },
}

const categoryOrder = [
  'document',
  'metrics',
  'stats',
  'process',
  'comparison',
  'timeline',
  'structure',
  'data',
  'faq',
  'code',
  'pricing',
  'gallery',
  'table',
  'dashboard',
  'application',
]

const categoryNarratives = {
  document: ['Tell one story on one canvas', 'For orientation, decisions, and editorial guidance.'],
  metrics: ['Give a number meaning', 'For individual metrics, targets, and compact status signals.'],
  stats: ['Connect several signals', 'For trends, featured values, and metrics over time.'],
  process: ['Explain steps and handoffs', 'For workflows, cycles, handoffs, and reduction.'],
  comparison: ['Make differences visible', 'For sides, criteria, and traceable decisions.'],
  timeline: ['Show change over time', 'For chronologies, roadmaps, phases, and milestones.'],
  structure: ['Explain relationships and levels', 'For hierarchies, systems, layers, and networks.'],
  data: ['Read data accurately', 'For distributions, ranks, change, uncertainty, and spatial patterns.'],
  faq: ['Answer questions directly', 'For concise answers, categories, and progressive disclosure.'],
  code: ['Show code with context', 'For variants, files, and step-by-step explanations.'],
  pricing: ['Compare offers clearly', 'For plans, capabilities, recommendations, and add-ons.'],
  gallery: ['Arrange media editorially', 'For collections, visual stories, and explanatory captions.'],
  table: ['Inspect many records', 'For sortable tables and mobile record cards.'],
  dashboard: ['Turn status into action', 'For metrics, trends, and operational detail views.'],
  application: ['Structure workspaces', 'For navigation, primary content, and supporting regions.'],
}

const overviewSource = `---
kind: page
layout: composition
title: Choose patterns by meaning
summary: The examples lead from the message to an appropriate visual form and show the result in every important format.
locale: en
slug: pattern-gallery-overview
composition:
  format: infographic
  canvas: landscape
  intent: explain
  density: balanced
  preferredPattern: stratified-story
  audience: Authors, designers, and external AI agents
  goal: Select an appropriate information pattern safely and review it visually
  thesis: Meaning determines the pattern, not decoration
  conclusion: Review semantics first, then compare desktop, mobile, dark, and print
  disclosure: progressive
---

:::hero{role="primary"}
# From content to clear communication

Every example passes through the same controlled pipeline.
:::

:::card{title="1 · Semantics"}
What does the information mean: process, comparison, change, structure, or data finding?
:::

:::card{title="2 · Narrative"}
Which message should be understood first, and which evidence follows?
:::

:::card{title="3 · Visual Composition"}
Which pattern carries this meaning without introducing a misleading form?
:::

:::card{title="4 · Layout"}
How does content arrange itself in the actual container on desktop and mobile?
:::

:::card{title="5 · Rendering"}
HTML, SVG, and PNG are produced from the same resolved model.
:::
`

const overview = await compileCompositionMarkdown(overviewSource, {
  settings: { theme: { tokens: themes['neutral-editorial'] } },
  scheme: 'light',
  viewport: viewports['1600'],
  outputs: ['model', 'html', 'svg', 'png'],
})
await writeFile(join(gallery, 'overview.en.md'), overviewSource)
await writeFile(join(gallery, 'overview.svg'), overview.renders.svg)
await writeFile(join(gallery, 'overview.png'), Buffer.from(overview.renders.png_base64, 'base64'))
await writeFile(
  join(gallery, 'overview-model.json'),
  `${JSON.stringify({ semantic: overview.semantic, narrative: overview.narrative, composition: overview.composition, layout: overview.layout, render_tree: overview.render_tree }, null, 2)}\n`,
)

const capabilityDocument = await renderMarkdown(`---
kind: page
layout: standard
title: Rendering capabilities
locale: en
slug: rendering-capabilities
summary: Standard Markdown rendering capabilities.
---

\`\`\`javascript
const result = await content.compile({
  target: 'visual',
  outputs: ['html', 'svg', 'png']
})
\`\`\`

\`\`\`mermaid
flowchart LR
  A[Markdown] --> B[Semantic model]
  B --> C[Published output]
\`\`\`
`)
const capabilityCode = capabilityDocument.html.match(/<pre[^>]*class="[^"]*shiki[^"]*"[\s\S]*?<\/pre>/)?.[0] || ''
const capabilityReport = await renderMarkdown(`---
kind: page
layout: composition
title: Weekly delivery report
locale: en
slug: weekly-delivery-report
summary: A compact, auditable report assembled from semantic Markdown.
composition: { format: report, canvas: landscape, intent: status, preferredPattern: grouped-dashboard }
---

::::group{columns="3" role="primary"}
::metric{label="Availability" value="99.98%" trend="within target" tone="positive"}

::metric{label="Deployments" value="42" trend="+12%" tone="positive"}

::metric{label="Open risks" value="3" trend="one critical" tone="warning"}

:::card{title="Decision" span="2"}
Proceed with the release and keep the migration risk open until the next checkpoint.
:::

::progress{label="Objectives completed" value="8" max="10"}
::::
`)
const capabilityChart = {
  id: 0,
  type: 'line',
  data_shape: 'series',
  orientation: 'vertical',
  stacked: false,
  title: 'Publishing latency',
  description: 'Median publishing latency over six weeks',
  unit: 'ms',
  headers: ['Week', 'Latency'],
  rows: [
    ['27', 248],
    ['28', 231],
    ['29', 218],
    ['30', 205],
    ['31', 194],
    ['32', 184],
  ],
}
const capabilityChartLight = renderReportChartSvg(capabilityChart, { scheme: 'light', locale: 'en' }).svg
const capabilityChartDark = renderReportChartSvg(capabilityChart, { scheme: 'dark', locale: 'en' }).svg
const capabilityChartUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
const guideById = new Map(publishingGuideRegistry.map((guide) => [guide.id, guide]))
const storyArc = (guide) => guide.narrative.story_arc.map((step) => step.replaceAll('-', ' ')).join(' → ')

for (const pattern of patternRegistry) {
  const examplePath = join(exampleDir, `${pattern.id}.en.md`)
  let source
  try {
    source = englishExampleSource(await readFile(examplePath, 'utf8'), pattern)
    await writeFile(examplePath, source)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    source = englishExampleSource(markdown(pattern), pattern)
    await writeFile(examplePath, source)
  }
  if (sourcesOnly) continue
  if (!skipAssets && (!assetPattern || assetPattern === pattern.id))
    for (const [theme, tokens] of Object.entries(themes)) {
      for (const scheme of ['light', 'dark']) {
        for (const [viewportName, viewport] of Object.entries(viewports)) {
          const result = await compileCompositionMarkdown(source, {
            settings: { theme: { tokens } },
            scheme,
            viewport,
            outputs: ['html', 'svg', 'png'],
            html_presentation: 'visual',
          })
          const stem = `${pattern.id}--${theme}--${scheme}--${viewportName}`
          await writeFile(join(assetDir, `${stem}.svg`), result.renders.svg)
          await writeFile(join(assetDir, `${stem}.png`), Buffer.from(result.renders.png_base64, 'base64'))
          await writeFile(
            join(assetDir, `${stem}.html`),
            `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${galleryFontCss}html,body{margin:0;min-height:100%;background:${scheme === 'dark' ? '#09090b' : '#fff'}}</style></head><body>${result.renders.html}</body></html>`,
          )
        }
      }
    }
  const useWhen = pattern.agent_hints.use_when[0].replaceAll('-', ' ')
  const semanticMeaning = pattern.semantics.conveys
    .slice(0, 3)
    .map((entry) => entry.replaceAll('-', ' '))
    .join(' · ')
  const responsive = pattern.responsive[0]
    ? `Below ${pattern.responsive[0].max_width} px, the composition switches to ${pattern.responsive[0].use}.`
    : 'Geometry reflows responsively within the same pattern.'
  cards.push({
    category: pattern.category,
    html: `<article class="pattern" id="pattern-${pattern.id}" data-category="${pattern.category}" data-id="${pattern.id}" data-search="${escapeHtml(`${pattern.title} ${pattern.summary} ${pattern.narrative.question}`)}" aria-label="${escapeHtml(pattern.title)} review"><header class="pattern-head"><div><span class="pattern-index">${String(cards.filter((card) => card.category === pattern.category).length + 1).padStart(2, '0')}</span><div class="pattern-copy"><p>${pattern.category}</p><h3>${pattern.title}</h3><p>${pattern.summary}</p></div></div><div class="pattern-tools"><code>${pattern.id}</code></div></header><div class="pattern-question"><span>Question it answers</span><strong>${escapeHtml(pattern.narrative.question)}</strong></div><div class="preview preview-export" data-preview="export"><img loading="lazy" width="1600" height="900" src="assets/${pattern.id}--neutral-editorial--light--1600.svg" alt="${pattern.title}: rendered example"><iframe title="${escapeHtml(pattern.title)} visual HTML rendering" loading="lazy" hidden></iframe></div><div class="pattern-context"><div><span>Use when</span><strong>${useWhen}</strong></div><div><span>Reader takeaway</span><strong>${escapeHtml(pattern.narrative.reader_takeaway)}</strong></div><div><span>Semantic meaning</span><strong>${semanticMeaning}</strong></div></div><div class="review-actions"><span>${responsive}</span><footer><a class="html" href="assets/${pattern.id}--neutral-editorial--light--1600.html">HTML</a><a class="svg" href="assets/${pattern.id}--neutral-editorial--light--1600.svg">SVG</a><a class="png" href="assets/${pattern.id}--neutral-editorial--light--1600.png">PNG</a></footer></div><details><summary>Semantic source</summary><pre>${escapeHtml(source)}</pre></details><details class="technical"><summary>Machine-readable contract</summary><pre>${escapeHtml(JSON.stringify(pattern, null, 2))}</pre></details></article>`,
  })
}

if (sourcesOnly) process.exit(0)

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

const mermaidSource = `flowchart LR
  A[Markdown] --> B[Semantic model]
  B --> C[Published output]`
const guideCards = publishingGuideRegistry
  .map(
    (guide) =>
      `<article class="guide-card" data-guide-kind="${guide.kind}"><span>${guide.kind}</span><h3>${guide.title}</h3><p class="guide-question">${escapeHtml(guide.narrative.question)}</p><dl><div><dt>Story</dt><dd>${escapeHtml(storyArc(guide))}</dd></div><div><dt>Use when</dt><dd>${escapeHtml(guide.selection.use_when[0].replaceAll('-', ' '))}</dd></div><div><dt>Avoid when</dt><dd>${escapeHtml((guide.selection.reject_when[0] || 'the semantic contract is not satisfied').replaceAll('-', ' '))}</dd></div></dl></article>`,
  )
  .join('')
const processGuide = guideById.get('process-diagram')
const codeGuide = guideById.get('code-walkthrough-guide')
const statusGuide = guideById.get('status-report')
const chartGuide = patternRegistry.find((pattern) => pattern.id === 'detailed-chart')
const renderingCapabilities = `<section class="capabilities" id="semantic-publishing"><header class="family-head"><span>00</span><div><p>Semantic publishing guidance</p><h2>Choose by the question, not the renderer</h2><p>Every report, chart, diagram, and code explanation needs an explicit communication goal, story arc, input contract, and rejection conditions. The same descriptors shown here are available to external agents through the headless API.</p></div><b>${publishingGuideRegistry.length}</b></header><div class="capability-grid"><article class="capability-card"><header><span>Code explanation</span><h3>${escapeHtml(codeGuide.narrative.question)}</h3><p>${escapeHtml(codeGuide.narrative.communication_goal)}</p><small>${escapeHtml(storyArc(codeGuide))}</small></header><div class="capability-stage code-stage">${capabilityCode}</div></article><article class="capability-card"><header><span>Process diagram</span><h3>${escapeHtml(processGuide.narrative.question)}</h3><p>${escapeHtml(processGuide.narrative.communication_goal)}</p><small>${escapeHtml(storyArc(processGuide))}</small></header><div class="capability-stage diagram-stage"><div class="mermaid-live" data-source="${encodeURIComponent(mermaidSource)}"></div></div></article><article class="capability-card"><header><span>Quantitative evidence</span><h3>${escapeHtml(chartGuide.narrative.question)}</h3><p>${escapeHtml(chartGuide.narrative.communication_goal)}</p><small>${escapeHtml(chartGuide.narrative.story_arc.map((step) => step.replaceAll('-', ' ')).join(' → '))}</small></header><div class="capability-stage chart-stage"><img class="chart-light" src="${capabilityChartUri(capabilityChartLight)}" alt="Publishing latency line chart"><img class="chart-dark" src="${capabilityChartUri(capabilityChartDark)}" alt="Publishing latency line chart in dark appearance"></div></article><article class="capability-card"><header><span>Status report</span><h3>${escapeHtml(statusGuide.narrative.question)}</h3><p>${escapeHtml(statusGuide.narrative.communication_goal)}</p><small>${escapeHtml(storyArc(statusGuide))}</small></header><div class="capability-stage report-demo">${capabilityReport.html}</div></article></div><div class="guide-intro"><div><span>Selection guide</span><h3>Questions, stories, and rejection rules</h3></div><p>These are not renderer presets. They tell humans and machines what the information means and which narrative form is truthful.</p></div><div class="guide-grid">${guideCards}</div></section>`

const categorySections = categoryOrder
  .map((category, index) => {
    const entries = cards.filter((card) => card.category === category)
    if (!entries.length) return ''
    const [title, summary] = categoryNarratives[category]
    return `<section class="family" id="family-${category}" data-family="${category}"><header class="family-head"><span>${String(index + 1).padStart(2, '0')}</span><div><p>${category}</p><h2>${title}</h2><p>${summary}</p></div><b>${entries.length}</b></header><div class="family-patterns">${entries.map((entry) => entry.html).join('')}</div></section>`
  })
  .join('')

const categoryOptions = categoryOrder
  .filter((category) => cards.some((card) => card.category === category))
  .map((category) => `<option value="${category}">${categoryNarratives[category][0]}</option>`)
  .join('')

const familyNavigation = categoryOrder
  .filter((category) => cards.some((card) => card.category === category))
  .map((category, index) => {
    const count = cards.filter((card) => card.category === category).length
    return `<a href="#family-${category}" data-family-link="${category}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${categoryNarratives[category][0]}</strong><b>${count}</b></a>`
  })
  .join('')

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ContentKit · Understand and review information patterns</title><style>
:root{font-family:${contentkitFontFamilyCompact};color:#18181b;background:#fff;line-height:1.5}*{box-sizing:border-box}body{margin:0;background:linear-gradient(#fff,#fafafa)}a{color:inherit;text-underline-offset:.2em}.shell{width:min(100% - 2rem,112rem);margin-inline:auto}.hero{padding:clamp(3.5rem,8vw,8rem) 0 3rem}.eyebrow{display:inline-flex;align-items:center;gap:.5rem;color:#52525b;text-transform:uppercase;font-size:.72rem;font-weight:750;letter-spacing:.12em}.eyebrow::before{width:.45rem;height:.45rem;border-radius:50%;background:#2563eb;content:''}.hero h1{max-width:15ch;margin:.75rem 0 1.25rem;font-size:clamp(2.7rem,6.5vw,6.5rem);font-weight:760;line-height:.96;letter-spacing:-.06em}.hero>p{max-width:52rem;margin:0;color:#52525b;font-size:clamp(1.05rem,1.4vw,1.35rem)}.overview{margin-top:3rem;border:1px solid #d4d4d8;border-radius:1rem;background:#f4f4f5;padding:clamp(.6rem,1.4vw,1.25rem);box-shadow:0 1px 2px #18181b0a,0 24px 70px #18181b0a}.overview img{display:block;width:100%;border-radius:.65rem}.overview-links{display:flex;flex-wrap:wrap;justify-content:space-between;gap:1rem;padding:.9rem .35rem .1rem;color:#52525b;font-size:.9rem}.overview-links nav{display:flex;gap:1rem}.principles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;margin-top:1.5rem}.principle{border:1px solid #e4e4e7;border-radius:.8rem;background:#fff;padding:1.25rem;box-shadow:0 1px 2px #18181b0a}.principle span{color:#2563eb;font-size:.75rem;font-weight:750;letter-spacing:.08em}.principle h2{margin:.45rem 0;font-size:1.05rem}.principle p{margin:0;color:#52525b;font-size:.93rem}.review-bar{position:sticky;top:0;z-index:5;border-block:1px solid #e4e4e7;background:#fffffff0;backdrop-filter:blur(16px)}.controls{display:flex;flex-wrap:wrap;gap:.65rem;padding:.8rem 0}.controls label{display:grid;gap:.2rem;color:#71717a;font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase}.controls select,.controls input{min-width:10rem;min-height:2.65rem;border:1px solid #d4d4d8;border-radius:.55rem;background:#fff;color:#18181b;padding:.48rem .7rem;font:inherit;font-size:.9rem;box-shadow:0 1px 2px #18181b0a}.controls input{min-width:min(100%,19rem)}.gallery{padding:3rem 0 7rem}.family{scroll-margin-top:6rem}.family+.family{margin-top:6rem}.family-head{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:1.25rem;align-items:start;margin-bottom:1.25rem;padding-bottom:1.25rem;border-bottom:1px solid #d4d4d8}.family-head>span{display:grid;width:2.4rem;height:2.4rem;border:1px solid #d4d4d8;border-radius:50%;color:#52525b;font-size:.76rem;font-weight:750;place-items:center}.family-head p{margin:0;color:#71717a}.family-head div>p:first-child{text-transform:uppercase;font-size:.7rem;font-weight:750;letter-spacing:.12em}.family-head h2{margin:.15rem 0;font-size:clamp(1.7rem,3vw,2.7rem);letter-spacing:-.04em}.family-head b{border:1px solid #d4d4d8;border-radius:999px;background:#f4f4f5;padding:.35rem .65rem;font-size:.75rem}.family-patterns{display:grid;gap:1.5rem}.pattern{border:1px solid #d4d4d8;border-radius:1rem;background:#fff;padding:clamp(1rem,2vw,1.5rem);overflow:hidden;box-shadow:0 1px 2px #18181b0a,0 12px 34px #18181b08}.pattern-head{display:flex;justify-content:space-between;gap:1rem;align-items:start}.pattern h3{margin:.3rem 0;font-size:clamp(1.35rem,2vw,1.8rem);letter-spacing:-.025em}.pattern-head p{max-width:55rem;margin:.15rem 0;color:#52525b}.pattern code{flex:0 0 auto;border:1px solid #e4e4e7;border-radius:.4rem;background:#fafafa;color:#52525b;padding:.3rem .5rem;font-size:.75rem}.narrative{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;margin:1.25rem 0;border:1px solid #e4e4e7;border-radius:.7rem;background:#e4e4e7;overflow:hidden}.narrative>div{display:grid;align-content:start;gap:.35rem;min-height:6.5rem;background:#fafafa;padding:1rem}.narrative span{color:#71717a;font-size:.7rem;font-weight:750;letter-spacing:.08em;text-transform:uppercase}.narrative strong{font-size:.92rem;font-weight:620}.preview{min-height:18rem;border:1px solid #d4d4d8;border-radius:.75rem;background:#f4f4f5;overflow:auto}.preview-bar{display:flex;align-items:center;gap:.35rem;height:2.6rem;border-bottom:1px solid #d4d4d8;background:#fafafa;padding:0 .9rem}.preview-bar i{width:.55rem;height:.55rem;border:1px solid #a1a1aa;border-radius:50%;background:#fff}.preview-bar span{margin-left:.5rem;color:#71717a;font-size:.72rem}.pattern img{display:block;width:100%;object-fit:contain}.review-actions{display:flex;justify-content:space-between;gap:1rem;align-items:center;padding:1rem 0;color:#52525b;font-size:.82rem}.pattern footer{display:flex;gap:.55rem}.pattern a{border:1px solid #d4d4d8;border-radius:.45rem;background:#fff;padding:.35rem .55rem;color:#18181b;font-weight:650;text-decoration:none;white-space:nowrap}.pattern details{border-top:1px solid #e4e4e7}.pattern summary{cursor:pointer;padding:.8rem 0;font-size:.88rem;font-weight:650}.pattern pre{max-height:26rem;overflow:auto;white-space:pre-wrap;border-radius:.65rem;background:#18181b;color:#fafafa;padding:1rem;font-size:.78rem;line-height:1.55}.technical{color:#71717a}.viewport-mobile .pattern{width:min(100%,32rem);margin-inline:auto}.viewport-mobile .preview{padding-inline:clamp(.5rem,4vw,2rem)}.viewport-mobile .preview-bar{margin-inline:calc(clamp(.5rem,4vw,2rem) * -1)}
@media(max-width:760px){.principles,.narrative{grid-template-columns:1fr}.family-head{grid-template-columns:auto 1fr}.family-head b{display:none}.pattern-head,.review-actions{align-items:flex-start;flex-direction:column}.pattern code{order:-1}.controls>*{flex:1 1 10rem}.controls input{width:100%}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style></head><body><header class="hero shell"><span class="eyebrow">ContentKit Examples</span><h1>From content to clear communication.</h1><p>This gallery follows ContentKit's own principles: meaning and communication goal come first, followed by the appropriate visual pattern. Choose a family based on the question you need to answer, not on appearance.</p><div class="overview"><img src="overview.svg" alt="Semantics, narrative, visual composition, layout, and rendering as an explanatory ContentKit composition"><div class="overview-links"><span>This introduction was compiled from semantic ContentKit Markdown.</span><nav><a href="overview.en.md">Source</a><a href="overview-model.json">Resolved model</a><a href="overview.svg">SVG</a></nav></div></div><div class="principles"><article class="principle"><span>01 · MEANING</span><h2>What should people understand?</h2><p>Processes, comparisons, time, structure, and distributions require different visual forms.</p></article><article class="principle"><span>02 · NARRATIVE</span><h2>What comes first?</h2><p>The key message, sequence, and evidence determine visual hierarchy.</p></article><article class="principle"><span>03 · REVIEW</span><h2>Does it remain readable everywhere?</h2><p>Review every result in light, dark, and six real container widths.</p></article></div></header><div class="review-bar"><div class="controls shell"><label>Search<input id="search" type="search" placeholder="e.g. comparison or timeline"></label><label>Information family<select id="category"><option value="">All families</option>${categoryOptions}</select></label><label>Appearance<select id="scheme"><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Container<select id="viewport"><option value="1600">1600 × 900</option><option value="1440">1440 × 1024</option><option value="1024">1024 × 1024</option><option value="768">768 × 1024</option><option value="390">390 × 844</option><option value="320">320 × 900</option></select></label></div></div><main class="gallery shell">${categorySections}</main><script>const q=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];function update(){const scheme=q('#scheme').value,viewport=q('#viewport').value,search=q('#search').value.trim().toLowerCase(),category=q('#category').value;document.body.classList.toggle('viewport-mobile',Number(viewport)<=390);all('.pattern').forEach(card=>{const id=card.dataset.id,haystack=(id+' '+card.textContent).toLowerCase(),matchesCategory=!category||card.dataset.category===category,stem=id+'--neutral-editorial--'+scheme+'--'+viewport;card.hidden=!matchesCategory||!haystack.includes(search);card.querySelector('img').src='assets/'+stem+'.svg';card.querySelector('.svg').href='assets/'+stem+'.svg';card.querySelector('.png').href='assets/'+stem+'.png'});all('.family').forEach(section=>{section.hidden=!section.querySelector('.pattern:not([hidden])')})}all('select,input').forEach(el=>el.addEventListener('input',update));update();</script></body></html>`

const redesignedHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ContentKit · Information pattern review</title>
<link rel="stylesheet" href="../../assets/site.css">
<style>
:root{font-family:${contentkitFontFamilyCompact};color:#18181b;background:#fff;line-height:1.5;font-synthesis:none;--line:#e4e4e7;--line-strong:#d4d4d8;--muted:#71717a;--soft:#fafafa;--accent:#2563eb;--sidebar:18rem}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#fff;color:#18181b}button,input,select{font:inherit}a{color:inherit;text-underline-offset:.2em}.app{min-height:100vh}.sidebar{position:fixed;inset:0 auto 0 0;z-index:20;width:var(--sidebar);overflow:auto;border-right:1px solid var(--line);background:#fafafa;padding:1.35rem 1rem}.brand{display:flex;align-items:center;gap:.7rem;padding:.35rem .45rem 1.25rem;font-size:.92rem;font-weight:760;text-decoration:none;letter-spacing:-.015em}.brand i{width:.68rem;height:.68rem;border-radius:.22rem;background:var(--accent);box-shadow:inset 0 0 0 1px #ffffff66}.side-label{margin:1rem .45rem .55rem;color:var(--muted);font-size:.69rem;font-weight:760;letter-spacing:.1em;text-transform:uppercase}.side-nav{display:grid;gap:.13rem}.side-nav a{display:grid;grid-template-columns:1.65rem minmax(0,1fr) auto;gap:.5rem;align-items:center;border-radius:.5rem;padding:.48rem .45rem;color:#52525b;text-decoration:none}.side-nav a:hover,.side-nav a.active{background:#fff;color:#18181b;box-shadow:0 0 0 1px var(--line),0 1px 2px #18181b0a}.side-nav span{color:#a1a1aa;font-size:.69rem;font-variant-numeric:tabular-nums}.side-nav strong{overflow:hidden;font-size:.76rem;font-weight:590;text-overflow:ellipsis;white-space:nowrap}.side-nav b{display:grid;min-width:1.35rem;height:1.35rem;border:1px solid var(--line);border-radius:999px;background:#fff;color:#71717a;font-size:.68rem;font-weight:700;place-items:center}.side-note{margin-top:1rem;border:1px solid var(--line);border-radius:.65rem;background:#fff;padding:.8rem}.side-note strong{display:block;font-size:.75rem}.side-note p{margin:.25rem 0 0;color:#71717a;font-size:.7rem;line-height:1.5}.workspace{min-width:0;margin-left:var(--sidebar)}.mobile-bar{display:none}.content{width:min(100% - 3rem,82rem);margin-inline:auto}.intro{padding:3.75rem 0 2.25rem}.eyebrow{display:flex;align-items:center;gap:.5rem;color:#52525b;font-size:.7rem;font-weight:760;letter-spacing:.1em;text-transform:uppercase}.eyebrow::before{width:.42rem;height:.42rem;border-radius:50%;background:var(--accent);content:''}.intro h1{max-width:18ch;margin:.65rem 0 .75rem;font-size:clamp(2.35rem,5vw,4.5rem);font-weight:760;letter-spacing:-.055em;line-height:.98}.intro>p{max-width:48rem;margin:0;color:#52525b;font-size:1rem}.pipeline{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin-top:2rem;border:1px solid var(--line);border-radius:.75rem;background:var(--line);gap:1px;overflow:hidden;box-shadow:0 1px 2px #18181b08}.pipeline article{min-height:7rem;background:#fff;padding:1rem}.pipeline span{color:var(--accent);font-size:.7rem;font-weight:760;letter-spacing:.08em}.pipeline strong{display:block;margin:.45rem 0 .25rem;font-size:.85rem}.pipeline p{margin:0;color:#71717a;font-size:.72rem;line-height:1.45}.review-bar{position:sticky;top:0;z-index:10;border-block:1px solid var(--line);background:#fffffff2;backdrop-filter:blur(18px)}.controls{display:flex;align-items:end;gap:.55rem;width:min(100% - 3rem,82rem);min-height:4.5rem;margin-inline:auto;padding:.65rem 0}.controls label{display:grid;gap:.18rem;color:#71717a;font-size:.68rem;font-weight:760;letter-spacing:.07em;text-transform:uppercase}.controls label:first-child{flex:1}.controls input,.controls select{height:2.35rem;border:1px solid var(--line-strong);border-radius:.5rem;background:#fff;color:#18181b;padding:0 .7rem;font-size:.78rem;box-shadow:0 1px 2px #18181b08;outline:none}.controls input{width:100%;min-width:11rem}.controls input:focus,.controls select:focus{border-color:#93b4f5;box-shadow:0 0 0 3px #2563eb15}.result-count{margin:0 0 .55rem auto;color:#71717a;font-size:.72rem;white-space:nowrap}.gallery{padding:3rem 0 7rem}.family{scroll-margin-top:6rem}.family+.family{margin-top:5.5rem}.family-head{display:grid;grid-template-columns:2.2rem minmax(0,1fr) auto;gap:1rem;align-items:start;margin-bottom:1.75rem;padding-bottom:1.1rem;border-bottom:1px solid var(--line)}.family-head>span{display:grid;width:2.2rem;height:2.2rem;border:1px solid var(--line-strong);border-radius:.6rem;color:#71717a;font-size:.7rem;font-weight:750;place-items:center}.family-head div>p:first-child{margin:0;color:#71717a;font-size:.68rem;font-weight:760;letter-spacing:.1em;text-transform:uppercase}.family-head h2{margin:.15rem 0;font-size:1.65rem;letter-spacing:-.04em}.family-head h2+div,.family-head div>p:last-child{max-width:42rem;margin:0;color:#71717a;font-size:.82rem}.family-head>b{display:grid;min-width:2rem;height:2rem;border:1px solid var(--line);border-radius:999px;background:#fafafa;color:#71717a;font-size:.7rem;place-items:center}.family-patterns{display:grid;gap:3.5rem}.pattern{min-width:0;padding-bottom:1.75rem;border-bottom:1px solid var(--line)}.pattern-head{display:flex;justify-content:space-between;gap:1rem;align-items:center;padding:0 .2rem .7rem}.pattern-head>div{display:flex;align-items:center;gap:.65rem}.pattern-index{color:#a1a1aa;font-size:.7rem;font-weight:750;font-variant-numeric:tabular-nums}.pattern-head p{margin:0;color:#71717a;font-size:.7rem;font-weight:760;letter-spacing:.09em;text-transform:uppercase}.pattern code{flex:none;border:1px solid var(--line);border-radius:.4rem;background:#fafafa;color:#71717a;padding:.25rem .45rem;font-size:.7rem}.pattern-question{display:grid;grid-template-columns:9rem minmax(0,1fr);gap:1rem;align-items:baseline;margin:0 .2rem .85rem;padding:.65rem .8rem;border-left:2px solid var(--accent);background:#fafafa}.pattern-question span{color:#71717a;font-size:.65rem;font-weight:760;letter-spacing:.08em;text-transform:uppercase}.pattern-question strong{font-size:.82rem;font-weight:620}.preview{overflow:auto;border:1px solid var(--line);border-radius:.75rem;background:#f4f4f5;padding:.75rem}.pattern img{display:block;width:min(100%,var(--canvas-preview-width,100%));height:auto;margin:0 auto;object-fit:contain;box-shadow:0 6px 22px #18181b0a}.pattern-context{display:grid;grid-template-columns:.72fr 1.55fr 1fr;margin-top:1rem;border-block:1px solid var(--line)}.pattern-context>div{min-height:4.4rem;padding:.75rem .25rem}.pattern-context>div+div{border-left:1px solid var(--line);padding-left:1rem}.pattern-context span{display:block;color:#71717a;font-size:.64rem;font-weight:760;letter-spacing:.08em;text-transform:uppercase}.pattern-context strong{display:block;margin-top:.3rem;font-size:.73rem;font-weight:570;line-height:1.45}.review-actions{display:flex;justify-content:space-between;gap:1rem;align-items:center;padding:.8rem .25rem;color:#71717a;font-size:.72rem}.review-actions footer{display:flex;gap:.4rem}.review-actions a{border:1px solid var(--line-strong);border-radius:.4rem;background:#fff;padding:.28rem .48rem;color:#3f3f46;font-weight:650;text-decoration:none}.pattern details{border-top:1px solid var(--line)}.pattern details:last-child{margin-bottom:.25rem}.pattern summary{cursor:pointer;padding:.65rem .25rem;color:#52525b;font-size:.72rem;font-weight:650}.pattern pre{max-height:24rem;overflow:auto;white-space:pre-wrap;border-radius:.55rem;background:#18181b;color:#fafafa;padding:1rem;font-size:.7rem;line-height:1.55}.technical{color:#71717a}[hidden]{display:none!important}.viewport-mobile .pattern{width:auto;margin-inline:0}.viewport-mobile .preview{padding:.5rem}
.capabilities{scroll-margin-top:6rem;margin-bottom:5.5rem}.capability-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.capability-card{overflow:hidden;border:1px solid var(--line-strong);border-radius:.85rem;background:#fff;box-shadow:0 1px 2px #18181b0a,0 9px 26px #18181b06}.capability-card>header{min-height:13rem;padding:1.1rem 1.25rem}.capability-card>header span{color:var(--accent);font-size:.62rem;font-weight:760;letter-spacing:.09em;text-transform:uppercase}.capability-card h3{margin:.3rem 0 .45rem;font-size:1rem;letter-spacing:-.025em;line-height:1.3}.capability-card p{margin:0;color:#71717a;font-size:.74rem}.capability-card small{display:block;margin-top:.7rem;color:#71717a;font-size:.65rem;line-height:1.5}.capability-stage{height:18.5rem;overflow:hidden;border-top:1px solid var(--line);background:#fafafa;padding:1rem}.code-stage{display:grid;align-items:stretch;background:#18181b}.code-stage pre{width:100%;height:100%;min-height:0;margin:0!important;border-radius:.6rem!important;padding:1rem!important;font-size:.76rem!important;line-height:1.65!important}.diagram-stage{display:grid;place-items:center}.mermaid-live{width:100%;text-align:center}.mermaid-live svg{display:block;max-width:100%;height:auto;margin:auto}.chart-stage{display:grid;place-items:center}.chart-stage img{display:block;width:100%;height:auto}.chart-dark{display:none!important}.report-demo{display:grid;align-items:stretch;overflow:auto}.report-demo .composition-group{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem}.report-demo .report-metric,.report-demo .composition-card,.report-demo .report-progress{min-height:7.2rem;border:1px solid var(--line);border-radius:.65rem;background:#fff;padding:.85rem}.report-demo .report-span-2{grid-column:span 2}.report-demo .report-metric{display:grid;align-content:space-between;border-top:2px solid var(--accent)}.report-demo .report-metric-label,.report-demo .report-metric-trend,.report-demo .report-progress-head{color:#71717a;font-size:.68rem}.report-demo .report-metric-value{font-size:1.65rem;letter-spacing:-.04em}.report-demo .composition-card h3{margin:0 0 .45rem;font-size:.85rem}.report-demo .composition-card h3 a{text-decoration:none}.report-demo .composition-card p{font-size:.72rem}.report-demo .report-progress-head{display:flex;justify-content:space-between;gap:.5rem}.report-demo .report-progress-track{height:.45rem;margin-top:1rem;border-radius:999px;background:#e4e4e7;overflow:hidden}.report-demo .report-progress-fill{display:block;height:100%;border-radius:inherit;background:var(--accent)}.guide-intro{display:flex;justify-content:space-between;gap:2rem;align-items:end;margin:3rem 0 1rem}.guide-intro span,.guide-card>span{color:var(--accent);font-size:.62rem;font-weight:760;letter-spacing:.09em;text-transform:uppercase}.guide-intro h3{margin:.15rem 0 0;font-size:1.3rem;letter-spacing:-.03em}.guide-intro p{max-width:34rem;margin:0;color:#71717a;font-size:.75rem}.guide-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;border:1px solid var(--line);border-radius:.8rem;background:var(--line);overflow:hidden}.guide-card{min-height:18rem;background:#fff;padding:1.1rem}.guide-card h3{margin:.3rem 0 .55rem;font-size:.96rem}.guide-question{min-height:4rem;margin:0;color:#18181b;font-size:.78rem;font-weight:620;line-height:1.45}.guide-card dl{display:grid;gap:.65rem;margin:1rem 0 0}.guide-card dl div{border-top:1px solid var(--line);padding-top:.55rem}.guide-card dt{color:#71717a;font-size:.58rem;font-weight:760;letter-spacing:.08em;text-transform:uppercase}.guide-card dd{margin:.18rem 0 0;color:#52525b;font-size:.66rem;line-height:1.45}
:root[data-theme="dark"]{color-scheme:dark;--line:#27272a;--line-strong:#3f3f46;--muted:#a1a1aa;--soft:#18181b;background:#09090b;color:#fafafa}:root[data-theme="dark"] body{background:#09090b;color:#fafafa}:root[data-theme="dark"] .sidebar{background:#111113}:root[data-theme="dark"] .side-nav a,:root[data-theme="dark"] .intro>p,:root[data-theme="dark"] .pattern-head p,:root[data-theme="dark"] .family-head p,:root[data-theme="dark"] .review-actions,:root[data-theme="dark"] .pattern summary,:root[data-theme="dark"] .guide-card dd{color:#a1a1aa}:root[data-theme="dark"] .side-nav a:hover,:root[data-theme="dark"] .side-nav a.active,:root[data-theme="dark"] .side-note,:root[data-theme="dark"] .pipeline article,:root[data-theme="dark"] .pattern,:root[data-theme="dark"] .controls input,:root[data-theme="dark"] .controls select,:root[data-theme="dark"] .side-nav b,:root[data-theme="dark"] .capability-card,:root[data-theme="dark"] .guide-card,:root[data-theme="dark"] .report-demo .report-metric,:root[data-theme="dark"] .report-demo .composition-card,:root[data-theme="dark"] .report-demo .report-progress{background:#111113;color:#fafafa}:root[data-theme="dark"] .review-bar,:root[data-theme="dark"] .mobile-bar{background:#09090bf0}:root[data-theme="dark"] .pattern-index,:root[data-theme="dark"] .pattern code,:root[data-theme="dark"] .family-head>b,:root[data-theme="dark"] .preview-bar,:root[data-theme="dark"] .pattern-context>div,:root[data-theme="dark"] .pattern-question{background:#18181b;color:#d4d4d8}:root[data-theme="dark"] .preview,:root[data-theme="dark"] .pattern-context,:root[data-theme="dark"] .capability-stage{background:#18181b}:root[data-theme="dark"] .review-actions a{background:#18181b;color:#fafafa}:root[data-theme="dark"] .mobile-menu{background:#111113}:root[data-theme="dark"] .mobile-menu a{color:#d4d4d8}:root[data-theme="dark"] .chart-light{display:none!important}:root[data-theme="dark"] .chart-dark{display:block!important}:root[data-theme="dark"] .shiki{background-color:var(--shiki-dark-bg)!important;color:var(--shiki-dark)!important}:root[data-theme="dark"] .shiki span{color:var(--shiki-dark)!important}
@media(max-width:1050px){:root{--sidebar:0rem}.sidebar{display:none}.workspace{margin-left:0}.mobile-bar{position:sticky;top:0;z-index:30;display:flex;justify-content:space-between;align-items:center;height:3.6rem;border-bottom:1px solid var(--line);background:#fffffff2;padding:0 1rem;backdrop-filter:blur(18px)}.mobile-bar .brand{padding:0}.mobile-bar details{position:relative}.mobile-bar summary{list-style:none;cursor:pointer;border:1px solid var(--line-strong);border-radius:.45rem;background:#fff;padding:.38rem .6rem;font-size:.72rem;font-weight:650}.mobile-bar summary::-webkit-details-marker{display:none}.mobile-menu{position:absolute;right:0;top:2.7rem;width:min(21rem,calc(100vw - 2rem));max-height:70vh;overflow:auto;border:1px solid var(--line-strong);border-radius:.7rem;background:#fff;padding:.65rem;box-shadow:0 20px 55px #18181b20}.mobile-menu a{display:block;border-radius:.4rem;padding:.55rem;color:#3f3f46;font-size:.75rem;text-decoration:none}.mobile-menu a:hover{background:#f4f4f5}.review-bar{top:3.6rem}}
@media(max-width:760px){.content,.controls{width:min(100% - 2rem,82rem)}.intro{padding:2.4rem 0 1.5rem}.intro h1{font-size:clamp(2.2rem,12vw,3.35rem)}.intro>p{font-size:.92rem}.pipeline{grid-template-columns:1fr}.pipeline article{display:grid;grid-template-columns:2.1rem 8rem 1fr;align-items:start;gap:.35rem;min-height:auto;padding:.72rem}.pipeline strong{margin:0;font-size:.78rem}.pipeline p{font-size:.68rem}.controls{display:grid;grid-template-columns:1fr 1fr;align-items:end}.controls label:first-child{grid-column:1/-1}.controls input,.controls select{width:100%;min-width:0}.result-count{display:none}.gallery{padding-top:2rem}.family+.family{margin-top:4rem}.family-head{grid-template-columns:2.2rem 1fr}.family-head>b{display:none}.family-head h2{font-size:1.35rem}.family-patterns{gap:3rem}.pattern-head{padding:0 .1rem .65rem;flex-direction:row;align-items:center}.pattern code{order:0}.pattern-question{grid-template-columns:1fr;gap:.2rem}.preview{margin:0}.pattern-context{grid-template-columns:1fr;margin-top:.75rem}.pattern-context>div{min-height:auto}.pattern-context>div+div{border-top:1px solid var(--line);border-left:0;padding-left:.25rem}.review-actions{align-items:flex-start;flex-direction:column;padding-inline:.25rem}.pattern details{margin:0}.guide-intro{align-items:start;flex-direction:column;gap:.4rem}.guide-grid{grid-template-columns:1fr}.guide-card{min-height:auto}.guide-question{min-height:0}}
@media(max-width:760px){.capability-grid{grid-template-columns:1fr}.capability-card>header{min-height:auto}.capability-stage{height:auto;min-height:14rem}.code-stage{height:14rem}.report-demo .composition-group{grid-template-columns:1fr}.report-demo .report-span-2{grid-column:auto}}
.pattern-head>div{align-items:flex-start;gap:.75rem}.pattern-index{margin-top:.18rem}.pattern-head .pattern-copy>p:first-child{margin:0;color:#71717a;font-size:.68rem;font-weight:760;letter-spacing:.09em;text-transform:uppercase}.pattern-copy h3{margin:.08rem 0 .12rem;font-size:1.15rem;letter-spacing:-.025em}.pattern-head .pattern-copy>p:last-child{max-width:42rem;margin:0;color:#71717a;font-size:.78rem;font-weight:400;letter-spacing:0;text-transform:none}
.pattern-tools{display:flex;flex:none;gap:.45rem;align-items:center}
:root[data-theme="dark"] .mobile-bar summary{border-color:#3f3f46;background:#18181b;color:#fafafa}
@media(max-width:760px){.capabilities,.family{scroll-margin-top:18rem}}
:root[data-theme="light"]{--background:0 0% 100%;--foreground:240 10% 3.9%;--muted:240 4.8% 95.9%;--muted-foreground:240 3.8% 32%;--border:240 5.9% 90%;--primary:240 5.9% 10%;--primary-foreground:0 0% 98%}:root[data-theme="dark"]{--background:240 10% 3.9%;--foreground:0 0% 98%;--muted:240 3.7% 15.9%;--muted-foreground:240 5% 64.9%;--border:240 3.7% 20%;--primary:0 0% 98%;--primary-foreground:240 5.9% 10%}
@media(max-width:900px){.controls{display:grid;grid-template-columns:1fr 1fr}.controls label:first-child{grid-column:1/-1}.controls input,.controls select{width:100%;min-width:0}.result-count{display:none}}
@media(max-width:760px){.pattern-head>div{min-width:0}.pattern-copy{min-width:0}.pattern-copy h3{font-size:1.05rem}.pattern-head code{max-width:9rem;overflow:hidden;text-overflow:ellipsis}.pattern-tools>span{display:none}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
.pattern iframe{display:block;width:100%;border:0;background:#fff}.pattern iframe[hidden]{display:none}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar"><a class="brand" href="#introduction"><i></i>ContentKit Patterns</a><p class="side-label">Semantic guidance</p><nav class="side-nav"><a href="#semantic-publishing"><span>00</span><strong>Stories and selection</strong><b>${publishingGuideRegistry.length}</b></a></nav><p class="side-label">Information families</p><nav class="side-nav">${familyNavigation}</nav><div class="side-note"><strong>Review order</strong><p>Meaning first. Then narrative, hierarchy, readability, responsive behavior, and output fidelity.</p></div></aside>
  <div class="workspace">
    <header class="mobile-bar"><a class="brand" href="#introduction"><i></i>ContentKit Patterns</a><details><summary>Browse</summary><nav class="mobile-menu"><a href="#introduction">Introduction</a><a href="#semantic-publishing">Stories and selection</a>${familyNavigation}</nav></details></header>
    <main>
      <section class="intro content" id="introduction"><span class="eyebrow">Pattern review · ${patternRegistry.length} patterns</span><h1>Information patterns for clear communication.</h1><p>Start with what people need to understand. Then review the visual form at six real container widths, in light and dark, from one deterministic semantic model.</p><div class="pipeline"><article><span>01</span><strong>Semantics</strong><p>Identify the meaning and relationships.</p></article><article><span>02</span><strong>Narrative</strong><p>Choose the key message and evidence order.</p></article><article><span>03</span><strong>Composition</strong><p>Select a truthful visual form.</p></article><article><span>04</span><strong>Layout</strong><p>Resolve geometry for the actual container.</p></article><article><span>05</span><strong>Rendering</strong><p>Publish matching HTML, SVG, and PNG.</p></article></div></section>
      <div class="review-bar"><div class="controls"><label>Find a pattern<input id="search" type="search" placeholder="Search by purpose or name"></label><label>Family<select id="category"><option value="">All families</option>${categoryOptions}</select></label><label>Appearance<select id="scheme"><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Render as<select id="output"><option value="svg">SVG</option><option value="html">HTML + CSS</option><option value="png">PNG</option></select></label><label>Container<select id="viewport"><option value="1600">1600 × 900</option><option value="1440">1440 × 1024</option><option value="1024">1024 × 1024</option><option value="768">768 × 1024</option><option value="390">390 × 844</option><option value="320">320 × 900</option></select></label><p class="result-count"><b id="visible-count">${patternRegistry.length}</b> visible</p></div></div>
      <div class="gallery content">${renderingCapabilities}${categorySections}</div>
    </main>
  </div>
</div>
<script src="../../node_modules/mermaid/dist/mermaid.min.js"></script><script>
const q=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];
let renderedMermaidTheme='';async function renderMermaid(theme){const host=q('.mermaid-live');if(!host||!window.mermaid||renderedMermaidTheme===theme)return;renderedMermaidTheme=theme;host.innerHTML=decodeURIComponent(host.dataset.source);host.removeAttribute('data-processed');window.mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:theme==='dark'?'dark':'neutral'});await window.mermaid.run({nodes:[host]})}
function update(){const scheme=q('#scheme').value,viewport=q('#viewport').value,output=q('#output').value,search=q('#search').value.trim().toLowerCase(),category=q('#category').value,heights={320:900,390:844,768:1024,1024:1024,1440:1024,1600:900};document.documentElement.dataset.theme=scheme;document.body.classList.toggle('viewport-mobile',Number(viewport)<=390);let visible=0;all('.pattern').forEach(card=>{const id=card.dataset.id,haystack=(id+' '+card.dataset.search+' '+card.textContent).toLowerCase(),matchesCategory=!category||card.dataset.category===category,stem=id+'--neutral-editorial--'+scheme+'--'+viewport,show=matchesCategory&&haystack.includes(search),image=card.querySelector('.preview-export>img'),frame=card.querySelector('.preview-export>iframe'),isHtml=output==='html';card.hidden=!show;if(show)visible+=1;image.hidden=isHtml;frame.hidden=!isHtml;image.width=Number(viewport);image.height=heights[viewport];frame.width=Number(viewport);frame.height=heights[viewport];if(isHtml)frame.src='assets/'+stem+'.html';else image.src='assets/'+stem+'.'+output;card.querySelector('.html').href='assets/'+stem+'.html';card.querySelector('.svg').href='assets/'+stem+'.svg';card.querySelector('.png').href='assets/'+stem+'.png'});all('.family').forEach(section=>{section.hidden=!section.querySelector('.pattern:not([hidden])')});q('#visible-count').textContent=visible;renderMermaid(scheme)}
all('select,input').forEach(el=>el.addEventListener('input',update));
all('.mobile-menu a').forEach(link=>link.addEventListener('click',()=>link.closest('details').removeAttribute('open')));
const observer=new IntersectionObserver(entries=>{const current=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(!current)return;all('[data-family-link]').forEach(link=>link.classList.toggle('active',link.dataset.familyLink===current.target.dataset.family))},{rootMargin:'-15% 0px -70% 0px',threshold:[0,.1,.5]});all('.family').forEach(section=>observer.observe(section));update();
</script>
</body>
</html>`

const galleryHtml = redesignedHtml || html
await writeFile(join(gallery, 'index.html'), galleryHtml)
await writeFile(
  join(root, 'examples/composition-patterns.json'),
  `${JSON.stringify({ schema_version: '1', patterns: patternRegistry }, null, 2)}\n`,
)
