/**
 * De duurzaamheidspakketten met hun samenstelling en prijs (hoofdstuk 6.5).
 *
 * De prijs staat niet in de database: hij volgt uit de regels en de prijsmodus.
 * Zou hij wel opgeslagen zijn, dan klopt hij niet meer zodra de inkoopprijs van
 * een paneel verandert — en dat is precies het moment waarop iemand ernaar
 * kijkt.
 *
 * Bij elk pakket staat de marge. Die is intern: hij hoort op het scherm en niet
 * op de offerte.
 */
import { useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatBp, formatCurrency, formatDecimal } from '@showroom/shared';
import { endpoints, type PakketMetPrijs } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { dialoogKnop } from '../kansen/Dialoog.tsx';
import { OfferteDialoog } from './OfferteDialoog.tsx';

const PRIJSMODUS: Record<PakketMetPrijs['pricing_mode'], string> = {
  sum: 'som van de regels',
  sum_with_margin: 'som plus marge',
  fixed: 'vaste prijs',
};

export function Pakketten({ navigeer }: { navigeer: (pad: string) => void }): JSX.Element {
  const [offerteVoor, setOfferteVoor] = useState<PakketMetPrijs | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const pakketten = useQuery({ queryKey: ['pakketten'], queryFn: () => endpoints.pakketten() });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header>
        <h1 style={{ fontSize: 18, margin: 0 }}>Duurzaamheidspakketten</h1>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--inkt-stil)', lineHeight: 1.6 }}>
          De prijs wordt uitgerekend uit de regels; hij staat niet vast opgeslagen. Wijzigt de
          inkoop- of verkoopprijs van een product, dan staat het hier meteen goed.
        </p>
      </header>

      {pakketten.isLoading && (
        <Kaart>
          <Skelet hoogte={200} />
        </Kaart>
      )}

      {pakketten.data?.data.length === 0 && (
        <Kaart>
          <p style={{ margin: 0, color: 'var(--inkt-zacht)' }}>
            Er zijn nog geen pakketten samengesteld.
          </p>
        </Kaart>
      )}

      {(pakketten.data?.data ?? []).map((pakket) => {
        const uitgeklapt = open === pakket.id;
        const verplicht = pakket.regels.filter((regel) => regel.is_optional === 0);
        const opties = pakket.regels.filter((regel) => regel.is_optional === 1);

        return (
          <Kaart key={pakket.id} accent={pakket.active === 1 ? 'var(--capaciteit)' : undefined}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 15 }}>{pakket.name}</strong>
              {pakket.code && (
                <code style={{ fontSize: 11, color: 'var(--inkt-stil)' }}>{pakket.code}</code>
              )}
              {pakket.active !== 1 && (
                <span style={{ fontSize: 11, color: 'var(--inkt-stil)' }}>— niet actief</span>
              )}

              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--inkt-zacht)' }}>
                {PRIJSMODUS[pakket.pricing_mode]}
                {pakket.pricing_mode === 'sum_with_margin'
                  ? ` (${formatBp(pakket.margin_bp)})`
                  : ''}
              </span>
            </div>

            {pakket.description && (
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--inkt-zacht)' }}>
                {pakket.description}
              </p>
            )}

            <div
              style={{
                display: 'grid',
                gap: 10,
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                marginTop: 12,
              }}
            >
              <Cijfer label="Excl. btw" waarde={formatCurrency(pakket.prijs.subtotaalCents)} />
              <Cijfer label="Btw" waarde={formatCurrency(pakket.prijs.btwCents)} />
              <Cijfer
                label="Incl. btw"
                waarde={formatCurrency(pakket.prijs.totaalCents)}
                nadruk
              />
              {/* Intern cijfer: dit hoort op het scherm en niet op de offerte. */}
              <Cijfer
                label="Marge (intern)"
                waarde={`${formatCurrency(pakket.prijs.margeCents)} · ${formatBp(pakket.prijs.margeBp)}`}
              />
              {pakket.estimated_install_hours !== null && (
                <Cijfer
                  label="Montage"
                  waarde={`${formatDecimal(pakket.estimated_install_hours)} uur`}
                />
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="focus-ring"
                onClick={() => setOpen(uitgeklapt ? null : pakket.id)}
                aria-expanded={uitgeklapt}
                style={dialoogKnop}
              >
                {uitgeklapt ? 'Samenstelling verbergen' : `Samenstelling (${pakket.regels.length})`}
              </button>
              <button
                type="button"
                className="focus-ring"
                onClick={() => setOfferteVoor(pakket)}
                style={{ ...dialoogKnop, background: 'var(--belasting)', color: '#fff', border: 0 }}
              >
                Offerte maken…
              </button>
            </div>

            {uitgeklapt && (
              <div style={{ marginTop: 12, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--rand)' }}>
                      <th scope="col" style={kop}>Onderdeel</th>
                      <th scope="col" style={{ ...kop, textAlign: 'right' }}>Aantal</th>
                      <th scope="col" style={kop}>Eenheid</th>
                      <th scope="col" style={{ ...kop, textAlign: 'right' }}>Stuksprijs</th>
                      <th scope="col" style={kop}>Soort</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...verplicht, ...opties].map((regel) => (
                      <tr key={regel.id} style={{ borderBottom: '1px solid var(--rand)' }}>
                        <th scope="row" style={{ ...cel, textAlign: 'left', fontWeight: 500 }}>
                          {regel.naam}
                        </th>
                        <td style={{ ...cel, textAlign: 'right' }}>
                          {formatDecimal(regel.quantity)}
                        </td>
                        <td style={cel}>{regel.unit ?? '—'}</td>
                        <td style={{ ...cel, textAlign: 'right' }}>
                          {formatCurrency(
                            regel.unit_price_cents > 0
                              ? regel.unit_price_cents
                              : (regel.sales_price_cents ?? 0),
                          )}
                        </td>
                        <td style={cel}>
                          {regel.is_optional === 1 ? (
                            <span style={{ color: 'var(--inkt-stil)' }}>optioneel</span>
                          ) : (
                            'inbegrepen'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ fontSize: 11, color: 'var(--inkt-stil)', margin: '8px 0 0' }}>
                  Optionele onderdelen tellen niet mee in de pakketprijs hierboven; de klant kiest ze
                  er per offerte bij.
                </p>
              </div>
            )}
          </Kaart>
        );
      })}

      {offerteVoor && (
        <OfferteDialoog
          pakket={offerteVoor}
          onSluit={() => setOfferteVoor(null)}
          onKlaar={(quoteId) => {
            setOfferteVoor(null);
            navigeer(`/duurzaamheid/offerte/${quoteId}`);
          }}
        />
      )}
    </div>
  );
}

function Cijfer({
  label,
  waarde,
  nadruk,
}: {
  label: string;
  waarde: string;
  nadruk?: boolean;
}): JSX.Element {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--inkt-stil)' }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontSize: nadruk ? 15 : 13, fontWeight: nadruk ? 700 : 500 }}>
        {waarde}
      </p>
    </div>
  );
}

const kop: React.CSSProperties = { padding: '4px 6px', fontWeight: 600 };
const cel: React.CSSProperties = { padding: '5px 6px' };
