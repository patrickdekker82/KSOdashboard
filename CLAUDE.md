# Showroom Suite — projectcontext

## Deze repository is de enige plek voor dit project

Alle code, documentatie en geschiedenis van de Showroom Suite horen in
`patrickdekker82/KSOdashboard`. Werk nooit in een andere repository voor dit
project, ook niet als er in dezelfde sessie een andere repository beschikbaar
is. `patrickdekker82/ScoutIQ` is een los project (voetbalscouting) en staat
hier volledig buiten.

Werkmap: `/home/user/ksodashboard`.

## Wat dit is

Een Electron-desktopapplicatie voor de afdeling Showroom van een
woningbouworganisatie: kopersbegeleiding, planning en capaciteit. Geen cloud,
geen webadres, werkt offline. Alles in het Nederlands voor de gebruiker; code,
variabelen en commentaar in het Engels.

## Opbouw

```
packages/
├── shared/   zod-schema's, types, ISO-weken (op UTC), geldrekenen, formatters
├── core/     DE KERN — Fastify, SQLite, migraties, de engines
├── main/     Electron main + preload
└── renderer/ React
```

De bedrijfslogica draait achter HTTP op loopback in een utility process, niet
achter IPC. Daardoor is alles testbaar zonder Electron.

## Regels die er in dit project toe doen

- **Geld is altijd `INTEGER` in eurocenten**, percentages altijd basispunten
  (0–10000). Nooit floats. Afronden gebeurt één keer, aan het eind.
- **Schemawijzigingen gaan via een nieuw, genummerd SQL-bestand** in
  `packages/core/src/db/migrations/`. Nooit een bestaande migratie aanpassen,
  nooit een ORM het schema laten genereren.
- **De engines blijven puur.** `modules/availability/engine.ts` en
  `modules/capacity/engine.ts` raken de database niet. Data ophalen hoort in
  `modules/capacity/repository.ts`.
- **ISO-weken op UTC**, niet via `date-fns`: `getISOWeek` rekent lokaal en
  verschuift de weekgrens voor gebruikers ten westen van UTC.
- **Autorisatie server-side afdwingen**, niet alleen knoppen verbergen.
- **Ziekteverzuim**: leg nooit de aard van een ziekte vast. Types met
  `visibility = 'management'` tonen aan collega's alleen "Afwezig".
- **Kleuren in grafieken worden gevalideerd, niet gekozen.** Zie
  `docs/BESLISSINGEN.md`; betekenis mag nooit aan kleur alleen hangen.
- **Geen `any`** zonder expliciete `// eslint-disable` met reden.

## Voor je klaar bent

```bash
npm run check     # typecheck + lint + tests — moet groen zijn
```

Commit-messages in het Nederlands, per logische eenheid. Werk de `CHANGELOG.md`
bij en noteer functionele keuzes in `docs/BESLISSINGEN.md`.

## Waar wat staat

| Document | Waarvoor |
|---|---|
| `README.md` | overzicht en aan de slag |
| `docs/BESLISSINGEN.md` | waarom iets zo gebouwd is |
| `docs/DATAMODEL.md` | het datamodel |
| `docs/INSTALLATIE.md` | installeren, voor niet-technische collega's |
| `docs/GEBRUIKERSHANDLEIDING.md` | dagelijks gebruik |
| `docs/BEHEERDERSHANDLEIDING.md` | beheer, koppelingen, privacy |
