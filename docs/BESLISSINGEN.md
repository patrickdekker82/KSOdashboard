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

### Een eigen xlsx-lezer in plaats van een bibliotheek

De applicatie heeft nul runtime-afhankelijkheden, en dat is een van de redenen
dat de installatie op elke werkplek hetzelfde doet: er is niets dat op de ene
machine een andere versie kan hebben dan op de andere. Een xlsx-bibliotheek
erbij halen zou dat opgeven voor iets wat, na een keer goed kijken, overzichtelijk
werk is: een .xlsx is een zip met XML, en `zlib.inflateRawSync` — dat in Node
zit — doet het enige echt ingewikkelde deel.

De grens is expliciet getrokken. De lezer kan geen zip64, geen versleutelde
archieven en geen andere compressie dan "opgeslagen" en "deflate". Een werkmap
uit Excel of LibreOffice valt in geen van die gevallen; komt er toch zoiets
binnen, dan zegt de foutmelding wát er niet kan.

De testfixture is een écht xlsx-bestand, geschreven zoals Excel het opslaat:
gedeelde teksten, een eigen datumopmaak, een formule met de uitkomst erbij, een
ongecomprimeerd onderdeel en een tabblad dat niet `sheet1.xml` heet. Dat laatste
is geen gezocht randgeval — Excel hernoemt werkbladbestanden zodra er een
tabblad is verwijderd, en een lezer die de verwijzing niet volgt leest dan het
verkeerde blad.

### Dag-eerst bij het lezen van datums

`03-02-2026` is in deze applicatie 3 februari en niet 2 maart. Aan de waarde is
dat niet te zien zolang beide getallen onder de dertien blijven, dus er moet een
keuze worden gemaakt, en die is hier: dit is een Nederlandse applicatie voor een
Nederlands bedrijf.

Een bestand uit een Amerikaanse bron wordt dus verkeerd gelezen. Dat is een
bewuste afweging: die bestanden komen hier niet voor, en de omgekeerde keuze zou
elke Nederlandse planning stilletjes verschuiven — het soort fout dat pas
opvalt als de bezetting niet klopt.

### De import beoordeelt twee keer in plaats van het voorbeeld weg te schrijven

Het voor de hand liggende ontwerp is: het bestand lezen, de rijen in het
geheugen houden, en bij "doorvoeren" precies die rijen wegschrijven. Dat is
sneller en het levert gegarandeerd op wat de gebruiker zag.

Maar dat laatste is juist het probleem. Tussen het bekijken en het doorvoeren
kan een collega hetzelfde project hebben aangemaakt. Het voorbeeld zegt dan
"nieuw" en het wegschrijven maakt een tweede project met dezelfde naam. Daarom
wordt het bestand bij het doorvoeren opnieuw beoordeeld, tegen de database zoals
hij op dat moment is. Wijkt de uitkomst af van het voorbeeld, dan is dat wat er
werkelijk moest gebeuren.

### Een foute rij stopt de import niet

Een import van veertig regels afkeuren omdat er in regel zeventien een datum
verkeerd staat, betekent dat iemand het bestand in Excel gaat repareren en het
daarna helemaal opnieuw doet — en dat het bij de volgende fout weer gebeurt. De
foute rij wordt overgeslagen, met de reden erbij en het regelnummer uit het
bronbestand, zodat hij in Excel terug te vinden is. De rest gaat gewoon door.

Twee dingen worden bewust níet stilzwijgend opgelost: een onbekende
opdrachtgever levert geen nieuwe klant op (anders staan er na een paar imports
vijf varianten van dezelfde aannemer in het systeem), en een tweede import maakt
geen tweede showroomfase (dat zou de bezetting van dat project verdubbelen).

### Meldingen sluiten zichzelf

De verleiding bij signaleringen is om ze alleen aan te maken en het opruimen
aan de gebruiker te laten. Dat werkt een week: daarna staan er tachtig
meldingen, waarvan de helft over weken die allang weer rustig zijn, en leest
niemand ze meer.

Daarom levert een regel geen meldingen op maar *bevindingen*, en vergelijkt de
motor die met wat er al staat. Een bevinding die er nog niet was wordt een
melding; een die al openstaat schuift alleen "laatst gezien" op; en een open
melding zonder bevinding wordt gesloten. Het opruimen is daarmee een gevolg van
de berekening en niet van discipline.

Drie manieren om een melding weg te krijgen, met opzet verschillend:

- **Gezien** laat hem staan maar op de achtergrond — je weet ervan.
- **Later** haalt hem tot een datum uit beeld. Speelt het dan nog, dan komt hij
  terug.
- **Afhandelen** sluit hem. Bestaat de situatie bij de volgende controle nog,
  dan komt hij ook terug. Wegklikken lost niets op, en de applicatie doet niet
  alsof.

### Eén melding per situatie, die heropend wordt

`alerts.dedupe_key` heeft een unieke index, dus er is per situatie hooguit één
rij. Een terugkerend probleem heropent die rij in plaats van een tweede aan te
maken, en "voor het eerst gezien" gaat mee naar dat moment: "speelt al sinds
maart" zou onwaar zijn voor iets dat in april was opgelost. Een bevestiging van
de vorige keer vervalt daarbij — die ging over het vorige voorval.

De sleutel krijgt het regeltype als voorvoegsel. Zonder dat zouden twee regels
die allebei "kwaliteit:klant" kiezen elkaars melding overschrijven, en de
unieke index maakt daar een harde fout van in plaats van een subtiele.

### Eén vast uur, geen cron-planner

De regels hebben een `check_cron`-kolom uit hoofdstuk 4, maar er wordt niets
uit gelezen: er draait één timer die elk uur alles doorrekent. Meldingen die
over weken en dagen gaan, hebben geen planning per regel nodig, en een tweede
planningsmechanisme naast de timer levert vooral de vraag op welke van de twee
nu leidend is. De kolom blijft staan voor als dat ooit wél nodig is.

Elke regel draait in zijn eigen transactie. Valt er één om — een fout in een
query, een parameter die geen getal blijkt — dan werken de andere zeventien
gewoon, en staat er in de uitkomst wat er misging. Een leeg dashboard omdat één
regel struikelt is erger dan een dashboard met zeventien van de achttien.

### Een regel zonder code zegt dat zelf

`backup_failed` staat wel in de database maar heeft geen implementatie: er
worden nog geen back-uploops vastgelegd. Die regel stilzwijgend overslaan zou
betekenen dat iemand denkt dat hij bewaakt wordt terwijl dat niet zo is. De API
geeft per regel terug of hij gebouwd is, en het beheerscherm zegt het met
zoveel woorden.

### Een offerte is een kopie, geen verwijzing

Het zou eleganter lijken om een offerte naar het pakket te laten wijzen en de
prijs bij het tonen uit te rekenen. Dan hoeft er niets gekopieerd te worden en
staat de prijs altijd "goed".

Maar dat is precies het probleem: een offerte die de klant vorige week heeft
ontvangen, mag niet stilletjes van bedrag veranderen omdat de inkoopprijs van
een paneel is aangepast. Wat er op papier stond, blijft staan. De regels worden
dus gekopieerd, met de prijs zoals die op dat moment gold, en er staat een test
op die precies dat vastlegt.

### Optionele regels staan uit tot de klant ze kiest

Een optie die standaard aan staat, maakt de eerste prijs die de klant ziet hoger
dan het pakket belooft. Dat is geen verkooptechniek maar een vertrouwenskwestie.
De optie komt dus uitgevinkt binnen, telt voor nul euro, en verschijnt op de
afgedrukte offerte onderaan als suggestie met haar prijs erbij — niet in de
tabel met wat er geleverd wordt.

### PDF via het hoofdproces, niet via een bibliotheek

Electron heeft `printToPDF` ingebouwd. De offerte wordt als kale HTML opgebouwd
en in een verborgen venster afgedrukt. Dat scheelt een PDF-bibliotheek, en het
scheelt vooral de betaalde image-, html- en xlsx-modules van docxtemplater die
de opdracht expliciet uitsluit.

De HTML gebruikt geen enkele themavariabele. Een offerte die bij de een op wit
papier en bij de ander op donkergrijs uitkomt omdat het scherm in donkere modus
stond, is geen offerte. Daar staat een test op.

### Het jaar hoort in het offertenummer

Een teller die per jaar terugloopt geeft in januari opnieuw 0001 uit, en dat
nummer bestaat dan al. Het jaar staat daarom in het nummer zelf:
`OF-2026-0001`. Ophogen en uitlezen gebeuren in één transactie — in deze
applicatie draait alles in één proces, maar in de hostmodus bedienen meerdere
werkplekken dezelfde database, en dan telt dat echt.

### Mailen via een .eml, niet via de Microsoft Graph API

Hoofdstuk 9 vraagt om een Microsoft 365-koppeling. Hoofdstuk 0 verbiedt externe
clouddiensten, telemetrie en "phone home". Die twee bijten elkaar niet zomaar —
een koppeling met de eigen tenant van het bedrijf is geen vendor die meekijkt —
maar er is een praktischer bezwaar dat de doorslag geeft.

Een Graph-koppeling vraagt om OAuth: een client-id, een tenant-id, een
toestemmingsscherm, en tokens die de applicatie moet bewaren en verversen. Dat
is een hoop machinerie waar niets van te controleren valt zonder een echte
tenant, en een integratie die niet te testen is, is een integratie waarvan
niemand weet of hij werkt.

De gekozen route doet hetzelfde werk zonder een van die bezwaren. De applicatie
stelt het bericht op, vult de plaatshouders in, legt het vast bij het record en
schrijft het weg als `.eml`. Dat bestand opent in Outlook als klaargezet
concept — de kop `X-Unsent: 1` zorgt daarvoor — waarna de gebruiker het naleest
en zelf verstuurt, vanuit zijn eigen mailbox met zijn eigen handtekening.

Wat dat oplevert:

- geen tokens, geen client-id, geen toestemmingsscherm, geen verversing
- niets verlaat de machine buiten de mailclient die er al staat
- het is volledig te testen: het `.eml` wordt in de tests weer uitgelezen en
  gecontroleerd
- de gebruiker ziet altijd wat er verstuurd wordt voordat het weggaat

Wat het niet oplevert: automatisch verzenden zonder tussenkomst, en het binnen-
halen van inkomende mail. Die twee zijn met deze route niet mogelijk. De tabel
`email_accounts` met haar `graph_tenant_id` en `graph_token_ref` blijft staan
voor wie dat later alsnog wil bouwen; de rest van de module hoeft er dan niet
voor op de schop.

### De sjabloonmotor kijkt niet in de prototypeketen

Dezelfde les als bij de formule-evaluator, waar dat gat er in een eerdere
versie wél in zat: `{{contact.constructor}}` mag geen functie opleveren en
`{{contact.__proto__}}` geen prototype. De context is daarom een `Map` van
`Map`s en geen object-literal, en er staat een test op die alle vijf de
verdachte namen langsloopt.

Een plaatshouder die niet ingevuld kan worden, wordt gemeld in plaats van stil
weggelaten. "Beste ," is erger dan een waarschuwing vooraf, en het scherm zegt
precies welke plaatshouders leeg bleven.

### "Niet mailen" is een harde grens

`contacts.do_not_email` staat er niet voor de sier. Een contactpersoon met dat
vinkje komt niet in de ontvangers, en als daardoor niemand overblijft zegt de
foutmelding waaróm — anders gaat iemand zoeken naar een adres dat er wel is.

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

## Fase 10 — de AI-assistent

### Eén uitgang, en die staat standaard dicht

De opdracht zegt: geen externe clouddiensten, geen telemetrie, geen "phone
home". Een AI-assistent is per definitie een externe dienst — tenzij hij lokaal
draait, en dat vraagt hardware die op een showroomwerkplek niet staat.

De keuze is daarom: de assistent bestaat, maar is de énige uitgang, hij staat
standaard dicht, en wat er doorheen gaat is zichtbaar en beperkt.

- Zonder API-sleutel gebeurt er niets. Zo wordt de applicatie geïnstalleerd.
- Alleen `POST /api/v1/ai/run` gaat het netwerk op. Eén route, in één bestand.
- Wat er meegaat is per preset in te stellen; wat niet meegaat kan niet lekken.
- Er is een knop die laat zien wat er weggaat, vóórdat het weggaat.
- Elke aanroep komt in het logboek, ook een mislukte.

### Anonimiseren, en dan nóg een keer controleren

Het schema schrijft `anonymise_personal_data` voor. De uitwerking:
`anonimiseer.ts` is een zuivere module — geen database, geen netwerk, geen
datum — die een woordenboek bouwt van wat vervangen moet worden en dat daarna
toepast en terugdraait. Zuiver, omdat dit de code is die bepaalt wat er de deur
uit gaat: die moet volledig testbaar zijn.

Twee bronnen voeden het woordenboek. Ten eerste de database: namen, adressen,
e-mailadressen en telefoonnummers die bij dít record horen. Wat we weten hoeven
we niet te raden — een regex vindt een e-mailadres wel, maar niet dat "Kroon"
hier een achternaam is en geen bouwdeel. Ten tweede een vangnet van patronen
voor wat iemand in vrije tekst getypt heeft.

Drie dingen die in de praktijk misgingen en waar nu tests op staan:

1. **Deelwoorden.** "Jan" zit in "Janssen". De woordgrenscontrole gebruikt
   Unicode-letterklassen, niet `\b` (dat is ASCII-only), en loopt álle
   voorkomens na — stoppen bij de eerste liet de tweede lekken.
2. **Langste eerst.** "Jan van der Berg" gaat vóór "Jan", anders blijft er
   "«PERSOON_1» van der Berg" staan.
3. **Losse kernwoorden van een bedrijfsnaam.** Live gevonden: in een activiteit
   stond "Meesters nabellen over de offerte", terwijl het woordenboek alleen
   "Bouwbedrijf Meesters B.V." kende. Rechtsvormen blijven staan — die zeggen
   niets over wélk bedrijf het is.

Daarna volgt de vangrail: de geanonimiseerde tekst wordt nógmaals gecontroleerd,
en vindt die controle alsnog iets, dan gaat het verzoek niet weg. Dat is er
uitdrukkelijk voor het geval het anonimiseren zélf een fout heeft. Liever een
assistent die weigert dan een klantnaam die stilletjes verdwijnt.

De plaatshouders staan tussen dubbele guillemets (`«PERSOON_1»`). Die komen in
Nederlandse zakelijke tekst niet voor, dus het model kan ze niet per ongeluk
zelf verzinnen. Doet het dat tóch, dan blijft de plaatshouder staan en meldt
het scherm hem — beter dan er stilzwijgend de naam van iemand anders in
schuiven.

### De sleutel naast de database, niet erin

`secrets` heeft de vorm `key, ciphertext, iv, tag`: AES-GCM. De vraag is waar
de versleutelsleutel dan staat. In de database zou zinloos zijn.

Hij staat in een apart bestand (`kluissleutel.bin`, rechten 0600) in de
gegevensmap. De nachtelijke back-up neemt de database mee naar de netwerkschijf;
het sleutelbestand blijft op de werkplek. Wie de back-up in handen krijgt, heeft
de API-sleutel dus niet. Op Windows doet `chmod` weinig — daar is de
bescherming dat de gegevensmap onder het gebruikersprofiel staat. GCM levert
bovendien een authenticatietag, dus een gemanipuleerd veld valt door de mand in
plaats van stil onzin op te leveren.

### De officiële SDK, en dus de eerste runtime-afhankelijkheid

Tot nu toe had `packages/core` alleen Fastify c.s. als afhankelijkheid en werd
alles wat op een bibliotheek leek zelf geschreven — de zip-lezer, de xlsx-lezer,
de .eml-opbouw. Hier gebeurt dat bewust niet: voor een API-koppeling is de
officiële `@anthropic-ai/sdk` de juiste keuze. Zelf HTTP-verzoeken bouwen
betekent zelf de foutafhandeling, de streaming en de versionering onderhouden,
en juist bij de enige externe koppeling wil je die niet zelf beheren. De
foutafhandeling loopt via de getypeerde foutklassen van de SDK en niet via het
aflezen van foutteksten: die veranderen, de klassen niet.

Er wordt gestreamd, ook al is de uitvoer meestal kort. Een niet-gestreamd
verzoek met een royale `max_tokens` loopt tegen de aanvraagtimeout aan.

### Kosten in dollar, geen verzonnen koers

`cost_estimate_cents` wordt gevuld in dollarcent, want zo rekent de leverancier
af. Een wisselkoers in de code is binnen een maand onjuist, en dan staat er een
bedrag in euro's op het scherm dat niemand op de factuur terugvindt. Het scherm
zet er "US$" bij. Modellen waarvan de prijs hier niet bekend is leveren
"onbekend" op in plaats van een verzonnen bedrag.

### Het logboek bewaart geen promptinhoud

`prompt_summary` krijgt de naam van de preset en het record, meer niet. De
prompt zelf bevat klantgegevens en het logboek is voor elke manager zichtbaar.
Wat er gebeurd is, is af te leiden uit de preset en het record; wat er precies
in stond hoeft daar niet voor bewaard te worden.

## Vooruit

- **PostgreSQL blijft mogelijk.** SQLite-specifieke SQL staat alleen in
  `views.sql` en in de querymodule. De rest gaat via Drizzle.
- **Een native mobiele app is buiten scope.** De PWA via de hostmodus is de
  route; buiten kantoor via een VPN als Tailscale, te documenteren en niet zelf
  te bouwen.
- **Boekhoudkoppeling is buiten scope**, maar de generieke export en het
  auditlog maken het later mogelijk.
