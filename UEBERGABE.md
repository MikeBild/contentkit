# Übergabe: ContentKit Cockpit — Feinschliff mit Familien-Wiedererkennung

**Für:** Claude Code auf dem Mac, Repo `~/Projects/AI/contentkit`
**Referenz-Grundlage dieses Produkts:** **Keine externe Referenz.** Die
Wiedererkennung für den Endnutzer kommt aus den Familienmustern der
Cockpit-Konvention v1.4, mit benannten Vorbildern je Muster: **WorkKit**
für die Entscheidungs-Grammatik (§8), **SubKit** für Diff-Freigabe,
Sammlungs-Listen und Verbindungs-Status (§9–§11), **WikiKit** für Capture
und Lesepfad (§4/§5). Wer eines der drei Produkte kennt, findet sich hier
sofort zurecht — das ist das Designziel. Kein Shared Code; Muster werden
kopiert. Repo hat `apps/cockpit/UI-UX.md` ✓.

## Ausgangslage

ContentKit ist am nächsten an der Konvention: Die Release-Kette als Zone B
ist das beste Produktbild der sechs, und „5 von 10 Statistiken haben nichts
darzustellen" lebt §4 bereits vorbildlich. Der Feinschliff besteht darin,
die Familienmuster dort einzusetzen, wo ContentKit heute eigene Wege geht.

## Stufe 1 — Entscheidungen (§8, Vorbild WorkKit)

Queue-Quellen: wartende Entwürfe (mit Alter) · Moderationsfälle
(Kommentare, Kontaktanfragen, Beitragsfeedback) · Preview-Promotions.
Nav-Eintrag „Entscheidungen" mit Zähler unter der Übersicht; die
Overview-Karte „Wartet auf dich" (Zone A) zeigt die Top-Positionen und
verlinkt dorthin. Moderation bleibt als Detailseite bestehen; ihr
Pending-Anteil lebt zusätzlich in der Queue. Aging-Rubrik, Regale,
Zero-States nach §8; Moderations-Erledigtes verschwindet aus der Queue
(Zustand), das Audit behält alles (Geschichte, §8.5).

## Stufe 2 — Diff-Freigabe (§9, Vorbild SubKit)

Die Preview-Promotion ist ContentKits Vorschlags-Mechanik: Die
Promotion-Entscheidung erscheint als Diff-Karte — geänderte Dokumente
alt/neu (Markdown-Renderer), Preview-Link als Prüf-Ergebnis daneben —
entscheidbar in place und zusätzlich in der Queue sichtbar. Die APIs
existieren (immutable preview promotion, Cockpit-Review-Link). Wichtig:
Publikation/Aktivierung bleibt die menschliche Browser-Entscheidung der
bestehenden Mechanik — die Karte führt hin, sie umgeht nichts.

## Stufe 3 — Konvention einlösen, Bestand entrümpeln

- **Destruktive Aktionen (§5):** „Verwerfen" neben jedem „Bearbeiten" und
  rotes „Löschen" bei Releases → ins ⋯-Menü mit Bestätigung.
- **Betriebsmetriken (§1):** HTTP, MCP-Calls, p95 von der Übersicht nach
  Installation → System. Die Release-Kette bleibt der Hero.
- **Werkzeuge-Gruppe:** Kompositionen + Präsentationen aus der
  Inhalte-Gruppe in eine eigene Gruppe „Werkzeuge" — Autorenwerkzeug ≠
  Cockpit-Screen.
- **Sammlungs-Listen (§10, Vorbild SubKit):** Dokumente-/Release-Listen
  mit Suche, Sortier-Headern und Kategorie-Chips aus den Daten;
  Zusammenfassungszeile in Listen (§5).
- **Site-Switcher (§6):** sortiert, Prod/Test/Canary getrennt, Test
  ausblendbar.

## Stufe 4 — Rechte-Inventur (§11)

Die 40 API-Schlüssel und 18 Identitätsfreigaben bekommen die
Rechte-Inventur: Sortierung „zuletzt verwendet", nie benutzte markiert,
Alter sichtbar, Widerruf in place. Die vorhandene Governance-Aussage im UI
(„Es gibt bewusst keinen Update-Endpunkt …") bleibt — sie ist ein gutes
Beispiel für §14 (Grenze, nicht Leitplanke) und wird entsprechend
gekennzeichnet.

## Stufe 5 — Capture für Entwürfe (§4, Vorbild WikiKit)

Entwurfs-Erfassung reibungsfrei: neuer Entwurf ohne Pflichtfelder-Hürde,
Metadaten kommen bei der Redaktions-Triage (die §8-Queue zeigt „5 Entwürfe
warten seit 21 Minuten" bereits an — der Weg vom Zähler zur gebündelten
Durchsicht wird der Triage-Flow). Leere Zustände führen zur Handlung
(„Ersten Entwurf anlegen" → Assistent mit vorbereitetem Prompt).

## Akzeptanzkriterien (bindend, Format s. Übergaben-Index)

**AK-CK-1.1 · Eine Queue, drei Quellen**
Gegeben: 5 wartende Entwürfe (21 min), 2 Moderationsfälle, 1 offene
Promotion (Fixture).
Wenn: `/decisions` geöffnet.
Dann: alle 8 in einer Queue mit Alter und Kind-Badges; Nav-Zähler „8";
Zone A der Übersicht zeigt die Top-Positionen und verlinkt dorthin.
Prüfweg: E2E.

**AK-CK-1.2 · Zustand vs. Geschichte (§8.5)**
Gegeben: ein Moderationsfall.
Wenn: freigeschaltet.
Dann: er verschwindet aus Queue und Zone A; das Audit behält den Vorgang
vollständig.
Prüfweg: E2E + Audit-Assert.

**AK-CK-2.1 · Promotion-Diff-Karte (§9)**
Gegeben: eine Preview-Promotion mit 3 geänderten Dokumenten.
Dann: Diff-Karte (Markdown alt/neu) mit Preview-Link als Prüf-Ergebnis
daneben; „Zur Aktivierung" führt in den bestehenden Browser-Review —
die Karte selbst löst keine Publikation aus.
Prüfweg: E2E + Code-Review-Assert (keine Publish-Mutation aus der Karte).

**AK-CK-3.1 · Keine rote Primärfläche (§5)**
Gegeben: Dokumente- und Release-Listen.
Dann: „Verwerfen"/„Löschen" existieren nur im ⋯-Menü mit Bestätigung;
keine destruktive Primärfläche in einer Listenzeile.
Prüfweg: E2E + Visual.

**AK-CK-3.2 · Übersicht ohne Betrieb (§1)**
Dann: HTTP/MCP/p95 erscheinen nicht auf der Übersicht, sondern unter
Installation → System; die Release-Kette bleibt Hero; die
„gemessene Null"-Karte bleibt erhalten.
Prüfweg: E2E.

**AK-CK-3.3 · Werkzeuge getrennt**
Dann: Kompositionen + Präsentationen stehen in einer eigenen Nav-Gruppe
„Werkzeuge", nicht zwischen den Inhalten.
Prüfweg: E2E.

**AK-CK-3.4 · Listen-Grammatik (§10) + Switcher (§6)**
Dann: Dokumenten-Liste mit Suche, Sortier-Headern, Kategorie-Chips aus den
Daten und Zusammenfassungszeile; Site-Switcher sortiert, Prod/Test/Canary
getrennt, Test ausblendbar.
Prüfweg: E2E.

**AK-CK-4.1 · Schlüssel-Inventur (§11)**
Gegeben: 40 API-Schlüssel, davon mehrere nie benutzt (Fixture).
Dann: Liste sortiert nach „zuletzt verwendet"; nie benutzte sind markiert;
Alter sichtbar; Widerruf in place mit Bestätigung; die vorhandene
Governance-Aussage ist als **Grenze** gekennzeichnet (§14).
Prüfweg: E2E.

**AK-CK-5.1 · Capture ohne Hürde (§4)**
Wenn: „Neuer Entwurf".
Dann: keine Pflichtfelder vor dem ersten Speichern; leerer Zustand führt
in den Assistenten mit vorbereitetem Prompt.
Prüfweg: E2E.

**AK-CK-G.1 · Gates**
Dann: Konventions-Kopie v1.4 im Repo; `UI-UX.md` aktualisiert; alle
Repo-Gates grün.
Prüfweg: CI-Gate.
