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

describe('wat er in de praktijk in een notitieveld staat', () => {
  // Deze gevallen komen niet uit mijn hoofd maar uit een proef met echte
  // notitieteksten. Drie ervan gingen mis.
  const KLANT: Bekend[] = [
    { soort: 'PERSOON', waarde: 'Jan de Vries' },
    { soort: 'PERSOON', waarde: 'de Vries' },
    { soort: 'ORGANISATIE', waarde: 'Bouwbedrijf Meesters B.V.' },
    { soort: 'ORGANISATIE', waarde: 'Meesters' },
  ];

  it('verminkt een e-mailadres niet met een kernwoord uit de klantnaam', () => {
    // Dit ging mis: "Meesters" verving eerst het midden van het adres, waarna
    // er "info@«ORGANISATIE_1».nl" stond en het domein alsnog zichtbaar bleef.
    // Daarom gaan de patronen nu vóór de bekende waarden.
    const { uit } = verberg('Zie j.devries@meesters.nl en info@meesters.nl.', KLANT);

    expect(uit).toBe('Zie «EMAIL_1» en «EMAIL_2».');
    expect(uit).not.toContain('meesters');
  });

  it('pakt een BSN, want dat hoort nooit de deur uit te gaan', () => {
    const { uit } = verberg('BSN 123456782 stond per ongeluk in het dossier.');

    expect(uit).toBe('BSN «BSN_1» stond per ongeluk in het dossier.');
  });

  it('laat een willekeurige reeks van negen cijfers met rust', () => {
    // Ordernummers zijn ook negen cijfers. De elfproef scheidt ze; zonder die
    // controle zou elke bestelling als persoonsgegeven worden aangezien.
    const { uit } = verberg('Ordernummer 123456789 is verstuurd.');

    expect(uit).toBe('Ordernummer 123456789 is verstuurd.');
  });

  it('pakt een KvK- en een BTW-nummer', () => {
    const { uit } = verberg('KvK 12345678, BTW NL001234567B01.');

    expect(uit).toBe('«KVK_1», BTW «BTW_1».');
  });

  it('ziet acht losse cijfers zonder het woord KvK niet als KvK-nummer', () => {
    const { uit } = verberg('Factuur 87654321 staat open.');

    expect(uit).toBe('Factuur 87654321 staat open.');
  });

  it('pakt een telefoonnummer met spaties én een aaneengesloten nummer', () => {
    const { uit } = verberg('Contact via 06 12 34 56 78 of 0612345678.');

    expect(uit).toBe('Contact via «TELEFOON_1» of «TELEFOON_2».');
  });

  it('pakt een IBAN zonder spaties', () => {
    const { uit } = verberg('IBAN NL91ABNA0417164300 zonder spaties.');

    expect(uit).toBe('IBAN «IBAN_1» zonder spaties.');
  });

  it('pakt een postcode zonder spatie en een huisnummer met letter', () => {
    const { uit } = verberg('Adres: Dorpsstraat 12a, 3431CB Nieuwegein.');

    expect(uit).toContain('«ADRES_1»');
    expect(uit).not.toContain('Dorpsstraat');
    expect(uit).not.toContain('3431CB');
  });

  it('vervangt de klantnaam ook als er alleen een kernwoord staat', () => {
    const { uit } = verberg('Meesters BV heeft getekend.', KLANT);

    expect(uit).toBe('«ORGANISATIE_1» BV heeft getekend.');
  });

  it('haalt bij een dubbele achternaam in elk geval het bekende deel weg', () => {
    // "Bakker" staat niet in de database, dus die blijft staan. Half
    // geanonimiseerd is hier beter dan niets, en het is eerlijker om dat vast
    // te leggen dan te doen alsof het volledig lukt.
    const { uit } = verberg('Mw. de Vries-Bakker was er ook bij.', KLANT);

    expect(uit).toBe('Mw. «PERSOON_1»-Bakker was er ook bij.');
  });

  it('herkent een roepnaam niet, en dat weten we', () => {
    // "Jantje" voor "Jan" is niet met een regel te vangen. Vastgelegd zodat
    // niemand denkt dat dit wél gedekt is.
    const { uit } = verberg('Jantje wil graag een offerte.', KLANT);

    expect(uit).toBe('Jantje wil graag een offerte.');
  });
});

describe('de vangrail ziet de nieuwe soorten ook', () => {
  it('meldt een BSN dat na het anonimiseren zou blijven staan', () => {
    const boek = bouwWoordenboek('Niets.', []);

    expect(restantenPersoonsgegevens('BSN 123456782', boek)).toContain('123456782');
  });

  it('meldt een KvK-nummer', () => {
    const boek = bouwWoordenboek('Niets.', []);

    expect(restantenPersoonsgegevens('KvK 12345678', boek).length).toBeGreaterThan(0);
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
