import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';
import { runMigrations } from '../../db/migrate.ts';
import {
  CONTACT_VERWIJZINGEN,
  ORGANISATIE_VERWIJZINGEN,
  SamenvoegFout,
  voegSamen,
} from './merge.ts';

const ORGANISATIE_VELDEN = ['name', 'kvk_number', 'email', 'phone', 'city', 'postcode', 'website'];

let directory: string;
let handle: DatabaseHandle;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'showroom-merge-'));
  handle = openDatabase(join(directory, 'showroom.db'));
  runMigrations(handle);
  handle.raw.prepare("INSERT INTO users (name, initials, email, password_hash) VALUES ('Test', 'TT', 't@t.local', 'x')").run();
});

afterEach(() => {
  handle.close();
  rmSync(directory, { recursive: true, force: true });
});

function organisatie(naam: string, extra: Record<string, string> = {}): number {
  const kolommen = ['name', ...Object.keys(extra)];
  const waarden = [naam, ...Object.values(extra)];
  handle.raw
    .prepare(
      `INSERT INTO organizations (${kolommen.join(', ')}) VALUES (${kolommen.map(() => '?').join(', ')})`,
    )
    .run(...(waarden as never[]));
  return Number((handle.raw.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
}

// ---------------------------------------------------------------------------

describe('de lijst met verwijzingen is compleet', () => {
  /**
   * Deze test is het vangnet: komt er een tabel bij die naar organizations of
   * contacts verwijst, dan valt hij hier om zodra iemand vergeet hem in
   * merge.ts te registreren. Zonder dit zou samenvoegen stilletjes rijen
   * achterlaten die naar een gearchiveerd record wijzen.
   */
  function foreignKeysNaar(doel: string): Array<{ tabel: string; kolom: string }> {
    const tabellen = (
      handle.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((rij) => rij.name);

    const gevonden: Array<{ tabel: string; kolom: string }> = [];
    for (const tabel of tabellen) {
      const keys = handle.raw.prepare(`PRAGMA foreign_key_list(${tabel})`).all() as Array<{
        table: string;
        from: string;
      }>;
      for (const key of keys) {
        if (key.table === doel) gevonden.push({ tabel, kolom: key.from });
      }
    }
    return gevonden;
  }

  it('kent elke foreign key naar organizations', () => {
    const inSchema = foreignKeysNaar('organizations')
      .map((entry) => `${entry.tabel}.${entry.kolom}`)
      .sort();
    const geregistreerd = ORGANISATIE_VERWIJZINGEN.map(
      (entry) => `${entry.tabel}.${entry.kolom}`,
    ).sort();
    expect(geregistreerd).toEqual(inSchema);
  });

  it('kent elke foreign key naar contacts', () => {
    const inSchema = foreignKeysNaar('contacts')
      .map((entry) => `${entry.tabel}.${entry.kolom}`)
      .sort();
    const geregistreerd = CONTACT_VERWIJZINGEN.map((entry) => `${entry.tabel}.${entry.kolom}`).sort();
    expect(geregistreerd).toEqual(inSchema);
  });
});

describe('samenvoegen', () => {
  it('neemt de gekozen waarde per veld over', () => {
    const winnaar = organisatie('Bouwbedrijf Meesters', { city: 'Tilburg' });
    const verliezer = organisatie('Meesters BV', { kvk_number: '12345678', email: 'info@meesters.local' });

    voegSamen(
      handle,
      {
        entiteit: 'organizations',
        winnaarId: winnaar,
        verliezerId: verliezer,
        // Per veld kiest de gebruiker welke waarde wint.
        waarden: { kvk_number: '12345678', email: 'info@meesters.local' },
      },
      1,
      ORGANISATIE_VELDEN,
    );

    const rij = handle.raw.prepare('SELECT * FROM organizations WHERE id = ?').get(winnaar) as Record<
      string,
      unknown
    >;
    expect(rij.name).toBe('Bouwbedrijf Meesters'); // niet gekozen, dus onveranderd
    expect(rij.city).toBe('Tilburg');
    expect(rij.kvk_number).toBe('12345678');
    expect(rij.email).toBe('info@meesters.local');
  });

  it('archiveert de verliezer in plaats van hem te verwijderen', () => {
    const winnaar = organisatie('Alpha');
    const verliezer = organisatie('Alpha dubbel');

    voegSamen(handle, { entiteit: 'organizations', winnaarId: winnaar, verliezerId: verliezer }, 1, ORGANISATIE_VELDEN);

    const rij = handle.raw.prepare('SELECT archived_at FROM organizations WHERE id = ?').get(verliezer) as {
      archived_at: string | null;
    };
    expect(rij.archived_at).not.toBeNull();
  });

  it('laat contactpersonen, projecten, kansen en offertes meeverhuizen', () => {
    const winnaar = organisatie('Alpha');
    const verliezer = organisatie('Alpha dubbel');

    handle.raw
      .prepare("INSERT INTO contacts (organization_id, last_name) VALUES (?, 'De Vries')")
      .run(verliezer);
    handle.raw
      .prepare("INSERT INTO projects (name, contractor_organization_id) VALUES ('Plan A', ?)")
      .run(verliezer);
    handle.raw
      .prepare("INSERT INTO opportunities (name, organization_id) VALUES ('Kans A', ?)")
      .run(verliezer);
    handle.raw.prepare('INSERT INTO package_quotes (organization_id) VALUES (?)').run(verliezer);

    const resultaat = voegSamen(
      handle,
      { entiteit: 'organizations', winnaarId: winnaar, verliezerId: verliezer },
      1,
      ORGANISATIE_VELDEN,
    );

    const telling = (tabel: string, kolom: string): number =>
      Number(
        (
          handle.raw.prepare(`SELECT COUNT(*) AS n FROM ${tabel} WHERE ${kolom} = ?`).get(winnaar) as {
            n: number;
          }
        ).n,
      );

    expect(telling('contacts', 'organization_id')).toBe(1);
    expect(telling('projects', 'contractor_organization_id')).toBe(1);
    expect(telling('opportunities', 'organization_id')).toBe(1);
    expect(telling('package_quotes', 'organization_id')).toBe(1);

    // En het resultaat vertelt precies wat er is omgehangen.
    expect(resultaat.verplaatst).toEqual(
      expect.arrayContaining([
        { tabel: 'contacts', kolom: 'organization_id', rijen: 1 },
        { tabel: 'opportunities', kolom: 'organization_id', rijen: 1 },
      ]),
    );
  });

  it('laat niets achter dat nog naar de verliezer wijst', () => {
    const winnaar = organisatie('Alpha');
    const verliezer = organisatie('Alpha dubbel');

    handle.raw.prepare("INSERT INTO contacts (organization_id, last_name) VALUES (?, 'X')").run(verliezer);
    handle.raw.prepare("INSERT INTO projects (name, organization_id) VALUES ('P', ?)").run(verliezer);
    handle.raw.prepare("INSERT INTO products (name, supplier_organization_id) VALUES ('Paneel', ?)").run(verliezer);

    voegSamen(handle, { entiteit: 'organizations', winnaarId: winnaar, verliezerId: verliezer }, 1, ORGANISATIE_VELDEN);

    for (const { tabel, kolom } of ORGANISATIE_VERWIJZINGEN) {
      const aantal = Number(
        (
          handle.raw.prepare(`SELECT COUNT(*) AS n FROM ${tabel} WHERE ${kolom} = ?`).get(verliezer) as {
            n: number;
          }
        ).n,
      );
      expect(aantal, `${tabel}.${kolom} wijst nog naar de verliezer`).toBe(0);
    }
  });

  it('verhuist activiteiten, tags en bijlagen die op entiteitsnaam koppelen', () => {
    const winnaar = organisatie('Alpha');
    const verliezer = organisatie('Alpha dubbel');

    handle.raw.prepare("INSERT INTO activities (subject) VALUES ('Bellen')").run();
    handle.raw
      .prepare("INSERT INTO activity_links (activity_id, entity_key, record_id) VALUES (1, 'organizations', ?)")
      .run(verliezer);
    handle.raw.prepare("INSERT INTO tags (name) VALUES ('Belangrijk')").run();
    handle.raw
      .prepare("INSERT INTO taggables (tag_id, entity_key, record_id) VALUES (1, 'organizations', ?)")
      .run(verliezer);
    handle.raw
      .prepare(
        "INSERT INTO attachments (entity_key, record_id, filename, stored_path) VALUES ('organizations', ?, 'x.pdf', '/x.pdf')",
      )
      .run(verliezer);

    voegSamen(handle, { entiteit: 'organizations', winnaarId: winnaar, verliezerId: verliezer }, 1, ORGANISATIE_VELDEN);

    for (const tabel of ['activity_links', 'taggables', 'attachments']) {
      const rij = handle.raw
        .prepare(`SELECT record_id FROM ${tabel} WHERE entity_key = 'organizations'`)
        .get() as { record_id: number };
      expect(rij.record_id, tabel).toBe(winnaar);
    }
  });

  it('loopt niet stuk op een dubbele samengestelde sleutel', () => {
    // Beide organisaties zijn aan dezelfde contactpersoon gekoppeld; na het
    // omhangen zou dat twee identieke rijen opleveren.
    const winnaar = organisatie('Alpha');
    const verliezer = organisatie('Alpha dubbel');
    handle.raw.prepare("INSERT INTO contacts (last_name) VALUES ('De Vries')").run();

    handle.raw
      .prepare('INSERT INTO organization_contacts (organization_id, contact_id) VALUES (?, 1)')
      .run(winnaar);
    handle.raw
      .prepare('INSERT INTO organization_contacts (organization_id, contact_id) VALUES (?, 1)')
      .run(verliezer);

    expect(() =>
      voegSamen(handle, { entiteit: 'organizations', winnaarId: winnaar, verliezerId: verliezer }, 1, ORGANISATIE_VELDEN),
    ).not.toThrow();

    const aantal = Number(
      (handle.raw.prepare('SELECT COUNT(*) AS n FROM organization_contacts').get() as { n: number }).n,
    );
    expect(aantal).toBe(1);
  });

  it('legt de samenvoeging vast in het auditlog', () => {
    const winnaar = organisatie('Alpha');
    const verliezer = organisatie('Alpha dubbel', { city: 'Breda' });

    voegSamen(handle, { entiteit: 'organizations', winnaarId: winnaar, verliezerId: verliezer }, 1, ORGANISATIE_VELDEN);

    const rij = handle.raw
      .prepare("SELECT * FROM audit_log WHERE action = 'samengevoegd'")
      .get() as Record<string, unknown>;
    expect(rij).toBeDefined();
    expect(rij.record_id).toBe(winnaar);
    // Het verdwenen record staat volledig in het log, dus het is terug te vinden.
    expect(JSON.parse(String(rij.before)).verliezer.city).toBe('Breda');
  });

  it('draait alles terug wanneer er iets misgaat', () => {
    const winnaar = organisatie('Alpha');
    const verliezer = organisatie('Alpha dubbel');
    handle.raw.prepare("INSERT INTO contacts (organization_id, last_name) VALUES (?, 'X')").run(verliezer);

    // Een niet-toegestaan veld wordt geweigerd vóór de transactie.
    expect(() =>
      voegSamen(
        handle,
        {
          entiteit: 'organizations',
          winnaarId: winnaar,
          verliezerId: verliezer,
          waarden: { archived_at: null },
        },
        1,
        ORGANISATIE_VELDEN,
      ),
    ).toThrow(SamenvoegFout);

    // Er is niets verhuisd en de verliezer staat er nog.
    const contact = handle.raw.prepare('SELECT organization_id FROM contacts').get() as {
      organization_id: number;
    };
    expect(contact.organization_id).toBe(verliezer);
    const rij = handle.raw.prepare('SELECT archived_at FROM organizations WHERE id = ?').get(verliezer) as {
      archived_at: string | null;
    };
    expect(rij.archived_at).toBeNull();
  });

  it('weigert samenvoegen met zichzelf en onbekende records', () => {
    const een = organisatie('Alpha');
    expect(() =>
      voegSamen(handle, { entiteit: 'organizations', winnaarId: een, verliezerId: een }, 1, ORGANISATIE_VELDEN),
    ).toThrow(/met zichzelf/);
    expect(() =>
      voegSamen(handle, { entiteit: 'organizations', winnaarId: een, verliezerId: 999 }, 1, ORGANISATIE_VELDEN),
    ).toThrow(/niet gevonden/);
  });

  it('weigert een record dat al gearchiveerd is', () => {
    const winnaar = organisatie('Alpha');
    const verliezer = organisatie('Alpha dubbel');
    handle.raw.prepare("UPDATE organizations SET archived_at = datetime('now') WHERE id = ?").run(verliezer);
    expect(() =>
      voegSamen(handle, { entiteit: 'organizations', winnaarId: winnaar, verliezerId: verliezer }, 1, ORGANISATIE_VELDEN),
    ).toThrow(/al gearchiveerd/);
  });
});
