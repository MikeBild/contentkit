---
kind: deck
layout: deck
title: ContentKit – semantisches Publishing
locale: de
slug: contentkit-semantic-publishing
summary: Von geprüften Quellen über Informationsarchitektur und Erzählung bis zum dauerhaft veröffentlichten Deck.
question: Wie wird aus Quelldaten ein nachvollziehbares und visuell starkes Deck?
goal: Den vollständigen ContentKit-Weg von der Quelle bis zum messbaren Release zeigen.
thesis: Semantik führt die Darstellung – Rendering und Veröffentlichung bleiben deterministisch.
conclusion: Ein gemeinsamer Inhaltskern erzeugt prüfbare Seiten, Reports und Präsentationen.
action: Quellen strukturieren, Deck planen, semantisch rendern und atomar veröffentlichen.
deck:
  theme: editorial
  visualScheme: auto
  maxSlides: 16
  firstSlide:
    layout: cover
---

# ContentKit

Semantisches Publishing für Seiten, Reports und Präsentationen.

---

# Ein gemeinsamer Inhaltskern

:::relationship{title="Vom Beleg zum veröffentlichten Artefakt" role="primary" preferredPattern="architecture-map"}
- Quelldaten · liefern überprüfbare Aussagen und Referenzen
- Informationsarchitektur · ordnet Themen, Belege und Abhängigkeiten
- Erzählung · führt von der Frage über die Evidenz zur Handlung
- Semantische Komponenten · beschreiben Bedeutung statt Pixel
- Release · veröffentlicht ein unveränderliches Ergebnis
:::

---

# Planung vor Darstellung

:::process{title="Deterministischer DeckPlan" role="primary" preferredPattern="chevron-process"}
- Markdown und Quellen prüfen
- Informationsarchitektur ableiten
- Rollen und Kommunikationsziele bestimmen
- DeckPlan und Quellhash festschreiben
:::

---

# Eine Erzählung mit Richtung

:::timeline{title="Vom Ausgangspunkt zur Entscheidung" role="primary" preferredPattern="horizontal-timeline"}
- Ausgangslage · die Leitfrage und ihr Kontext
- Evidenz · belegte Fakten und erkennbare Einschränkungen
- Einordnung · Beziehungen, Alternativen und Folgen
- Entscheidung · Schlussfolgerung und konkrete Handlung
:::

---

# Semantik wird visuell

::::comparison{title="Autorenvertrag und Ausgabe" role="primary" preferredPattern="split-comparison"}
:::side{label="Eingabe"}
- Markdown · lesbar, versionierbar und vergleichbar
- Direktiven · Metric, Process, Timeline und Relationship
:::
:::side{label="Ausgabe"}
- SVG · zugänglich, skalierbar und in hell/dunkel verfügbar
- PNG · layoutgleiches Raster-Fallback für jeden visuellen Baustein
:::
::::

---

# Zwei Farbschemata, ein Inhalt

:::metric{label="Visuelle Varianten" value="2" period="pro Komponente" status="light + dark" role="primary"}
:::

:::metric{label="Externe Laufzeitaufrufe" value="0" period="im veröffentlichten Deck" status="offline"}
:::

---

# Ein kontrollierter Build

:::process{title="Vom Plan zum selbstständigen Deck" role="primary" preferredPattern="connected-process"}
- Semantische Regionen validieren
- SVG- und PNG-Repräsentationen rendern
- Slidev mit begrenzter Laufzeit bauen
- HTML, Assets und Schriften einbetten
:::

---

# Veröffentlichung ohne Zwischenzustand

:::process{title="Sicherer Release-Weg" role="primary" preferredPattern="circular-lifecycle"}
- Unveränderliche Revision anlegen
- Vorschau im Browser prüfen
- Release vollständig bauen
- Zeiger atomar aktivieren
- Bei Bedarf auf den vorherigen Stand zurückschalten
:::

---

# Betrieb ist Teil des Produkts

:::relationship{title="Messbare Deck-Pipeline" role="primary" preferredPattern="hub-and-spoke"}
- Pläne und Validierungen · zeigen die Nutzung vor dem Build
- Sync- und Async-Builds · unterscheiden Ausführungswege
- Cache · trennt Treffer und vollständige Renderings
- Artefakte · zählen Slides, SVG, PNG und Ausgabebytes
- Ergebnisse · erfassen Erfolg, Fehler, Timeout und Ablehnung
:::

---

# Das Ergebnis

:::metric{label="Öffentliche stabile URL" value="1" period="pro Release-Deck" status="dauerhaft" role="primary"}
:::

Quelle, Plan, visuelle Komponenten, HTML, Telemetrie und Rollback gehören zu einem ContentKit-Release.

---

# Quellen

- [ContentKit](https://github.com/MikeBild/contentkit)
- [Semantische Slide-Decks](https://github.com/MikeBild/contentkit/blob/main/docs/SLIDE_DECKS.md)
- [Visuelle Kompositionen](https://github.com/MikeBild/contentkit/blob/main/docs/VISUAL_COMPOSITIONS.md)
- [Produktstatistiken](https://github.com/MikeBild/contentkit/blob/main/docs/PRODUCT_ANALYTICS.md)
