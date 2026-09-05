/**
 * Kolommen herkennen en celwaarden lezen (hoofdstuk 11).
 *
 * Een planningsbestand komt uit Excel en is door mensen gemaakt: koppen heten
 * "Aantal won.", "aantal woningen" of "Woningen", datums staan als 02-03-2026
 * of als 2026-03-02, en getallen hebben een punt als duizendteken. Dit bestand
 * doet de vertaling van dat alles naar wat de database wil, en zegt per waarde
 * wat er mis is in plaats van er stilletjes iets van te maken.
 *
 * De herkenning is een voorstel, geen wet: het scherm laat de koppeling zien en
 * de gebruiker kan hem aanpassen voordat er iets wordt weggeschreven.
 */
import type { CelWaarde } from './xlsx.ts';

/** De velden waar een planningsregel uit kan bestaan. */
export type Veld =
  | 'nummer'
  | 'naam'
  | 'plaats'
  | 'plan'
  | 'opdrachtgever'
  | 'aantal'
  | 'showroom_start'
  | 'showroom_eind'
  | 'begeleider'
  | 'afspraken_per_woning'
  | 'doorlooptijd_weken'
  | 'opmerking';

export type VeldSoort = 'tekst' | 'getal' | 'datum';

export type VeldOmschrijving = {
  veld: Veld;
  label: string;
  soort: VeldSoort;
  verplicht: boolean;
  /** Woorden die in een kop mogen staan om dit veld te herkennen. */
  aliassen: string[];
  uitleg?: string;
};

export const VELDEN: VeldOmschrijving[] = [
  {
    veld: 'nummer',
    label: 'Projectnummer',
    soort: 'tekst',
    verplicht: false,
    aliassen: ['projectnummer', 'projectnr', 'nummer', 'nr', 'code', 'projectcode'],
    uitleg: 'Hierop wordt herkend of een project al bestaat.',
  },
  {
    veld: 'naam',
    label: 'Projectnaam',
    soort: 'tekst',
    verplicht: true,
    aliassen: ['projectnaam', 'naam', 'project', 'omschrijving', 'werk'],
  },
  { veld: 'plaats', label: 'Plaats', soort: 'tekst', verplicht: false, aliassen: ['plaats', 'stad', 'gemeente', 'locatie'] },
  { veld: 'plan', label: 'Plannaam', soort: 'tekst', verplicht: false, aliassen: ['plan', 'plannaam', 'wijk', 'fase'] },
  {
    veld: 'opdrachtgever',
    label: 'Opdrachtgever',
    soort: 'tekst',
    verplicht: false,
    aliassen: ['opdrachtgever', 'klant', 'aannemer', 'ontwikkelaar', 'bouwer'],
    uitleg: 'Wordt gezocht op naam; een onbekende naam levert een melding op, geen nieuwe klant.',
  },
  {
    veld: 'aantal',
    label: 'Aantal woningen',
    soort: 'getal',
    verplicht: true,
    aliassen: ['aantalwoningen', 'aantalwon', 'woningen', 'aantal', 'wooneenheden', 'eenheden'],
  },
  {
    veld: 'showroom_start',
    label: 'Showroom start',
    soort: 'datum',
    verplicht: false,
    aliassen: ['showroomstart', 'startshowroom', 'start', 'startdatum', 'vanaf', 'begin'],
  },
  {
    veld: 'showroom_eind',
    label: 'Showroom eind',
    soort: 'datum',
    verplicht: false,
    aliassen: ['showroomeind', 'eindshowroom', 'eind', 'einddatum', 'tot', 'einde', 'gereed'],
  },
  {
    veld: 'begeleider',
    label: 'Kopersbegeleider',
    soort: 'tekst',
    verplicht: false,
    aliassen: ['kopersbegeleider', 'begeleider', 'kb', 'medewerker', 'verantwoordelijke'],
    uitleg: 'Initialen of naam van een medewerker.',
  },
  {
    veld: 'afspraken_per_woning',
    label: 'Afspraken per woning',
    soort: 'getal',
    verplicht: false,
    aliassen: ['afsprakenperwoning', 'afspraken', 'v'],
  },
  {
    veld: 'doorlooptijd_weken',
    label: 'Doorlooptijd (weken)',
    soort: 'getal',
    verplicht: false,
    aliassen: ['doorlooptijd', 'doorlooptijdweken', 'nawerk', 'd'],
  },
  { veld: 'opmerking', label: 'Opmerking', soort: 'tekst', verplicht: false, aliassen: ['opmerking', 'notitie', 'toelichting', 'bijzonderheden'] },
];

export const VELD_INFO = new Map(VELDEN.map((veld) => [veld.veld, veld]));

/** Een kop tot vergelijkbare vorm terugbrengen. */
export function normaliseerKop(kop: string): string {
  return kop
    .toLowerCase()
    .normalize('NFD')
    // Diakritische tekens eraf: "Aantal wóningen" moet ook meedoen.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export type Koppeling = Partial<Record<Veld, number>>;

/**
 * Stelt per veld een kolom voor op basis van de kopregel.
 *
 * Een exacte treffer wint van een treffer die alleen "begint met"; anders zou
 * "Start bouw" de kolom "Showroom start" kunnen wegkapen omdat beide met
 * "start" te maken hebben.
 */
export function stelKoppelingVoor(koppen: readonly CelWaarde[]): Koppeling {
  const genormaliseerd = koppen.map((kop) =>
    kop === null || kop === undefined ? '' : normaliseerKop(String(kop)),
  );
  const koppeling: Koppeling = {};
  const gebruikt = new Set<number>();

  // Eerst alle exacte treffers, daarna pas de losse.
  for (const streng of [true, false]) {
    for (const omschrijving of VELDEN) {
      if (koppeling[omschrijving.veld] !== undefined) continue;

      const index = genormaliseerd.findIndex((kop, positie) => {
        if (kop === '' || gebruikt.has(positie)) return false;
        return streng
          ? omschrijving.aliassen.includes(kop)
          : omschrijving.aliassen.some((alias) => alias.length >= 3 && kop.includes(alias));
      });

      if (index !== -1) {
        koppeling[omschrijving.veld] = index;
        gebruikt.add(index);
      }
    }
  }

  return koppeling;
}

// --- waarden lezen ---------------------------------------------------------

export type Gelezen<T> = { waarde: T | null; fout: string | null };

/** Leest een cel als tekst. Lege cellen worden `null`, niet "". */
export function leesTekst(cel: CelWaarde): Gelezen<string> {
  if (cel === null || cel === undefined) return { waarde: null, fout: null };
  const tekst = String(cel).trim();
  return { waarde: tekst === '' ? null : tekst, fout: null };
}

/**
 * Leest een cel als getal, Nederlands genoteerd.
 *
 * "1.250,5" is duizend tweehonderdvijftig en een half. Een punt is dus een
 * duizendteken, tenzij hij als enige scheidingsteken voorkomt met precies drie
 * cijfers erachter — dan is het waarschijnlijk toch een decimale punt uit een
 * Engelse export, en dat is niet met zekerheid te zeggen. In dat geval kiezen
 * we voor het duizendteken, want een woningaantal met drie decimalen bestaat
 * niet en 1.250 woningen wel.
 */
export function leesGetal(cel: CelWaarde): Gelezen<number> {
  if (cel === null || cel === undefined) return { waarde: null, fout: null };
  if (typeof cel === 'number') return { waarde: cel, fout: null };
  if (typeof cel === 'boolean') return { waarde: null, fout: 'Hier staat geen getal.' };

  const schoon = cel.trim().replace(/\s/g, '').replace(/^€/, '');
  if (schoon === '') return { waarde: null, fout: null };

  const genormaliseerd = schoon.includes(',')
    ? schoon.replace(/\./g, '').replace(',', '.')
    : schoon.replace(/\./g, '');

  if (!/^-?\d+(\.\d+)?$/.test(genormaliseerd)) {
    return { waarde: null, fout: `"${cel}" is geen getal.` };
  }

  const getal = Number(genormaliseerd);
  return Number.isFinite(getal)
    ? { waarde: getal, fout: null }
    : { waarde: null, fout: `"${cel}" is geen getal.` };
}

const DATUM_PATRONEN: Array<{ patroon: RegExp; volgorde: [number, number, number] }> = [
  // 2026-03-02 en 2026/03/02
  { patroon: /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/, volgorde: [1, 2, 3] },
  // 02-03-2026, 2-3-2026, 02/03/2026
  { patroon: /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/, volgorde: [3, 2, 1] },
  // 02-03-26
  { patroon: /^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/, volgorde: [3, 2, 1] },
];

/**
 * Leest een cel als datum en geeft hem als ISO terug.
 *
 * De xlsx-lezer levert datumcellen al als ISO aan; hier gaat het om wat een
 * mens intikte. Dag en maand staan in Nederland omgekeerd ten opzichte van de
 * Amerikaanse notatie, en dat verschil is niet aan de waarde te zien zolang
 * beide onder de dertien blijven. Daarom is de dag-eerst-lezing leidend: dit
 * is een Nederlandse applicatie, en 03-02-2026 is hier 3 februari.
 */
export function leesDatum(cel: CelWaarde): Gelezen<string> {
  if (cel === null || cel === undefined) return { waarde: null, fout: null };

  if (typeof cel === 'number') {
    return { waarde: null, fout: 'Deze cel is een getal, geen datum. Zet de celopmaak op datum.' };
  }
  if (typeof cel === 'boolean') return { waarde: null, fout: 'Hier staat geen datum.' };

  const tekst = cel.trim();
  if (tekst === '') return { waarde: null, fout: null };

  for (const { patroon, volgorde } of DATUM_PATRONEN) {
    const match = patroon.exec(tekst);
    if (!match) continue;

    const [jaarIndex, maandIndex, dagIndex] = volgorde;
    let jaar = Number(match[jaarIndex]);
    const maand = Number(match[maandIndex]);
    const dag = Number(match[dagIndex]);

    // Een jaartal van twee cijfers: 70 t/m 99 is de vorige eeuw, de rest deze.
    if (jaar < 100) jaar += jaar >= 70 ? 1900 : 2000;

    if (maand < 1 || maand > 12) return { waarde: null, fout: `"${tekst}" heeft maand ${maand}.` };
    if (dag < 1 || dag > 31) return { waarde: null, fout: `"${tekst}" heeft dag ${dag}.` };

    const datum = new Date(Date.UTC(jaar, maand - 1, dag));
    // 31 februari rolt door naar maart; zo vangen we dat op.
    if (datum.getUTCMonth() !== maand - 1 || datum.getUTCDate() !== dag) {
      return { waarde: null, fout: `"${tekst}" bestaat niet als datum.` };
    }

    const mm = String(maand).padStart(2, '0');
    const dd = String(dag).padStart(2, '0');
    return { waarde: `${jaar}-${mm}-${dd}`, fout: null };
  }

  return {
    waarde: null,
    fout: `"${tekst}" is geen datum. Gebruik bijvoorbeeld 02-03-2026.`,
  };
}

/** Leest één cel volgens de soort van het veld. */
export function leesVeld(veld: Veld, cel: CelWaarde): Gelezen<string | number> {
  const soort = VELD_INFO.get(veld)?.soort ?? 'tekst';
  if (soort === 'getal') return leesGetal(cel);
  if (soort === 'datum') return leesDatum(cel);
  return leesTekst(cel);
}
