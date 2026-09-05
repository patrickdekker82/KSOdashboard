/**
 * Tests voor de Excel- en CSV-lezer (hoofdstuk 11).
 *
 * De xlsx-fixture is een écht bestand, geschreven zoals Excel het zou opslaan:
 * gedeelde teksten, een eigen datumopmaak, een formule met de uitkomst erbij,
 * een ongecomprimeerd onderdeel en een tabblad dat niet `sheet1.xml` heet. Dat
 * laatste is geen gezochte randgeval — Excel hernoemt werkbladbestanden zodra
 * er een tabblad is verwijderd, en een lezer die de verwijzing niet volgt leest
 * dan het verkeerde blad.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { excelDatum, ExcelFout, kolomVan, leesWerkblad } from './xlsx.ts';
import { leesCsv, raadScheidingsteken } from './csv.ts';
import { leesInhoudsopgave, leesOpNaam, ZipFout } from './zip.ts';

const HIER = dirname(fileURLToPath(import.meta.url));
const PLANNING = readFileSync(join(HIER, 'fixtures', 'planning.xlsx'));

describe('zip uitpakken', () => {
  it('leest de inhoudsopgave van een echt xlsx-bestand', () => {
    const namen = leesInhoudsopgave(PLANNING).map((item) => item.naam);
    expect(namen).toContain('xl/workbook.xml');
    expect(namen).toContain('xl/sharedStrings.xml');
    expect(namen).toContain('xl/worksheets/planning.xml');
  });

  it('pakt een gecomprimeerd onderdeel uit', () => {
    const xml = leesOpNaam(PLANNING, 'xl/workbook.xml')!.toString('utf8');
    expect(xml).toContain('Planning 2026');
  });

  // Excel slaat [Content_Types].xml ongecomprimeerd op; wie alleen deflate
  // aankan, struikelt daarover.
  it('pakt ook een onderdeel uit dat niet gecomprimeerd is opgeslagen', () => {
    const xml = leesOpNaam(PLANNING, '[Content_Types].xml')!.toString('utf8');
    expect(xml).toContain('spreadsheetml');
  });

  it('geeft null voor een onderdeel dat er niet in zit', () => {
    expect(leesOpNaam(PLANNING, 'xl/bestaatniet.xml')).toBeNull();
  });

  it('weigert iets dat geen zip is, met uitleg', () => {
    expect(() => leesInhoudsopgave(Buffer.from('dit is gewoon tekst'))).toThrow(ZipFout);
  });
});

describe('werkblad lezen', () => {
  const blad = leesWerkblad(PLANNING);

  it('volgt de verwijzing naar het juiste tabblad', () => {
    expect(blad.naam).toBe('Planning 2026');
  });

  it('leest de kopregel uit de gedeelde teksten', () => {
    expect(blad.rijen[0]).toEqual([
      'Projectnummer',
      'Projectnaam',
      'Plaats',
      'Aantal woningen',
      'Showroom start',
      'Showroom eind',
      'Kopersbegeleider',
      'Opmerking',
    ]);
  });

  it('leest tekst en getallen in de juiste kolom', () => {
    expect(blad.rijen[1]?.[0]).toBe('P26001');
    expect(blad.rijen[1]?.[1]).toBe('Plan Zuidhoek');
    expect(blad.rijen[1]?.[3]).toBe(32);
  });

  it('herkent een datum aan de opmaak van de cel en geeft hem als ISO terug', () => {
    expect(blad.rijen[1]?.[4]).toBe('2026-03-02');
    expect(blad.rijen[1]?.[5]).toBe('2026-05-29');
  });

  // Een lege cel wordt in xlsx gewoon weggelaten. Zonder de celverwijzing te
  // volgen schuift alles erna een kolom op, en dan staat de kopersbegeleider
  // ineens in de kolom van de einddatum.
  it('houdt de kolommen op hun plek als een cel ontbreekt', () => {
    expect(blad.rijen[2]?.[6]).toBe('RB');
    expect(blad.rijen[2]?.[7]).toBeUndefined();
    expect(blad.rijen[3]?.[7]).toBe('onder voorbehoud');
  });

  it('leest van een formule de uitkomst die Excel heeft opgeslagen', () => {
    expect(blad.rijen[4]?.[3]).toBe(74);
  });

  it('leest een tekst die niet in de gedeelde lijst staat', () => {
    expect(blad.rijen[4]?.[0]).toBe('Totaal');
  });

  it('leest een booleaanse cel', () => {
    expect(blad.rijen[4]?.[4]).toBe(true);
  });

  it('geeft een foutcel terug als tekst in plaats van te struikelen', () => {
    expect(blad.rijen[4]?.[5]).toBe('#DIV/0!');
  });

  it('vertelt bij een onbekend tabblad welke er wel zijn', () => {
    expect(() => leesWerkblad(PLANNING, 'Bestaat niet')).toThrow(/Planning 2026/);
  });

  it('legt uit dat een oude .xls niet werkt', () => {
    // Een .xls uit 1997-2003 begint met deze handtekening en is geen zip.
    const oud = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => leesWerkblad(oud)).toThrow(ExcelFout);
    expect(() => leesWerkblad(oud)).toThrow(/\.xlsx/);
  });

  it('weigert een zip die geen werkmap bevat', () => {
    expect(() => leesWerkblad(zipMet({ 'gewoon.txt': 'hallo' }))).toThrow(ExcelFout);
  });
});

describe('excelDatum', () => {
  // Dagnummer 60 is 29 februari 1900: een dag die niet bestaat, maar die Excel
  // wel telt. Alles daarboven moet dus een dag terug.
  it('rekent de schrikkeldagfout van 1900 mee', () => {
    expect(excelDatum(1)).toBe('1900-01-01');
    expect(excelDatum(59)).toBe('1900-02-28');
    expect(excelDatum(61)).toBe('1900-03-01');
  });

  it('rekent hedendaagse datums goed uit', () => {
    expect(excelDatum(45658)).toBe('2025-01-01');
    expect(excelDatum(46023)).toBe('2026-01-01');
  });
});

describe('kolomVan', () => {
  it('rekent kolomletters om naar een nummer', () => {
    expect(kolomVan('A1')).toBe(0);
    expect(kolomVan('Z9')).toBe(25);
    expect(kolomVan('AA1')).toBe(26);
    expect(kolomVan('AB10')).toBe(27);
    expect(kolomVan('BA1')).toBe(52);
  });

  it('geeft null bij iets wat geen celverwijzing is', () => {
    expect(kolomVan('123')).toBeNull();
  });
});

describe('csv lezen', () => {
  it('raadt de puntkomma van een Nederlandse export', () => {
    expect(raadScheidingsteken('a;b;c\n1;2;3')).toBe(';');
  });

  it('raadt de komma van een Engelse export', () => {
    expect(raadScheidingsteken('a,b,c\n1,2,3')).toBe(',');
  });

  // Een regel als: naam;bedrag  →  "Meesters, B.V.";1.250,00
  it('telt scheidingstekens niet mee die tussen aanhalingstekens staan', () => {
    expect(raadScheidingsteken('"Meesters, B.V.";"1.250,00";"x"')).toBe(';');
  });

  it('leest velden tussen aanhalingstekens met scheidingsteken erin', () => {
    expect(leesCsv('naam;plaats\n"Meesters, B.V.";Houten')).toEqual([
      ['naam', 'plaats'],
      ['Meesters, B.V.', 'Houten'],
    ]);
  });

  it('leest een verdubbeld aanhalingsteken als één teken', () => {
    expect(leesCsv('a;b\n"zeg ""hallo""";x')).toEqual([
      ['a', 'b'],
      ['zeg "hallo"', 'x'],
    ]);
  });

  it('laat een regeleinde binnen aanhalingstekens de rij niet afbreken', () => {
    expect(leesCsv('a;b\n"regel 1\nregel 2";x')).toEqual([
      ['a', 'b'],
      ['regel 1\nregel 2', 'x'],
    ]);
  });

  it('leest \\r\\n als één regeleinde', () => {
    expect(leesCsv('a;b\r\n1;2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  // De byte order mark is onzichtbaar maar plakt aan de eerste kolomkop, en dan
  // wordt "Projectnummer" niet meer herkend.
  it('haalt de byte order mark van de eerste kop af', () => {
    expect(leesCsv('\uFEFFProjectnummer;Naam\nP1;X')[0]?.[0]).toBe('Projectnummer');
  });

  it('slaat lege regels over', () => {
    expect(leesCsv('a;b\n\n1;2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('houdt lege velden op hun plek', () => {
    expect(leesCsv('a;b;c\n1;;3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('leest de laatste regel ook zonder afsluitend regeleinde', () => {
    expect(leesCsv('a;b\n1;2')).toHaveLength(2);
  });
});

/** Bouwt een zip in het geheugen, om randgevallen te kunnen testen. */
function zipMet(bestanden: Record<string, string>): Buffer {
  const lokaal: Buffer[] = [];
  const centraal: Buffer[] = [];
  let offset = 0;

  for (const [naam, inhoud] of Object.entries(bestanden)) {
    const naamBytes = Buffer.from(naam, 'utf8');
    const ruw = Buffer.from(inhoud, 'utf8');
    const ingepakt = deflateRawSync(ruw);

    const kop = Buffer.alloc(30);
    kop.writeUInt32LE(0x04034b50, 0);
    kop.writeUInt16LE(20, 4);
    kop.writeUInt16LE(8, 8); // deflate
    kop.writeUInt32LE(0, 14); // crc, niet gecontroleerd door deze lezer
    kop.writeUInt32LE(ingepakt.length, 18);
    kop.writeUInt32LE(ruw.length, 22);
    kop.writeUInt16LE(naamBytes.length, 26);
    lokaal.push(kop, naamBytes, ingepakt);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(ingepakt.length, 20);
    entry.writeUInt32LE(ruw.length, 24);
    entry.writeUInt16LE(naamBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    centraal.push(entry, naamBytes);

    offset += kop.length + naamBytes.length + ingepakt.length;
  }

  const centraalBlok = Buffer.concat(centraal);
  const einde = Buffer.alloc(22);
  einde.writeUInt32LE(0x06054b50, 0);
  einde.writeUInt16LE(Object.keys(bestanden).length, 8);
  einde.writeUInt16LE(Object.keys(bestanden).length, 10);
  einde.writeUInt32LE(centraalBlok.length, 12);
  einde.writeUInt32LE(offset, 16);

  return Buffer.concat([...lokaal, centraalBlok, einde]);
}
