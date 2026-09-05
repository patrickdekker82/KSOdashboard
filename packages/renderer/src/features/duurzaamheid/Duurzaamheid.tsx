/**
 * Duurzaamheid in tabbladen: de pakketten en de offertes die eruit komen
 * (hoofdstuk 6.5).
 */
import { useState, type JSX } from 'react';
import { Pakketten } from './Pakketten.tsx';
import { GeneriekeLijst } from '../generiek/GeneriekeLijst.tsx';

type Tab = 'pakketten' | 'offertes';

export function Duurzaamheid({ navigeer }: { navigeer: (pad: string) => void }): JSX.Element {
  const [tab, setTab] = useState<Tab>('pakketten');

  const tabbladen: Array<{ sleutel: Tab; label: string }> = [
    { sleutel: 'pakketten', label: 'Pakketten' },
    { sleutel: 'offertes', label: 'Offertes' },
  ];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div
        role="tablist"
        aria-label="Onderdelen van duurzaamheid"
        style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--rand)' }}
      >
        {tabbladen.map((blad) => {
          const actief = tab === blad.sleutel;
          return (
            <button
              key={blad.sleutel}
              type="button"
              role="tab"
              aria-selected={actief}
              className="focus-ring"
              onClick={() => setTab(blad.sleutel)}
              style={{
                background: 'transparent',
                border: 0,
                borderBottom: `2px solid ${actief ? 'var(--belasting)' : 'transparent'}`,
                color: actief ? 'var(--inkt)' : 'var(--inkt-zacht)',
                fontWeight: actief ? 600 : 400,
                fontSize: 13,
                padding: '6px 10px',
                cursor: 'pointer',
              }}
            >
              {blad.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {tab === 'pakketten' && <Pakketten navigeer={navigeer} />}
        {tab === 'offertes' && (
          <GeneriekeLijst
            entiteit="package-quotes"
            titel="Offertes"
            onOpen={(id) => navigeer(`/duurzaamheid/offerte/${id}`)}
          />
        )}
      </div>
    </div>
  );
}
