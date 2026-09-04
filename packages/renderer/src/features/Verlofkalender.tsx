/**
 * Verlofkalender (hoofdstuk 6.4.1).
 *
 * Jaarraster: rijen zijn medewerkers, kolommen zijn weken. Daaronder staat
 * permanent de capaciteitsstrook, want dat is het punt van deze module: je
 * ziet meteen wat verlof en inzet elders met de planning doen.
 *
 * Verlof, ziekte en inzet zijn niet alleen aan kleur te herkennen. Elk blok
 * draagt ook een letter, en de legenda benoemt ze.
 */
import { useQuery } from '@tanstack/react-query';
import { getIsoWeek, STATUS_TOKENS } from '@showroom/shared';
import { endpoints } from '../lib/api.ts';
import { Kaart, Skelet } from './Dashboard.tsx';
import type { JSX } from 'react';

type Blok = {
  soort: 'verlof' | 'ziekte' | 'inzet';
  letter: string;
  kleur: string;
  titel: string;
};

/** Eén cel per medewerker per week, met wat er in die week speelt. */
function bouwRaster(
  afwezigheid: Record<string, unknown>[],
  inzet: Record<string, unknown>[],
  weken: Array<{ isoYear: number; isoWeek: number; startDate: string; endDate: string }>,
): Map<string, Map<string, Blok>> {
  const raster = new Map<string, Map<string, Blok>>();

  const zet = (initialen: string, sleutel: string, blok: Blok): void => {
    const rij = raster.get(initialen) ?? new Map<string, Blok>();
    // Ziekte en verlof gaan voor inzet elders in de weergave.
    if (!rij.has(sleutel) || blok.soort !== 'inzet') rij.set(sleutel, blok);
    raster.set(initialen, rij);
  };

  const overlapt = (start: string, eind: string | null, week: { startDate: string; endDate: string }): boolean =>
    start <= week.endDate && (eind === null || eind >= week.startDate);

  for (const rij of afwezigheid) {
    const type = String(rij.type_name ?? 'Afwezig');
    const ziek = type.toLowerCase().includes('ziek');
    for (const week of weken) {
      if (!overlapt(String(rij.start_date), (rij.end_date as string | null) ?? null, week)) continue;
      zet(String(rij.initials), `${week.isoYear}-${week.isoWeek}`, {
        soort: ziek ? 'ziekte' : 'verlof',
        letter: ziek ? 'Z' : 'V',
        kleur: ziek ? 'var(--ziekte)' : 'var(--verlof)',
        titel: `${type} — ${String(rij.start_date)} t/m ${String(rij.end_date ?? 'nader order')}`,
      });
    }
  }

  for (const rij of inzet) {
    for (const week of weken) {
      if (!overlapt(String(rij.start_date), String(rij.end_date), week)) continue;
      zet(String(rij.initials), `${week.isoYear}-${week.isoWeek}`, {
        soort: 'inzet',
        letter: 'I',
        kleur: 'var(--inzet)',
        titel: `${String(rij.title)} — ${String(rij.allocation_value)} ${String(rij.allocation_mode)}`,
      });
    }
  }

  return raster;
}

export function Verlofkalender(): JSX.Element {
  const huidig = getIsoWeek(new Date());
  const kalender = useQuery({
    queryKey: ['kalender', huidig.year, huidig.week],
    queryFn: () => endpoints.kalender(),
  });

  if (kalender.isLoading) {
    return (
      <Kaart>
        <Skelet hoogte={300} />
      </Kaart>
    );
  }

  const data = kalender.data?.data;
  const weken = data?.weken ?? [];
  const raster = bouwRaster(data?.afwezigheid ?? [], data?.inzet ?? [], weken);
  const begeleiders = [...new Set(weken.flatMap((week) => week.byUser.map((u) => u.initials)))];

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Kaart>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Jaarraster</h2>
          <Legenda />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <caption className="alleen-voorlezen" style={{ textAlign: 'left', paddingBottom: 6, color: 'var(--inkt-zacht)' }}>
              Wie is wanneer weg of elders ingezet
            </caption>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: 'left', padding: '4px 8px', position: 'sticky', left: 0, background: 'var(--oppervlak-2)' }}>
                  Medewerker
                </th>
                {weken.map((week) => (
                  <th
                    key={`${week.isoYear}-${week.isoWeek}`}
                    scope="col"
                    style={{ padding: '4px 2px', fontWeight: 400, color: 'var(--inkt-stil)', minWidth: 26 }}
                  >
                    {week.isoWeek}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {begeleiders.map((initialen) => (
                <tr key={initialen}>
                  <th
                    scope="row"
                    style={{ textAlign: 'left', padding: '4px 8px', position: 'sticky', left: 0, background: 'var(--oppervlak-2)', fontWeight: 500 }}
                  >
                    {initialen}
                  </th>
                  {weken.map((week) => {
                    const blok = raster.get(initialen)?.get(`${week.isoYear}-${week.isoWeek}`);
                    return (
                      <td key={`${week.isoYear}-${week.isoWeek}`} style={{ padding: 1 }}>
                        <div
                          title={blok?.titel ?? (week.isClosed ? 'Gesloten week' : 'Beschikbaar')}
                          className={week.isClosed && !blok ? 'arcering-gesloten' : undefined}
                          style={{
                            height: 22,
                            borderRadius: 3,
                            background: blok ? blok.kleur : 'var(--rand)',
                            opacity: blok ? 1 : 0.4,
                            color: '#fff',
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: 10,
                            fontWeight: 600,
                          }}
                        >
                          {/* Nooit alleen kleur: elk blok draagt zijn letter. */}
                          {blok?.letter ?? ''}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Kaart>

      {/* De capaciteitsstrook staat permanent onder elke weergave. */}
      <Kaart>
        <h2 style={{ fontSize: 15, margin: '0 0 4px' }}>Resulterende weekcapaciteit</h2>
        <p style={{ color: 'var(--inkt-zacht)', margin: '0 0 12px', fontSize: 13 }}>
          Elke wijziging in verlof of inzet werkt hier direct in door.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 2, minWidth: weken.length * 28 }}>
            {weken.map((week) => {
              const status = STATUS_TOKENS[week.status];
              const hoogte = Math.min(100, week.utilisationPct);
              return (
                <div
                  key={`${week.isoYear}-${week.isoWeek}`}
                  title={`Week ${week.isoWeek}: ${Math.round(week.utilisationPct)}% — ${status.label}`}
                  style={{ width: 26, textAlign: 'center' }}
                >
                  <div
                    style={{
                      height: 48,
                      display: 'flex',
                      alignItems: 'flex-end',
                      background: 'var(--rand)',
                      borderRadius: 3,
                      overflow: 'hidden',
                    }}
                    className={week.isClosed ? 'arcering-gesloten' : undefined}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: `${hoogte}%`,
                        background: status.color,
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--inkt-stil)' }}>{week.isoWeek}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Kaart>
    </div>
  );
}

function Legenda(): JSX.Element {
  const items: Array<{ letter: string; kleur: string; label: string }> = [
    { letter: 'V', kleur: 'var(--verlof)', label: 'Verlof' },
    { letter: 'Z', kleur: 'var(--ziekte)', label: 'Ziekte' },
    { letter: 'I', kleur: 'var(--inzet)', label: 'Inzet elders' },
  ];
  return (
    <ul style={{ display: 'flex', gap: 14, margin: 0, padding: 0, listStyle: 'none', fontSize: 12 }}>
      {items.map((item) => (
        <li key={item.letter} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            aria-hidden
            style={{
              width: 16,
              height: 16,
              borderRadius: 3,
              background: item.kleur,
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            {item.letter}
          </span>
          <span style={{ color: 'var(--inkt-zacht)' }}>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
