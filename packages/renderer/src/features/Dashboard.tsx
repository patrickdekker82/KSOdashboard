import { useQuery } from '@tanstack/react-query';
import { formatDecimal, STATUS_TOKENS } from '@showroom/shared';
import { endpoints } from '../lib/api.ts';
import { BezettingsGrafiek } from '../components/BezettingsGrafiek.tsx';
import { Signaleringen } from './signaleringen/Signaleringen.tsx';
import { formatCurrency } from '@showroom/shared';
import type { JSX, ReactNode } from 'react';

export function Dashboard({ navigeer }: { navigeer: (pad: string) => void }): JSX.Element {
  const bezetting = useQuery({
    queryKey: ['weekbezetting', 26],
    queryFn: () => endpoints.weekbezetting(),
  });
  const gaten = useQuery({ queryKey: ['gaten'], queryFn: () => endpoints.gaten() });
  const perBegeleider = useQuery({
    queryKey: ['per-begeleider'],
    queryFn: () => endpoints.perBegeleider(),
  });
  const pijplijn = useQuery({
    queryKey: ['pijplijnrapport', '', ''],
    queryFn: () => endpoints.pijplijnrapport(),
  });

  const weken = bezetting.data?.data ?? [];
  const komende = weken.slice(0, 4);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>Dashboard</h1>

      <Kpis
        weken={weken}
        samenvatting={pijplijn.data?.data.samenvatting}
      />

      <Signaleringen navigeer={navigeer} />

      <Aandachtspunten gaten={gaten.data?.data ?? []} />

      <Kaart>
        {bezetting.isLoading ? (
          <Skelet hoogte={320} />
        ) : (
          <BezettingsGrafiek weken={weken} titel="Showroombezetting — 26 weken vooruit" />
        )}
      </Kaart>

      <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <Kaart>
          <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>Wie is er de komende weken?</h2>
          {komende.length === 0 ? (
            <Skelet hoogte={120} />
          ) : (
            <WieIsErTabel weken={komende} />
          )}
        </Kaart>

        <Kaart>
          <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>Bezetting per begeleider</h2>
          {perBegeleider.isLoading ? (
            <Skelet hoogte={120} />
          ) : (
            <PerBegeleider rijen={perBegeleider.data?.data ?? []} />
          )}
        </Kaart>
      </div>
    </div>
  );
}

/**
 * De cijfers waar een werkdag mee begint (hoofdstuk 8.1).
 *
 * Bewust weinig: bezetting van deze week en de komende vier, wat er open staat
 * in de trechter en wat er dit jaar is gescoord. Een dashboard met twintig
 * getallen leest niemand.
 */
function Kpis({
  weken,
  samenvatting,
}: {
  weken: Array<{ utilisationPct: number; capacity: number; loadTotal: number; status: string }>;
  samenvatting?: { openAantal: number; openCents: number; gewogenCents: number; gescoordDitJaarCents: number };
}): JSX.Element {
  const dezeWeek = weken[0];
  const vier = weken.slice(0, 4);
  const gemiddelde =
    vier.length === 0 ? 0 : vier.reduce((som, week) => som + week.utilisationPct, 0) / vier.length;

  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
      <Kpi
        label="Deze week"
        waarde={dezeWeek ? `${Math.round(dezeWeek.utilisationPct)}%` : '—'}
        bij={
          dezeWeek
            ? `${formatDecimal(dezeWeek.loadTotal)} van ${formatDecimal(dezeWeek.capacity)} afspraken`
            : undefined
        }
        kleur={dezeWeek ? STATUS_TOKENS[dezeWeek.status as keyof typeof STATUS_TOKENS]?.color : undefined}
      />
      <Kpi
        label="Komende vier weken"
        waarde={vier.length === 0 ? '—' : `${Math.round(gemiddelde)}%`}
        bij="gemiddelde bezetting"
      />
      <Kpi
        label="Open kansen"
        waarde={samenvatting ? String(samenvatting.openAantal) : '—'}
        bij={samenvatting ? formatCurrency(samenvatting.openCents) : undefined}
      />
      <Kpi
        label="Gewogen pijplijn"
        waarde={samenvatting ? formatCurrency(samenvatting.gewogenCents) : '—'}
        bij="kans maal bedrag"
      />
      <Kpi
        label="Gescoord dit jaar"
        waarde={samenvatting ? formatCurrency(samenvatting.gescoordDitJaarCents) : '—'}
      />
    </div>
  );
}

function Kpi({
  label,
  waarde,
  bij,
  kleur,
}: {
  label: string;
  waarde: string;
  bij?: string;
  kleur?: string;
}): JSX.Element {
  return (
    <Kaart accent={kleur}>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--inkt-stil)' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 600 }}>{waarde}</p>
      {bij && (
        <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--inkt-stil)' }}>{bij}</p>
      )}
    </Kaart>
  );
}

function Aandachtspunten({
  gaten,
}: {
  gaten: Array<{
    startWeek: { year: number; week: number };
    endWeek: { year: number; week: number };
    weeks: number;
    avgUtilisationPct: number;
    shortfallUnits: number;
  }>;
}): JSX.Element {
  if (gaten.length === 0) {
    return (
      <Kaart>
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Aandachtspunten</h2>
        <p style={{ color: 'var(--inkt-zacht)', margin: 0 }}>
          Geen structurele leegte gevonden in de komende periode.
        </p>
      </Kaart>
    );
  }

  return (
    <Kaart accent="var(--belasting)">
      <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>Aandachtspunten</h2>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
        {gaten.slice(0, 3).map((gat) => (
          <li key={`${gat.startWeek.year}-${gat.startWeek.week}`}>
            <strong>
              Let op — showroom loopt leeg vanaf week {gat.startWeek.week}
            </strong>
            <p style={{ margin: '4px 0 0', color: 'var(--inkt-zacht)', lineHeight: 1.6 }}>
              Van week {gat.startWeek.week} t/m week {gat.endWeek.week} ligt de verwachte
              bezetting op gemiddeld {Math.round(gat.avgUtilisationPct)}%. Er is ruimte voor
              circa <strong style={{ color: 'var(--inkt)' }}>{gat.shortfallUnits} woningen</strong>.
            </p>
          </li>
        ))}
      </ul>
    </Kaart>
  );
}

function WieIsErTabel({
  weken,
}: {
  weken: Array<{
    isoWeek: number;
    isClosed: boolean;
    byUser: Array<{ initials: string; availabilityPct: number; leaveHours: number; allocationHours: number }>;
  }>;
}): JSX.Element {
  const begeleiders = weken[0]?.byUser.map((user) => user.initials) ?? [];

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="compact" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--rand)' }}>
            <th scope="col" style={{ textAlign: 'left' }}>Begeleider</th>
            {weken.map((week) => (
              <th key={week.isoWeek} scope="col" style={{ textAlign: 'right' }}>
                wk {week.isoWeek}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {begeleiders.map((initialen) => (
            <tr key={initialen} style={{ borderBottom: '1px solid var(--rand)' }}>
              <th scope="row" style={{ textAlign: 'left', fontWeight: 500 }}>{initialen}</th>
              {weken.map((week) => {
                const user = week.byUser.find((entry) => entry.initials === initialen);
                const pct = Math.round(user?.availabilityPct ?? 0);
                const reden =
                  (user?.leaveHours ?? 0) > 0
                    ? 'verlof'
                    : (user?.allocationHours ?? 0) > 0
                      ? 'elders'
                      : null;
                return (
                  <td key={week.isoWeek} style={{ textAlign: 'right' }}>
                    {week.isClosed ? (
                      <span style={{ color: 'var(--inkt-stil)' }}>gesloten</span>
                    ) : (
                      <>
                        {pct}%
                        {reden && (
                          <span style={{ color: 'var(--inkt-stil)', marginLeft: 4 }}>{reden}</span>
                        )}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PerBegeleider({
  rijen,
}: {
  rijen: Array<{ userId: number; initials: string; weken: unknown[] }>;
}): JSX.Element {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
      {rijen.map((rij) => {
        const weken = rij.weken as Array<{ capacity: number; load: number; utilisationPct: number }>;
        const capaciteit = weken.reduce((sum, week) => sum + week.capacity, 0);
        const belasting = weken.reduce((sum, week) => sum + week.load, 0);
        const bezetting = capaciteit > 0 ? (belasting / capaciteit) * 100 : 0;
        const status: keyof typeof STATUS_TOKENS =
          bezetting < 80 ? 'groen' : bezetting <= 100 ? 'oranje' : 'rood';

        return (
          <li key={rij.userId}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <strong>{rij.initials}</strong>
              <span style={{ color: 'var(--inkt-zacht)' }}>
                {formatDecimal(belasting)} van {formatDecimal(capaciteit)} afspraken ·{' '}
                {Math.round(bezetting)}% · {STATUS_TOKENS[status].label}
              </span>
            </div>
            <div
              style={{ height: 6, background: 'var(--rand)', borderRadius: 3, marginTop: 4 }}
              role="img"
              aria-label={`${rij.initials}: ${Math.round(bezetting)} procent bezet`}
            >
              <div
                style={{
                  width: `${Math.min(100, bezetting)}%`,
                  height: '100%',
                  borderRadius: 3,
                  background: STATUS_TOKENS[status].color,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Kaart({
  children,
  accent,
}: {
  children: ReactNode;
  accent?: string;
}): JSX.Element {
  return (
    <section
      style={{
        background: 'var(--oppervlak-2)',
        border: '1px solid var(--rand)',
        borderLeft: accent ? `3px solid ${accent}` : '1px solid var(--rand)',
        borderRadius: 10,
        padding: 16,
        minWidth: 0,
      }}
    >
      {children}
    </section>
  );
}

export function Skelet({ hoogte }: { hoogte: number }): JSX.Element {
  return (
    <div
      aria-hidden
      style={{
        height: hoogte,
        borderRadius: 8,
        background:
          'linear-gradient(90deg, var(--rand) 0%, var(--oppervlak) 50%, var(--rand) 100%)',
        opacity: 0.5,
      }}
    />
  );
}
