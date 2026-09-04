/**
 * Weekbezetting: belasting tegen capaciteit (hoofdstuk 8.1 en 7.4).
 *
 * Twee kleuren, meer niet: blauw voor belasting, groen voor capaciteit. Beide
 * zijn gecontroleerd op leesbaarheid voor kleurenblinden in licht en donker.
 * Alles wat verder onderscheiden moet worden, doet dat met vorm in plaats van
 * met kleur:
 *
 *   prognose                       hetzelfde blauw, gearceerd
 *   capaciteit bij volle bezetting dezelfde groene lijn, gestreept
 *   gesloten weken                 gearceerd, plus het label "gesloten"
 *   stoplichtstatus                een gekleurde stip met het woord erbij
 *
 * Er is een tabelweergave naast de grafiek, zodat de cijfers ook zonder kleur
 * en zonder muis te lezen zijn.
 */
import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { STATUS_TOKENS, formatDecimal, type CapacityWeek } from '@showroom/shared';

type Props = {
  weken: CapacityWeek[];
  /** Tweede reeks om tegen af te zetten, bijvoorbeeld een scenario. */
  scenario?: CapacityWeek[] | null;
  titel?: string;
  hoogte?: number;
};

type Punt = {
  label: string;
  bevestigd: number;
  prognose: number;
  totaal: number;
  capaciteit: number;
  capaciteitVol: number;
  verlies: number;
  bezetting: number;
  status: CapacityWeek['status'];
  gesloten: boolean;
  scenario?: number;
};

function naarPunten(weken: CapacityWeek[], scenario?: CapacityWeek[] | null): Punt[] {
  return weken.map((week, index) => ({
    label: `wk ${week.isoWeek}`,
    bevestigd: week.loadConfirmed,
    prognose: week.loadForecast,
    totaal: week.loadTotal,
    capaciteit: week.capacity,
    capaciteitVol: week.capacityIfFullyStaffed,
    verlies: Math.max(0, week.capacityIfFullyStaffed - week.capacity),
    bezetting: week.utilisationPct,
    status: week.status,
    gesloten: week.isClosed,
    scenario: scenario?.[index]?.loadTotal,
  }));
}

function Uitleg({ punt }: { punt: Punt }): JSX.Element {
  const status = STATUS_TOKENS[punt.status];
  return (
    <div
      style={{
        background: 'var(--oppervlak-2)',
        border: '1px solid var(--rand)',
        borderRadius: 8,
        padding: '10px 12px',
        color: 'var(--inkt)',
        boxShadow: '0 4px 16px rgb(0 0 0 / 0.08)',
        minWidth: 220,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{punt.label}</div>
      {punt.gesloten ? (
        <div style={{ color: 'var(--inkt-zacht)' }}>Gesloten week — geen capaciteit.</div>
      ) : (
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 16px' }}>
          <dt>Bevestigd</dt>
          <dd style={{ margin: 0, textAlign: 'right' }}>{formatDecimal(punt.bevestigd)}</dd>
          {punt.prognose > 0 && (
            <>
              <dt>Prognose</dt>
              <dd style={{ margin: 0, textAlign: 'right' }}>{formatDecimal(punt.prognose)}</dd>
            </>
          )}
          <dt>Capaciteit</dt>
          <dd style={{ margin: 0, textAlign: 'right' }}>{formatDecimal(punt.capaciteit)}</dd>
          {punt.verlies > 0.01 && (
            <>
              <dt style={{ color: 'var(--inkt-zacht)' }}>Verlies door verlof/inzet</dt>
              <dd style={{ margin: 0, textAlign: 'right', color: 'var(--inkt-zacht)' }}>
                −{formatDecimal(punt.verlies)}
              </dd>
            </>
          )}
          <dt>Bezetting</dt>
          <dd style={{ margin: 0, textAlign: 'right' }}>
            {/* Het stoplicht draagt altijd zijn woord, nooit alleen kleur. */}
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: 4,
                background: status.color,
                marginRight: 6,
              }}
            />
            {Math.round(punt.bezetting)}% · {status.label}
          </dd>
        </dl>
      )}
    </div>
  );
}

export function BezettingsGrafiek({ weken, scenario, titel, hoogte = 320 }: Props): JSX.Element {
  const [tabel, setTabel] = useState(false);
  const punten = useMemo(() => naarPunten(weken, scenario), [weken, scenario]);

  if (weken.length === 0) {
    return (
      <div style={{ padding: 24, color: 'var(--inkt-zacht)' }}>
        Er is nog geen planning om te tonen. Voeg een project met een showroomfase toe.
      </div>
    );
  }

  return (
    <section>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          {titel ?? 'Showroombezetting per week'}
        </h2>
        <span style={{ color: 'var(--inkt-zacht)', fontSize: 12 }}>
          afspraken per week · {weken.length} weken
        </span>
        <button
          type="button"
          className="focus-ring"
          onClick={() => setTabel((huidig) => !huidig)}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: '1px solid var(--rand)',
            borderRadius: 6,
            padding: '4px 10px',
            color: 'var(--inkt-zacht)',
            cursor: 'pointer',
          }}
        >
          {tabel ? 'Grafiek tonen' : 'Als tabel tonen'}
        </button>
      </header>

      {tabel ? (
        <Tabel punten={punten} />
      ) : (
        <div style={{ height: hoogte }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={punten} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
              <defs>
                {/* Arcering voor prognose en voor gesloten weken: onderscheid
                    zonder een extra kleur nodig te hebben. */}
                <pattern id="arcering-prognose" patternUnits="userSpaceOnUse" width="6" height="6">
                  <rect width="6" height="6" fill="var(--belasting)" opacity="0.28" />
                  <path d="M0,6 l6,-6" stroke="var(--belasting)" strokeWidth="2" />
                </pattern>
                <pattern id="arcering-gesloten" patternUnits="userSpaceOnUse" width="6" height="6">
                  <rect width="6" height="6" fill="transparent" />
                  <path d="M0,6 l6,-6" stroke="var(--rand)" strokeWidth="2" />
                </pattern>
              </defs>

              <CartesianGrid stroke="var(--rand)" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: 'var(--inkt-stil)', fontSize: 11 }}
                axisLine={{ stroke: 'var(--rand)' }}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                tick={{ fill: 'var(--inkt-stil)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={44}
                label={{
                  value: 'afspraken',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fill: 'var(--inkt-stil)', fontSize: 11 },
                }}
              />
              <Tooltip
                cursor={{ fill: 'var(--rand)', opacity: 0.35 }}
                content={({ active, payload }) =>
                  active && payload?.[0] ? <Uitleg punt={payload[0].payload as Punt} /> : null
                }
              />
              <Legend
                wrapperStyle={{ fontSize: 12, color: 'var(--inkt-zacht)', paddingTop: 8 }}
                iconType="plainline"
              />

              {/* Gesloten weken als gearceerde achtergrond. */}
              {punten.map((punt, index) =>
                punt.gesloten ? (
                  <ReferenceLine
                    key={`gesloten-${index}`}
                    x={punt.label}
                    stroke="var(--rand)"
                    strokeWidth={18}
                    strokeOpacity={0.5}
                    ifOverflow="extendDomain"
                  />
                ) : null,
              )}

              <Bar
                dataKey="bevestigd"
                name="Bevestigde belasting"
                stackId="belasting"
                fill="var(--belasting)"
                radius={[0, 0, 0, 0]}
                maxBarSize={26}
              />
              <Bar
                dataKey="prognose"
                name="Prognose (gearceerd)"
                stackId="belasting"
                fill="url(#arcering-prognose)"
                stroke="var(--belasting)"
                strokeWidth={1}
                radius={[4, 4, 0, 0]}
                maxBarSize={26}
              />
              <Line
                type="monotone"
                dataKey="capaciteitVol"
                name="Capaciteit bij volledige bezetting"
                stroke="var(--capaciteit)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                strokeOpacity={0.65}
              />
              <Line
                type="monotone"
                dataKey="capaciteit"
                name="Werkelijke capaciteit"
                stroke="var(--capaciteit)"
                strokeWidth={2}
                dot={false}
              />
              {scenario && (
                <Line
                  type="monotone"
                  dataKey="scenario"
                  name="Scenario"
                  stroke="var(--inkt-zacht)"
                  strokeWidth={2}
                  strokeDasharray="1 3"
                  dot={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function Tabel({ punten }: { punten: Punt[] }): JSX.Element {
  return (
    <div style={{ overflowX: 'auto', maxHeight: 340 }}>
      <table
        className="compact"
        style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
      >
        <caption style={{ textAlign: 'left', color: 'var(--inkt-zacht)', paddingBottom: 6 }}>
          Weekbezetting in cijfers
        </caption>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--rand)' }}>
            <th scope="col">Week</th>
            <th scope="col" style={{ textAlign: 'right' }}>Bevestigd</th>
            <th scope="col" style={{ textAlign: 'right' }}>Prognose</th>
            <th scope="col" style={{ textAlign: 'right' }}>Capaciteit</th>
            <th scope="col" style={{ textAlign: 'right' }}>Bij volle bezetting</th>
            <th scope="col" style={{ textAlign: 'right' }}>Bezetting</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {punten.map((punt) => (
            <tr key={punt.label} style={{ borderBottom: '1px solid var(--rand)' }}>
              <th scope="row" style={{ textAlign: 'left', fontWeight: 500 }}>
                {punt.label}
              </th>
              <td style={{ textAlign: 'right' }}>{formatDecimal(punt.bevestigd)}</td>
              <td style={{ textAlign: 'right' }}>{formatDecimal(punt.prognose)}</td>
              <td style={{ textAlign: 'right' }}>{formatDecimal(punt.capaciteit)}</td>
              <td style={{ textAlign: 'right', color: 'var(--inkt-zacht)' }}>
                {formatDecimal(punt.capaciteitVol)}
              </td>
              <td style={{ textAlign: 'right' }}>{Math.round(punt.bezetting)}%</td>
              <td>{STATUS_TOKENS[punt.status].label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
