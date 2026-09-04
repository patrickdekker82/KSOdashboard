import type { JSX } from 'react';
import { Kaart } from '../Dashboard.tsx';

/** Overzicht van de beheerschermen. Wat er nog niet is, staat er eerlijk bij. */
const ONDERDELEN: Array<{ pad: string; titel: string; uitleg: string; klaar: boolean }> = [
  {
    pad: '/instellingen/velden',
    titel: 'Velden & layouts',
    uitleg:
      'Velden toevoegen, hernoemen, verplaatsen, verbergen en verwijderen — zonder code, ' +
      'voor elke entiteit.',
    klaar: true,
  },
  { pad: '', titel: 'Gebruikers & rollen', uitleg: 'Komt in fase 12.', klaar: false },
  { pad: '', titel: 'Werkroosters', uitleg: 'Komt in fase 12.', klaar: false },
  { pad: '', titel: 'Keuzelijsten', uitleg: 'Komt in fase 12.', klaar: false },
  { pad: '', titel: 'Capaciteitsinstellingen', uitleg: 'Komt in fase 12.', klaar: false },
  { pad: '', titel: 'Back-up & herstel', uitleg: 'Komt in fase 12.', klaar: false },
  { pad: '', titel: 'Microsoft 365-koppeling', uitleg: 'Komt in fase 9.', klaar: false },
  { pad: '', titel: 'AI-instellingen', uitleg: 'Komt in fase 10.', klaar: false },
];

export function Instellingen({ navigeer }: { navigeer: (pad: string) => void }): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>Instellingen</h1>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {ONDERDELEN.map((onderdeel) => (
          <Kaart key={onderdeel.titel} accent={onderdeel.klaar ? 'var(--belasting)' : undefined}>
            {onderdeel.klaar ? (
              <button
                type="button"
                className="focus-ring"
                onClick={() => navigeer(onderdeel.pad)}
                style={{
                  background: 'none',
                  border: 0,
                  padding: 0,
                  font: 'inherit',
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--belasting)',
                  cursor: 'pointer',
                }}
              >
                {onderdeel.titel} →
              </button>
            ) : (
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--inkt-stil)' }}>
                {onderdeel.titel}
              </span>
            )}
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--inkt-zacht)', lineHeight: 1.6 }}>
              {onderdeel.uitleg}
            </p>
          </Kaart>
        ))}
      </div>
    </div>
  );
}
