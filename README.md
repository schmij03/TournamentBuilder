# TournamentBuilder

Turniere für die Schule planen und durchführen: Sporttag, Unihockey-Turnier, Tischtennis, Völkerball oder ein Quiz-Wettkampf. Die App läuft komplett im Browser, braucht keinen Server und kein Login und funktioniert auch offline.

## Funktionen

- **Turnierformen:** nur Gruppenphase / Liga, Gruppenphase mit anschliessender KO-Phase oder reines KO-System
- **Gruppenphase:** beliebig viele Gruppen, jeder gegen jeden (einfach oder mit Hin- und Rückspiel), Gruppen zufällig auslosen oder von Hand zuteilen
- **KO-Phase:** Anzahl Weiterkommende pro Gruppe, zusätzlich beste Nächstplatzierte (z. B. beste Gruppendritte), Freilose bei ungerader Teamzahl, Spiel um Platz 3, Gruppengegner treffen sich nicht in der ersten KO-Runde
- **Rangierung:** Punkte für Sieg, Unentschieden und Niederlage einstellbar, Reihenfolge der Kriterien bei Gleichstand frei wählbar (Punkte, Differenz, erzielte Tore, Siege, Direktvergleich)
- **Zeitplan:** Beginn, Spieldauer, Wechselpause, Anzahl Felder, Mindestpause pro Team, eigene Dauer für KO-Spiele; Änderungen wirken auch während des Turniers
- **Teams:** einzeln oder als Liste hinzufügen (z. B. aus einer Klassenliste kopieren), umbenennen, Setzliste für das KO-System
- **Alle Plätze ausspielen:** Platzierungsspiele für jeden Rang. Bei «nur Gruppen» spielen die Gleichplatzierten aller Gruppen um ihre Ränge, im KO spielen auch die Verlierer weiter (Platz 5–8 usw.), nicht qualifizierte Teams spielen ihre Plätze unter sich aus
- **Mittagspause:** Spiele, die in die Pause fallen würden, rücken automatisch dahinter
- **Losentscheid:** bei Gleichständen, die keine Regel auflöst, per Knopf in der Tabelle
- **Resultate:** direkt im Spielplan oder im KO-Baum eingeben; Remis im KO mit Sieger nach Penalty
- **Spieluhr:** bei jedem Spiel mit «Uhr» wählbar; zählt die Spielzeit herunter, optional mit Halbzeit und Seitenwechsel, Wechselsignal alle X Minuten (z. B. Linienwechsel), danach Wechselpause und Sprung zum nächsten Spiel; mit Signaltönen
- **Live-Modus** (nur in der Online-Version auf claude.ai): Turnier mit «Live teilen» auf mehrere Geräte bringen, z. B. Schiedsrichter tragen Resultate am Handy ein und der Beamer zeigt sie sofort, inklusive laufender Spieluhr
- **Schiri-Ansicht:** fürs Handy, pro Feld: aktuelles Spiel mit grossen +/−-Knöpfen für den Spielstand, Spieluhr und die nächsten Spiele auf diesem Feld
- **Rückgängig:** letzte Änderungen zurücknehmen (Knopf oder Strg+Z)
- **Offline-App:** Die GitHub-Pages-Version lässt sich auf dem Handy oder Laptop installieren und läuft danach auch ohne Internet
- **Beamer-Ansicht:** Vollbild mit Uhrzeit, Spieluhr, nächsten Spielen, letzten Resultaten, Tabellen bzw. KO-Baum
- Spielplan nach Gruppe, Team und Feld filtern
- **Mehrere Turniere**, Kopie als Vorlage, Export und Import als JSON, Drucken des Spielplans
- Bezeichnungen anpassbar (Tore/Punkte/Körbe, Feld/Platz/Tisch), helles und dunkles Farbschema

## Benutzung

Online über GitHub Pages (siehe unten) oder lokal: `index.html` bzw. die Einzeldatei `dist/tournamentbuilder.html` im Browser öffnen.

Die Daten liegen im `localStorage` des Browsers. Wer das Turnier auf einem anderen Gerät weiterführen möchte, nutzt **Export** und **Import**.

## Entwicklung

```bash
npm test        # Tests der Turnierlogik (Node 18+)
npm run build   # erzeugt dist/tournamentbuilder.html (alles in einer Datei)
```

| Datei | Inhalt |
| --- | --- |
| `js/core.js` | Turnierlogik ohne DOM: Spielplan, Tabellen, KO-Baum, Validierung |
| `js/app.js` | Oberfläche, Speicherung, Dialoge, Beamer-Ansicht |
| `css/style.css` | Gestaltung inkl. Dunkelmodus und Druckansicht |
| `tests/` | Tests für `core.js` |

## Online stellen mit GitHub Pages

1. Im Repository unter **Settings → Pages** bei *Source* «GitHub Actions» wählen.
2. Auf den Standard-Branch pushen. Der Workflow `.github/workflows/pages.yml` testet, baut und veröffentlicht die Seite unter `https://<benutzer>.github.io/TournamentBuilder/`.
