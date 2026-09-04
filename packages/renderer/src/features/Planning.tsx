/**
 * Planning met scenario-schuiven (hoofdstuk 8.1 en 15.6).
 *
 * De schuiven raken de database niet: ze sturen dezelfde engine aan via
 * /capacity/simulate, zodat je een aanname kunt uitproberen zonder iets vast
 * te leggen.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_CAPACITY_SETTINGS } from '@showroom/shared';
import { endpoints } from '../lib/api.ts';
import { BezettingsGrafiek } from '../components/BezettingsGrafiek.tsx';
import { Kaart, Skelet } from './Dashboard.tsx';
import type { JSX } from 'react';

export function Planning(): JSX.Element {
  const [scenarioAan, setScenarioAan] = useState(false);
  const [a, setA] = useState(DEFAULT_CAPACITY_SETTINGS.totalWeeklyCapacity ?? 9);
  const [v, setV] = useState(1);
  const [d, setD] = useState(5);

  const basis = useQuery({
    queryKey: ['weekbezetting', 'planning'],
    queryFn: () => endpoints.weekbezetting(),
  });

  const scenario = useQuery({
    queryKey: ['scenario', a, v, d],
    queryFn: () => endpoints.simuleer({ A: a, V: v, D: d }),
    enabled: scenarioAan,
  });

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>Planning</h1>

      <Kaart>
        {basis.isLoading ? (
          <Skelet hoogte={340} />
        ) : (
          <BezettingsGrafiek
            weken={basis.data?.data ?? []}
            scenario={scenarioAan ? (scenario.data?.data ?? null) : null}
            titel="Bezetting per week"
            hoogte={340}
          />
        )}
      </Kaart>

      <Kaart>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Scenario</h2>
          <label style={{ fontSize: 13, color: 'var(--inkt-zacht)', marginLeft: 'auto' }}>
            <input
              type="checkbox"
              checked={scenarioAan}
              onChange={(event) => setScenarioAan(event.target.checked)}
              style={{ marginRight: 6 }}
            />
            Scenario tonen
          </label>
        </div>

        <p style={{ color: 'var(--inkt-zacht)', margin: '0 0 16px', fontSize: 13, lineHeight: 1.6 }}>
          Deze schuiven veranderen niets aan de vastgelegde gegevens. Ze rekenen dezelfde
          planning door met andere aannames.
        </p>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          <Schuif
            label="A — afspraken per week (team)"
            waarde={a}
            min={1}
            max={20}
            stap={1}
            onWijzig={setA}
            uitleg="Het teamplafond: hoeveel showroomafspraken er per week passen."
          />
          <Schuif
            label="V — afspraken per woning"
            waarde={v}
            min={1}
            max={4}
            stap={1}
            onWijzig={setV}
            uitleg="Meestal 1: de tweede afspraak gaat telefonisch en belast de showroom niet."
          />
          <Schuif
            label="D — doorlooptijd in weken"
            waarde={d}
            min={1}
            max={12}
            stap={1}
            onWijzig={setD}
            uitleg="Over hoeveel weken het nawerk van een afspraak zich uitsmeert."
          />
        </div>
      </Kaart>
    </div>
  );
}

function Schuif({
  label,
  waarde,
  min,
  max,
  stap,
  onWijzig,
  uitleg,
}: {
  label: string;
  waarde: number;
  min: number;
  max: number;
  stap: number;
  onWijzig: (waarde: number) => void;
  uitleg: string;
}): JSX.Element {
  const id = `schuif-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
        {label}: <strong>{waarde}</strong>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={stap}
        value={waarde}
        onChange={(event) => onWijzig(Number(event.target.value))}
        className="focus-ring"
        style={{ width: '100%' }}
        aria-describedby={`${id}-uitleg`}
      />
      <p id={`${id}-uitleg`} style={{ fontSize: 12, color: 'var(--inkt-stil)', margin: '4px 0 0' }}>
        {uitleg}
      </p>
    </div>
  );
}
