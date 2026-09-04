/**
 * Validatie van veldwaarden (hoofdstuk 3.2).
 *
 * Één plek waar bepaald wordt wat er in een veld mag, gebruikt door de
 * CRUD-factory bij het opslaan. De renderer valideert dezelfde regels vooraf,
 * maar de kern is degene die het afdwingt.
 */
import {
  CUSTOM_FIELD_KEY_PATTERN,
  FIELD_TYPE_INFO,
  type FieldDefinition,
  type FieldType,
  type FieldValidation,
} from '@showroom/shared';
import { evaluateFormula, FormuleFout } from './formula.ts';

export type VeldFout = { veld: string; label: string; melding: string };

export type ValidatieResultaat =
  | { ok: true; waarden: Record<string, unknown> }
  | { ok: false; fouten: VeldFout[] };

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const TIJD = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATUMTIJD = /^\d{4}-\d{2}-\d{2}[T ]([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TELEFOON = /^[+()\d][\d\s()+.-]{5,24}$/;
const KLEUR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Een door de beheerder ingevoerd patroon is een reguliere expressie van een
 * mens, niet van een programmeur. Om te voorkomen dat een ongelukkig patroon de
 * kern laat vastlopen (catastrofaal terugkrabbelen), begrenzen we zowel de
 * lengte van het patroon als die van de te toetsen tekst.
 */
const MAX_PATROON_LENGTE = 200;
const MAX_TE_TOETSEN_LENGTE = 1000;

function toetsPatroon(patroon: string, waarde: string): boolean {
  if (patroon.length > MAX_PATROON_LENGTE) return true; // te lang: niet toetsen
  if (waarde.length > MAX_TE_TOETSEN_LENGTE) return false;
  try {
    return new RegExp(patroon).test(waarde);
  } catch {
    // Een ongeldig patroon mag geen record blokkeren; de beheerder ziet het
    // bij het opslaan van de velddefinitie.
    return true;
  }
}

function leeg(waarde: unknown): boolean {
  return (
    waarde === null ||
    waarde === undefined ||
    waarde === '' ||
    (Array.isArray(waarde) && waarde.length === 0)
  );
}

/** Zet een binnenkomende waarde om naar het type dat het veld bewaart. */
export function coerceValue(type: FieldType, waarde: unknown): unknown {
  if (leeg(waarde)) return null;

  switch (FIELD_TYPE_INFO[type].storedAs) {
    case 'number': {
      if (typeof waarde === 'number') return waarde;
      // Nederlandse invoer: "1.234,56" wordt 1234.56.
      const tekst = String(waarde).trim().replace(/\./g, '').replace(',', '.');
      const getal = Number(tekst);
      return Number.isNaN(getal) ? waarde : getal;
    }
    case 'boolean':
      if (typeof waarde === 'boolean') return waarde;
      return ['true', '1', 'ja', 'waar'].includes(String(waarde).toLowerCase());
    case 'array':
      return Array.isArray(waarde) ? waarde : [waarde];
    case 'string':
      return typeof waarde === 'string' ? waarde : String(waarde);
  }
}

/** Toegestane keuzes voor een select of multiselect. */
export type OptieBron = (definition: FieldDefinition) => string[] | null;

function controleerType(
  definition: FieldDefinition,
  waarde: unknown,
  opties: OptieBron,
): string | null {
  const regels: FieldValidation = definition.validation ?? {};

  switch (definition.type) {
    case 'text':
    case 'textarea':
    case 'richtext':
    case 'file': {
      const tekst = String(waarde);
      if (regels.minLength !== undefined && tekst.length < regels.minLength) {
        return `Minimaal ${regels.minLength} tekens.`;
      }
      if (regels.maxLength !== undefined && tekst.length > regels.maxLength) {
        return `Maximaal ${regels.maxLength} tekens.`;
      }
      if (regels.pattern && !toetsPatroon(regels.pattern, tekst)) {
        return regels.patternMessage ?? 'De waarde heeft niet de verwachte vorm.';
      }
      return null;
    }

    case 'number':
    case 'currency':
    case 'percent':
    case 'integer': {
      if (typeof waarde !== 'number' || Number.isNaN(waarde)) return 'Vul een getal in.';
      if (!Number.isFinite(waarde)) return 'Dit getal is te groot.';
      if (definition.type === 'integer' && !Number.isInteger(waarde)) {
        return 'Vul een heel getal in, zonder decimalen.';
      }
      if (regels.min !== undefined && waarde < regels.min) return `Minimaal ${regels.min}.`;
      if (regels.max !== undefined && waarde > regels.max) return `Maximaal ${regels.max}.`;
      return null;
    }

    case 'date':
      return DATUM.test(String(waarde)) ? null : 'Vul een datum in (jjjj-mm-dd).';
    case 'datetime':
      return DATUMTIJD.test(String(waarde)) ? null : 'Vul een datum en tijd in.';
    case 'time':
      return TIJD.test(String(waarde)) ? null : 'Vul een tijd in (uu:mm).';

    case 'boolean':
      return typeof waarde === 'boolean' ? null : 'Kies ja of nee.';

    case 'select': {
      const toegestaan = opties(definition);
      if (toegestaan === null) return null;
      return toegestaan.includes(String(waarde))
        ? null
        : 'Deze keuze staat niet (meer) in de lijst.';
    }

    case 'multiselect': {
      const toegestaan = opties(definition);
      if (!Array.isArray(waarde)) return 'Kies een of meer waarden.';
      if (toegestaan === null) return null;
      const onbekend = waarde.map(String).filter((keuze) => !toegestaan.includes(keuze));
      return onbekend.length === 0
        ? null
        : `Deze keuzes staan niet in de lijst: ${onbekend.join(', ')}.`;
    }

    case 'relation':
    case 'user':
      return Number.isInteger(waarde) && (waarde as number) > 0
        ? null
        : 'Kies een record uit de lijst.';

    case 'email':
      return EMAIL.test(String(waarde)) ? null : 'Vul een geldig e-mailadres in.';
    case 'phone':
      return TELEFOON.test(String(waarde)) ? null : 'Vul een geldig telefoonnummer in.';
    case 'url':
      // Alleen https en http; geen javascript: of file: in een klikbaar veld.
      return /^https?:\/\/\S+$/i.test(String(waarde))
        ? null
        : 'Vul een webadres in dat begint met http:// of https://.';
    case 'color':
      return KLEUR.test(String(waarde)) ? null : 'Kies een kleur (bijvoorbeeld #2563eb).';

    case 'formula':
      // Wordt berekend, nooit ingevoerd; hier komen we alleen als iemand het
      // toch probeert op te sturen.
      return 'Een formuleveld wordt berekend en kan niet worden ingevuld.';
  }
}

/**
 * Valideert de maatwerkvelden van één record.
 *
 * `binnen` bevat alleen de velden die de aanroeper wil wijzigen; `bestaand`
 * is wat er al stond, zodat een verplicht veld dat niet in deze wijziging zit
 * niet ten onrechte als leeg wordt gezien.
 */
export function validateCustomFields(
  definities: readonly FieldDefinition[],
  binnen: Record<string, unknown>,
  opties: OptieBron = () => null,
  bestaand: Record<string, unknown> = {},
): ValidatieResultaat {
  const fouten: VeldFout[] = [];
  const waarden: Record<string, unknown> = { ...bestaand };

  const perSleutel = new Map(
    definities
      .filter((definition) => definition.storage === 'json' && !definition.archivedAt)
      .map((definition) => [definition.fieldKey, definition]),
  );

  // Onbekende sleutels weigeren we: anders groeit custom_fields ongemerkt vol
  // met resten van verwijderde velden en typefouten.
  for (const sleutel of Object.keys(binnen)) {
    if (!perSleutel.has(sleutel)) {
      fouten.push({
        veld: sleutel,
        label: sleutel,
        melding: CUSTOM_FIELD_KEY_PATTERN.test(sleutel)
          ? 'Dit maatwerkveld bestaat niet (meer) voor deze entiteit.'
          : 'Onbekend veld.',
      });
    }
  }

  for (const definition of perSleutel.values()) {
    const aangeleverd = Object.hasOwn(binnen, definition.fieldKey);

    if (definition.type === 'formula') {
      // Een formule wordt hier niet opgeslagen; hij wordt bij het lezen berekend.
      if (aangeleverd && !leeg(binnen[definition.fieldKey])) {
        fouten.push({
          veld: definition.fieldKey,
          label: definition.label,
          melding: 'Een formuleveld wordt berekend en kan niet worden ingevuld.',
        });
      }
      delete waarden[definition.fieldKey];
      continue;
    }

    const ruw = aangeleverd ? binnen[definition.fieldKey] : bestaand[definition.fieldKey];
    const waarde = coerceValue(definition.type, ruw);

    if (leeg(waarde)) {
      if (definition.required) {
        fouten.push({
          veld: definition.fieldKey,
          label: definition.label,
          melding: `"${definition.label}" is verplicht.`,
        });
      }
      if (aangeleverd) delete waarden[definition.fieldKey];
      continue;
    }

    const melding = controleerType(definition, waarde, opties);
    if (melding) {
      fouten.push({ veld: definition.fieldKey, label: definition.label, melding });
      continue;
    }

    waarden[definition.fieldKey] = waarde;
  }

  return fouten.length > 0 ? { ok: false, fouten } : { ok: true, waarden };
}

/**
 * Rekent de formulevelden van een record uit.
 *
 * Een formule die niet uitkomt levert `null` op met een uitleg ernaast, in
 * plaats van het hele record te laten mislukken: één kapotte formule mag een
 * lijst niet onbruikbaar maken.
 */
export function computeFormulaFields(
  definities: readonly FieldDefinition[],
  record: Record<string, unknown>,
): { waarden: Record<string, unknown>; fouten: Record<string, string> } {
  const waarden: Record<string, unknown> = {};
  const fouten: Record<string, string> = {};

  const context: Record<string, never> = Object.create(null);
  for (const [sleutel, waarde] of Object.entries(record)) {
    if (waarde === null || ['string', 'number', 'boolean'].includes(typeof waarde)) {
      (context as Record<string, unknown>)[sleutel] = waarde;
    }
  }

  for (const definition of definities) {
    if (definition.type !== 'formula' || definition.archivedAt) continue;
    const expressie = definition.validation?.expression;
    if (!expressie) {
      waarden[definition.fieldKey] = null;
      continue;
    }
    try {
      waarden[definition.fieldKey] = evaluateFormula(expressie, context);
    } catch (error) {
      waarden[definition.fieldKey] = null;
      fouten[definition.fieldKey] =
        error instanceof FormuleFout ? error.message : 'De formule kon niet worden uitgerekend.';
    }
  }

  return { waarden, fouten };
}
