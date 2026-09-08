/**
 * Bewakers voor de generieke CRUD-factory.
 *
 * De factory kent per entiteit alleen kolommen en een rol. Dat is genoeg voor
 * een klant of een discipline, maar niet voor een registratie die aan één
 * medewerker hangt: verlof en inzet elders horen bij een persoon, en er zit een
 * goedkeuringsstroom omheen (hoofdstuk 6.4.3).
 *
 * Zonder deze bewaker kan iedere ingelogde gebruiker verlof voor een collega
 * boeken, en — erger — zijn eigen aanvraag meteen op `goedgekeurd` zetten. De
 * endpoints `/approve` en `/reject` eisen wel de rol manager, maar een gewone
 * POST of PATCH liep daar zo omheen.
 */
import type { UserRole } from '@showroom/shared';
import { ApiError } from '../../api-error.ts';
import type { DatabaseHandle } from '../../db/client.ts';
import type { EntityDefinition } from './registry.ts';

type Rij = Record<string, unknown>;

/**
 * Wie voor de hele afdeling mag plannen.
 *
 * Managers en beheerders via hun rol, en daarnaast iedereen met het vinkje
 * "mag verlof en inzet voor collega's invullen". Dat vinkje bestaat omdat er
 * vaak één iemand de planning bijhoudt zonder manager te zijn; die moest
 * anders de hele managerrol krijgen.
 */
function magVoorIedereen(gebruiker: { role: UserRole; magVerlofBeheren?: boolean }): boolean {
  return (
    gebruiker.role === 'manager' || gebruiker.role === 'admin' || gebruiker.magVerlofBeheren === true
  );
}

/**
 * Leest of collega's zelf mogen invoeren. Ontbreekt de instelling, dan mag het:
 * een bestaande installatie hoort niet stiller te worden door een nieuwe sleutel.
 */
function zelfAanvragenMag(handle: DatabaseHandle, sleutel: string): boolean {
  const rij = handle.raw.prepare('SELECT value FROM settings WHERE key = ?').get(sleutel) as
    | { value: string }
    | undefined;
  if (!rij) return true;
  try {
    return JSON.parse(rij.value) !== false;
  } catch {
    return true;
  }
}

export type EigenRegistratieOpties = {
  /** Hoe de registratie in een foutmelding heet, bijvoorbeeld "verlofaanvraag". */
  wat: string;
  /**
   * Sleutel van de instelling die zegt of collega's zelf mogen invoeren. Weg
   * laten betekent: altijd toegestaan.
   */
  zelfAanvragenInstelling?: string;
  /**
   * Zet de statuskolom buiten bereik van de gewone gebruiker. De status
   * verandert dan alleen nog via de goedkeuringsstroom.
   */
  statusViaStroom?: boolean;
};

/**
 * Laat een gebruiker alleen zijn eigen registraties beheren, tenzij hij manager
 * of beheerder is. Vult bij het aanmaken de medewerker in als die ontbreekt.
 */
export function eigenRegistratie(
  opties: EigenRegistratieOpties,
): NonNullable<EntityDefinition['beforeWrite']> {
  return ({ handle, gebruiker, invoer, bestaand, actie }) => {
    const iedereen = magVoorIedereen(gebruiker);

    /*
     * Sommige afdelingen willen niet dat collega's zelf iets aanvragen: één
     * iemand houdt de planning bij en de rest meldt het mondeling. Staat de
     * instelling uit, dan kan alleen wie het recht heeft nog invoeren.
     *
     * Server-side, niet alleen het formulier verbergen: een scherm verbergen
     * is een suggestie, geen regel.
     */
    if (opties.zelfAanvragenInstelling !== undefined && !iedereen && actie === 'aangemaakt') {
      if (!zelfAanvragenMag(handle, opties.zelfAanvragenInstelling)) {
        throw new ApiError(
          403,
          'zelf_aanvragen_uit',
          `Op deze afdeling wordt ${opties.wat} niet door uzelf ingevoerd. ` +
            'Geef het door aan wie de planning bijhoudt.',
        );
      }
    }

    // Wie geen medewerker meestuurt, bedoelt zichzelf. Dat scheelt de UI een
    // veld en voorkomt een NOT NULL-fout uit SQLite.
    if (actie === 'aangemaakt' && invoer.user_id === undefined) {
      invoer.user_id = gebruiker.id;
    }

    if (opties.statusViaStroom && !iedereen && invoer.status !== undefined) {
      throw new ApiError(
        403,
        'status_via_stroom',
        `U kunt de status van een ${opties.wat} niet zelf zetten. Een manager keurt hem goed of af; ` +
          'intrekken kan met "Annuleren".',
      );
    }

    if (iedereen) return;

    const doelwit = invoer.user_id === undefined ? undefined : Number(invoer.user_id);
    if (doelwit !== undefined && doelwit !== gebruiker.id) {
      throw new ApiError(
        403,
        'alleen_eigen',
        `U kunt alleen uw eigen ${opties.wat} vastleggen. Vraag een manager om dit voor een collega te doen.`,
      );
    }

    const eigenaar = eigenaarVan(bestaand);
    if (eigenaar !== null && eigenaar !== gebruiker.id) {
      throw new ApiError(
        403,
        'alleen_eigen',
        `Deze ${opties.wat} is van een collega. Alleen een manager kan die wijzigen.`,
      );
    }
  };
}

function eigenaarVan(rij: Rij | null): number | null {
  const waarde = rij?.user_id;
  return typeof waarde === 'number' ? waarde : null;
}
