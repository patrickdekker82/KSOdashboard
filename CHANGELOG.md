# Wijzigingen

Deze lijst volgt de bouwfasen uit de opdracht. Datums ontbreken bewust: wat
telt is welke fase is opgeleverd.

## Onderweg naar 0.1.0

### Rekenkern (verplicht getest)
- Beschikbaarheidsengine per medewerker per ISO-week: rooster, feestdagen,
  sluitingen, verlof en inzet elders, alles omgerekend naar uren. Inclusief de
  regel die dubbeltelling tussen verlof en inzet voorkomt.
- Capaciteitsengine: basisbelasting per fase, doorlooptijd-convolutie over
  uitsluitend open weken, prognoseweging op kans, verdeling per begeleider en
  gatdetectie met het aantal woningen dat nog nodig is.
- Feestdaggenerator met Pasen volgens Meeus/Jones/Butcher, de afgeleide
  feestdagen, de verschuivingsregel voor Koningsdag en de lustrumregel voor
  Bevrijdingsdag.
- Prijsberekening voor kansen en pakketten, volledig in centen als integer.

### Database
- Initiële migratie met 58 tabellen uit hoofdstuk 4, als één expliciet en
  gecommit SQL-bestand.
- FTS5-zoekindex over organisaties en contactpersonen, met triggers.
- Rapportage-views, waaronder `v_afwezigheid` dat verlof en inzet elders
  samenvoegt.
- Migratierunner met een transactie per bestand.
- Seed met de gegevens uit bijlage A plus een demoscenario waarin elke
  signaleringsregel iets te melden heeft.
- Blokkade op databaselocaties op netwerkschijven en in synchronisatiemappen.

### Kern (API)
- Fastify op loopback, met sessies, argon2id-wachtwoorden en een sessietoken
  dat andere lokale processen buiten de deur houdt.
- Generieke CRUD over 26 entiteiten: paginering, filters, zoeken, soft delete,
  herstellen, bulkacties en auditlog.
- Filterboom naar geparametriseerde SQL, met een whitelist op veldnamen.
- Capaciteits-, beschikbaarheids- en verlofendpoints, inclusief de weergave die
  laat zien wat een verlofaanvraag met de bezetting doet.
- Autorisatie per endpoint, server-side afgedwongen. Ziekteverzuim is voor
  collega's zichtbaar als "Afwezig", niet als ziekte.

### Schil
- Electron met main, preload en renderer; de kern in een eigen utility process
  dat bij een crash automatisch herstart.
- Nederlands applicatiemenu, systeemvak met snelmenu, native meldingen,
  bestandsdialogen met "Toon in map", diepe links (`showroom://`), één
  instantie tegelijk, en het onthouden van de vensterpositie.
- PDF via `printToPDF` in een verborgen venster: geen externe browser nodig.
- Strikte CSP, contextisolatie, sandbox, en een preload die precies elf
  functies aanbiedt en niets meer.

### Schermen
- Inloggen, dashboard, planning met scenario-schuiven, en de verlofkalender met
  de capaciteitsstrook eronder.
- Grafiekkleuren zijn met een validator gecontroleerd op leesbaarheid voor
  kleurenblinden, in licht en donker. Prognose, gesloten weken en verlofblokken
  zijn ook zonder kleur te onderscheiden.

### Fase 2 — configureerbaar veldsysteem
- Veldenregister met alle 21 types uit 3.2, validatie per type en Nederlandse
  foutmeldingen die allemaal tegelijk worden gemeld.
- Formulevelden met een eigen parser en evaluator; geen `eval`, geen toegang
  tot iets buiten het record.
- Index-migraties voor maatwerkvelden: een virtuele gegenereerde kolom plus
  index, die SQLite in het queryplan ook echt gebruikt.
- Een beheerder kan zonder code een veld toevoegen, hernoemen, verplaatsen,
  verbergen en verwijderen. Een maatwerkveld kan definitief weg inclusief data,
  na het overtypen van de sleutel; een systeemveld alleen verborgen.
- Generieke lijst met kolomkiezer, filters per veldtype, sortering en
  paginering; generieke detailpagina volgens de layout-secties; beheerscherm
  voor velden.
- Opgeslagen weergaven leveren kolommen, filter en sortering aan.

### Fase 3 — CRM
- Zoeken over klanten, contactpersonen, projecten en kansen in één lijst, met
  Ctrl+K, zoeken-terwijl-je-typt en volledige toetsenbordbediening.
- Dubbelendetectie op KvK-nummer, e-mailadres, adres en gelijkende naam, met
  een samenvoegdialoog waarin per veld gekozen wordt welke waarde wint.
- Tijdlijn per record: activiteiten, wijzigingen, e-mail, offertes en
  fasewisselingen in één lijst, met een veld om meteen iets vast te leggen.
- Labels en bijlagen per record. Bijlagen hebben een extensiewhitelist, een
  grens van 25 MB, een door de applicatie gegenereerde naam op schijf en een
  downloadendpoint dat een sessie vereist.
- AVG: een inzagedossier per contactpersoon en anonimiseren dat de
  persoonsgegevens overschrijft maar de transacties bewaart.

### Fase 4 — kansen en verkooptrechter
- Kansen met disciplineregels: bedrag, marge, gewogen bedrag en gescoord bedrag
  worden na elke wijziging op één plek herrekend, met de prijsmodule uit de
  rekenkern. Een `afterWrite`-haak in de CRUD-factory zorgt dat dat ook gebeurt
  bij een import, een bulkactie of een aanroep buiten het scherm om.
- Fasewisselingen worden vastgelegd met het aantal dagen in de vorige fase.
  Kansen die langer stilstaan dan de fase toestaat, worden als verouderd
  gemeld — waarbij "stil" kijkt naar de laatste activiteit, niet alleen naar de
  laatste fasewissel.
- Winnen gaat per discipline: per regel wordt vastgelegd wat er daadwerkelijk
  is gescoord, en wat niet meekomt gaat op verloren. Optioneel rolt er meteen
  een showroomproject uit met klant, aantal woningen en verwachte periode.
- Verliezen vraagt een reden of een toelichting; zonder één van beide weigert
  de kern het.
- Rapportage over de trechter: openstaand per fase, win-rate per discipline,
  eigenaar en bron, doorlooptijd per fase met gemiddelde én mediaan, gescoorde
  omzet per discipline per maand en de tien meest voorkomende verliesredenen.
- Kanbanbord met slepen tussen fasen. Naar "Gewonnen" of "Verloren" slepen
  opent de bijbehorende dialoog in plaats van de kans stilletjes te verplaatsen.
  Elke kaart heeft daarnaast een keuzelijst "Verplaats naar", zodat het bord
  ook zonder muis te bedienen is.
- Regeleditor per kans met totalen die meelopen tijdens het typen, berekend met
  dezelfde functie als de kern gebruikt.
- Trechterscherm met een liggende staafgrafiek in de twee gecontroleerde
  kleuren, het aantal kansen als tekst op elke staaf, en alle cijfers eronder
  ook als tabel.

### Fase 5 — verlof en inzet
- Verlofsaldo per medewerker per jaar: recht plus overheveling min opgenomen,
  alles in uren. Aangevraagd verlof staat apart van opgenomen verlof, want het
  is nog niet opgenomen maar wel vergeven.
- De uren per dag komen uit dezelfde functie als de beschikbaarheidsengine
  gebruikt, dus saldo en planning kunnen niet uit elkaar lopen. Een feestdag
  midden in een vakantie kost geen verlof; de vaste vrije dag van een parttimer
  evenmin; verlof over de jaargrens drukt op twee saldi.
- Verlof aanvragen laat tijdens het invullen zien wat de aanvraag met de
  planning doet ("week 46: bezetting 156% → 312%"), inclusief wie er die week
  al weg is. Een waarschuwing, geen blokkade.
- Goedkeuringswerklijst voor managers, met bij elke aanvraag diezelfde
  doorrekening en een notitie die de aanvrager terugziet.
- Saldoscherm met recht, overheveling, opgenomen, aangevraagd, resterend en wat
  er vrij te besteden overblijft; een manager stelt het recht er ook in.
- Inzet elders vastleggen in percentage, dagen per week of uren per week.
- Beveiligingsherstel: de generieke CRUD-factory liet iedere gebruiker verlof
  voor een collega boeken en zijn eigen aanvraag meteen goedkeuren. Een
  `beforeWrite`-haak in de registry is nu de laatste horde voor de database.

### Fase 6 — projecten en de planningimport
- Excel-lezer zonder externe afhankelijkheid: een .xlsx is een zip met XML, en
  `zlib.inflateRawSync` doet het zware deel. Leest gedeelde teksten, datums aan
  de celopmaak, formules via hun opgeslagen uitkomst en werkbladen die niet
  `sheet1.xml` heten. Wat de lezer niet kan (zip64, versleutelde archieven)
  zegt hij met zoveel woorden.
- CSV-lezer die de puntkomma van een Nederlandse export herkent, met velden
  tussen aanhalingstekens, regeleindes daarbinnen en de byte order mark.
- Kolomherkenning op Nederlandse koppen ("Aantal won.", "Projectnr"), met
  Nederlandse datums en getallen. 03-02-2026 is hier 3 februari; een punt
  zonder komma is een duizendteken.
- Import in twee stappen: een droogloop die niets wegschrijft en per regel zegt
  wat er zou gebeuren, en een doorvoering in één transactie. Het doorvoeren
  beoordeelt het bestand opnieuw, want tussen kijken en doorvoeren kan er iets
  veranderd zijn.
- Een rij met een fout wordt overgeslagen en de rest gaat door. Bij het
  bijwerken van een bestaand project staat erbij welke kolommen veranderen.
- Een tweede import maakt geen tweede showroomfase aan; dat zou de bezetting
  verdubbelen. Een onbekende opdrachtgever levert een melding op en geen nieuwe
  klant.
- Importspoor per batch en per rij in de database, inclusief de afgebroken
  pogingen.
- Importwizard met bestandskeuze, kolomkoppeling, voorbeeld en uitkomst, plus
  de importgeschiedenis.
- Projectdetailpagina met de fasering op een tijdbalk en een editor ervoor.
  Fasen die de planning niet belasten zijn gearceerd én benoemd.

### Fase 7 — dashboard en signaleringen
- Zeventien van de achttien signaleringsregels doorgerekend: capaciteitsgaten,
  overbezetting, weken die krap worden door afwezigheid, te weinig begeleiders,
  verlofaanvragen in drukke weken, aflopende inzet, open ziekmeldingen,
  projecten zonder planning of begeleider, projecten die op één afwezige
  begeleider draaien, stilstaande kansen, naderende sluitdatums, offertes zonder
  reactie of met aflopende geldigheid, achterstallige opvolging, slapende
  klanten en datakwaliteit.
- `backup_failed` heeft bewust nog geen code; het regelbeheer laat per regel
  zien of hij gebouwd is, in plaats van hem stilletjes nooit af te laten gaan.
- De motor ontdubbelt op een sleutel per situatie, schuift "laatst gezien" op
  bij een melding die blijft bestaan, en sluit meldingen zodra de situatie weg
  is. Een terugkerend probleem heropent dezelfde melding met een nieuwe
  begindatum; een bevestiging van de vorige keer vervalt daarbij.
- Elke regel draait in zijn eigen transactie, dus één kapotte regel neemt de
  andere zeventien niet mee.
- Uurlijkse controle in de kern, die kort na het starten al een eerste ronde
  draait.
- Meldingen kunnen worden bevestigd, een week uitgesteld of afgehandeld.
  Uitstellen haalt ze uit beeld maar niet uit de database; afhandelen sluit ze,
  waarna ze terugkomen als de situatie er nog is.
- Dashboard met een KPI-balk (bezetting deze week en de komende vier, open
  kansen, gewogen pijplijn, gescoord dit jaar) en de signaleringen erboven, op
  ernst gesorteerd met het woord erbij in plaats van kleur alleen.
- Beheerscherm voor de regels: aan of uit, ernst, parameters en handmatig
  draaien.
- Foutafhandeling: een weigering van Fastify zelf — een leeg lichaam bij
  content-type json bijvoorbeeld — werd als "er ging iets mis in de kern"
  gemeld. Dat is een fout van de aanroeper en zegt dat nu ook.

### Fase 8 — duurzaamheidspakketten en offertes
- Offertes uit een pakket: de regels worden gekopieerd, niet verwezen. Gaat de
  prijs van een zonnepaneel volgende maand omhoog, dan verandert een offerte die
  de klant al heeft gezien niet met terugwerkende kracht mee.
- Optionele regels komen uitgevinkt binnen; de klant kiest ze er per offerte
  bij. Bij een pakket met een vaste prijs wordt het verschil evenredig over de
  regels verdeeld, zodat de btw per tarief blijft kloppen.
- Nummerreeksen in gebruik genomen: de tabel stond er sinds fase 1 maar werd
  door niets gebruikt. Ophogen en uitlezen in één transactie, met het jaar in
  het nummer omdat de teller anders in januari terugspringt naar 0001.
- Statusstroom concept → verstuurd → geaccepteerd of afgewezen, met een
  verplichte reden bij afwijzen. Een offerte van nul euro versturen wordt
  geweigerd; verlopen offertes vervallen bij de uurlijkse controle.
- Pakketscherm met de samenstelling en de berekende prijs, inclusief de interne
  marge — die hoort op het scherm en niet op de offerte.
- Offertescherm met de opties aan- en uitvinken, de totalen en de statusknoppen.
- Afdrukken naar PDF via het verborgen venster van het hoofdproces. Geen externe
  PDF-bibliotheek, en dus ook geen betaalde docxtemplater-module.

### Fase 9 — opvolging en e-mail
- Berichten opstellen uit een sjabloon, met plaatshouders die uit het record
  worden gevuld: klant, contactpersoon, project, kans, offerte, afzender en de
  bedrijfsgegevens.
- De sjabloonmotor kijkt nooit in de prototypeketen, en meldt plaatshouders die
  niet ingevuld konden worden in plaats van er stil niets van te maken.
- Het bericht wordt vastgelegd bij het record — het staat dus in de tijdlijn —
  en weggeschreven als .eml die in Outlook opent als klaargezet concept. Geen
  OAuth, geen tokens, en niets dat de machine verlaat zonder dat de gebruiker
  het zelf verstuurt. Zie `docs/BESLISSINGEN.md` voor de afweging.
- Een contactpersoon met "niet mailen" komt niet in de ontvangers, en de
  foutmelding zegt waarom er dan geen ontvanger is.
- Opvolgscherm met vier bakjes: te laat, vandaag, komende twee weken en zonder
  datum. Een taak van vandaag valt niet onder "te laat", ook al is het tijdstip
  voorbij.
- Afronden plant in dezelfde handeling de vervolgactie, gekoppeld aan dezelfde
  records. Mislukt dat inplannen, dan blijft de taak open in plaats van half
  afgerond.
- Bellijsten om doorheen te lopen, met een notitie per gesprek. Afgevinkte
  regels zakken naar beneden in plaats van te verdwijnen.
- Demoseed krijgt taken en een bellijst, waarmee de regels "activiteit over
  datum" en "offerte zonder reactie" ook echt afgaan.

### Fase 10 — AI-assistent
- **Standaard uit.** Zonder API-sleutel gebeurt er niets: de assistent meldt
  dat hij uit staat en de uitvoerroute weigert met `409 ai_uit`. Dit is de
  enige koppeling van de applicatie naar buiten, en hij gaat pas aan als een
  beheerder daar zelf voor kiest.
- **Anonimiseren voordat er iets weggaat.** Namen, bedrijfsnamen (ook losse
  kernwoorden — in een notitie staat "Meesters nabellen", niet de volledige
  statutaire naam), adressen, plaatsen, postcodes, e-mailadressen,
  telefoonnummers en IBAN's worden vervangen door plaatshouders als
  `«PERSOON_1»`. Het antwoord wordt hier op de werkplek weer ingevuld. 21
  tests op de pure module, waaronder deelwoorden ("Jan" in "Janssen"),
  hoofdletters, tussenvoegsels en idempotentie.
- **Vangrail.** Na het anonimiseren wordt de tekst nógmaals gecontroleerd.
  Vindt die controle alsnog een persoonsgegeven, dan gaat het verzoek niet weg.
  Dat is er voor het geval het anonimiseren zelf een fout heeft.
- **Bekijk wat er weggaat.** Een knop die letterlijk de tekst toont die de deur
  uit zou gaan, inclusief plaatshouders — zonder iets te versturen. Werkt ook
  als de assistent uit staat.
- **Sleutelkluis.** De API-sleutel staat AES-256-GCM-versleuteld in de
  database, met de sleutel in een apart bestand (rechten 0600) náást de
  database. Een back-up van de database alléén levert hem niet op. Er staan
  twaalf tests op, waaronder een die het databasebestand doorzoekt op de
  klaretekst.
- **Presets.** Vijf Nederlandse presets in de seed, met per preset in te stellen
  wat er meegaat uit het dossier (record, contactpersonen, activiteiten,
  offertes) en of er geanonimiseerd wordt. Wat niet meegaat kan ook niet lekken.
- **Logboek.** Elke aanroep komt in `ai_runs`, ook een mislukte: preset,
  gebruiker, model, tokens, kostenraming, duur en het record waar het over
  ging. Bewust géén promptinhoud — die bevat klantgegevens.
- **Kostenraming** in dollarcent, op basis van de tokenprijzen van het model.
  Er wordt geen wisselkoers verzonnen; het scherm zet er "US$" bij.
- Foutmeldingen komen uit de getypeerde foutklassen van de SDK en zijn in het
  Nederlands: een geweigerde sleutel, een firewall die `api.anthropic.com`
  tegenhoudt en een dienst die vol zit geven elk hun eigen uitleg.
- Eerste runtime-afhankelijkheid van het project: de officiële
  `@anthropic-ai/sdk`. Zie `docs/BESLISSINGEN.md`.

### Fase 11 — rapportages en export
- **Query-bouwer**: kies een gegevenssoort, vink kolommen aan, filter,
  sorteer, groepeer met aantal/som/gemiddelde/laagste/hoogste. Kolomnamen
  worden getoetst aan wat de tabel écht heeft (via `table_xinfo`, dus
  maatwerkvelden doen meteen mee) en waarden gaan als gebonden parameter mee.
- Een kolom die niet gegroepeerd is en geen functie heeft wordt geweigerd:
  SQLite laat dat toe en geeft dan een willekeurige rij uit de groep terug —
  een getal dat klopt maar niets betekent.
- Gearchiveerde records blijven standaard buiten de rapportage, net als in de
  lijstschermen.
- **Beveiligde SQL-modus** voor beheerders, met vier lagen: een read-only
  verbinding (de laag die telt), alleen SELECT of WITH, één instructie
  tegelijk, en een lijst verboden woorden. Verboden woorden binnen een
  tekstwaarde of in commentaar zijn juist wél toegestaan — anders wordt
  `SELECT 'update de klant'` geweigerd en begrijpt niemand waarom.
- Zowel de bouwer als de SQL-modus draaien op dezelfde read-only verbinding.
  Geen enkele rapportage kan iets wijzigen, ook niet als er ooit een fout in
  de bouwer sluipt. Er staat een test op die bewijst dat de database na een
  geweigerde DELETE onveranderd is.
- **Export naar Excel, Word, CSV en PDF.** De xlsx- en docx-schrijver zijn
  zelf geschreven op een eigen zip-schrijver (`node:zlib`), net als de lezers
  van fase 6 — betaalde pakketten zijn uitgesloten en een externe
  afhankelijkheid was hier niet nodig.
- De werkmap komt bruikbaar aan: bedragen als bedrag in euro's (niet in
  centen), datums als datum, percentages als percentage, een vastgezette
  kopregel, een automatisch filter en kolombreedtes naar de inhoud.
- CSV met puntkomma's en een BOM, want een Nederlandse Excel opent een
  komma-CSV als één kolom en maakt zonder BOM van "Ré" iets onleesbaars.
- PDF loopt via de afdrukfunctie van de schil, net als de offerte-PDF: geen
  PDF-bibliotheek in de applicatie.
- **Opgeslagen rapportages**, met of zonder delen. Verwijderen mag alleen wie
  hem gemaakt heeft, of een beheerder.
- Een invoerkring die er al zat (`registry` → `guards` → `server` →
  `fields/routes` → `registry`) viel om zodra iets anders dan de server als
  eerste geladen werd. `ApiError` staat nu in een eigen bestand.

### Fase 12 — hostmodus, beheer, back-up en updates
- **Back-up met `VACUUM INTO`** en niet met een bestandskopie: onder WAL staat
  een verse wijziging nog niet in het hoofdbestand, en een platte kopie levert
  dan een database op waar die rij niet in zit. Er staat een test op die dat
  aantoont.
- Elke loop komt in `backup_runs`, ook een mislukte, met soort, pad, grootte,
  duur en wie het startte. Nachtelijke loop op een instelbaar tijdstip, met een
  opruimbeleid en een optionele tweede doelmap op de netwerkschijf.
- **Terugzetten** controleert eerst of de kopie heel is én van deze applicatie
  is, maakt dan een veiligheidskopie van wat er stond, zet de nieuwe database
  ernaast neer en wisselt pas dan om — er is geen moment zonder database. De
  WAL-bestanden van de oude database gaan mee weg.
- Herstellen loopt via de schil en niet via de API: alleen het hoofdproces kan
  de kern stoppen, het bestand omwisselen en opnieuw starten.
- **De achttiende signaleringsregel doet eindelijk iets.** `backup_failed`
  meldt een mislukte loop, een loop die te lang geleden is, en het geval dat er
  nog nooit een back-up gemaakt is. Sinds deze fase is `onbekendeTypes` leeg.
- **Hostmodus**: de kern luistert ook op het LAN, en het netwerkscherm toont
  de adressen die een collega in zijn browser moet typen. De database blijft op
  de host staan — een database op een netwerkschijf raakt beschadigd.
- **Mobiele weergave**: via de hostmodus, met een menulade in plaats van een
  zijbalk, tabellen die zijwaarts scrollen en aanraakbare knoppen. Geen tweede
  applicatie, hetzelfde scherm.
- **Updatecontrole** tegen een door het bedrijf beheerde map (netwerkschijf),
  standaard uit. Geen `electron-updater`, geen leveranciersserver, geen stille
  zelfvervanging: de applicatie kijkt, meldt het en toont het installatiebestand.
  Zie `docs/BESLISSINGEN.md`.
- Versies worden per onderdeel vergeleken, niet als tekst: `0.10.0` is nieuwer
  dan `0.9.0`. Daar staat een test op, want dit is precies de fout waarbij
  iedereen maandenlang op een oude versie blijft zitten.
- **De laatste vijf beheerschermen**: gebruikers en rollen, werkroosters,
  keuzelijsten, capaciteitsinstellingen, back-up en netwerk. Alle tegels op het
  instellingenscherm zijn nu ingevuld.

### Na fase 12 — doorlichting vóór ingebruikname
Vier dingen die pas boven kwamen door de installer echt te bouwen en te draaien
in plaats van alleen `npm run build`:

- **De applicatie was niet in te pakken.** `package.json` had geen `main`, dus
  electron-builder zocht `index.js` in de asar en vond niets. Nu
  `out/main/index.cjs`.
- **De ingepakte applicatie startte niet.** Zowel `externalizeDepsPlugin` als
  electron-builder kijken naar de root-`package.json`, en die had geen
  `dependencies`. Er werd dus geen enkele module meegeleverd en
  `@node-rs/argon2` — de wachtwoordhasher — was onvindbaar. De
  runtime-afhankelijkheden staan nu in de root en worden meegepakt.
- **De hoofdbundel is CommonJS geworden.** Met `type: module` was een
  `.js`-bestand ESM, en dan lost `import 'ajv/dist/jtd'` niet op: ajv is
  CommonJS zonder exports-map, en Fastify laadt er delen van met `require()`.
  Geen smaakkwestie — met ESM startte de ingepakte applicatie niet.
- **`build/icon.ico` ontbrak** terwijl `electron-builder.yml` ernaar verwees.
  Nu aanwezig, met zes resoluties.

Daarna is de gebouwde applicatie uit de asar gestart en bevraagd: inloggen
(argon2 uit `asar.unpacked`), een rapportage en een Excel-export.

- **Het beginwachtwoord wordt nu echt afgedwongen.** `mustChangePassword` werd
  wel berekend en teruggegeven, maar nergens gebruikt — niet in de kern en niet
  in de schil. Alle vijf de installatie-accounts deelden dus een wachtwoord dat
  in de handleiding staat, en in de hostmodus stond de applicatie daarmee open
  voor het hele kantoornetwerk. De kern laat zo'n account nu alleen nog bij
  `/auth/me`, `/auth/logout` en `/auth/change-password`, en de schil toont een
  scherm om het te wijzigen. In de demo blijft het uit: daar is niets te
  beschermen.
- De schermen die "nog niet gebouwd" meldden voor fasen die inmiddels af zijn,
  zeggen dat niet meer.

### Nog niet gebouwd
De Microsoft Graph-koppeling voor automatisch verzenden en inkomende mail; zie
de beslissing daarover in `docs/BESLISSINGEN.md`.
