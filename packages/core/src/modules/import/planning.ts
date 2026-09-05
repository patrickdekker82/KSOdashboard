/**
 * De planningimport: van gekoppelde kolommen naar projecten en fasen
 * (hoofdstuk 11).
 *
 * De import werkt in twee stappen die dezelfde code gebruiken. Eerst een
 * droogloop: elke rij krijgt een oordeel en de meldingen die erbij horen, en er
 * wordt niets weggeschreven. Pas als de gebruiker die uitkomst heeft gezien,
 * gaat dezelfde beoordeling nog een keer langs — nu binnen een transactie die
 * ook schrijft.
 *
 * Dat is bewust geen "voorbeeld tonen en dan de rijen uit het geheugen
 * wegschrijven". Tussen het bekijken en het doorvoeren kan een collega een
 * project hebben aangemaakt; de tweede ronde ziet dat, de eerste niet.
 *
 * Een rij die op een fout stuit, wordt overgeslagen — de rest gaat gewoon door.
 * Een import van veertig regels afkeuren omdat er één datum verkeerd staat,
 * betekent dat iemand het bestand in Excel gaat repareren en het daarna
 * helemaal opnieuw doet.
 */
import type { DatabaseHandle } from '../../db/client.ts';
import type { CelWaarde } from './xlsx.ts';
import { leesVeld, VELDEN, VELD_INFO, type Koppeling, type Veld } from './mapping.ts';

type Rij = Record<string, unknown>;

export type Oordeel = 'nieuw' | 'bijwerken' | 'ongewijzigd' | 'fout';

export type Melding = { veld: Veld | null; tekst: string; ernst: 'fout' | 'let_op' };

export type BeoordeeldeRij = {
  /** Het rijnummer in het bronbestand, één-gebaseerd zoals Excel het toont. */
  bronregel: number;
  oordeel: Oordeel;
  projectId: number | null;
  /** De waarden zoals ze gelezen zijn, klaar voor de database. */
  waarden: Partial<Record<Veld, string | number>>;
  ruw: Record<string, CelWaarde>;
  meldingen: Melding[];
  /** Wat er zou veranderen aan een bestaand project. */
  wijzigingen: Array<{ kolom: string; van: unknown; naar: unknown }>;
};

export type Beoordeling = {
  rijen: BeoordeeldeRij[];
  totaal: number;
  nieuw: number;
  bijwerken: number;
  ongewijzigd: number;
  fout: number;
};

/** Kolommen op het project die één op één uit een veld komen. */
const PROJECTKOLOM: Partial<Record<Veld, string>> = {
  nummer: 'number',
  naam: 'name',
  plaats: 'city',
  plan: 'plan_name',
  aantal: 'unit_count',
  afspraken_per_woning: 'appointments_per_unit',
  doorlooptijd_weken: 'lead_time_weeks',
  opmerking: 'description',
};

export type ImportOpties = {
  /** De rij met kopteksten, één-gebaseerd. Alles daarboven wordt genegeerd. */
  kopregel: number;
  koppeling: Koppeling;
  /** Bestaande projecten bijwerken, of alleen nieuwe aanmaken. */
  bestaandeBijwerken: boolean;
};

/**
 * Beoordeelt elke rij, en schrijft alleen weg als `schrijven` aan staat.
 *
 * De aanroeper zorgt voor de transactie: bij het doorvoeren moet een fout
 * halverwege het hele bestand terugdraaien, niet de helft laten staan.
 */
export function beoordeel(
  handle: DatabaseHandle,
  rijen: readonly CelWaarde[][],
  opties: ImportOpties,
  gebruikerId: number,
  schrijven = false,
): Beoordeling {
  const gegevensRijen = rijen.slice(opties.kopregel);
  const koppen = rijen[opties.kopregel - 1] ?? [];
  const beoordeeld: BeoordeeldeRij[] = [];

  const fase = showroomFaseId(handle);
  const begeleiders = laadBegeleiders(handle);
  const organisaties = laadOrganisaties(handle);

  gegevensRijen.forEach((rij, index) => {
    const bronregel = opties.kopregel + index + 1;
    // Een rij waar niets in staat is geen fout: dat zijn de lege regels
    // onderaan waar Excel graag mee eindigt.
    if (rij.every((cel) => cel === null || cel === undefined || String(cel).trim() === '')) return;

    beoordeeld.push(
      beoordeelRij(handle, rij, koppen, bronregel, opties, {
        fase,
        begeleiders,
        organisaties,
        gebruikerId,
        schrijven,
      }),
    );
  });

  return {
    rijen: beoordeeld,
    totaal: beoordeeld.length,
    nieuw: beoordeeld.filter((rij) => rij.oordeel === 'nieuw').length,
    bijwerken: beoordeeld.filter((rij) => rij.oordeel === 'bijwerken').length,
    ongewijzigd: beoordeeld.filter((rij) => rij.oordeel === 'ongewijzigd').length,
    fout: beoordeeld.filter((rij) => rij.oordeel === 'fout').length,
  };
}

type Context = {
  fase: number | null;
  begeleiders: Map<string, number>;
  organisaties: Map<string, number>;
  gebruikerId: number;
  schrijven: boolean;
};

function beoordeelRij(
  handle: DatabaseHandle,
  rij: readonly CelWaarde[],
  koppen: readonly CelWaarde[],
  bronregel: number,
  opties: ImportOpties,
  context: Context,
): BeoordeeldeRij {
  const meldingen: Melding[] = [];
  const waarden: Partial<Record<Veld, string | number>> = {};
  const ruw: Record<string, CelWaarde> = {};

  for (const [veld, kolom] of Object.entries(opties.koppeling) as Array<[Veld, number]>) {
    const cel = rij[kolom] ?? null;
    const kop = koppen[kolom];
    ruw[kop === null || kop === undefined ? `kolom ${kolom + 1}` : String(kop)] = cel;

    const gelezen = leesVeld(veld, cel);
    if (gelezen.fout) {
      meldingen.push({ veld, tekst: `${VELD_INFO.get(veld)?.label}: ${gelezen.fout}`, ernst: 'fout' });
      continue;
    }
    if (gelezen.waarde !== null) waarden[veld] = gelezen.waarde;
  }

  for (const omschrijving of VELDEN) {
    if (!omschrijving.verplicht) continue;
    if (waarden[omschrijving.veld] !== undefined) continue;
    // Staat er al een melding over dit veld, dan stond de waarde er wel maar
    // was hij onleesbaar. "Ontbreekt" erbij zetten leidt alleen maar af van de
    // echte melding.
    if (meldingen.some((melding) => melding.veld === omschrijving.veld)) continue;

    meldingen.push({
      veld: omschrijving.veld,
      tekst: `${omschrijving.label} is verplicht en ontbreekt.`,
      ernst: 'fout',
    });
  }

  controleerInhoud(waarden, meldingen);

  const bestaand = zoekProject(handle, waarden);
  const koppelingen = zoekKoppelingen(waarden, context, meldingen);

  if (meldingen.some((melding) => melding.ernst === 'fout')) {
    return {
      bronregel,
      oordeel: 'fout',
      projectId: bestaand ? Number(bestaand.id) : null,
      waarden,
      ruw,
      meldingen,
      wijzigingen: [],
    };
  }

  if (!bestaand) {
    const projectId = context.schrijven
      ? maakProject(handle, waarden, koppelingen, context)
      : null;
    return { bronregel, oordeel: 'nieuw', projectId, waarden, ruw, meldingen, wijzigingen: [] };
  }

  const wijzigingen = verschillen(bestaand, waarden);

  if (!opties.bestaandeBijwerken) {
    if (wijzigingen.length > 0) {
      meldingen.push({
        veld: null,
        tekst: 'Dit project bestaat al en wordt overgeslagen omdat bijwerken uit staat.',
        ernst: 'let_op',
      });
    }
    return {
      bronregel,
      oordeel: 'ongewijzigd',
      projectId: Number(bestaand.id),
      waarden,
      ruw,
      meldingen,
      wijzigingen,
    };
  }

  if (wijzigingen.length === 0) {
    return {
      bronregel,
      oordeel: 'ongewijzigd',
      projectId: Number(bestaand.id),
      waarden,
      ruw,
      meldingen,
      wijzigingen,
    };
  }

  if (context.schrijven) werkProjectBij(handle, Number(bestaand.id), waarden, koppelingen, context);

  return {
    bronregel,
    oordeel: 'bijwerken',
    projectId: Number(bestaand.id),
    waarden,
    ruw,
    meldingen,
    wijzigingen,
  };
}

/** Controles die niets met de database te maken hebben. */
function controleerInhoud(
  waarden: Partial<Record<Veld, string | number>>,
  meldingen: Melding[],
): void {
  const aantal = waarden.aantal;
  if (typeof aantal === 'number') {
    if (aantal < 0) {
      meldingen.push({ veld: 'aantal', tekst: 'Het aantal woningen kan niet negatief zijn.', ernst: 'fout' });
    } else if (!Number.isInteger(aantal)) {
      meldingen.push({ veld: 'aantal', tekst: 'Een half huis bestaat niet: het aantal woningen moet heel zijn.', ernst: 'fout' });
    } else if (aantal === 0) {
      meldingen.push({ veld: 'aantal', tekst: 'Dit project heeft nul woningen en geeft dus geen belasting.', ernst: 'let_op' });
    }
  }

  const start = waarden.showroom_start;
  const eind = waarden.showroom_eind;
  if (typeof start === 'string' && typeof eind === 'string' && eind < start) {
    meldingen.push({
      veld: 'showroom_eind',
      tekst: 'De einddatum van de showroomfase ligt voor de startdatum.',
      ernst: 'fout',
    });
  }
  if (typeof start === 'string' && eind === undefined) {
    meldingen.push({
      veld: 'showroom_eind',
      tekst: 'Er is een startdatum maar geen einddatum; er wordt geen showroomfase aangemaakt.',
      ernst: 'let_op',
    });
  }
}

/** Zoekt het project waar deze rij over gaat: eerst op nummer, dan op naam. */
function zoekProject(
  handle: DatabaseHandle,
  waarden: Partial<Record<Veld, string | number>>,
): Rij | null {
  if (typeof waarden.nummer === 'string') {
    const opNummer = handle.raw
      .prepare('SELECT * FROM projects WHERE number = ? AND archived_at IS NULL')
      .get(waarden.nummer) as Rij | undefined;
    if (opNummer) return opNummer;
  }

  if (typeof waarden.naam === 'string') {
    // Hoofdletterongevoelig, want "Plan Zuidhoek" en "plan zuidhoek" zijn in
    // een spreadsheet hetzelfde project.
    const opNaam = handle.raw
      .prepare('SELECT * FROM projects WHERE LOWER(name) = LOWER(?) AND archived_at IS NULL')
      .get(waarden.naam) as Rij | undefined;
    if (opNaam) return opNaam;
  }

  return null;
}

type Koppelingen = { begeleiderId: number | null; organisatieId: number | null };

function zoekKoppelingen(
  waarden: Partial<Record<Veld, string | number>>,
  context: Context,
  meldingen: Melding[],
): Koppelingen {
  let begeleiderId: number | null = null;
  if (typeof waarden.begeleider === 'string') {
    begeleiderId = context.begeleiders.get(waarden.begeleider.trim().toLowerCase()) ?? null;
    if (begeleiderId === null) {
      meldingen.push({
        veld: 'begeleider',
        tekst: `"${waarden.begeleider}" is geen bekende medewerker; het project komt zonder begeleider binnen.`,
        ernst: 'let_op',
      });
    }
  }

  let organisatieId: number | null = null;
  if (typeof waarden.opdrachtgever === 'string') {
    organisatieId = context.organisaties.get(waarden.opdrachtgever.trim().toLowerCase()) ?? null;
    if (organisatieId === null) {
      // Bewust geen nieuwe klant aanmaken: dan staan er na één import twintig
      // varianten van dezelfde aannemer in het systeem.
      meldingen.push({
        veld: 'opdrachtgever',
        tekst: `"${waarden.opdrachtgever}" staat niet bij de klanten; koppel hem later handmatig.`,
        ernst: 'let_op',
      });
    }
  }

  return { begeleiderId, organisatieId };
}

/** Welke kolommen van het bestaande project zouden veranderen. */
function verschillen(
  bestaand: Rij,
  waarden: Partial<Record<Veld, string | number>>,
): Array<{ kolom: string; van: unknown; naar: unknown }> {
  const lijst: Array<{ kolom: string; van: unknown; naar: unknown }> = [];

  for (const [veld, kolom] of Object.entries(PROJECTKOLOM) as Array<[Veld, string]>) {
    const nieuw = waarden[veld];
    if (nieuw === undefined) continue;
    const huidig = bestaand[kolom];
    // Losse vergelijking op tekst: 32 uit Excel en 32 uit SQLite zijn hetzelfde
    // getal, ook als het ene een string is.
    if (String(huidig ?? '') !== String(nieuw)) {
      lijst.push({ kolom: VELD_INFO.get(veld)?.label ?? kolom, van: huidig, naar: nieuw });
    }
  }

  return lijst;
}

// --- schrijven -------------------------------------------------------------

function maakProject(
  handle: DatabaseHandle,
  waarden: Partial<Record<Veld, string | number>>,
  koppelingen: Koppelingen,
  context: Context,
): number {
  const resultaat = handle.raw
    .prepare(
      `INSERT INTO projects
         (number, name, city, plan_name, unit_count, appointments_per_unit, lead_time_weeks,
          description, organization_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      tekstOfNull(waarden.nummer),
      String(waarden.naam),
      tekstOfNull(waarden.plaats),
      tekstOfNull(waarden.plan),
      typeof waarden.aantal === 'number' ? waarden.aantal : 0,
      typeof waarden.afspraken_per_woning === 'number' ? waarden.afspraken_per_woning : null,
      typeof waarden.doorlooptijd_weken === 'number' ? waarden.doorlooptijd_weken : null,
      tekstOfNull(waarden.opmerking),
      koppelingen.organisatieId,
      context.gebruikerId,
      context.gebruikerId,
    );

  const projectId = Number(resultaat.lastInsertRowid);
  zetShowroomfase(handle, projectId, waarden, context);
  zetBegeleider(handle, projectId, koppelingen.begeleiderId);
  return projectId;
}

function werkProjectBij(
  handle: DatabaseHandle,
  projectId: number,
  waarden: Partial<Record<Veld, string | number>>,
  koppelingen: Koppelingen,
  context: Context,
): void {
  const toewijzingen: string[] = [];
  const parameters: Array<string | number | null> = [];

  for (const [veld, kolom] of Object.entries(PROJECTKOLOM) as Array<[Veld, string]>) {
    const waarde = waarden[veld];
    if (waarde === undefined) continue;
    toewijzingen.push(`${kolom} = ?`);
    parameters.push(waarde);
  }

  if (koppelingen.organisatieId !== null) {
    toewijzingen.push('organization_id = ?');
    parameters.push(koppelingen.organisatieId);
  }

  if (toewijzingen.length > 0) {
    handle.raw
      .prepare(
        `UPDATE projects SET ${toewijzingen.join(', ')}, updated_at = datetime('now'), updated_by = ?
          WHERE id = ?`,
      )
      .run(...([...parameters, context.gebruikerId, projectId] as never[]));
  }

  zetShowroomfase(handle, projectId, waarden, context);
  zetBegeleider(handle, projectId, koppelingen.begeleiderId);
}

/**
 * Zet de showroomfase van het project op de periode uit het bestand.
 *
 * Er is er hoogstens één: een bestaande showroomfase wordt bijgewerkt in plaats
 * van dat er een tweede naast komt. Zou dat wel gebeuren, dan telt de
 * capaciteitsberekening het project dubbel.
 */
function zetShowroomfase(
  handle: DatabaseHandle,
  projectId: number,
  waarden: Partial<Record<Veld, string | number>>,
  context: Context,
): void {
  const start = waarden.showroom_start;
  const eind = waarden.showroom_eind;
  if (typeof start !== 'string' || typeof eind !== 'string' || context.fase === null) return;

  const bestaand = handle.raw
    .prepare(
      `SELECT id FROM project_phases
        WHERE project_id = ? AND phase_type_id = ? AND archived_at IS NULL
        ORDER BY start_date LIMIT 1`,
    )
    .get(projectId, context.fase) as { id: number } | undefined;

  if (bestaand) {
    handle.raw
      .prepare(
        `UPDATE project_phases SET start_date = ?, end_date = ?, updated_at = datetime('now')
          WHERE id = ?`,
      )
      .run(start, eind, bestaand.id);
    return;
  }

  handle.raw
    .prepare(
      `INSERT INTO project_phases (project_id, phase_type_id, start_date, end_date, is_capacity_load)
       VALUES (?, ?, ?, ?, 1)`,
    )
    .run(projectId, context.fase, start, eind);
}

/** Koppelt de begeleider, tenzij hij er al op zit. */
function zetBegeleider(handle: DatabaseHandle, projectId: number, userId: number | null): void {
  if (userId === null) return;

  const bestaand = handle.raw
    .prepare(
      `SELECT id FROM project_assignments
        WHERE project_id = ? AND user_id = ? AND archived_at IS NULL`,
    )
    .get(projectId, userId) as { id: number } | undefined;
  if (bestaand) return;

  handle.raw
    .prepare(
      `INSERT INTO project_assignments (project_id, user_id, role, share_bp)
       VALUES (?, ?, 'kopersbegeleider', 10000)`,
    )
    .run(projectId, userId);
}

// --- opzoeklijsten ---------------------------------------------------------

function showroomFaseId(handle: DatabaseHandle): number | null {
  const rij = handle.raw
    .prepare(
      `SELECT i.id FROM picklist_items i
         JOIN picklists p ON p.id = i.picklist_id
        WHERE p.key = 'projectfase' AND i.value = 'showroom'`,
    )
    .get() as { id: number } | undefined;
  return rij ? Number(rij.id) : null;
}

/** Medewerkers op initialen én op naam, allebei in kleine letters. */
function laadBegeleiders(handle: DatabaseHandle): Map<string, number> {
  const rijen = handle.raw
    .prepare('SELECT id, name, initials FROM users WHERE archived_at IS NULL')
    .all() as Rij[];

  const kaart = new Map<string, number>();
  for (const rij of rijen) {
    kaart.set(String(rij.initials).toLowerCase(), Number(rij.id));
    kaart.set(String(rij.name).toLowerCase(), Number(rij.id));
  }
  return kaart;
}

function laadOrganisaties(handle: DatabaseHandle): Map<string, number> {
  const rijen = handle.raw
    .prepare('SELECT id, name FROM organizations WHERE archived_at IS NULL')
    .all() as Rij[];

  const kaart = new Map<string, number>();
  for (const rij of rijen) kaart.set(String(rij.name).toLowerCase(), Number(rij.id));
  return kaart;
}

function tekstOfNull(waarde: string | number | undefined): string | null {
  return waarde === undefined ? null : String(waarde);
}
