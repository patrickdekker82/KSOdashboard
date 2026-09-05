/**
 * Een CSV schrijven (hoofdstuk 11).
 *
 * Met puntkomma's, en met een BOM ervoor. Beide om dezelfde reden: een
 * Nederlandse Excel opent een komma-CSV als één kolom, en zonder BOM maakt hij
 * van "Ré" iets onleesbaars. Dat is geen elegantie, dat is wat er op de
 * werkplek gebeurt.
 *
 * De lezer in `modules/import/csv.ts` raadt het scheidingsteken; hier wordt het
 * vastgezet, want we schrijven voor Excel en niet voor een parser.
 */
import { toonWaarde } from './docx.ts';
import type { Kolom } from './xlsx.ts';

/** De byte-order-mark die Excel nodig heeft om UTF-8 te herkennen. */
export const BOM = '\uFEFF';

/**
 * Zet één waarde tussen aanhalingstekens als dat nodig is.
 *
 * Volgens RFC 4180: aanhalingstekens erin worden verdubbeld. Ook een waarde
 * met een regeleinde erin moet ingepakt, anders schuift de rest van het
 * bestand een regel op.
 */
export function veld(waarde: string, scheiding: string): string {
  if (waarde === '') return '';
  if (
    waarde.includes(scheiding) ||
    waarde.includes('"') ||
    waarde.includes('\n') ||
    waarde.includes('\r')
  ) {
    return `"${waarde.replace(/"/g, '""')}"`;
  }
  return waarde;
}

export type CsvOpties = {
  /** Standaard een puntkomma, want daar rekent een Nederlandse Excel op. */
  scheiding?: string;
  /** Standaard aan; zonder BOM gaan accenten in Excel stuk. */
  bom?: boolean;
};

export function maakCsv(
  kolommen: Kolom[],
  rijen: Array<Record<string, unknown>>,
  opties: CsvOpties = {},
): string {
  const scheiding = opties.scheiding ?? ';';

  const regels = [
    kolommen.map((kolom) => veld(kolom.kop, scheiding)).join(scheiding),
    ...rijen.map((rij) =>
      kolommen
        .map((kolom) => veld(toonWaarde(rij[kolom.sleutel], kolom.type), scheiding))
        .join(scheiding),
    ),
  ];

  // CRLF, want een CSV die in Kladblok op één regel staat levert altijd een
  // telefoontje op.
  return `${opties.bom === false ? '' : BOM}${regels.join('\r\n')}\r\n`;
}
