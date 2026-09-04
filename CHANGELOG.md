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

### Nog niet gebouwd
CRM, kansen, projectbeheer, duurzaamheidspakketten, opvolging, Microsoft 365,
de AI-assistent, rapportages en export, import, hostmodus en automatische
updates. De schermen daarvoor tonen in welke fase ze komen.
