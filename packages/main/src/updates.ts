/**
 * Kijken of er een nieuwe versie klaarstaat (hoofdstuk 12).
 *
 * Bewust géén `electron-updater` en géén stille zelfvervanging. Twee redenen.
 *
 * De eerste is de opdracht: geen externe clouddiensten, geen "phone home". Een
 * updater die uit zichzelf een leveranciersserver bevraagt is precies dat. Hier
 * wijst de beheerder zelf een locatie aan — in de praktijk een map op de
 * netwerkschijf waar de systeembeheerder de installer neerzet — en staat de
 * controle standaard uit.
 *
 * De tweede is de werkplek: een applicatie die zichzelf 's ochtends vervangt
 * terwijl iemand met een klant in de showroom staat, is geen verbetering. Deze
 * module kijkt of er iets nieuwers is, zegt dat, en laat de installer zien. Het
 * dubbelklikken doet de gebruiker zelf; de NSIS-installatie is per gebruiker,
 * dus daar is geen beheerder voor nodig.
 *
 * Het manifest is een JSON-bestand naast de installer:
 *
 *     { "versie": "0.2.0", "bestand": "ShowroomSuite-Setup-0.2.0.exe",
 *       "uitgebracht": "2026-09-07", "opmerkingen": "Wat er veranderd is" }
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export type Manifest = {
  versie: string;
  bestand?: string;
  uitgebracht?: string;
  opmerkingen?: string;
};

export type Updateuitkomst = {
  /** `false` zolang er geen locatie is ingesteld. */
  ingeschakeld: boolean;
  huidigeVersie: string;
  nieuwsteVersie: string | null;
  nieuwerBeschikbaar: boolean;
  /** Het volledige pad naar de installer, als die er staat. */
  installer: string | null;
  uitgebracht: string | null;
  opmerkingen: string | null;
  fout: string | null;
  gecontroleerdOp: string;
};

/**
 * Vergelijkt twee versies volgens semver, zonder bibliotheek.
 *
 * `1` als `a` nieuwer is, `-1` als `b` nieuwer is, `0` als ze gelijk zijn.
 * Een voorloopletter (`v0.2.0`) en een achtervoegsel (`0.2.0-rc1`) worden
 * genegeerd: een release-kandidaat op de netwerkschijf is geen update.
 */
export function vergelijkVersies(a: string, b: string): number {
  const delen = (versie: string): number[] =>
    versie
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]!
      .split('.')
      .map((deel) => {
        const getal = Number.parseInt(deel, 10);
        return Number.isFinite(getal) ? getal : 0;
      });

  const links = delen(a);
  const rechts = delen(b);

  for (let index = 0; index < Math.max(links.length, rechts.length); index += 1) {
    const l = links[index] ?? 0;
    const r = rechts[index] ?? 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

/** Leest en controleert het manifest. Gooit met een Nederlandse uitleg. */
export function leesManifest(inhoud: string): Manifest {
  let gelezen: unknown;
  try {
    gelezen = JSON.parse(inhoud);
  } catch {
    throw new Error('Het versiebestand is geen geldige JSON.');
  }

  const rij = (gelezen ?? {}) as Record<string, unknown>;
  const versie = typeof rij.versie === 'string' ? rij.versie.trim() : '';

  if (!/^v?\d+\.\d+/.test(versie)) {
    throw new Error('In het versiebestand staat geen bruikbaar versienummer.');
  }

  return {
    versie,
    bestand: typeof rij.bestand === 'string' ? rij.bestand : undefined,
    uitgebracht: typeof rij.uitgebracht === 'string' ? rij.uitgebracht : undefined,
    opmerkingen: typeof rij.opmerkingen === 'string' ? rij.opmerkingen : undefined,
  };
}

export const MANIFEST_BESTANDSNAAM = 'versie.json';

/**
 * Kijkt op de ingestelde locatie of er een nieuwere versie staat.
 *
 * `locatie` is een map: een gewoon pad of een UNC-pad (`\\\\server\\share\\map`).
 * Er wordt niets over het netwerk opgehaald behalve het lezen van die map, en
 * dat doet Windows zelf — er gaat geen HTTP-verzoek de deur uit.
 */
export function controleerUpdate(locatie: string, huidigeVersie: string): Updateuitkomst {
  const basis: Updateuitkomst = {
    ingeschakeld: locatie.trim() !== '',
    huidigeVersie,
    nieuwsteVersie: null,
    nieuwerBeschikbaar: false,
    installer: null,
    uitgebracht: null,
    opmerkingen: null,
    fout: null,
    gecontroleerdOp: new Date().toISOString(),
  };

  if (!basis.ingeschakeld) return basis;

  if (!isAbsolute(locatie) && !locatie.startsWith('\\\\')) {
    return { ...basis, fout: 'Geef een volledig pad op, bijvoorbeeld \\\\server\\software\\showroom.' };
  }

  const manifestpad = join(locatie, MANIFEST_BESTANDSNAAM);

  try {
    if (!existsSync(manifestpad)) {
      return {
        ...basis,
        fout: `Op ${locatie} staat geen ${MANIFEST_BESTANDSNAAM}. Klopt het pad, en is de schijf bereikbaar?`,
      };
    }

    const manifest = leesManifest(readFileSync(manifestpad, 'utf8'));
    const nieuwer = vergelijkVersies(manifest.versie, huidigeVersie) > 0;

    let installer: string | null = null;
    if (manifest.bestand !== undefined) {
      const kandidaat = join(locatie, manifest.bestand);
      if (existsSync(kandidaat) && statSync(kandidaat).isFile()) installer = kandidaat;
    }

    return {
      ...basis,
      nieuwsteVersie: manifest.versie,
      nieuwerBeschikbaar: nieuwer,
      installer,
      uitgebracht: manifest.uitgebracht ?? null,
      opmerkingen: manifest.opmerkingen ?? null,
      fout:
        nieuwer && installer === null
          ? `Versie ${manifest.versie} is aangekondigd, maar het installatiebestand staat er niet naast.`
          : null,
    };
  } catch (fout) {
    return { ...basis, fout: fout instanceof Error ? fout.message : String(fout) };
  }
}
