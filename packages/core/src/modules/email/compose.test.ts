/**
 * Tests voor het opstellen van een bericht (hoofdstuk 9).
 *
 * Het gaat hier om drie dingen die in de praktijk misgaan: dat de context
 * klopt (een offertemail moet de klant én het offertenummer kennen), dat een
 * contactpersoon met "niet mailen" er niet stiekem toch een krijgt, en dat het
 * bericht in de tijdlijn van het record terechtkomt.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';
import { runMigrations } from '../../db/migrate.ts';
import { bouwContext } from './context.ts';
import { MailFout, markeerVerstuurd, stelBerichtOp, veiligeBestandsnaam, vindOntvangers } from './compose.ts';
import { vulSjabloonIn } from './template.ts';

type Rij = Record<string, unknown>;

let directory: string;
let handle: DatabaseHandle;

const NU = new Date('2026-09-07T09:00:00Z');

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'showroom-mail-'));
  handle = openDatabase(join(directory, 'showroom.db'));
  runMigrations(handle);

  handle.raw
    .prepare(
      "INSERT INTO users (name, initials, email, password_hash) VALUES ('Patrick Dekker', 'PD', 'patrick@showroom.local', 'x')",
    )
    .run();
  handle.raw
    .prepare(
      "INSERT INTO settings (key, value) VALUES ('bedrijf', '{\"naam\":\"Showroom BV\",\"plaats\":\"Nieuwegein\"}')",
    )
    .run();

  handle.raw
    .prepare("INSERT INTO organizations (name, city, email) VALUES ('Bouwbedrijf Meesters B.V.', 'Houten', 'info@meesters.nl')")
    .run();
  handle.raw
    .prepare(
      `INSERT INTO contacts (organization_id, first_name, infix, last_name, email, is_primary)
       VALUES (1, 'Peter', 'van', 'Meesters', 'peter@meesters.nl', 1)`,
    )
    .run();
  handle.raw
    .prepare("INSERT INTO projects (name, organization_id, city, unit_count) VALUES ('Plan Zuidhoek', 1, 'Nieuwegein', 32)")
    .run();
  handle.raw
    .prepare(
      `INSERT INTO package_quotes (number, organization_id, contact_id, project_id, status,
                                   subtotal_cents, vat_cents, total_cents, valid_until)
       VALUES ('OF-2026-0001', 1, 1, 1, 'concept', 159000, 33390, 192390, '2026-10-07')`,
    )
    .run();

  handle.raw
    .prepare(
      `INSERT INTO email_templates (name, code, subject, body_html, entity_scope)
       VALUES ('Offerte toesturen', 'OFFERTE', 'Offerte {{offerte.nummer}}',
               '<p>Beste {{contact.voornaam}},</p><p>Hierbij offerte {{offerte.nummer}} van {{offerte.totaal}} voor {{project.naam}}.</p><p>Groet,<br>{{gebruiker.naam}}</p>',
               'package_quotes')`,
    )
    .run();
});

afterEach(() => {
  handle.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('de context bouwen', () => {
  it('kent bij een offerte de klant, het contact, het project en de offerte zelf', () => {
    const context = bouwContext(handle, 'package-quotes', 1, 1);

    expect(context.get('offerte')?.get('nummer')).toBe('OF-2026-0001');
    // Intl zet een vaste spatie (U+00A0) na het euroteken, geen gewone.
    expect(context.get('offerte')?.get('totaal')).toBe('€\u00a01.923,90');
    expect(context.get('organisatie')?.get('naam')).toBe('Bouwbedrijf Meesters B.V.');
    expect(context.get('contact')?.get('voornaam')).toBe('Peter');
    expect(context.get('project')?.get('naam')).toBe('Plan Zuidhoek');
    expect(context.get('gebruiker')?.get('naam')).toBe('Patrick Dekker');
    expect(context.get('bedrijf')?.get('naam')).toBe('Showroom BV');
  });

  it('zet het tussenvoegsel bij de achternaam', () => {
    const context = bouwContext(handle, 'contacts', 1, 1);
    expect(context.get('contact')?.get('achternaam')).toBe('van Meesters');
    expect(context.get('contact')?.get('volledigenaam')).toBe('Peter van Meesters');
  });

  it('haalt bij een contactpersoon de organisatie erbij', () => {
    const context = bouwContext(handle, 'contacts', 1, 1);
    expect(context.get('organisatie')?.get('naam')).toBe('Bouwbedrijf Meesters B.V.');
  });

  it('zet bedragen en datums in Nederlandse notatie', () => {
    const context = bouwContext(handle, 'package-quotes', 1, 1);
    expect(context.get('offerte')?.get('geldigtot')).toBe('07-10-2026');
  });

  // De mail gaat naar de primaire contactpersoon van de klant, dus het sjabloon
  // moet hem kunnen noemen ook als de offerte zelf geen contact heeft.
  it('valt bij een offerte zonder contactpersoon terug op de primaire van de klant', () => {
    handle.raw.prepare('UPDATE package_quotes SET contact_id = NULL WHERE id = 1').run();

    const context = bouwContext(handle, 'package-quotes', 1, 1);
    expect(context.get('contact')?.get('voornaam')).toBe('Peter');
  });

  it('laat een groep weg die er niet is', () => {
    const context = bouwContext(handle, 'organizations', 1, 1);
    expect(context.has('offerte')).toBe(false);
    expect(vulSjabloonIn('{{offerte.nummer}}', context).ontbrekend).toEqual(['offerte.nummer']);
  });
});

describe('ontvangers zoeken', () => {
  it('vindt de primaire contactpersoon van de klant', () => {
    const uitkomst = vindOntvangers(handle, 'package-quotes', 1);
    expect(uitkomst.ontvangers).toEqual([{ adres: 'peter@meesters.nl', naam: 'Peter van Meesters' }]);
  });

  // Dat vinkje staat er niet voor niets; het per ongeluk negeren is precies het
  // soort fout dat een AVG-klacht oplevert.
  it('slaat een contactpersoon met "niet mailen" over', () => {
    handle.raw.prepare('UPDATE contacts SET do_not_email = 1 WHERE id = 1').run();

    const uitkomst = vindOntvangers(handle, 'contacts', 1);
    expect(uitkomst.ontvangers).toEqual([]);
    expect(uitkomst.geweigerd).toEqual(['Peter van Meesters']);
  });

  it('slaat een contactpersoon zonder e-mailadres over', () => {
    handle.raw.prepare('UPDATE contacts SET email = NULL WHERE id = 1').run();
    expect(vindOntvangers(handle, 'contacts', 1).ontvangers).toEqual([]);
  });
});

describe('een bericht opstellen', () => {
  it('vult het sjabloon in met de gegevens van de offerte', () => {
    const bericht = stelBerichtOp(handle, { entiteit: 'package-quotes', recordId: 1, templateId: 1 }, 1, NU);

    expect(bericht.onderwerp).toBe('Offerte OF-2026-0001');
    expect(bericht.bodyHtml).toContain('Beste Peter,');
    expect(bericht.bodyHtml).toContain('€\u00a01.923,90');
    expect(bericht.bodyHtml).toContain('Plan Zuidhoek');
    expect(bericht.ontbrekend).toEqual([]);
  });

  it('legt het bericht vast bij het record, zodat het in de tijdlijn komt', () => {
    const bericht = stelBerichtOp(handle, { entiteit: 'package-quotes', recordId: 1, templateId: 1 }, 1, NU);

    const rij = handle.raw
      .prepare('SELECT * FROM email_messages WHERE id = ?')
      .get(bericht.messageId) as Rij;
    expect(rij).toMatchObject({ status: 'opgesteld', direction: 'uitgaand' });

    const koppeling = handle.raw
      .prepare('SELECT * FROM email_message_links WHERE message_id = ?')
      .get(bericht.messageId) as Rij;
    expect(koppeling).toMatchObject({ entity_key: 'package-quotes', record_id: 1 });
  });

  it('levert een .eml die de ontvanger en het onderwerp bevat', () => {
    const bericht = stelBerichtOp(handle, { entiteit: 'package-quotes', recordId: 1, templateId: 1 }, 1, NU);

    expect(bericht.eml).toContain('To: Peter van Meesters <peter@meesters.nl>');
    expect(bericht.eml).toContain('From: Patrick Dekker <patrick@showroom.local>');
    expect(bericht.eml).toContain('X-Unsent: 1');
  });

  it('maakt van het onderwerp een bruikbare bestandsnaam', () => {
    const bericht = stelBerichtOp(handle, { entiteit: 'package-quotes', recordId: 1, templateId: 1 }, 1, NU);
    expect(bericht.bestandsnaam).toBe('Offerte OF-2026-0001.eml');
  });

  it('meldt plaatshouders die niet ingevuld konden worden', () => {
    handle.raw
      .prepare("UPDATE email_templates SET body_html = '<p>{{contact.roepnaam}}</p>' WHERE id = 1")
      .run();

    const bericht = stelBerichtOp(handle, { entiteit: 'package-quotes', recordId: 1, templateId: 1 }, 1, NU);
    expect(bericht.ontbrekend).toEqual(['contact.roepnaam']);
  });

  // Bij een organisatie gaat de mail naar de primaire contactpersoon, dus het
  // sjabloon moet hem kunnen noemen — anders wordt het "Beste ,".
  it('werkt ook zonder sjabloon, met een zelf getypt bericht', () => {
    const bericht = stelBerichtOp(
      handle,
      {
        entiteit: 'organizations',
        recordId: 1,
        onderwerp: 'Even bijpraten',
        bodyHtml: '<p>Beste {{contact.voornaam}},</p>',
      },
      1,
      NU,
    );

    expect(bericht.onderwerp).toBe('Even bijpraten');
    expect(bericht.bodyHtml).toContain('Beste Peter,');
  });

  it('weigert een bericht zonder onderwerp', () => {
    expect(() =>
      stelBerichtOp(handle, { entiteit: 'organizations', recordId: 1, bodyHtml: '<p>x</p>' }, 1, NU),
    ).toThrow(/onderwerp/);
  });

  it('weigert een onderwerp waar geen mail bij hoort', () => {
    expect(() => stelBerichtOp(handle, { entiteit: 'projects_typo', recordId: 1 }, 1, NU)).toThrow(
      MailFout,
    );
  });

  it('legt uit waarom er geen ontvanger is bij "niet mailen"', () => {
    handle.raw.prepare('UPDATE contacts SET do_not_email = 1 WHERE id = 1').run();

    expect(() =>
      stelBerichtOp(handle, { entiteit: 'package-quotes', recordId: 1, templateId: 1 }, 1, NU),
    ).toThrow(/niet mailen/);
  });

  it('neemt een meegegeven ontvanger boven de gevonden', () => {
    const bericht = stelBerichtOp(
      handle,
      {
        entiteit: 'package-quotes',
        recordId: 1,
        templateId: 1,
        aan: [{ adres: 'anders@meesters.nl', naam: 'Iemand anders' }],
      },
      1,
      NU,
    );

    expect(bericht.aan).toEqual([{ adres: 'anders@meesters.nl', naam: 'Iemand anders' }]);
  });

  it('markeert een bericht als verstuurd', () => {
    const bericht = stelBerichtOp(handle, { entiteit: 'package-quotes', recordId: 1, templateId: 1 }, 1, NU);
    markeerVerstuurd(handle, bericht.messageId, NU);

    const rij = handle.raw
      .prepare('SELECT status, sent_at FROM email_messages WHERE id = ?')
      .get(bericht.messageId) as Rij;
    expect(rij).toMatchObject({ status: 'verstuurd', sent_at: '2026-09-07 09:00:00' });
  });

  it('markeert niet twee keer', () => {
    const bericht = stelBerichtOp(handle, { entiteit: 'package-quotes', recordId: 1, templateId: 1 }, 1, NU);
    markeerVerstuurd(handle, bericht.messageId, NU);
    expect(() => markeerVerstuurd(handle, bericht.messageId, NU)).toThrow(MailFout);
  });
});

describe('bestandsnamen', () => {
  it('haalt tekens weg waar Windows over valt', () => {
    expect(veiligeBestandsnaam('Offerte: 1/2 <concept>')).toBe('Offerte- 1-2 -concept-');
  });

  it('valt terug op een naam als er niets overblijft', () => {
    expect(veiligeBestandsnaam('   ')).toBe('bericht');
  });

  it('kort een lange naam in', () => {
    expect(veiligeBestandsnaam('x'.repeat(200)).length).toBe(80);
  });
});
