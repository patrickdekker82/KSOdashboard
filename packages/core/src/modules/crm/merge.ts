/**
 * Samenvoegen van dubbele records (hoofdstuk 6.1).
 *
 * Het lastige aan samenvoegen is niet het kopiëren van velden maar het
 * meeverhuizen van alles wat naar het verliezende record wijst. Wordt dat
 * vergeten, dan verdwijnt een contactpersoon of een offerte uit beeld terwijl
 * hij nog gewoon in de database staat.
 *
 * Daarom staat hier één expliciete lijst van elke verwijzing naar
 * `organizations` en `contacts`. Komt er een tabel bij die daarnaar verwijst,
 * dan hoort hij hier ook bij — en de test controleert dat.
 */
import type { DatabaseHandle } from '../../db/client.ts';

export type Verwijzing = { tabel: string; kolom: string };

/** Alles wat naar een organisatie wijst. */
export const ORGANISATIE_VERWIJZINGEN: Verwijzing[] = [
  { tabel: 'contacts', kolom: 'organization_id' },
  { tabel: 'organization_contacts', kolom: 'organization_id' },
  { tabel: 'organizations', kolom: 'parent_organization_id' },
  { tabel: 'opportunities', kolom: 'organization_id' },
  { tabel: 'projects', kolom: 'organization_id' },
  { tabel: 'projects', kolom: 'contractor_organization_id' },
  { tabel: 'projects', kolom: 'developer_organization_id' },
  { tabel: 'products', kolom: 'supplier_organization_id' },
  { tabel: 'package_quotes', kolom: 'organization_id' },
  { tabel: 'capacity_allocations', kolom: 'organization_id' },
];

/** Alles wat naar een contactpersoon wijst. */
export const CONTACT_VERWIJZINGEN: Verwijzing[] = [
  { tabel: 'organization_contacts', kolom: 'contact_id' },
  { tabel: 'opportunities', kolom: 'primary_contact_id' },
  { tabel: 'package_quotes', kolom: 'contact_id' },
];

export type SamenvoegOpdracht = {
  entiteit: 'organizations' | 'contacts';
  /** Het record dat blijft bestaan. */
  winnaarId: number;
  /** Het record dat wordt gearchiveerd. */
  verliezerId: number;
  /**
   * Per veld de gekozen waarde. Wat hier niet in staat, blijft zoals het bij
   * de winnaar stond.
   */
  waarden?: Record<string, unknown>;
};

export type SamenvoegResultaat = {
  winnaarId: number;
  verliezerId: number;
  /** Hoeveel rijen er per tabel/kolom zijn omgehangen. */
  verplaatst: Array<{ tabel: string; kolom: string; rijen: number }>;
  velden: string[];
};

export class SamenvoegFout extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SamenvoegFout';
  }
}

function verwijzingenVoor(entiteit: SamenvoegOpdracht['entiteit']): Verwijzing[] {
  return entiteit === 'organizations' ? ORGANISATIE_VERWIJZINGEN : CONTACT_VERWIJZINGEN;
}

/**
 * Voegt twee records samen.
 *
 * Draait in één transactie: of alles verhuist en de verliezer wordt
 * gearchiveerd, of er verandert niets.
 */
export function voegSamen(
  handle: DatabaseHandle,
  opdracht: SamenvoegOpdracht,
  gebruikerId: number,
  toegestaneVelden: readonly string[],
): SamenvoegResultaat {
  const { entiteit, winnaarId, verliezerId } = opdracht;

  if (winnaarId === verliezerId) {
    throw new SamenvoegFout('Een record kan niet met zichzelf worden samengevoegd.');
  }

  const tabel = entiteit;
  const winnaar = handle.raw.prepare(`SELECT * FROM ${tabel} WHERE id = ?`).get(winnaarId) as
    | Record<string, unknown>
    | undefined;
  const verliezer = handle.raw.prepare(`SELECT * FROM ${tabel} WHERE id = ?`).get(verliezerId) as
    | Record<string, unknown>
    | undefined;

  if (!winnaar) throw new SamenvoegFout('Het record dat blijft bestaan is niet gevonden.');
  if (!verliezer) throw new SamenvoegFout('Het record dat vervalt is niet gevonden.');
  if (verliezer.archived_at !== null) {
    throw new SamenvoegFout('Dit record is al gearchiveerd.');
  }

  const velden = Object.keys(opdracht.waarden ?? {});
  for (const veld of velden) {
    if (!toegestaneVelden.includes(veld)) {
      throw new SamenvoegFout(`Het veld "${veld}" kan niet worden overgenomen.`);
    }
  }

  handle.raw.exec('BEGIN');
  try {
    // 1. De gekozen waarden op de winnaar zetten.
    if (velden.length > 0) {
      const waarden = velden.map((veld) => {
        const waarde = opdracht.waarden![veld];
        return waarde !== null && typeof waarde === 'object' ? JSON.stringify(waarde) : waarde;
      });
      handle.raw
        .prepare(
          `UPDATE ${tabel} SET ${velden.map((veld) => `${veld} = ?`).join(', ')},
                  updated_at = datetime('now'), updated_by = ?
            WHERE id = ?`,
        )
        .run(...([...waarden, gebruikerId, winnaarId] as never[]));
    }

    // 2. Alles wat naar de verliezer wees, naar de winnaar laten wijzen.
    const verplaatst: SamenvoegResultaat['verplaatst'] = [];
    for (const { tabel: doeltabel, kolom } of verwijzingenVoor(entiteit)) {
      // organization_contacts en taggables hebben een samengestelde sleutel;
      // een blinde UPDATE zou daar op een dubbele sleutel stuklopen. Eerst de
      // rijen weghalen die na het omhangen een duplicaat zouden worden.
      if (doeltabel === 'organization_contacts') {
        const anderekolom = kolom === 'organization_id' ? 'contact_id' : 'organization_id';
        handle.raw
          .prepare(
            `DELETE FROM organization_contacts
              WHERE ${kolom} = ?
                AND ${anderekolom} IN (SELECT ${anderekolom} FROM organization_contacts WHERE ${kolom} = ?)`,
          )
          .run(verliezerId, winnaarId);
      }

      const resultaat = handle.raw
        .prepare(`UPDATE ${doeltabel} SET ${kolom} = ? WHERE ${kolom} = ?`)
        .run(winnaarId, verliezerId);
      const rijen = Number(resultaat.changes ?? 0);
      if (rijen > 0) verplaatst.push({ tabel: doeltabel, kolom, rijen });
    }

    // 3. Losse koppelingen die op entiteitsnaam werken.
    for (const doeltabel of ['activity_links', 'email_message_links', 'taggables']) {
      handle.raw
        .prepare(
          `DELETE FROM ${doeltabel}
            WHERE entity_key = ? AND record_id = ?
              AND EXISTS (SELECT 1 FROM ${doeltabel} t2
                           WHERE t2.entity_key = ? AND t2.record_id = ?
                             AND t2.rowid <> ${doeltabel}.rowid)`,
        )
        .run(entiteit, verliezerId, entiteit, winnaarId);

      const resultaat = handle.raw
        .prepare(`UPDATE ${doeltabel} SET record_id = ? WHERE entity_key = ? AND record_id = ?`)
        .run(winnaarId, entiteit, verliezerId);
      const rijen = Number(resultaat.changes ?? 0);
      if (rijen > 0) verplaatst.push({ tabel: doeltabel, kolom: 'record_id', rijen });
    }

    const bijlagen = handle.raw
      .prepare('UPDATE attachments SET record_id = ? WHERE entity_key = ? AND record_id = ?')
      .run(winnaarId, entiteit, verliezerId);
    if (Number(bijlagen.changes ?? 0) > 0) {
      verplaatst.push({ tabel: 'attachments', kolom: 'record_id', rijen: Number(bijlagen.changes) });
    }

    // 4. De verliezer archiveren, met een spoor naar waar hij heen is.
    handle.raw
      .prepare(
        `UPDATE ${tabel}
            SET archived_at = datetime('now'), updated_at = datetime('now'), updated_by = ?
          WHERE id = ?`,
      )
      .run(gebruikerId, verliezerId);

    // 5. Vastleggen wat er is gebeurd, zodat het terug te vinden is.
    handle.raw
      .prepare(
        `INSERT INTO audit_log (user_id, entity_key, record_id, action, before, after)
         VALUES (?, ?, ?, 'samengevoegd', ?, ?)`,
      )
      .run(
        gebruikerId,
        entiteit,
        winnaarId,
        JSON.stringify({ verliezer, verplaatst }),
        JSON.stringify({ winnaarId, overgenomen: opdracht.waarden ?? {} }),
      );

    handle.raw.exec('COMMIT');
    return { winnaarId, verliezerId, verplaatst, velden };
  } catch (error) {
    handle.raw.exec('ROLLBACK');
    throw error;
  }
}
