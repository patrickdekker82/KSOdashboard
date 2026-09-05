/**
 * Wat de assistent van een record te zien krijgt (hoofdstuk 6.8).
 *
 * Twee dingen worden hier opgehaald. Het dossier: een korte, platte tekst met
 * wat er over dit record bekend is, zodat de assistent niet uit het niets hoeft
 * te schrijven. En de bekende persoonsgegevens: precies die namen, adressen en
 * nummers die uit de database komen, zodat `anonimiseer` ze kan vervangen door
 * plaatshouders voordat het dossier de deur uit gaat.
 *
 * Die tweede lijst is het belangrijkst. Een regex vindt een e-mailadres wel,
 * maar niet dat "Kroon" hier een achternaam is en geen bouwdeel. Wat we uit de
 * database weten, hoeven we niet te raden.
 */
import type { DatabaseHandle } from '../../db/client.ts';
import type { Bekend } from './anonimiseer.ts';

type Rij = Record<string, unknown>;

const tekst = (waarde: unknown): string =>
  waarde === null || waarde === undefined ? '' : String(waarde).trim();

/** Blokken die een preset in `include_context` kan opvragen. */
export const CONTEXTBLOKKEN = new Set(['record', 'contactpersonen', 'activiteiten', 'offertes']);

/** De entiteiten waar de assistent iets over mag weten. */
export const ONDERWERPEN = new Map<string, { tabel: string; label: string }>([
  ['organizations', { tabel: 'organizations', label: 'Klant' }],
  ['contacts', { tabel: 'contacts', label: 'Contactpersoon' }],
  ['projects', { tabel: 'projects', label: 'Project' }],
  ['opportunities', { tabel: 'opportunities', label: 'Kans' }],
  ['package-quotes', { tabel: 'package_quotes', label: 'Offerte' }],
]);

/** Leest het record zelf. `null` als het niet bestaat. */
function leesRecord(handle: DatabaseHandle, entiteit: string, recordId: number): Rij | null {
  const onderwerp = ONDERWERPEN.get(entiteit);
  if (onderwerp === undefined) return null;

  const rij = handle.raw
    .prepare(`SELECT * FROM ${onderwerp.tabel} WHERE id = ?`)
    .get(recordId) as Rij | undefined;

  return rij ?? null;
}

/** Het organisatienummer waar dit record onder valt, als dat er is. */
function organisatieVan(handle: DatabaseHandle, entiteit: string, record: Rij): number | null {
  if (entiteit === 'organizations') return Number(record.id);
  const id = record.organization_id;
  return typeof id === 'number' ? id : null;
}

/**
 * De persoonsgegevens die bij dit record horen, zoals ze in de database staan.
 *
 * Ruim genomen: liever een naam te veel op de lijst dan een naam te weinig.
 * Een waarde die niet in de tekst voorkomt kost niets — `bouwWoordenboek`
 * negeert hem gewoon.
 */
export function bekendeGegevens(
  handle: DatabaseHandle,
  entiteit: string,
  recordId: number,
): Bekend[] {
  const record = leesRecord(handle, entiteit, recordId);
  if (record === null) return [];

  const lijst: Bekend[] = [];
  const voegToe = (soort: Bekend['soort'], waarde: unknown): void => {
    const schoon = tekst(waarde);
    if (schoon !== '') lijst.push({ soort, waarde: schoon });
  };

  const organisatieId = organisatieVan(handle, entiteit, record);

  if (organisatieId !== null) {
    const organisatie = handle.raw
      .prepare('SELECT * FROM organizations WHERE id = ?')
      .get(organisatieId) as Rij | undefined;

    if (organisatie !== undefined) {
      voegToe('ORGANISATIE', organisatie.name);
      voegToe('ORGANISATIE', organisatie.legal_name);
      // Ook de losse kernwoorden: in een notitie staat "Meesters nabellen",
      // niet "Bouwbedrijf Meesters B.V.". Zonder dit lekt de klantnaam alsnog.
      for (const woord of kernwoorden(organisatie.name)) voegToe('ORGANISATIE', woord);
      for (const woord of kernwoorden(organisatie.legal_name)) voegToe('ORGANISATIE', woord);
      voegToe('EMAIL', organisatie.email);
      voegToe('TELEFOON', organisatie.phone);
      voegToe('ADRES', straat(organisatie.address_street, organisatie.address_number, organisatie.address_addition));
      voegToe('ADRES', organisatie.address_street);
      voegToe('ADRES', organisatie.postcode);
      voegToe('ADRES', straat(organisatie.visit_address_street, organisatie.visit_address_number, organisatie.visit_address_addition));
      voegToe('ADRES', organisatie.visit_postcode);
      voegToe('ADRES', organisatie.city);
      voegToe('ADRES', organisatie.visit_city);
    }

    for (const contact of contactenVan(handle, organisatieId)) {
      voegContactToe(contact, voegToe);
    }
  }

  if (entiteit === 'contacts') voegContactToe(record, voegToe);

  return lijst;
}

/**
 * De onderscheidende woorden uit een bedrijfsnaam.
 *
 * Rechtsvormen en aanduidingen zeggen niets over wélk bedrijf het is en
 * leveren alleen ruis op ("«ORGANISATIE_3» B.V."), dus die blijven staan.
 * Wat overblijft is precies wat iemand in een notitie afkort.
 */
const RECHTSVORMEN = new Set([
  'bv',
  'b.v.',
  'nv',
  'n.v.',
  'vof',
  'v.o.f.',
  'cv',
  'c.v.',
  'holding',
  'beheer',
  'groep',
  'group',
  'en',
  'zn',
  'zonen',
]);

function kernwoorden(naam: unknown): string[] {
  return tekst(naam)
    .split(/[\s,]+/)
    .map((woord) => woord.replace(/[.,;:]+$/, ''))
    .filter(
      (woord) => woord.length >= 4 && !RECHTSVORMEN.has(woord.toLocaleLowerCase('nl-NL')),
    );
}

/** `Dorpsstraat` + `12` + `B` → `Dorpsstraat 12 B`. */
function straat(straatnaam: unknown, nummer: unknown, toevoeging: unknown): string {
  const delen = [tekst(straatnaam), tekst(nummer), tekst(toevoeging)].filter((deel) => deel !== '');
  return delen.length >= 2 ? delen.join(' ') : '';
}

function voegContactToe(
  contact: Rij,
  voegToe: (soort: Bekend['soort'], waarde: unknown) => void,
): void {
  const voor = tekst(contact.first_name);
  const tussen = tekst(contact.infix);
  const achter = tekst(contact.last_name);

  // Volledige naam eerst; `bouwWoordenboek` sorteert op lengte, maar de
  // losse delen moeten er óók bij staan voor wie alleen "Bakker" schrijft.
  voegToe('PERSOON', [voor, tussen, achter].filter((deel) => deel !== '').join(' '));
  voegToe('PERSOON', [tussen, achter].filter((deel) => deel !== '').join(' '));
  voegToe('PERSOON', achter);
  voegToe('PERSOON', voor);
  voegToe('EMAIL', contact.email);
  voegToe('TELEFOON', contact.phone);
  voegToe('TELEFOON', contact.mobile);
}

function contactenVan(handle: DatabaseHandle, organisatieId: number): Rij[] {
  return handle.raw
    .prepare(
      `SELECT * FROM contacts
       WHERE organization_id = ? AND archived_at IS NULL
       ORDER BY is_primary DESC, last_name
       LIMIT 25`,
    )
    .all(organisatieId) as Rij[];
}

/**
 * Bouwt het dossier: platte tekst, met kopjes, klaar om mee te sturen.
 *
 * `blokken` komt uit `include_context` van de preset. Wat er niet in staat,
 * gaat ook niet mee — een preset die alleen een opvolgmail schrijft heeft de
 * offertegeschiedenis niet nodig, en wat niet meegaat kan ook niet lekken.
 */
export function bouwDossier(
  handle: DatabaseHandle,
  entiteit: string,
  recordId: number,
  blokken: string[],
): string {
  const onderwerp = ONDERWERPEN.get(entiteit);
  const record = leesRecord(handle, entiteit, recordId);
  if (onderwerp === undefined || record === null) return '';

  const wil = (blok: string): boolean => blokken.includes(blok);
  const stukken: string[] = [];

  if (wil('record')) {
    stukken.push(`## ${onderwerp.label}\n${beschrijfRecord(entiteit, record)}`);
  }

  const organisatieId = organisatieVan(handle, entiteit, record);

  if (wil('contactpersonen') && organisatieId !== null) {
    const regels = contactenVan(handle, organisatieId).map((contact) => {
      const naam = [contact.first_name, contact.infix, contact.last_name]
        .map(tekst)
        .filter((deel) => deel !== '')
        .join(' ');
      const functie = tekst(contact.job_title);
      return `- ${naam}${functie === '' ? '' : ` (${functie})`}`;
    });

    if (regels.length > 0) stukken.push(`## Contactpersonen\n${regels.join('\n')}`);
  }

  if (wil('activiteiten')) {
    const regels = (
      handle.raw
        .prepare(
          `SELECT a.type, a.subject, a.body, a.completed_at, a.due_at, a.created_at
             FROM activities a
             JOIN activity_links l ON l.activity_id = a.id
            WHERE l.entity_key = ? AND l.record_id = ? AND a.archived_at IS NULL
         ORDER BY COALESCE(a.completed_at, a.due_at, a.created_at) DESC
            LIMIT 15`,
        )
        .all(entiteit, recordId) as Rij[]
    ).map((rij) => {
      const wanneer = tekst(rij.completed_at ?? rij.due_at ?? rij.created_at).slice(0, 10);
      const body = tekst(rij.body);
      return `- ${wanneer} · ${tekst(rij.type)} · ${tekst(rij.subject)}${body === '' ? '' : `\n  ${body.replace(/\s+/g, ' ').slice(0, 400)}`}`;
    });

    if (regels.length > 0) stukken.push(`## Laatste contactmomenten\n${regels.join('\n')}`);
  }

  if (wil('offertes') && organisatieId !== null) {
    const regels = (
      handle.raw
        .prepare(
          `SELECT number, status, total_cents, valid_until, sent_at
             FROM package_quotes
            WHERE organization_id = ? AND archived_at IS NULL
         ORDER BY COALESCE(sent_at, created_at) DESC
            LIMIT 10`,
        )
        .all(organisatieId) as Rij[]
    ).map((rij) => {
      const bedrag = (Number(rij.total_cents ?? 0) / 100).toLocaleString('nl-NL', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      const verstuurd = tekst(rij.sent_at).slice(0, 10);
      return `- ${tekst(rij.number)} · ${tekst(rij.status)} · € ${bedrag}${verstuurd === '' ? '' : ` · verstuurd ${verstuurd}`}`;
    });

    if (regels.length > 0) stukken.push(`## Offertes\n${regels.join('\n')}`);
  }

  return stukken.join('\n\n');
}

/** De velden die per entiteit de moeite waard zijn om mee te sturen. */
const VELDEN = new Map<string, Array<[string, string]>>([
  [
    'organizations',
    [
      ['Naam', 'name'],
      ['Plaats', 'city'],
      ['Straat', 'address_street'],
      ['Telefoon', 'phone'],
      ['E-mail', 'email'],
      ['Omschrijving', 'description'],
    ],
  ],
  [
    'contacts',
    [
      ['Voornaam', 'first_name'],
      ['Tussenvoegsel', 'infix'],
      ['Achternaam', 'last_name'],
      ['Functie', 'job_title'],
      ['E-mail', 'email'],
      ['Telefoon', 'phone'],
      ['Notities', 'notes'],
    ],
  ],
  [
    'projects',
    [
      ['Naam', 'name'],
      ['Nummer', 'number'],
      ['Plaats', 'city'],
      ['Plan', 'plan_name'],
      ['Aantal woningen', 'unit_count'],
      ['Omschrijving', 'description'],
    ],
  ],
  [
    'opportunities',
    [
      ['Naam', 'name'],
      ['Nummer', 'number'],
      ['Status', 'status'],
      ['Verwachte waarde', 'amount_cents'],
      ['Kans', 'probability_bp'],
      ['Verwachte sluitingsdatum', 'expected_close_date'],
      ['Volgende stap', 'next_step'],
      ['Omschrijving', 'description'],
    ],
  ],
  [
    'package-quotes',
    [
      ['Nummer', 'number'],
      ['Status', 'status'],
      ['Totaal', 'total_cents'],
      ['Geldig tot', 'valid_until'],
      ['Toelichting', 'notes'],
    ],
  ],
]);

function beschrijfRecord(entiteit: string, record: Rij): string {
  const velden = VELDEN.get(entiteit) ?? [];
  const regels: string[] = [];

  for (const [label, kolom] of velden) {
    const waarde = tekst(record[kolom]);
    if (waarde === '') continue;

    if (kolom.endsWith('_cents')) {
      const bedrag = (Number(waarde) / 100).toLocaleString('nl-NL', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      regels.push(`- ${label}: € ${bedrag}`);
      continue;
    }
    if (kolom.endsWith('_bp')) {
      regels.push(`- ${label}: ${Number(waarde) / 100}%`);
      continue;
    }

    regels.push(`- ${label}: ${waarde.replace(/\s+/g, ' ').slice(0, 500)}`);
  }

  return regels.join('\n');
}
