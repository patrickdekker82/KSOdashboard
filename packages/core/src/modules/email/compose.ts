/**
 * Een bericht opstellen en vastleggen (hoofdstuk 9).
 *
 * Opstellen doet drie dingen: het sjabloon invullen met de gegevens van het
 * record, het bericht vastleggen in `email_messages` zodat het in de tijdlijn
 * verschijnt, en er een .eml van maken die de gebruiker in Outlook opent.
 *
 * Er gaat dus niets vanzelf de deur uit. Dat is een bewuste keuze en niet een
 * halve implementatie: de gebruiker leest zijn eigen mail na voordat hij hem
 * verstuurt, en de applicatie hoeft geen wachtwoord of token van een mailbox te
 * bewaren.
 */
import type { DatabaseHandle } from '../../db/client.ts';
import { bouwContext, ONDERWERPEN } from './context.ts';
import { bouwEml, htmlNaarTekst } from './eml.ts';
import { plaatshoudersIn, vulSjabloonIn, type SjabloonContext } from './template.ts';

type Rij = Record<string, unknown>;

export class MailFout extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MailFout';
    this.code = code;
  }
}

export type Ontvanger = { adres: string; naam?: string | null };

export type OpstelInvoer = {
  entiteit: string;
  recordId: number;
  templateId?: number | null;
  /** Zelf getypt onderwerp en tekst, als er geen sjabloon wordt gebruikt. */
  onderwerp?: string;
  bodyHtml?: string;
  aan?: Ontvanger[];
  cc?: Ontvanger[];
};

export type OpgesteldBericht = {
  messageId: number;
  onderwerp: string;
  bodyHtml: string;
  bodyText: string;
  aan: Ontvanger[];
  cc: Ontvanger[];
  /** Plaatshouders die niet konden worden ingevuld. */
  ontbrekend: string[];
  eml: string;
  bestandsnaam: string;
};

/**
 * Zoekt de ontvangers bij een record.
 *
 * Contactpersonen met "niet mailen" aan blijven eruit — dat vinkje staat er
 * niet voor niets, en het per ongeluk negeren is precies het soort fout dat
 * een AVG-klacht oplevert.
 */
export function vindOntvangers(
  handle: DatabaseHandle,
  entiteit: string,
  recordId: number,
): { ontvangers: Ontvanger[]; geweigerd: string[] } {
  const ontvangers: Ontvanger[] = [];
  const geweigerd: string[] = [];

  const voegToe = (rij: Rij | undefined): void => {
    if (!rij) return;
    const adres = rij.email === null || rij.email === undefined ? '' : String(rij.email).trim();
    if (adres === '') return;

    const naam = [rij.first_name, rij.infix, rij.last_name]
      .filter((deel) => deel !== null && deel !== undefined && String(deel) !== '')
      .join(' ');

    if (Number(rij.do_not_email) === 1) {
      geweigerd.push(naam || adres);
      return;
    }
    if (!ontvangers.some((entry) => entry.adres === adres)) {
      ontvangers.push({ adres, naam: naam || null });
    }
  };

  if (entiteit === 'contacts') {
    voegToe(handle.raw.prepare('SELECT * FROM contacts WHERE id = ?').get(recordId) as Rij);
    return { ontvangers, geweigerd };
  }

  // Bij een ander onderwerp: de primaire contactpersoon van de bijbehorende
  // organisatie, en anders de eerste die er is.
  const organisatieId = zoekOrganisatie(handle, entiteit, recordId);
  if (organisatieId !== null) {
    const rijen = handle.raw
      .prepare(
        `SELECT * FROM contacts
          WHERE organization_id = ? AND archived_at IS NULL
          ORDER BY is_primary DESC, id`,
      )
      .all(organisatieId) as Rij[];
    if (rijen[0]) voegToe(rijen[0]);
  }

  return { ontvangers, geweigerd };
}

function zoekOrganisatie(handle: DatabaseHandle, entiteit: string, recordId: number): number | null {
  const tabel: Record<string, string> = {
    organizations: 'organizations',
    projects: 'projects',
    opportunities: 'opportunities',
    'package-quotes': 'package_quotes',
  };
  const naam = tabel[entiteit];
  if (!naam) return null;

  if (entiteit === 'organizations') return recordId;

  const rij = handle.raw
    .prepare(`SELECT organization_id FROM ${naam} WHERE id = ?`)
    .get(recordId) as { organization_id: number | null } | undefined;
  return rij?.organization_id ?? null;
}

/** Stelt het bericht op, legt het vast en levert de .eml. */
export function stelBerichtOp(
  handle: DatabaseHandle,
  invoer: OpstelInvoer,
  gebruikerId: number,
  nu = new Date(),
): OpgesteldBericht {
  if (!ONDERWERPEN.has(invoer.entiteit)) {
    throw new MailFout(
      'onbekend_onderwerp',
      `Er kan geen mail worden opgesteld bij "${invoer.entiteit}".`,
    );
  }

  const context = bouwContext(handle, invoer.entiteit, invoer.recordId, gebruikerId);

  let onderwerpSjabloon = invoer.onderwerp ?? '';
  let bodySjabloon = invoer.bodyHtml ?? '';
  let templateId: number | null = null;

  if (invoer.templateId) {
    const sjabloon = handle.raw
      .prepare('SELECT * FROM email_templates WHERE id = ? AND archived_at IS NULL')
      .get(invoer.templateId) as Rij | undefined;
    if (!sjabloon) throw new MailFout('niet_gevonden', 'Dit sjabloon bestaat niet.');

    templateId = Number(sjabloon.id);
    onderwerpSjabloon = String(sjabloon.subject);
    bodySjabloon = String(sjabloon.body_html);
  }

  if (onderwerpSjabloon.trim() === '') {
    throw new MailFout('geen_onderwerp', 'Een bericht zonder onderwerp versturen doet niemand.');
  }

  const onderwerp = vulSjabloonIn(onderwerpSjabloon, context, false);
  const body = vulSjabloonIn(bodySjabloon, context, true);
  const ontbrekend = [...new Set([...onderwerp.ontbrekend, ...body.ontbrekend])];

  const gevonden = vindOntvangers(handle, invoer.entiteit, invoer.recordId);
  const aan = invoer.aan && invoer.aan.length > 0 ? invoer.aan : gevonden.ontvangers;
  if (aan.length === 0) {
    throw new MailFout(
      'geen_ontvanger',
      gevonden.geweigerd.length > 0
        ? `Er is geen ontvanger: ${gevonden.geweigerd.join(', ')} staat op "niet mailen".`
        : 'Er is geen e-mailadres bekend bij dit record.',
    );
  }

  const bodyText = htmlNaarTekst(body.tekst);
  const afzender = laadAfzender(handle, gebruikerId);

  const bericht = handle.raw
    .prepare(
      `INSERT INTO email_messages
         (account_id, template_id, direction, to_json, cc_json, subject, body_html, body_text,
          status, created_by)
       VALUES (?, ?, 'uitgaand', ?, ?, ?, ?, ?, 'opgesteld', ?)`,
    )
    .run(
      afzender.accountId,
      templateId,
      JSON.stringify(aan),
      JSON.stringify(invoer.cc ?? []),
      onderwerp.tekst,
      body.tekst,
      bodyText,
      gebruikerId,
    );

  const messageId = Number(bericht.lastInsertRowid);

  handle.raw
    .prepare(
      'INSERT INTO email_message_links (message_id, entity_key, record_id) VALUES (?, ?, ?)',
    )
    .run(messageId, invoer.entiteit, invoer.recordId);

  const eml = bouwEml({
    van: { adres: afzender.adres, naam: afzender.naam },
    aan,
    cc: invoer.cc,
    onderwerp: onderwerp.tekst,
    tekst: bodyText,
    html: body.tekst,
    datum: nu,
  });

  return {
    messageId,
    onderwerp: onderwerp.tekst,
    bodyHtml: body.tekst,
    bodyText,
    aan,
    cc: invoer.cc ?? [],
    ontbrekend,
    eml,
    bestandsnaam: `${veiligeBestandsnaam(onderwerp.tekst)}.eml`,
  };
}

/** De afzender: het ingestelde mailaccount, of anders de gebruiker zelf. */
function laadAfzender(
  handle: DatabaseHandle,
  gebruikerId: number,
): { accountId: number | null; adres: string; naam: string | null } {
  const account = handle.raw
    .prepare(
      `SELECT * FROM email_accounts
        WHERE active = 1 AND archived_at IS NULL AND (user_id = ? OR user_id IS NULL)
        ORDER BY user_id IS NULL, is_default DESC, id
        LIMIT 1`,
    )
    .get(gebruikerId) as Rij | undefined;

  if (account) {
    return {
      accountId: Number(account.id),
      adres: String(account.from_address),
      naam: (account.display_name as string | null) ?? null,
    };
  }

  const gebruiker = handle.raw
    .prepare('SELECT name, email FROM users WHERE id = ?')
    .get(gebruikerId) as Rij | undefined;

  return {
    accountId: null,
    adres: String(gebruiker?.email ?? 'onbekend@localhost'),
    naam: (gebruiker?.name as string | null) ?? null,
  };
}

/** Een onderwerp als bestandsnaam: zonder tekens waar Windows over valt. */
export function veiligeBestandsnaam(onderwerp: string): string {
  const schoon = onderwerp
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return schoon === '' ? 'bericht' : schoon;
}

/** Markeert een opgesteld bericht als verstuurd, nadat de gebruiker dat zegt. */
export function markeerVerstuurd(
  handle: DatabaseHandle,
  messageId: number,
  nu = new Date(),
): void {
  const resultaat = handle.raw
    .prepare(
      `UPDATE email_messages SET status = 'verstuurd', sent_at = ?
        WHERE id = ? AND status != 'verstuurd'`,
    )
    .run(nu.toISOString().slice(0, 19).replace('T', ' '), messageId);

  if (Number(resultaat.changes ?? 0) === 0) {
    throw new MailFout('niet_gevonden', 'Dit bericht bestaat niet of staat al op verstuurd.');
  }
}

/** De sjablonen die bij een onderwerp horen. */
export function laadSjablonen(handle: DatabaseHandle, entiteit?: string): Rij[] {
  return handle.raw
    .prepare(
      `SELECT id, name, code, subject, body_html, entity_scope, variables
         FROM email_templates
        WHERE archived_at IS NULL AND is_active = 1
          ${entiteit ? 'AND (entity_scope IS NULL OR entity_scope = ?)' : ''}
        ORDER BY name`,
    )
    .all(...((entiteit ? [naarTabel(entiteit)] : []) as never[])) as Rij[];
}

/** De sjablonen noemen de tabelnaam; de API praat in entiteitssleutels. */
function naarTabel(entiteit: string): string {
  return entiteit === 'package-quotes' ? 'package_quotes' : entiteit;
}

/** Welke plaatshouders een sjabloon gebruikt, zodat het scherm ze kan tonen. */
export function sjabloonPlaatshouders(sjabloon: Rij): string[] {
  return [
    ...new Set([
      ...plaatshoudersIn(String(sjabloon.subject ?? '')),
      ...plaatshoudersIn(String(sjabloon.body_html ?? '')),
    ]),
  ];
}

export type { SjabloonContext };
