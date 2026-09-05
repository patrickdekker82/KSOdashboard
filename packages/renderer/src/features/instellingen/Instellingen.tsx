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
  {
    pad: '/instellingen/signaleringen',
    titel: 'Signaleringen',
    uitleg:
      'De achttien regels die het dashboard voeden: aan of uit, hoe erg, en met welke ' +
      'drempels. Inclusief wanneer ze voor het laatst gedraaid hebben.',
    klaar: true,
  },
  {
    pad: '/instellingen/gebruikers',
    titel: 'Gebruikers & rollen',
    uitleg:
      'Wie er in mag, met welke rol, en wie meetelt als kopersbegeleider in de bezetting.',
    klaar: true,
  },
  {
    pad: '/instellingen/roosters',
    titel: 'Werkroosters',
    uitleg:
      'Uren per dag en afspraken per week, met een ingangsdatum — zodat een roosterwijziging ' +
      'de bezetting van vorig jaar niet met terugwerkende kracht verandert.',
    klaar: true,
  },
  {
    pad: '/instellingen/keuzelijsten',
    titel: 'Keuzelijsten',
    uitleg: 'De waarden achter de keuzevelden: statussen, bronnen, redenen, afwezigheidstypes.',
    klaar: true,
  },
  {
    pad: '/instellingen/capaciteit',
    titel: 'Capaciteitsinstellingen',
    uitleg:
      'De getallen waar de bezettingsberekening op draait: afspraken per woning, doorlooptijd, ' +
      'minimale bezetting en marge.',
    klaar: true,
  },
  {
    pad: '/instellingen/backup',
    titel: 'Back-up & herstel',
    uitleg:
      'Nu een back-up maken, de nachtelijke loop instellen, een kopie controleren en er een ' +
      'terugzetten. Met een logboek van elke poging.',
    klaar: true,
  },
  {
    pad: '/instellingen/netwerk',
    titel: 'Netwerk & updates',
    uitleg:
      'Hostmodus aanzetten zodat collega\u2019s en telefoons meekijken, en aanwijzen waar de ' +
      'installer van een nieuwe versie staat.',
    klaar: true,
  },
  { pad: '', titel: 'Microsoft 365-koppeling', uitleg: 'Buiten scope; zie BESLISSINGEN.', klaar: false },
  {
    pad: '/instellingen/ai',
    titel: 'AI-assistent',
    uitleg:
      'De enige koppeling die deze applicatie naar buiten heeft. Sleutel, presets, wat er ' +
      'wel en niet meegaat, en een logboek van elke aanroep met de kosten.',
    klaar: true,
  },
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
