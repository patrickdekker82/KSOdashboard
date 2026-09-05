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
import type { EntityDefinition } from './registry.ts';

type Rij = Record<string, unknown>;

/** Managers en beheerders plannen voor de hele afdeling; de rest voor zichzelf. */
function magVoorIedereen(rol: UserRole): boolean {
  return rol === 'manager' || rol === 'admin';
}

export type EigenRegistratieOpties = {
  /** Hoe de registratie in een foutmelding heet, bijvoorbeeld "verlofaanvraag". */
  wat: string;
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
  return ({ gebruiker, invoer, bestaand, actie }) => {
    const iedereen = magVoorIedereen(gebruiker.role);

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
