/**
 * De offerte als afdrukbare HTML (hoofdstuk 6.5 en 11).
 *
 * Het hoofdproces zet dit met `printToPDF` in een verborgen venster om naar een
 * PDF. Er is dus geen externe PDF-bibliotheek nodig — en geen betaalde module,
 * want de image-, html- en xlsx-modules van docxtemplater kosten geld.
 *
 * De HTML is opzettelijk kaal en gebruikt geen enkele variabele uit het thema:
 * een offerte die bij de een op wit papier en bij de ander op donkergrijs
 * uitkomt omdat het scherm in donkere modus stond, is geen offerte.
 */
import { formatCurrency, formatDate } from '@showroom/shared';
import type { Offerte, Offerteregel } from '../../lib/api.ts';

/** Zet tekst veilig in HTML. */
function esc(waarde: unknown): string {
  return String(waarde ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type Afzender = {
  bedrijf: string;
  adres?: string;
  email?: string;
  telefoon?: string;
};

/** Bouwt de HTML van één offerte. */
export function offerteHtml(
  offerte: Offerte,
  regels: Offerteregel[],
  afzender: Afzender = { bedrijf: 'Showroom' },
): string {
  const meegeteld = regels.filter((regel) => regel.is_optional === 0 || regel.is_selected === 1);
  const opties = regels.filter((regel) => regel.is_optional === 1 && regel.is_selected === 0);

  const klantregels = [
    offerte.klant,
    [offerte.first_name, offerte.last_name].filter(Boolean).join(' ') || null,
    offerte.project ? `Project: ${offerte.project}` : null,
  ].filter((regel): regel is string => Boolean(regel));

  const rij = (regel: Offerteregel): string => `
    <tr>
      <td>${esc(regel.description)}${regel.sku ? `<span class="sku">${esc(regel.sku)}</span>` : ''}</td>
      <td class="getal">${esc(String(regel.quantity).replace('.', ','))}</td>
      <td>${esc(regel.unit ?? '')}</td>
      <td class="getal">${esc(formatCurrency(regel.unit_price_cents))}</td>
      <td class="getal">${regel.discount_bp > 0 ? `${esc(String(regel.discount_bp / 100).replace('.', ','))}%` : '—'}</td>
      <td class="getal">${esc(formatCurrency(regel.amount_cents))}</td>
    </tr>`;

  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><title>Offerte ${esc(offerte.number)}</title>
<style>
  /* Vaste kleuren: een offerte hoort niet mee te veranderen met het schermthema. */
  body { font: 11pt/1.5 "Segoe UI", system-ui, sans-serif; color: #111; margin: 0; padding: 24mm 18mm; }
  h1 { font-size: 18pt; margin: 0 0 2mm; }
  .kop { display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm; }
  .afzender { text-align: right; font-size: 9pt; color: #444; }
  .blok { margin: 8mm 0; }
  .label { font-size: 9pt; color: #666; }
  table { width: 100%; border-collapse: collapse; margin-top: 4mm; font-size: 10pt; }
  th { text-align: left; border-bottom: 1pt solid #333; padding: 2mm 1mm; font-size: 9pt; }
  td { padding: 1.8mm 1mm; border-bottom: 0.5pt solid #ddd; vertical-align: top; }
  .getal { text-align: right; white-space: nowrap; }
  .sku { display: block; font-size: 8pt; color: #777; }
  .totalen { margin-top: 5mm; margin-left: auto; width: 70mm; }
  .totalen td { border: 0; padding: 1mm 0; }
  .totalen .eind td { border-top: 1pt solid #333; font-weight: 700; font-size: 12pt; padding-top: 2mm; }
  .opties { margin-top: 6mm; font-size: 9.5pt; color: #444; }
  .voet { margin-top: 10mm; font-size: 9pt; color: #444; white-space: pre-wrap; }
</style></head>
<body>
  <div class="kop">
    <div>
      <h1>Offerte ${esc(offerte.number)}</h1>
      <div class="label">${offerte.sent_at ? `Verstuurd op ${esc(formatDate(offerte.sent_at.slice(0, 10)))}` : 'Concept'}${
        offerte.valid_until ? ` &middot; geldig tot ${esc(formatDate(offerte.valid_until))}` : ''
      }</div>
    </div>
    <div class="afzender">
      <strong>${esc(afzender.bedrijf)}</strong>
      ${afzender.adres ? `<div>${esc(afzender.adres)}</div>` : ''}
      ${afzender.email ? `<div>${esc(afzender.email)}</div>` : ''}
      ${afzender.telefoon ? `<div>${esc(afzender.telefoon)}</div>` : ''}
    </div>
  </div>

  <div class="blok">
    <div class="label">Voor</div>
    ${klantregels.map((regel) => `<div>${esc(regel)}</div>`).join('') || '<div>—</div>'}
  </div>

  ${offerte.pakket ? `<div class="blok"><div class="label">Pakket</div><div>${esc(offerte.pakket)}</div></div>` : ''}

  <table>
    <thead>
      <tr>
        <th>Omschrijving</th>
        <th class="getal">Aantal</th>
        <th>Eenheid</th>
        <th class="getal">Stuksprijs</th>
        <th class="getal">Korting</th>
        <th class="getal">Bedrag</th>
      </tr>
    </thead>
    <tbody>${meegeteld.map(rij).join('')}</tbody>
  </table>

  <table class="totalen">
    <tr><td>Subtotaal</td><td class="getal">${esc(formatCurrency(offerte.subtotal_cents))}</td></tr>
    ${offerte.discount_cents > 0 ? `<tr><td>Waarvan korting</td><td class="getal">${esc(formatCurrency(offerte.discount_cents))}</td></tr>` : ''}
    <tr><td>Btw</td><td class="getal">${esc(formatCurrency(offerte.vat_cents))}</td></tr>
    <tr class="eind"><td>Totaal</td><td class="getal">${esc(formatCurrency(offerte.total_cents))}</td></tr>
  </table>

  ${
    opties.length > 0
      ? `<div class="opties"><strong>Niet gekozen opties</strong><ul>${opties
          .map(
            (regel) =>
              `<li>${esc(regel.description)} — ${esc(
                formatCurrency(
                  Math.round(regel.quantity * regel.unit_price_cents * (1 - regel.discount_bp / 10000)),
                ),
              )}</li>`,
          )
          .join('')}</ul></div>`
      : ''
  }

  ${offerte.notes ? `<div class="voet">${esc(offerte.notes)}</div>` : ''}
</body></html>`;
}
