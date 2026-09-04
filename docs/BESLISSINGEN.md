# Beslissingen

Waarom dingen zijn zoals ze zijn. Elke keuze staat hier met de afweging erbij,
zodat een opvolger niet hoeft te raden — en zodat een verkeerde keuze
herkenbaar terug te draaien is.

## De twee vragen uit hoofdstuk 16.2

Beide zijn gesteld; er is doorgebouwd met de standaardkeuze.

1. **Netwerkstand bij oplevering.** Gebouwd als **alleenstaand**. De hostmodus
   zit in het ontwerp (de kern luistert al op een instelbaar adres en de
   API-laag is er klaar voor) maar staat uit. Aanzetten is later een
   instelling, geen verbouwing.
2. **Klantdata naar de Anthropic API.** Aangenomen: **ja, met anonimisering
   aan** voor elke preset die persoonsgegevens raakt. De schakelaar staat per
   preset in het datamodel (`ai_presets.anonymise_personal_data`) en staat
   standaard aan.

## Techniek

### `node:sqlite` met Drizzle via de proxy-driver

Hoofdstuk 2.5 vroeg te controleren of er een Drizzle-driver voor `node:sqlite`
bestaat. **Die bestaat niet** (gecontroleerd op drizzle-orm 0.45.2: er zijn
drivers voor better-sqlite3, bun-sqlite, expo-sqlite, op-sqlite en
sqlite-proxy, maar niet voor `node:sqlite`).

De opdracht noemt `better-sqlite3` als terugval. Dat is hier niet nodig
gebleken: `drizzle-orm/sqlite-proxy` laat Drizzle de SQL bouwen terwijl wij hem
uitvoeren. Daarmee blijft `node:sqlite` de driver, blijft Drizzle de
querybouwer, en is er **geen enkele gecompileerde database-afhankelijkheid** —
precies wat de terugvalregeling wilde voorkomen. Geen `electron-rebuild`, geen
`asarUnpack` voor de database, geen gedoe bij een Electron-upgrade.

Prijs: de proxy-driver is asynchroon. Dat is in een Fastify-server geen bezwaar.

### argon2 via `@node-rs/argon2`

Om dezelfde reden. Het `argon2`-pakket bouwt native tegen de Node-ABI en zou
bij elke Electron-upgrade opnieuw gebouwd moeten worden. `@node-rs/argon2`
levert voorgecompileerde NAPI-binaries; NAPI is ABI-stabiel, dus een
Electron-upgrade raakt het niet. De binary wordt wel uit de asar gepakt
(`asarUnpack`), want een `.node`-bestand moet als bestand op schijf staan.

De parameters zijn die uit de opdracht: `memoryCost 19456, timeCost 2,
parallelism 1`.

### ISO-weken op UTC in plaats van via date-fns

`date-fns` staat in de stack en wordt gebruikt voor presentatie, maar het
weekrekenwerk in de engines gebeurt op eigen UTC-arithmetiek.

Reden: `getISOWeek` en verwanten rekenen in de lokale tijdzone van de machine.
Voor een gebruiker ten westen van UTC verschuift de weekgrens daardoor, en dan
valt een showroomafspraak in de verkeerde week. De engines moeten
tijdzone-onafhankelijk zijn, dus rekenen ze in UTC. Het is ongeveer 150 regels
en het is volledig getest, inclusief jaren met 53 weken.

### De bedrijfslogica achter HTTP in plaats van achter IPC

Zoals de opdracht voorschrijft. Het kost een paar honderd regels extra en
levert op: de logica is testbaar zonder Electron (alle 205 tests draaien zonder
dat er een venster bestaat), de hostmodus is later bijna gratis, en de mobiele
weergave heeft geen tweede implementatie nodig.

De kern draait in een utility process. Crasht die, dan herstart main hem en
toont een melding; het venster blijft staan.

### Geen parameter properties in klassen

`ApiError` en `ApiFout` schrijven hun velden expliciet uit in plaats van
`constructor(readonly x: number)` te gebruiken. Node kan TypeScript alleen
*strippen*, niet omzetten, en struikelt over parameter properties. Zonder deze
aanpassing kan de kern niet zonder buildstap gedraaid worden, en dat is precies
hoe je hem in ontwikkeling wilt kunnen starten.

### Eigen hash-router in plaats van TanStack Router

De schil heeft nu tien routes op één niveau, zonder loaders of geneste
layouts. Daar is een router van veertig regels genoeg voor, en het venster
laadt in productie een `file://`-URL, waar hash-navigatie het eenvoudigst
werkt. `@tanstack/react-router` en `@tanstack/react-table` zijn daarom
voorlopig **uit de afhankelijkheden gehaald**; ze komen terug in fase 2, bij de
generieke lijst met kolomkiezer en de detailroutes. `@tanstack/react-query`
wordt wél gebruikt.

## Ontwerp

### Werk schuift door over een sluiting heen

Hoofdstuk 7.3 zegt dat de basisbelasting "gelijk verdeeld over de open weken
binnen de fase" wordt. Bijlage B1 zegt dat bij een sluiting in W15–W16 de
uitloop in W23 eindigt in plaats van in W21.

Die twee spreken elkaar tegen: verdeel je 24 afspraken over de zes open weken
binnen de fase, dan eindigt de uitloop in W21, niet in W23. Gekozen is voor de
uitkomst die bijlage B1 noemt, omdat die overeenkomt met het principe uit
hoofdstuk 1: *werk schuift door naar na de sluiting, het verdwijnt niet*.

Concreet: een fase van acht weken levert altijd acht weken werk. Die acht weken
worden op de eerste acht **open** weken vanaf de fasestart gelegd. Een sluiting
duwt het werk dus vooruit, waarbij de fase feitelijk verder loopt dan zijn
einddatum. Het totaal blijft exact gelijk. Er staan tests op beide gevallen.

### Kleuren zijn berekend, niet gekozen

De kleuren uit hoofdstuk 9 zijn door een validator gehaald op leesbaarheid voor
kleurenblinden, contrast en lichtheid, apart voor licht en donker. Twee
kleuren uit de opdracht haalden die controle niet:

- **Prognose lichtblauw** (`#93c5fd`) viel buiten de bruikbare lichtheidsband
  en las als grijs. Opgelost door prognose *dezelfde* blauwe kleur te geven met
  een gearceerde vulling — wat hoofdstuk 9 met "gestippeld" ook al vroeg.
  Prognose is immers geen andere categorie, het is dezelfde belasting met een
  andere zekerheid.
- **Capaciteit bij volledige bezetting** (`#86efac`) idem. Nu dezelfde groene
  lijn als de werkelijke capaciteit, maar gestreept, met het verschil
  gearceerd. Ook dat is wat hoofdstuk 7.4 vroeg.

Zo blijven er per grafiek twee kleuren over — blauw voor belasting, groen voor
capaciteit — en die halen alle controles in beide thema's.

Twee bewuste afwijkingen van de validator:

- **Verlof blijft grijs.** Grijs zakt onder de chroma-ondergrens voor een
  categoriekleur, maar hier ís grijs de betekenis: afwezigheid is de
  afwezigheid van kleur. Elk verlofblok draagt daarom ook een letter (V, Z, I)
  en de legenda benoemt ze, dus de betekenis hangt nooit aan kleur alleen.
- **Het stoplicht blijft een stoplicht.** Oranje en rood liggen voor
  kleurenblinden dicht bij elkaar; dat is inherent aan een stoplicht en de
  opdracht vraagt er expliciet om. Daarom draagt een stoplicht altijd zijn
  woord: "Ruimte", "Vol", "Overbezet", "Gesloten".

### Slepen met de HTML-standaard, niet met een sleepbibliotheek

Het kanbanbord sleept met `draggable` en de sleepgebeurtenissen die de browser
zelf levert. Een bibliotheek als dnd-kit zou vloeiender animeren, maar voegt
een afhankelijkheid toe die in deze bouwomgeving niet te testen is, en de
opdracht vraagt om slepen — niet om animaties.

Belangrijker: slepen is met een toetsenbord niet te bedienen, en dat geldt voor
elke bibliotheek. Daarom draagt elke kaart óók een keuzelijst "Verplaats naar"
die precies hetzelfde doet. Die keuzelijst is niet de armere variant voor wie
geen muis heeft; het is gewoon de tweede weg naar dezelfde handeling.

### Winnen en verliezen kunnen niet door te slepen

Een kans naar "Gewonnen" slepen zou het bedrag uit de offerte overnemen, en dat
is bijna nooit wat er werkelijk gescoord is — laat staan per discipline. Een
kans naar "Verloren" slepen zou geen reden vastleggen, en dan is het
verliesrapport later niets waard.

De kern weigert die twee fasewissels daarom met een eigen foutcode
(`gebruik_winnen`, `gebruik_verliezen`), ook bij een aanroep buiten het scherm
om. Het bord vangt die codes op en opent de dialoog die er wél bij hoort. De
weigering is dus geen hindernis voor de gebruiker: het is de knop.

### Bedragen worden als tekst omgerekend, niet als kommagetal

`1.005 × 100` is in drijvende komma 100,49999999999999. Wie € 1,005 typt zou
dus € 1,00 krijgen in plaats van € 1,01. Op één regel merkt niemand dat; op een
offerte met dertig regels wel.

De omrekening in `features/kansen/bedrag.ts` schuift de komma daarom op in de
tekst zelf en rondt op het eerste weggelaten cijfer af, van nul af — dezelfde
regel als `roundCents` in de rekenkern. Er staan tests op met precies de
bedragen waar een kommagetal de mist in gaat.

### Tijdstempels hebben één vorm

De kolommen `stage_changed_at` en `opportunity_stage_history.at` werden door
`wisselFase` met `toISOString()` gevuld en door winnen en verliezen met
`datetime('now')`. Twee vormen in dezelfde kolom: `2026-09-04T12:44:13.822Z`
naast `2026-09-04 12:44:27`. Sorteren of filteren over zo'n kolom vergelijkt
dan tekst met een "T" tegen tekst met een spatie, en dat gaat een keer mis.

Alles schrijft nu de vorm die SQLite zelf gebruikt, via één functie waar de
tests een klok in kunnen zetten.

### Een `beforeWrite`-haak boven op de rol per entiteit

De generieke CRUD-factory kende per entiteit alleen kolommen en een minimale
rol. Voor een klant of een discipline is dat genoeg, voor een registratie die
aan een persoon hangt niet: iedere ingelogde gebruiker kon verlof voor een
collega boeken, en zijn eigen aanvraag meteen op `goedgekeurd` zetten. Dat
`/absences/:id/approve` de rol manager eist, hielp niet — een gewone POST liep
er zo omheen.

De haak is bewust in de registry gaan zitten en niet in een apart routebestand
naast de factory. Een tweede schrijfpad zou de kans geven dat er ooit één
vergeten wordt; nu draait dezelfde bewaker op aanmaken, wijzigen, verwijderen,
herstellen én bulk. Bij een bulkactie gaan eerst alle rijen erlangs en pas
daarna de schrijfactie, zodat een bulk die halverwege op een collega stuit de
eerste helft niet al heeft doorgevoerd.

### Wat er wel en niet van het verlofsaldo af gaat

Drie keuzes, alle drie te verdedigen maar geen van drieën vanzelfsprekend:

- **Een feestdag kost geen verlof.** Wie in een vakantieweek met Hemelvaart
  erin vrij vraagt, raakt vier dagen kwijt en niet vijf. Die dag was al vrij.
- **Een bedrijfssluiting gaat er niet automatisch vanaf.** In veel bedrijven ís
  de bouwvak het verlof, maar dat is een afspraak en geen rekenregel. Het saldo
  telt daarom alleen wat er als verlof geregistreerd staat. Wie de bouwvak van
  het saldo wil laten aftrekken, boekt hem als verlof — dan klopt de
  verlofkalender ook meteen.
- **Ziekte gaat er nooit af.** Dat bepaalt `counts_as_leave` van het type, niet
  de naam.

De uren per dag komen uit `absenceHoursForDay` van de beschikbaarheidsengine.
Die functie stond daar al en is getest; hem overschrijven zou een tweede
waarheid opleveren die op het eerste randgeval — een halve dag aan het begin
van een reeks bij een parttimer — uit elkaar loopt.

### Acht uur per dag is alleen een leesbaarheidshulp

Het saldoscherm zet de uren om naar dagen, want zo praten mensen erover. Die
omrekening gebruikt een vaste achturige dag en staat er alleen ter
verduidelijking: er wordt nergens mee gerekend, en het rooster van de
medewerker blijft leidend. Anders zou "vijf dagen over" voor een parttimer een
onwaarheid worden.

### Verlof en inzet elders zijn twee tabellen

Zoals de opdracht voorschrijft, en de reden blijkt in de praktijk te kloppen:
ze gedragen zich anders. Verlof heeft een goedkeuringsstroom, een saldo en een
privacyregel; inzet elders heeft een percentage, een project en een looptijd.
In de capaciteitsberekening gaan ze van dezelfde beschikbare tijd af, en stap 6
van hoofdstuk 7.2 voorkomt dat ze dubbel tellen.

### Privacy rond ziekteverzuim

Iedereen ziet *dat* een collega afwezig is — de planning kan niet zonder. Het
*type* is bij afwezigheidstypes met `visibility = 'management'` alleen zichtbaar
voor managers, beheerders en de betrokkene zelf; anderen zien "Afwezig". Dat is
in de API afgedwongen, niet in de UI verborgen, en er staan drie tests op.

De aard van een ziekte wordt nergens vastgelegd. De seed laat het notitieveld
bij een ziekmelding leeg en de handleiding zegt waarom.

## Vooruit

- **PostgreSQL blijft mogelijk.** SQLite-specifieke SQL staat alleen in
  `views.sql` en in de querymodule. De rest gaat via Drizzle.
- **Een native mobiele app is buiten scope.** De PWA via de hostmodus is de
  route; buiten kantoor via een VPN als Tailscale, te documenteren en niet zelf
  te bouwen.
- **Boekhoudkoppeling is buiten scope**, maar de generieke export en het
  auditlog maken het later mogelijk.
