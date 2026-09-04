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

### Nog niet gebouwd
Kansen met disciplineregels en kanban (fase 4), de Excel-planning-import (fase 6), duurzaamheidspakketten (fase 8),
opvolging en Microsoft 365 (fase 9), de AI-assistent (fase 10), rapportages en
export (fase 11), hostmodus en automatische updates (fase 12). De schermen
daarvoor tonen in welke fase ze komen.
