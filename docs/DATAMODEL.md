# Datamodel

De volledige waarheid staat in `packages/core/src/db/migrations/0001_initieel.sql`.
Dit document geeft de vorm en de afspraken.

## Afspraken

| | |
|---|---|
| Sleutel | `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| Datums | `TEXT`, ISO-8601 (`jjjj-mm-dd` of volledige tijdstempel) |
| Bedragen | `INTEGER` in **eurocenten**. Nooit een float. |
| Percentages | `INTEGER` in **basispunten** (0–10000, waar 10000 = 100%) |
| Maatwerkvelden | `custom_fields TEXT` met JSON, standaard `'{}'` |
| Verwijderen | `archived_at`; `NULL` betekent actief |
| Herkomst | `created_at`, `updated_at`, `created_by`, `updated_by` |

Geld in centen en percentages in basispunten is geen stijlkeuze: het voorkomt
dat `0,1 + 0,2` ergens `0,30000000000000004` wordt en een offerte een cent
naast een andere offerte uitkomt. Afronden gebeurt één keer, aan het eind van
een berekening.

## Groepen

**Gebruikers en beveiliging** — `users`, `work_schedules`, `sessions`,
`audit_log`, `settings`, `secrets`.

Een gebruiker kan meerdere roosters in de tijd hebben; precies één is geldig op
een gegeven datum. `sessions.id` is de SHA-256-hash van het token, niet het
token zelf.

**Configureerbaarheid** — `field_definitions`, `picklists`, `picklist_items`,
`layout_sections`, `saved_views`.

Eén tabel beschrijft elk veld van elke entiteit, ook de systeemvelden.
Maatwerkvelden staan als JSON in `custom_fields` van de hoofdtabel; geen EAV,
dus één record blijft één rij.

**Verlof en inzet** — `absence_types`, `absences`, `leave_balances`,
`holidays`, `allocation_types`, `capacity_allocations`.

Twee tabellen, bewust. Verlof is afwezig zijn: het telt in een verlofsaldo,
kent goedkeuring en is een HR-begrip. Inzet elders is aanwezig zijn maar niet
beschikbaar voor de showroom: het heeft een percentage, een project en een
looptijd. In de capaciteitsberekening gaan ze van dezelfde tijd af.

`absences.end_date` mag `NULL` zijn: een ziekmelding tot nader order.

**CRM** — `organizations`, `contacts`, `organization_contacts`, `tags`,
`taggables`, plus `organizations_fts` en `contacts_fts` voor het zoeken.

**Kansen** — `pipelines`, `pipeline_stages`, `disciplines`, `opportunities`,
`opportunity_lines`, `opportunity_stage_history`.

Een kans heeft regels per discipline, elk met een eigen bedrag, kans en status.
Zo is gescoorde omzet per discipline te rapporteren.

**Projecten** — `projects`, `project_phases`, `project_assignments`,
`closure_periods`, `capacity_overrides`.

Fasen zijn losse records, dus een project kan meerdere showroomblokken hebben.
Alleen fasen met `is_capacity_load = 1` belasten de afdeling; start bouw en
oplevering niet. `counts_as_showroom = 0` maakt het mogelijk projecten vast te
leggen die geen showroomwerk geven, om inzet elders aan te koppelen.

Meerdere begeleiders per project met `share_bp`: "DM/PD" wordt twee
toewijzingen van elk 5000 basispunten.

**Duurzaamheid** — `product_categories`, `products`, `packages`,
`package_items`, `package_quotes`, `package_quote_lines`.

Offerteregels zijn een **momentopname**: ze bewaren hun eigen prijs, zodat een
latere prijswijziging op een product bestaande offertes niet verandert.

**Activiteiten** — `activities`, `activity_links`, `call_lists`,
`call_list_members`. Een activiteit kan aan meerdere records hangen.

**E-mail** — `email_accounts`, `email_templates`, `email_template_versions`,
`email_messages`, `email_message_links`.

**AI** — `ai_presets`, `ai_runs`. `ai_presets.anonymise_personal_data` bepaalt
of persoonsgegevens vervangen worden voordat er iets naar de API gaat.

**Rapportage en signalering** — `saved_queries`, `report_definitions`,
`alert_rules`, `alerts`, `attachments`, `number_sequences`, `import_jobs`,
`notifications`.

`alerts.dedupe_key` is uniek, zodat een uurlijkse controle dezelfde melding
niet blijft herhalen.

## Views

In `views.sql`, met Nederlandse kolomnamen omdat ze de basis zijn voor de
query-bouwer en de exports. Ze worden bij elke start opnieuw aangemaakt.

`v_afwezigheid` is de bijzondere: die voegt verlof en inzet elders samen met
een kolom `soort`, zodat de verlofkalender één lijst kan bevragen.

## Migraties

Genummerde SQL-bestanden in `packages/core/src/db/migrations/`, op volgorde
toegepast en bijgehouden in `schema_migrations`. Elk bestand draait in een
eigen transactie: mislukt er een, dan blijft de database op de laatste versie
die wél is toegepast.

Geen ORM genereert of herschikt ze. Wat in de repository staat, is wat er
draait.
