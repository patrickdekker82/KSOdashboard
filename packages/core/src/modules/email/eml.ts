/**
 * Een bericht als .eml-bestand (RFC 5322 met MIME).
 *
 * Dit is de reden dat de applicatie geen OAuth naar Microsoft nodig heeft om
 * te kunnen mailen. Een .eml opent in Outlook — en in elke andere mailclient —
 * als een klaargezet concept: de gebruiker leest het na, past aan wat hij wil
 * en drukt zelf op verzenden. Er verlaat niets de machine buiten de mailclient
 * die er al staat.
 *
 * Wat hier telt is de codering. Een onderwerp met "ë" of "€" moet als
 * encoded-word (RFC 2047), en de body als base64 met regels van hoogstens 76
 * tekens, anders toont Outlook er onzin van. Regeleindes zijn CRLF; dat is
 * geen stijlkwestie maar de norm, en sommige clients struikelen over LF.
 */

export type EmlBericht = {
  van: { adres: string; naam?: string | null };
  aan: Array<{ adres: string; naam?: string | null }>;
  cc?: Array<{ adres: string; naam?: string | null }>;
  onderwerp: string;
  tekst: string;
  html?: string | null;
  /** Wanneer het bericht is opgesteld; injecteerbaar voor de tests. */
  datum?: Date;
};

const CRLF = '\r\n';

/** Alles buiten de printbare ASCII moet gecodeerd, plus "?" en "_" in een woord. */
function heeftNietAscii(waarde: string): boolean {
  return /[^ -~]/.test(waarde);
}

/**
 * Codeert een kopregel volgens RFC 2047 als daar reden toe is.
 *
 * Base64 en niet quoted-printable: dat scheelt een tabel met uitzonderingen,
 * en voor een onderwerpregel maakt de lengte niet uit.
 */
export function codeerKop(waarde: string): string {
  if (!heeftNietAscii(waarde)) return waarde;
  return `=?UTF-8?B?${Buffer.from(waarde, 'utf8').toString('base64')}?=`;
}

/** "Jan Jansen" <jan@example.nl> — met de naam gecodeerd als dat moet. */
export function adres(entry: { adres: string; naam?: string | null }): string {
  const naam = entry.naam?.trim();
  if (!naam) return entry.adres;
  return `${codeerKop(naam)} <${entry.adres}>`;
}

/** Base64 in regels van 76 tekens, zoals de norm voorschrijft. */
export function base64Regels(inhoud: string): string {
  const gecodeerd = Buffer.from(inhoud, 'utf8').toString('base64');
  const regels: string[] = [];
  for (let index = 0; index < gecodeerd.length; index += 76) {
    regels.push(gecodeerd.slice(index, index + 76));
  }
  return regels.join(CRLF);
}

/** De datum in de vorm die RFC 5322 wil: "Mon, 07 Sep 2026 09:00:00 +0000". */
export function rfcDatum(moment: Date): string {
  const dagen = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maanden = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  const twee = (getal: number): string => String(getal).padStart(2, '0');
  return (
    `${dagen[moment.getUTCDay()]}, ${twee(moment.getUTCDate())} ` +
    `${maanden[moment.getUTCMonth()]} ${moment.getUTCFullYear()} ` +
    `${twee(moment.getUTCHours())}:${twee(moment.getUTCMinutes())}:${twee(moment.getUTCSeconds())} +0000`
  );
}

/**
 * Bouwt het .eml-bestand.
 *
 * Met HTML wordt het multipart/alternative: de mailclient kiest zelf de
 * opgemaakte of de platte versie. Zonder HTML blijft het een enkelvoudig
 * tekstbericht, want een multipart met één deel is nodeloos ingewikkeld.
 */
export function bouwEml(bericht: EmlBericht): string {
  const moment = bericht.datum ?? new Date();
  const grens = `----showroom-${Buffer.from(String(moment.getTime())).toString('hex').slice(0, 16)}`;

  const koppen = [
    `Date: ${rfcDatum(moment)}`,
    `From: ${adres(bericht.van)}`,
    `To: ${bericht.aan.map(adres).join(', ')}`,
    ...(bericht.cc && bericht.cc.length > 0 ? [`Cc: ${bericht.cc.map(adres).join(', ')}`] : []),
    `Subject: ${codeerKop(bericht.onderwerp)}`,
    'MIME-Version: 1.0',
    // Zonder deze vlag opent Outlook het bestand als verzonden bericht in
    // plaats van als concept, en dan kan de gebruiker het niet meer aanpassen.
    'X-Unsent: 1',
  ];

  if (!bericht.html) {
    return [
      ...koppen,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Regels(bericht.tekst),
      '',
    ].join(CRLF);
  }

  return [
    ...koppen,
    `Content-Type: multipart/alternative; boundary="${grens}"`,
    '',
    `--${grens}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Regels(bericht.tekst),
    '',
    `--${grens}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Regels(bericht.html),
    '',
    `--${grens}--`,
    '',
  ].join(CRLF);
}

/** Maakt van HTML een leesbare platte tekst, voor het tekstdeel van de mail. */
export function htmlNaarTekst(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    // Een alinea eindigt met een witregel; een lijstitem of tabelrij niet.
    .replace(/<\/\s*(p|div|h[1-6])\s*>/gi, '\n\n')
    .replace(/<\/\s*(li|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((regel) => regel.trimEnd())
    .join('\n')
    .trim();
}
