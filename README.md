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
| Veldenregister: velden toevoegen, hernoemen, verplaatsen, verbergen, verwijderen | **af** |
| Generieke lijst, detailpagina en veldbeheer | **af** |
| CRM: zoeken, tijdlijn, dubbelen samenvoegen, bijlagen, AVG | **af** |
| Kansen: kanban, disciplineregels, winnen/verliezen, trechterrapport | **af** |
| Verlof: aanvragen, goedkeuren, saldo in uren, inzet elders | **af** |
| Pakketten, offertes, opvolging, e-mail, AI, export | nog niet gebouwd |

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

## Het veldsysteem

Elk veld van elke entiteit staat in één register, ook de systeemvelden. Een
beheerder voegt bij Instellingen → Velden een veld toe en het werkt meteen in
het formulier, de lijst, het filter en de export — zonder dat er code bij hoeft.

Maatwerkvelden staan als JSON in `custom_fields`, dus één record blijft één rij.
Zet een beheerder "indexeren" aan, dan genereert het systeem een virtuele kolom
met een index erop, en gebruikt SQLite die ook echt in plaats van elke rij open
te maken.

Systeemvelden hebben een echte kolom en kunnen daarom wel verborgen en hernoemd
worden, maar niet verwijderd; de UI legt dat uit. Maatwerkvelden kunnen wel
definitief weg, inclusief de ingevoerde waarden, na het overtypen van de
veldsleutel.

Een formuleveld rekent over de andere velden van hetzelfde record. Dat gebeurt
met een eigen parser, niet met `eval`: wat niet in de grammatica staat, kan een
formule niet doen.

## CRM

`Ctrl+K` zoekt over klanten, contactpersonen, projecten en kansen tegelijk.
Wat een gebruiker intikt is tekst, geen zoekquery: aanhalingstekens, sterretjes
en woorden als `AND` of `NEAR` worden opgeschoond voordat ze bij FTS5 komen, en
er is een terugval op LIKE.

Dubbelendetectie kijkt naar KvK-nummer, e-mailadres, adres en naam. Namen worden
zo genormaliseerd dat rechtsvormen en woordvolgorde er niet meer toe doen, dus
"Bouwbedrijf Meesters B.V." en "Meesters Bouwbedrijf bv" worden als hetzelfde
herkend. Samenvoegen laat u per veld kiezen welke waarde wint en verhuist alles
mee wat naar het vervallende record wees.

Anonimiseren overschrijft naam en contactgegevens, óók in het auditlog, maar
laat offertes en kansen staan: het bedrag is bedrijfsadministratie, de naam is
een persoonsgegeven.

## Kansen

Het kansenscherm is een kanbanbord: één kolom per fase, één kaart per open
kans, en slepen verplaatst een kans. Naar "Gewonnen" of "Verloren" slepen
verplaatst niet, maar opent de bijbehorende dialoog — bij winnen hoort een
bedrag per discipline en bij verliezen een reden, en zonder die twee klopt het
verkooprapport later niet. De kern weigert die fasewissel ook als de aanroep
buiten het scherm om komt.

Slepen is met een toetsenbord niet te doen, dus elke kaart draagt daarnaast een
keuzelijst "Verplaats naar" met dezelfde werking.

Bedrag, marge, gewogen bedrag en gescoord bedrag zijn afgeleid en worden nooit
ingetikt: na elke wijziging aan een kans of een regel rekent de kern ze opnieuw
uit met de prijsmodule. De regeleditor toont tijdens het typen alvast wat het
wordt, met exact dezelfde functie, zodat scherm en database niet uit elkaar
kunnen lopen.

Bedragen typt u Nederlands ("1.234,56"). Die omrekening naar centen schuift de
komma in de tekst op in plaats van via een kommagetal te gaan: `1,005 × 100` is
in drijvende komma 100,49999999999999 en zou naar € 1,00 afronden.

## Verlof en inzet

Een aanvraag laat tijdens het invullen zien wat hij met de planning doet: welke
weken eronder komen te staan, hoeveel begeleiders er dan nog zijn en wie er al
weg is. Dat is een waarschuwing en geen blokkade. De kern weigert de aanvraag
niet, en het scherm dus ook niet: wie weet dat het druk wordt mag alsnog vrij
vragen, en het gesprek daarover hoort tussen mensen plaats te vinden.

Het saldo rekent in uren. Dat is de enige eenheid waarin een parttimer en een
voltijder in dezelfde tabel passen: "twee dagen verlof" is voor iemand die vier
uur op dinsdag werkt iets anders dan voor iemand die er acht draait. De uren per
dag komen uit dezelfde functie als de beschikbaarheidsengine gebruikt, zodat
saldo en planning niet uit elkaar kunnen lopen. Een feestdag midden in een
vakantie kost geen verlof, en de vaste vrije dag van een parttimer evenmin.

Verlof en inzet elders horen bij een persoon, en dat wordt in de kern
afgedwongen: een gewone gebruiker kan alleen zijn eigen registraties beheren en
de status niet zelf zetten. Goedkeuren blijft aan de manager, en dat geldt ook
voor een POST die de goedkeuringsstroom probeert over te slaan.

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

480 tests, waaronder de verplichte gevallen: de volledige tabel met
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
