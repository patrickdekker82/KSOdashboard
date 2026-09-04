/**
 * Zoeken (hoofdstuk 6.1).
 *
 * Organisaties en contactpersonen hebben een FTS5-index; projecten en kansen
 * worden met LIKE doorzocht. Beide gaan door dezelfde ingang, zodat de
 * zoekbalk één lijst met resultaten kan tonen.
 *
 * De vertaling van vrije zoektekst naar een MATCH-expressie is het lastige
 * stuk: FTS5 heeft een eigen querytaal met operatoren als AND, NOT, NEAR, ^
 * en *. Wat een gebruiker intikt is géén query, maar tekst. Een aanhalingsteken
 * of een losse * zou anders een SQL-fout opleveren in plaats van nul
 * resultaten.
 */
import type { DatabaseHandle } from '../../db/client.ts';

export type ZoekTreffer = {
  entiteit: string;
  id: number;
  titel: string;
  ondertitel: string | null;
  soort: string;
};

/** Tekens die FTS5 als operator leest en die we dus niet doorlaten. */
const FTS_OPERATOREN = /["()*:^\-+]/g;

/**
 * Zet vrije zoektekst om in een veilige FTS5-expressie.
 *
 * Elke term wordt tussen aanhalingstekens gezet (dan is hij letterlijk) en
 * krijgt een `*` erachter voor zoeken-terwijl-je-typt. Termen worden met AND
 * gecombineerd: wie twee woorden intikt, bedoelt meestal allebei.
 *
 * Geeft `null` terug als er na het opschonen niets bruikbaars overblijft.
 */
export function naarFtsExpressie(invoer: string): string | null {
  const termen = invoer
    .replace(FTS_OPERATOREN, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    // Eén letter levert bij zoeken-terwijl-je-typt de halve database op.
    .filter((term) => term.length >= 2)
    .slice(0, 8);

  if (termen.length === 0) return null;
  return termen.map((term) => `"${term}"*`).join(' AND ');
}

/** Schoont een term op voor een LIKE-vergelijking. */
function naarLike(invoer: string): string {
  return `%${invoer.replace(/[\\%_]/g, (teken) => `\\${teken}`)}%`;
}

type Rij = Record<string, unknown>;

/**
 * Zoekt over de entiteiten die er in de zoekbalk toe doen.
 *
 * `limiet` geldt per soort, zodat één entiteit met veel treffers de andere
 * niet wegdrukt.
 */
export function zoek(
  handle: DatabaseHandle,
  invoer: string,
  limiet = 8,
): { treffers: ZoekTreffer[]; term: string } {
  const term = invoer.trim();
  if (term.length < 2) return { treffers: [], term };

  const expressie = naarFtsExpressie(term);
  const treffers: ZoekTreffer[] = [];

  if (expressie) {
    // FTS5 kan alsnog struikelen over een expressie die wij niet voorzagen;
    // een zoekopdracht mag dan nul resultaten geven, geen 500.
    try {
      const organisaties = handle.raw
        .prepare(
          `SELECT o.id, o.name, o.city
             FROM organizations_fts f
             JOIN organizations o ON o.id = f.rowid
            WHERE organizations_fts MATCH ?
              AND o.archived_at IS NULL
            ORDER BY rank
            LIMIT ?`,
        )
        .all(expressie, limiet) as Rij[];

      for (const rij of organisaties) {
        treffers.push({
          entiteit: 'organizations',
          id: Number(rij.id),
          titel: String(rij.name),
          ondertitel: (rij.city as string | null) ?? null,
          soort: 'Klant',
        });
      }

      const contacten = handle.raw
        .prepare(
          `SELECT c.id, c.first_name, c.infix, c.last_name, c.email, o.name AS organisatie
             FROM contacts_fts f
             JOIN contacts c ON c.id = f.rowid
        LEFT JOIN organizations o ON o.id = c.organization_id
            WHERE contacts_fts MATCH ?
              AND c.archived_at IS NULL
            ORDER BY rank
            LIMIT ?`,
        )
        .all(expressie, limiet) as Rij[];

      for (const rij of contacten) {
        treffers.push({
          entiteit: 'contacts',
          id: Number(rij.id),
          titel: volledigeNaam(rij),
          ondertitel: (rij.organisatie as string | null) ?? (rij.email as string | null) ?? null,
          soort: 'Contactpersoon',
        });
      }
    } catch {
      // Val terug op LIKE; beter een traag antwoord dan geen antwoord.
      treffers.push(...likeZoek(handle, term, limiet));
    }
  }

  // Projecten en kansen hebben geen FTS-index; die zijn er te weinig voor.
  const patroon = naarLike(term);

  const projecten = handle.raw
    .prepare(
      `SELECT id, name, number, city FROM projects
        WHERE archived_at IS NULL
          AND (name LIKE ? ESCAPE '\\' OR plan_name LIKE ? ESCAPE '\\' OR number LIKE ? ESCAPE '\\')
        ORDER BY name LIMIT ?`,
    )
    .all(patroon, patroon, patroon, limiet) as Rij[];

  for (const rij of projecten) {
    treffers.push({
      entiteit: 'projects',
      id: Number(rij.id),
      titel: String(rij.name),
      ondertitel: [rij.number, rij.city].filter(Boolean).join(' · ') || null,
      soort: 'Project',
    });
  }

  const kansen = handle.raw
    .prepare(
      `SELECT id, name, number FROM opportunities
        WHERE archived_at IS NULL
          AND (name LIKE ? ESCAPE '\\' OR number LIKE ? ESCAPE '\\')
        ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(patroon, patroon, limiet) as Rij[];

  for (const rij of kansen) {
    treffers.push({
      entiteit: 'opportunities',
      id: Number(rij.id),
      titel: String(rij.name),
      ondertitel: (rij.number as string | null) ?? null,
      soort: 'Kans',
    });
  }

  return { treffers, term };
}

/** Terugval wanneer de FTS-index niet meewerkt. */
function likeZoek(handle: DatabaseHandle, term: string, limiet: number): ZoekTreffer[] {
  const patroon = naarLike(term);
  const treffers: ZoekTreffer[] = [];

  const organisaties = handle.raw
    .prepare(
      `SELECT id, name, city FROM organizations
        WHERE archived_at IS NULL AND (name LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\')
        ORDER BY name LIMIT ?`,
    )
    .all(patroon, patroon, limiet) as Rij[];
  for (const rij of organisaties) {
    treffers.push({
      entiteit: 'organizations',
      id: Number(rij.id),
      titel: String(rij.name),
      ondertitel: (rij.city as string | null) ?? null,
      soort: 'Klant',
    });
  }

  const contacten = handle.raw
    .prepare(
      `SELECT id, first_name, infix, last_name, email FROM contacts
        WHERE archived_at IS NULL AND (last_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')
        ORDER BY last_name LIMIT ?`,
    )
    .all(patroon, patroon, limiet) as Rij[];
  for (const rij of contacten) {
    treffers.push({
      entiteit: 'contacts',
      id: Number(rij.id),
      titel: volledigeNaam(rij),
      ondertitel: (rij.email as string | null) ?? null,
      soort: 'Contactpersoon',
    });
  }

  return treffers;
}

export function volledigeNaam(rij: Rij): string {
  return [rij.first_name, rij.infix, rij.last_name]
    .map((deel) => (deel === null || deel === undefined ? '' : String(deel)))
    .filter(Boolean)
    .join(' ');
}
