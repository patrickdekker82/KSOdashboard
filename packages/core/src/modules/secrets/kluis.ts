/**
 * De sleutelkluis: geheimen versleuteld in de database (hoofdstuk 6.8).
 *
 * De enige geheimen die deze applicatie kent zijn API-sleutels van derden.
 * Ze mogen niet leesbaar in de database staan, want de database gaat elke
 * nacht als back-up naar een netwerkschijf; wie die back-up in handen krijgt
 * mag daarmee niet ook de sleutel in handen krijgen.
 *
 * Daarom: AES-256-GCM, met een sleutelbestand *naast* de database in plaats
 * van erin. De back-up bevat de versleutelde tekst, het sleutelbestand blijft
 * op de werkplek achter. GCM levert bovendien een authenticatietag, dus een
 * gemanipuleerd cijfertekstveld valt door de mand in plaats van stilletjes
 * onzin op te leveren.
 *
 * Zie docs/BESLISSINGEN.md.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseHandle } from '../../db/client.ts';

/** Naam van het sleutelbestand in de gegevensmap. */
export const SLEUTELBESTAND = 'kluissleutel.bin';

const ALGORITME = 'aes-256-gcm';
const SLEUTELLENGTE = 32;
const IV_LENGTE = 12; // 96 bits, de aanbevolen lengte voor GCM

export class KluisFout extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'KluisFout';
    this.code = code;
  }
}

/**
 * Leest de kluissleutel uit de gegevensmap, of maakt hem de eerste keer aan.
 *
 * Het bestand krijgt rechten 0600. Op Windows doet `chmod` weinig; daar is de
 * bescherming dat de gegevensmap onder het profiel van de gebruiker staat.
 */
export function laadSleutel(gegevensmap: string): Buffer {
  const pad = join(gegevensmap, SLEUTELBESTAND);

  if (existsSync(pad)) {
    const inhoud = readFileSync(pad);
    if (inhoud.length !== SLEUTELLENGTE) {
      throw new KluisFout(
        'sleutel_onbruikbaar',
        `Het sleutelbestand ${pad} is beschadigd (${inhoud.length} in plaats van ${SLEUTELLENGTE} bytes). ` +
          'Verwijder het bestand om een nieuwe sleutel te maken; opgeslagen geheimen moeten dan opnieuw ingevoerd worden.',
      );
    }
    return inhoud;
  }

  mkdirSync(dirname(pad), { recursive: true });
  const sleutel = randomBytes(SLEUTELLENGTE);
  writeFileSync(pad, sleutel, { mode: 0o600 });
  try {
    chmodSync(pad, 0o600);
  } catch {
    // Windows kent geen POSIX-rechten; de map zelf is dan de bescherming.
  }
  return sleutel;
}

export type Versleuteld = { ciphertext: string; iv: string; tag: string };

/** Versleutelt een tekst tot de drie velden die de tabel `secrets` bewaart. */
export function versleutel(sleutel: Buffer, klaretekst: string): Versleuteld {
  const iv = randomBytes(IV_LENGTE);
  const cipher = createCipheriv(ALGORITME, sleutel, iv);
  const gedeelten = Buffer.concat([cipher.update(klaretekst, 'utf8'), cipher.final()]);

  return {
    ciphertext: gedeelten.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

/** Ontsleutelt wat `versleutel` gemaakt heeft. Gooit bij manipulatie. */
export function ontsleutel(sleutel: Buffer, doos: Versleuteld): string {
  const iv = Buffer.from(doos.iv, 'base64');
  if (iv.length !== IV_LENGTE) {
    throw new KluisFout('geheim_onleesbaar', 'De opgeslagen initialisatievector klopt niet.');
  }

  try {
    const decipher = createDecipheriv(ALGORITME, sleutel, iv);
    decipher.setAuthTag(Buffer.from(doos.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(doos.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new KluisFout(
      'geheim_onleesbaar',
      'Het geheim kon niet ontsleuteld worden. Is het sleutelbestand vervangen of de database van een andere werkplek gekopieerd? Voer het geheim opnieuw in.',
    );
  }
}

/** Bewaart een geheim onder een sleutelnaam. Een lege waarde wist het geheim. */
export function bewaarGeheim(
  handle: DatabaseHandle,
  gegevensmap: string,
  naam: string,
  waarde: string,
): void {
  if (waarde === '') {
    verwijderGeheim(handle, naam);
    return;
  }

  const doos = versleutel(laadSleutel(gegevensmap), waarde);
  handle.raw
    .prepare(
      `INSERT INTO secrets (key, ciphertext, iv, tag, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         iv         = excluded.iv,
         tag        = excluded.tag,
         updated_at = excluded.updated_at`,
    )
    .run(naam, doos.ciphertext, doos.iv, doos.tag);
}

/** Haalt een geheim op, of `null` als het er niet is. */
export function leesGeheim(
  handle: DatabaseHandle,
  gegevensmap: string,
  naam: string,
): string | null {
  const rij = handle.raw
    .prepare('SELECT ciphertext, iv, tag FROM secrets WHERE key = ?')
    .get(naam) as Versleuteld | undefined;

  if (rij === undefined) return null;
  return ontsleutel(laadSleutel(gegevensmap), rij);
}

export function verwijderGeheim(handle: DatabaseHandle, naam: string): void {
  handle.raw.prepare('DELETE FROM secrets WHERE key = ?').run(naam);
}

/** Of er een geheim staat, zonder het te ontsleutelen. Voor de instellingen. */
export function heeftGeheim(handle: DatabaseHandle, naam: string): boolean {
  const rij = handle.raw.prepare('SELECT 1 AS er FROM secrets WHERE key = ?').get(naam);
  return rij !== undefined;
}

/**
 * Toont een sleutel zoals hij in het scherm mag staan: alleen de laatste vier
 * tekens. Zo ziet de beheerder wélke sleutel er staat zonder hem te lezen.
 */
export function maskeer(waarde: string): string {
  const staart = waarde.slice(-4);
  return staart === '' ? '' : `••••••••${staart}`;
}

/** Vergelijkt twee geheimen zonder looptijdverschil. */
export function gelijk(a: string, b: string): boolean {
  const links = Buffer.from(a, 'utf8');
  const rechts = Buffer.from(b, 'utf8');
  return links.length === rechts.length && timingSafeEqual(links, rechts);
}
