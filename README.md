# Showroom Suite

Desktopapplicatie voor de afdeling Showroom: kopersbegeleiding, planning en
capaciteit op één plek, in plaats van verspreid over Excel-bestanden.

Eén installatiebestand, één icoon, dubbelklikken en werken. Geen cloud, geen
webadres om te onthouden, werkt volledig offline.

## Wat er nu werkt

| Onderdeel | Status |
|---|---|
| Rekenkern: beschikbaarheid, capaciteit, feestdagen, prijzen | **af**, volledig getest |
| Database: 58 tabellen, migraties, views, seed | **af** |
| API: authenticatie, autorisatie, generieke CRUD, capaciteit, verlof | **af** |
| Electron-schil: venster, Nederlands menu, systeemvak, diepe links, PDF | **af** |
| Schermen: inloggen, dashboard, planning, verlofkalender | **af** |
| CRM, kansen, pakketten, offertes, opvolging, e-mail, AI, rapportages | nog niet gebouwd |

De schermen die nog niet gebouwd zijn, tonen dat ook eerlijk: ze zeggen in welke
fase ze komen. De gegevens erachter staan al wel in de database.

Zie `CHANGELOG.md` voor wat er per stap is opgeleverd en `docs/BESLISSINGEN.md`
voor de keuzes die onderweg zijn gemaakt.

## Aan de slag

Vereist: Node.js 22.13 of nieuwer (voor de ingebouwde `node:sqlite`).

```bash
npm ci
npm run check          # typecheck + lint + tests
npm run dev            # de app in ontwikkelmodus
npm run build:win      # NSIS-installer voor Windows x64
```

De kern draait ook los van Electron, wat handig is om de API te bekijken:

```bash
node --experimental-strip-types packages/core/src/standalone.ts --demo
```

Dat vult een lege database met de demogegevens uit bijlage A en toont het
adres, de schemaversie en het sessietoken.

### Inloggen in de demo

| Gebruiker | E-mailadres | Rol |
|---|---|---|
| Patrick Dekker | `patrick@showroom.local` | beheerder |
| Dennis van de Meeberg | `dennis@showroom.local` | kopersbegeleider |
| Robert de Bergh | `robert@showroom.local` | kopersbegeleider (parttime) |
| Marieke Manager | `manager@showroom.local` | manager |
| Meekijker Acquisitie | `acquisitie@showroom.local` | alleen lezen |

Wachtwoord voor alle demo-accounts: `Showroom2026!` — de app vraagt bij de
eerste keer inloggen om een nieuw wachtwoord.

## Hoe het in elkaar zit

```
Showroom Suite.exe  (Electron)
├── MAIN            venster, Nederlands menu, systeemvak, meldingen, PDF, updates
├── UTILITY         "de kern": Fastify op loopback, SQLite, alle bedrijfslogica
└── RENDERER        React, praat via HTTP met de kern
```

De bedrijfslogica draait achter HTTP in plaats van achter IPC. Dat kost
nauwelijks iets en levert drie dingen op: de logica is testbaar zonder
Electron, de hostmodus (collega's en telefoons laten meekijken) is bijna
gratis, en de mobiele weergave heeft geen tweede implementatie nodig.

```
packages/
├── shared/     zod-schema's, types, ISO-weken, geldrekenen, formatters
├── core/       DE KERN — server, database, migraties, engines
│   ├── db/         schema, migraties, views, seed
│   └── modules/    availability capacity opportunities packages auth query crud
├── main/       Electron main + preload
└── renderer/   React
```

## De rekenkern

Twee pure functiebibliotheken zonder databasetoegang, en dus volledig
testbaar:

**Beschikbaarheid** (`modules/availability/engine.ts`) rekent per medewerker
per ISO-week uit hoeveel uur er overblijft na rooster, feestdagen, sluitingen,
verlof en tijdelijke inzet op andere projecten. Alles gaat in uren, want alleen
zo kloppen parttimers, halve dagen en percentages tegelijk.

De valkuil zit in stap 6: iemand die 40% op een ander project zit én een dag
verlof heeft, is die week 40% weg, niet 60%. Feestdagen en verlof gaan voor;
inzet elders vult alleen de resterende tijd. Daar staat een expliciete test op.

**Capaciteit** (`modules/capacity/engine.ts`) verdeelt de afspraken van een
project over de weken van zijn showroomfase en smeert het nawerk uit over de
doorlooptijd. Die uitsmering loopt alleen over open weken, zodat werk over een
bouwvak heen doorschuift in plaats van te verdwijnen.

Beide zijn getoetst aan de rekenvoorbeelden uit de opdracht, tot op twee
decimalen.

## Tests

```bash
npm test
```

205 tests, waaronder de verplichte gevallen: de volledige tabel met
beschikbaarheidsvoorbeelden, de dubbeltellingsregel, de paasdata van 2024 tot
en met 2035, de verschuivingsregel voor Koningsdag, de convolutie met en zonder
sluitingsperiode, de jaarovergang met week 53, en pogingen om via het filter
SQL binnen te smokkelen.

## Bestandslocaties

```
%APPDATA%\ShowroomSuite\
├── showroom.db  (+ -wal, -shm)
├── attachments\
├── backups\
├── templates\
├── logs\
└── config.json
```

De app weigert een databaselocatie op een netwerkschijf of in een
synchronisatiemap (OneDrive, Dropbox, Google Drive). SQLite over SMB of over
een sync-client raakt beschadigd. Back-upkopieën mogen daar wel heen.

## Documentatie

| Bestand | Voor wie |
|---|---|
| `docs/INSTALLATIE.md` | wie de app installeert |
| `docs/GEBRUIKERSHANDLEIDING.md` | de dagelijkse gebruiker |
| `docs/BEHEERDERSHANDLEIDING.md` | de beheerder |
| `docs/BESLISSINGEN.md` | wie wil weten waarom iets zo gebouwd is |
| `docs/DATAMODEL.md` | wie het datamodel in wil |
