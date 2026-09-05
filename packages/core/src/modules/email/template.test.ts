/**
 * Tests voor de sjabloonmotor en het .eml-bestand (hoofdstuk 9).
 *
 * Twee dingen die eerder in dit project zijn misgegaan, staan hier opnieuw op
 * de proef: de opzoeking mag niet langs de prototypeketen lopen (dat gat zat in
 * een eerdere versie van de formule-evaluator), en tekst uit de database moet
 * ontsnapt worden voordat hij in HTML terechtkomt.
 */
import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  plaatshoudersIn,
  vulSjabloonIn,
  zetGroep,
  type SjabloonContext,
} from './template.ts';
import { adres, base64Regels, bouwEml, codeerKop, htmlNaarTekst, rfcDatum } from './eml.ts';

function context(): SjabloonContext {
  const kaart: SjabloonContext = new Map();
  zetGroep(kaart, 'contact', { voornaam: 'Peter', achternaam: 'Meesters', email: null });
  zetGroep(kaart, 'organisatie', { naam: 'Bouwbedrijf Meesters B.V.' });
  zetGroep(kaart, 'offerte', { nummer: 'OF-2026-0001', totaal: '€ 1.923,90' });
  return kaart;
}

describe('sjablonen invullen', () => {
  it('vervangt een plaatshouder door de waarde', () => {
    const uit = vulSjabloonIn('Beste {{contact.voornaam}},', context());
    expect(uit.tekst).toBe('Beste Peter,');
    expect(uit.ontbrekend).toEqual([]);
  });

  it('trekt zich niets aan van spaties en hoofdletters', () => {
    expect(vulSjabloonIn('{{ Contact.Voornaam }}', context()).tekst).toBe('Peter');
  });

  it('vult meerdere plaatshouders in één regel in', () => {
    const uit = vulSjabloonIn(
      'Offerte {{offerte.nummer}} voor {{organisatie.naam}}: {{offerte.totaal}}',
      context(),
    );
    expect(uit.tekst).toBe('Offerte OF-2026-0001 voor Bouwbedrijf Meesters B.V.: € 1.923,90');
  });

  // "Beste ," is erger dan een waarschuwing vooraf.
  it('meldt een plaatshouder die niet ingevuld kan worden', () => {
    const uit = vulSjabloonIn('Beste {{contact.roepnaam}},', context());
    expect(uit.tekst).toBe('Beste ,');
    expect(uit.ontbrekend).toEqual(['contact.roepnaam']);
  });

  it('meldt een lege waarde ook als ontbrekend', () => {
    expect(vulSjabloonIn('{{contact.email}}', context()).ontbrekend).toEqual(['contact.email']);
  });

  it('meldt een onbekende groep', () => {
    expect(vulSjabloonIn('{{leverancier.naam}}', context()).ontbrekend).toEqual([
      'leverancier.naam',
    ]);
  });

  it('meldt dezelfde ontbrekende plaatshouder maar één keer', () => {
    const uit = vulSjabloonIn('{{contact.roepnaam}} en {{contact.roepnaam}}', context());
    expect(uit.ontbrekend).toEqual(['contact.roepnaam']);
  });

  // Dit is het gat dat in een eerdere versie van de formule-evaluator zat.
  it('geeft niets terug voor iets uit de prototypeketen', () => {
    for (const naam of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty']) {
      const uit = vulSjabloonIn(`{{contact.${naam}}}`, context());
      expect(uit.tekst, naam).toBe('');
      expect(uit.ontbrekend, naam).toContain(`contact.${naam}`);
    }
  });

  it('kijkt ook voor de groepsnaam niet in de prototypeketen', () => {
    expect(vulSjabloonIn('{{constructor.naam}}', context()).tekst).toBe('');
  });

  it('laat tekst die geen plaatshouder is met rust', () => {
    expect(vulSjabloonIn('Kosten: {2 x 3} en { { niet } }', context()).tekst).toBe(
      'Kosten: {2 x 3} en { { niet } }',
    );
  });

  it('ontsnapt waarden in de HTML-body', () => {
    const kaart = context();
    zetGroep(kaart, 'organisatie', { naam: 'Jansen & Zn <BV>' });

    const html = vulSjabloonIn('<p>{{organisatie.naam}}</p>', kaart, true);
    expect(html.tekst).toBe('<p>Jansen &amp; Zn &lt;BV&gt;</p>');
  });

  it('ontsnapt niet in het onderwerp', () => {
    const kaart = context();
    zetGroep(kaart, 'organisatie', { naam: 'Jansen & Zn' });
    expect(vulSjabloonIn('Offerte voor {{organisatie.naam}}', kaart, false).tekst).toBe(
      'Offerte voor Jansen & Zn',
    );
  });

  it('somt de plaatshouders van een sjabloon op', () => {
    expect(plaatshoudersIn('{{a.b}} {{c.d}} {{a.b}}')).toEqual(['a.b', 'c.d']);
  });

  it('ontsnapt de vijf tekens die ertoe doen', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});

describe('het .eml-bestand', () => {
  const bericht = {
    van: { adres: 'patrick@showroom.local', naam: 'Patrick Dekker' },
    aan: [{ adres: 'peter@meesters.nl', naam: 'Peter Meesters' }],
    onderwerp: 'Offerte OF-2026-0001',
    tekst: 'Beste Peter,\n\nHierbij de offerte.',
    html: '<p>Beste Peter,</p><p>Hierbij de offerte.</p>',
    datum: new Date('2026-09-07T09:00:00Z'),
  };

  it('zet de koppen erin die een mailclient nodig heeft', () => {
    const eml = bouwEml(bericht);
    expect(eml).toContain('From: Patrick Dekker <patrick@showroom.local>');
    expect(eml).toContain('To: Peter Meesters <peter@meesters.nl>');
    expect(eml).toContain('Subject: Offerte OF-2026-0001');
    expect(eml).toContain('MIME-Version: 1.0');
  });

  // Zonder deze vlag opent Outlook het bestand als verzonden bericht in plaats
  // van als concept, en dan kan de gebruiker het niet meer aanpassen.
  it('markeert het bericht als concept', () => {
    expect(bouwEml(bericht)).toContain('X-Unsent: 1');
  });

  it('gebruikt CRLF als regeleinde', () => {
    const eml = bouwEml(bericht);
    expect(eml).toContain('\r\n');
    expect(eml.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('maakt er multipart van als er HTML is', () => {
    const eml = bouwEml(bericht);
    expect(eml).toContain('multipart/alternative');
    expect(eml).toContain('text/plain; charset=UTF-8');
    expect(eml).toContain('text/html; charset=UTF-8');
  });

  it('houdt het enkelvoudig zonder HTML', () => {
    const eml = bouwEml({ ...bericht, html: null });
    expect(eml).not.toContain('multipart');
    expect(eml).toContain('Content-Type: text/plain; charset=UTF-8');
  });

  it('codeert de body als base64 die weer te lezen is', () => {
    const eml = bouwEml({ ...bericht, html: null });
    const body = eml.split('\r\n\r\n')[1] ?? '';
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe(bericht.tekst);
  });

  it('breekt base64 af op zesenzeventig tekens', () => {
    const lang = base64Regels('x'.repeat(500));
    for (const regel of lang.split('\r\n')) expect(regel.length).toBeLessThanOrEqual(76);
  });

  // Een onderwerp met een euroteken of een trema moet als encoded-word, anders
  // toont Outlook er onzin van.
  it('codeert een onderwerp met tekens buiten ASCII', () => {
    expect(codeerKop('Offerte € 1.000')).toMatch(/^=\?UTF-8\?B\?/);
    expect(codeerKop('Gewoon onderwerp')).toBe('Gewoon onderwerp');
  });

  it('codeert ook een naam in het adres', () => {
    expect(adres({ adres: 'a@b.nl', naam: 'Renée Jansen' })).toMatch(/^=\?UTF-8\?B\?.*\?= <a@b\.nl>$/);
  });

  it('laat een adres zonder naam kaal', () => {
    expect(adres({ adres: 'a@b.nl' })).toBe('a@b.nl');
    expect(adres({ adres: 'a@b.nl', naam: '  ' })).toBe('a@b.nl');
  });

  it('schrijft de datum in de vorm die de norm wil', () => {
    expect(rfcDatum(new Date('2026-09-07T09:05:03Z'))).toBe('Mon, 07 Sep 2026 09:05:03 +0000');
  });

  it('zet meerdere ontvangers achter elkaar', () => {
    const eml = bouwEml({
      ...bericht,
      aan: [{ adres: 'een@x.nl' }, { adres: 'twee@x.nl' }],
      cc: [{ adres: 'cc@x.nl' }],
    });
    expect(eml).toContain('To: een@x.nl, twee@x.nl');
    expect(eml).toContain('Cc: cc@x.nl');
  });
});

describe('html naar platte tekst', () => {
  it('maakt van alinea\'s regels', () => {
    expect(htmlNaarTekst('<p>Beste Peter,</p><p>Groet,<br>Patrick</p>')).toBe(
      'Beste Peter,\n\nGroet,\nPatrick',
    );
  });

  it('maakt van een lijst streepjes', () => {
    expect(htmlNaarTekst('<ul><li>Een</li><li>Twee</li></ul>')).toBe('- Een\n- Twee');
  });

  it('zet HTML-entiteiten terug', () => {
    expect(htmlNaarTekst('<p>Jansen &amp; Zn</p>')).toBe('Jansen & Zn');
  });

  it('haalt tags weg zonder de tekst te verliezen', () => {
    expect(htmlNaarTekst('<div><strong>Vet</strong> en gewoon</div>')).toBe('Vet en gewoon');
  });
});
