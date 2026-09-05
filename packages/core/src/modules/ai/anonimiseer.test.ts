/**
 * Tests voor het anonimiseren (hoofdstuk 6.8).
 *
 * Dit is het stukje code dat bepaalt wat er de deur uit gaat. Als het faalt,
 * lekt er een klantnaam naar een API. Daarom wordt hier niet alleen getest of
 * het "werkt", maar vooral of het op de vervelende gevallen niet stukgaat:
 * deelnamen, hoofdletters, tussenvoegsels en verzonnen plaatshouders.
 */
import { describe, expect, it } from 'vitest';
import {
  anonimiseer,
  bouwWoordenboek,
  herstel,
  onbekendePlaatshouders,
  restantenPersoonsgegevens,
  type Bekend,
} from './anonimiseer.ts';

/** Kort schrijven: woordenboek bouwen én toepassen. */
function verberg(tekst: string, bekend: Bekend[] = []): { uit: string; boek: ReturnType<typeof bouwWoordenboek> } {
  const boek = bouwWoordenboek(tekst, bekend);
  return { uit: anonimiseer(tekst, boek), boek };
}

describe('bekende waarden', () => {
  it('vervangt een naam en zet hem netjes terug', () => {
    const tekst = 'Mevrouw De Vries komt dinsdag langs in de showroom.';
    const { uit, boek } = verberg(tekst, [{ soort: 'PERSOON', waarde: 'De Vries' }]);

    expect(uit).toBe('Mevrouw «PERSOON_1» komt dinsdag langs in de showroom.');
    expect(herstel(uit, boek)).toBe(tekst);
  });

  it('neemt de langste naam eerst, zodat de achternaam niet blijft staan', () => {
    const bekend: Bekend[] = [
      { soort: 'PERSOON', waarde: 'Jan' },
      { soort: 'PERSOON', waarde: 'Jan van der Berg' },
    ];
    const { uit } = verberg('Jan van der Berg belde over de keuken.', bekend);

    expect(uit).toBe('«PERSOON_1» belde over de keuken.');
  });

  it('laat een deelwoord met rust', () => {
    // "Jan" zit in "Janssen"; dat mag geen plaatshouder opleveren.
    const { uit } = verberg('Janssen is niet Jan.', [{ soort: 'PERSOON', waarde: 'Jan' }]);

    expect(uit).toBe('Janssen is niet «PERSOON_1».');
  });

  it('trekt zich niets aan van hoofdletters, maar herstelt de oorspronkelijke schrijfwijze', () => {
    const boek = bouwWoordenboek('Bakker', [{ soort: 'PERSOON', waarde: 'Bakker' }]);
    const uit = anonimiseer('bakker en BAKKER en Bakker', boek);

    expect(uit).toBe('«PERSOON_1» en «PERSOON_1» en «PERSOON_1»');
    expect(herstel(uit, boek)).toBe('Bakker en Bakker en Bakker');
  });

  it('geeft dezelfde waarde overal dezelfde plaatshouder', () => {
    const { uit } = verberg('Bakker belde. Bakker mailde ook.', [
      { soort: 'PERSOON', waarde: 'Bakker' },
    ]);

    expect(uit).toBe('«PERSOON_1» belde. «PERSOON_1» mailde ook.');
  });

  it('negeert waarden die niet in de tekst staan', () => {
    const boek = bouwWoordenboek('Niets bijzonders.', [{ soort: 'PERSOON', waarde: 'Bakker' }]);

    expect(boek.vervangingen).toHaveLength(0);
  });

  it('slaat waarden van twee tekens over — te veel valse treffers', () => {
    const boek = bouwWoordenboek('Jo was er.', [{ soort: 'PERSOON', waarde: 'Jo' }]);

    expect(boek.vervangingen).toHaveLength(0);
  });
});

describe('vangnet zonder database', () => {
  it('pakt een e-mailadres', () => {
    const { uit } = verberg('Stuur het naar p.dekker@voorbeeld.nl voor vrijdag.');

    expect(uit).toBe('Stuur het naar «EMAIL_1» voor vrijdag.');
  });

  it('pakt een mobiel en een vast nummer', () => {
    const { uit } = verberg('Bel 06-12345678 of anders 030 1234567.');

    expect(uit).toBe('Bel «TELEFOON_1» of anders «TELEFOON_2».');
  });

  it('pakt een internationaal nummer', () => {
    const { uit } = verberg('Bereikbaar op +31 6 12345678.');

    expect(uit).toBe('Bereikbaar op «TELEFOON_1».');
  });

  it('pakt een IBAN vóór het telefoonpatroon eraan komt', () => {
    const { uit } = verberg('Rekening NL91 ABNA 0417 1643 00 staat open.');

    expect(uit).toBe('Rekening «IBAN_1» staat open.');
  });

  it('pakt straat met huisnummer en de postcode', () => {
    const { uit } = verberg('Bezoek Dorpsstraat 12, 3431 CB Nieuwegein.');

    expect(uit).toBe('Bezoek «ADRES_1», «ADRES_2» Nieuwegein.');
  });

  it('laat de woorden vóór de straatnaam met rust', () => {
    // Een patroon dat ook de woorden ervoor meeneemt zou "Bezoek" opslokken.
    const { uit } = verberg('Hij woont aan de Goghlaan 3-B.');

    expect(uit).toBe('Hij woont aan de «ADRES_1».');
  });

  it('laat een straatnaam uit meer woorden aan de database over', () => {
    // Het vangnet pakt alleen het laatste woord; de volledige straatnaam komt
    // uit `address_street` en loopt dus via de bekende waarden.
    const tekst = 'Hij woont aan de Van Goghlaan 3-B.';

    expect(verberg(tekst).uit).toBe('Hij woont aan de Van «ADRES_1».');
    expect(verberg(tekst, [{ soort: 'ADRES', waarde: 'Van Goghlaan 3-B' }]).uit).toBe(
      'Hij woont aan de «ADRES_1».',
    );
  });
});

describe('herstellen', () => {
  it('zet alle soorten terug', () => {
    const tekst =
      'Mevrouw De Vries, Dorpsstraat 12, bereikbaar op 06-12345678 of devries@voorbeeld.nl.';
    const { uit, boek } = verberg(tekst, [{ soort: 'PERSOON', waarde: 'De Vries' }]);

    expect(uit).not.toContain('De Vries');
    expect(uit).not.toContain('12345678');
    expect(herstel(uit, boek)).toBe(tekst);
  });

  it('laat een plaatshouder staan die het model zelf verzonnen heeft', () => {
    const boek = bouwWoordenboek('De Vries', [{ soort: 'PERSOON', waarde: 'De Vries' }]);
    const antwoord = 'Beste «PERSOON_1», met vriendelijke groet aan «PERSOON_9».';

    expect(herstel(antwoord, boek)).toBe(
      'Beste De Vries, met vriendelijke groet aan «PERSOON_9».',
    );
    expect(onbekendePlaatshouders(antwoord, boek)).toEqual(['«PERSOON_9»']);
  });

  it('is bestand tegen een lege tekst', () => {
    const boek = bouwWoordenboek('', []);

    expect(anonimiseer('', boek)).toBe('');
    expect(herstel('', boek)).toBe('');
  });
});

describe('vangrail', () => {
  it('meldt niets meer als alles vervangen is', () => {
    const tekst = 'De Vries, devries@voorbeeld.nl, 06-12345678, Dorpsstraat 12.';
    const { uit, boek } = verberg(tekst, [{ soort: 'PERSOON', waarde: 'De Vries' }]);

    expect(restantenPersoonsgegevens(uit, boek)).toEqual([]);
  });

  it('meldt wél iets als er een naam blijft staan', () => {
    const boek = bouwWoordenboek('De Vries', [{ soort: 'PERSOON', waarde: 'De Vries' }]);

    expect(restantenPersoonsgegevens('Groet aan De Vries', boek)).toContain('De Vries');
  });

  it('meldt een e-mailadres dat er later bij is gekomen', () => {
    const boek = bouwWoordenboek('Niets.', []);

    expect(restantenPersoonsgegevens('Mail naar iemand@elders.nl', boek)).toEqual([
      'iemand@elders.nl',
    ]);
  });
});

describe('idempotentie', () => {
  it('anonimiseert een al geanonimiseerde tekst niet nóg een keer', () => {
    const tekst = 'De Vries mailt via devries@voorbeeld.nl.';
    const { uit, boek } = verberg(tekst, [{ soort: 'PERSOON', waarde: 'De Vries' }]);

    expect(anonimiseer(uit, boek)).toBe(uit);
  });
});
