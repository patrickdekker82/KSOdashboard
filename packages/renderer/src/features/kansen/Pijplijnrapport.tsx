/**
 * Rapportage over de verkooptrechter (hoofdstuk 6.2).
 *
 * De trechter zelf is een liggende staafgrafiek: twee kleuren, blauw voor het
 * offertebedrag en groen voor het gewogen bedrag, dezelfde twee die overal in
 * deze applicatie gebruikt worden en gecontroleerd zijn op leesbaarheid voor
 * kleurenblinden. Elk staafje draagt het aantal kansen als tekst, en onder de
 * grafiek staan alle cijfers nog eens als tabel — de grafiek is een hulpmiddel,
 * niet de enige weg naar het getal.
 */
import { useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency, formatDecimal } from '@showroom/shared';
import { endpoints, type Pijplijnrapport as Rapport, type WinRate } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';

const invoer: React.CSSProperties = {
  background: 'var(--oppervlak)',
  border: '1px solid var(--rand)',
  borderRadius: 4,
  color: 'var(--inkt)',
  fontSize: 12,
  padding: '4px 6px',
};

export function Pijplijnrapport(): JSX.Element {
  const [van, setVan] = useState('');
  const [tot, setTot] = useState('');
  const periode = van !== '' && tot !== '';

  const rapport = useQuery({
    queryKey: ['pijplijnrapport', periode ? van : '', periode ? tot : ''],
    queryFn: () => endpoints.pijplijnrapport(periode ? van : undefined, periode ? tot : undefined),
  });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>Verkooptrechter</h1>
        <label style={{ fontSize: 12, color: 'var(--inkt-zacht)' }}>
          Afgesloten van{' '}
          <input
            type="date"
            className="focus-ring"
            value={van}
            onChange={(event) => setVan(event.target.value)}
            style={invoer}
          />
        </label>
        <label style={{ fontSize: 12, color: 'var(--inkt-zacht)' }}>
          tot{' '}
          <input
            type="date"
            className="focus-ring"
            value={tot}
            onChange={(event) => setTot(event.target.value)}
            style={invoer}
          />
        </label>
        {periode && (
          <button
            type="button"
            className="focus-ring"
            onClick={() => {
              setVan('');
              setTot('');
            }}
            style={{ ...invoer, cursor: 'pointer', color: 'var(--inkt-zacht)' }}
          >
            Periode wissen
          </button>
        )}
      </header>

      <p style={{ margin: 0, fontSize: 12, color: 'var(--inkt-stil)', lineHeight: 1.6 }}>
        De trechter toont de kansen die nu open staan. De win-rate, de doorlooptijd en de omzet
        kijken naar afgesloten kansen{periode ? ' in de gekozen periode' : ' over de hele historie'}.
      </p>

      {rapport.isLoading && (
        <Kaart>
          <Skelet hoogte={260} />
        </Kaart>
      )}

      {rapport.error && (
        <Kaart>
          <p style={{ color: 'var(--ziekte)', margin: 0 }}>
            {rapport.error instanceof Error
              ? rapport.error.message
              : 'Het rapport kon niet worden opgehaald.'}
          </p>
        </Kaart>
      )}

      {rapport.data && <Inhoud rapport={rapport.data.data} />}
    </div>
  );
}

function Inhoud({ rapport }: { rapport: Rapport }): JSX.Element {
  const punten = rapport.trechter.map((fase) => ({
    fase: fase.fase,
    aantal: fase.aantal,
    bedrag: fase.bedragCents / 100,
    gewogen: fase.gewogenCents / 100,
  }));

  return (
    <>
      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        }}
      >
        <Kpi label="Open kansen" waarde={String(rapport.samenvatting.openAantal)} />
        <Kpi label="Openstaand bedrag" waarde={formatCurrency(rapport.samenvatting.openCents)} />
        <Kpi label="Gewogen" waarde={formatCurrency(rapport.samenvatting.gewogenCents)} />
        <Kpi
          label="Gescoord dit jaar"
          waarde={formatCurrency(rapport.samenvatting.gescoordDitJaarCents)}
        />
        <Kpi label="Win-rate" waarde={`${formatDecimal(rapport.samenvatting.winRatePct)}%`} />
        <Kpi
          label="Gemiddelde deal"
          waarde={formatCurrency(rapport.samenvatting.gemiddeldeDealCents)}
        />
      </div>

      <Kaart>
        <h2 style={{ fontSize: 14, margin: '0 0 10px' }}>Trechter</h2>

        {punten.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--inkt-zacht)', margin: 0 }}>
            Er staan geen open kansen in de pijplijn.
          </p>
        ) : (
          <>
            <div style={{ height: Math.max(180, punten.length * 46) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={punten} layout="vertical" margin={{ left: 8, right: 48, top: 4 }}>
                  <CartesianGrid stroke="var(--rand)" strokeDasharray="2 4" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: 'var(--inkt-stil)', fontSize: 11 }}
                    axisLine={{ stroke: 'var(--rand)' }}
                    tickLine={false}
                    tickFormatter={(waarde: number) => `€ ${formatDecimal(waarde / 1000)}k`}
                  />
                  <YAxis
                    type="category"
                    dataKey="fase"
                    width={130}
                    tick={{ fill: 'var(--inkt-zacht)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--rand)', opacity: 0.35 }}
                    content={({ active, payload }) =>
                      active && payload?.[0] ? (
                        <Uitleg
                          punt={payload[0].payload as (typeof punten)[number]}
                        />
                      ) : null
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: 'var(--inkt-zacht)' }} />
                  <Bar dataKey="bedrag" name="Offertebedrag" fill="var(--belasting)" maxBarSize={16}>
                    {/* Het aantal in tekst: zo hoeft niemand de staaflengte te schatten. */}
                    <LabelList
                      dataKey="aantal"
                      position="right"
                      formatter={(waarde: unknown) => `${String(waarde ?? 0)}×`}
                      style={{ fill: 'var(--inkt-stil)', fontSize: 11 }}
                    />
                  </Bar>
                  <Bar
                    dataKey="gewogen"
                    name="Gewogen bedrag"
                    fill="var(--capaciteit)"
                    maxBarSize={16}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <Tabel
              koppen={['Fase', 'Aantal', 'Bedrag', 'Gewogen']}
              rijen={rapport.trechter.map((fase) => [
                fase.fase,
                String(fase.aantal),
                formatCurrency(fase.bedragCents),
                formatCurrency(fase.gewogenCents),
              ])}
            />
          </>
        )}
      </Kaart>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <WinRateKaart titel="Win-rate per discipline" rijen={rapport.winRatePerDiscipline} />
        <WinRateKaart titel="Win-rate per eigenaar" rijen={rapport.winRatePerEigenaar} />
        <WinRateKaart titel="Win-rate per bron" rijen={rapport.winRatePerBron} />

        <Kaart>
          <h2 style={{ fontSize: 14, margin: '0 0 10px' }}>Doorlooptijd per fase</h2>
          <p style={{ fontSize: 11, color: 'var(--inkt-stil)', margin: '0 0 8px', lineHeight: 1.6 }}>
            Naast het gemiddelde ook de mediaan: één kans die twee jaar bleef liggen trekt een
            gemiddelde scheef.
          </p>
          <Tabel
            koppen={['Fase', 'Gemiddeld', 'Mediaan', 'Metingen']}
            rijen={rapport.doorlooptijd.map((fase) => [
              fase.fase,
              `${formatDecimal(fase.gemiddeldeDagen)} d`,
              `${formatDecimal(fase.medianeDagen)} d`,
              String(fase.metingen),
            ])}
            leeg="Nog geen fasewisselingen vastgelegd."
          />
        </Kaart>

        <Kaart>
          <h2 style={{ fontSize: 14, margin: '0 0 10px' }}>Gescoorde omzet per discipline</h2>
          <Tabel
            koppen={['Maand', 'Discipline', 'Regels', 'Gescoord']}
            rijen={rapport.omzetPerDiscipline.map((rij) => [
              rij.maand,
              rij.discipline,
              String(rij.aantalRegels),
              formatCurrency(rij.gescoordCents),
            ])}
            leeg="Er is in deze periode niets gescoord."
          />
        </Kaart>

        <Kaart>
          <h2 style={{ fontSize: 14, margin: '0 0 10px' }}>Verliesredenen</h2>
          <Tabel
            koppen={['Reden', 'Aantal', 'Gemiste omzet']}
            rijen={rapport.verliesredenen.map((rij) => [
              rij.reden,
              String(rij.aantal),
              formatCurrency(rij.gemistCents),
            ])}
            leeg="Er zijn nog geen kansen verloren."
          />
        </Kaart>
      </div>
    </>
  );
}

function Uitleg({ punt }: { punt: { fase: string; aantal: number; bedrag: number; gewogen: number } }): JSX.Element {
  return (
    <div
      style={{
        background: 'var(--oppervlak-2)',
        border: '1px solid var(--rand)',
        borderRadius: 6,
        padding: '6px 10px',
        fontSize: 12,
      }}
    >
      <strong>{punt.fase}</strong>
      <div style={{ color: 'var(--inkt-zacht)' }}>
        {punt.aantal} kans{punt.aantal === 1 ? '' : 'en'}
      </div>
      <div>{formatCurrency(Math.round(punt.bedrag * 100))} offerte</div>
      <div>{formatCurrency(Math.round(punt.gewogen * 100))} gewogen</div>
    </div>
  );
}

function WinRateKaart({ titel, rijen }: { titel: string; rijen: WinRate[] }): JSX.Element {
  return (
    <Kaart>
      <h2 style={{ fontSize: 14, margin: '0 0 10px' }}>{titel}</h2>
      <Tabel
        koppen={['', 'Gewonnen', 'Verloren', 'Win-rate', 'Gescoord']}
        rijen={rijen.map((rij) => [
          rij.label,
          String(rij.gewonnen),
          String(rij.verloren),
          `${formatDecimal(rij.winRatePct)}%`,
          formatCurrency(rij.gescoordCents),
        ])}
        leeg="Nog geen afgesloten kansen."
      />
    </Kaart>
  );
}

function Kpi({ label, waarde }: { label: string; waarde: string }): JSX.Element {
  return (
    <Kaart>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--inkt-stil)' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 600 }}>{waarde}</p>
    </Kaart>
  );
}

function Tabel({
  koppen,
  rijen,
  leeg = 'Geen gegevens.',
}: {
  koppen: string[];
  rijen: string[][];
  leeg?: string;
}): JSX.Element {
  if (rijen.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--inkt-zacht)', margin: 0 }}>{leeg}</p>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--rand)' }}>
            {koppen.map((kop, index) => (
              <th
                key={kop || `kolom-${index}`}
                scope="col"
                style={{ padding: '4px 6px', textAlign: index === 0 ? 'left' : 'right' }}
              >
                {kop}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rijen.map((rij) => (
            <tr key={rij.join('|')} style={{ borderBottom: '1px solid var(--rand)' }}>
              {rij.map((cel, index) =>
                index === 0 ? (
                  <th key={index} scope="row" style={{ padding: '5px 6px', textAlign: 'left', fontWeight: 500 }}>
                    {cel}
                  </th>
                ) : (
                  <td key={index} style={{ padding: '5px 6px', textAlign: 'right' }}>
                    {cel}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
