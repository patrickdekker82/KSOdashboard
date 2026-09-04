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

### Nog niet gebouwd
De Excel-planning-import (fase 6), duurzaamheidspakketten (fase 8),
opvolging en Microsoft 365 (fase 9), de AI-assistent (fase 10), rapportages en
export (fase 11), hostmodus en automatische updates (fase 12). De schermen
daarvoor tonen in welke fase ze komen.
