/**
 * De verlofmodule, in tabbladen (hoofdstuk 6.4).
 *
 * De kalender is het overzicht, maar het werk gebeurt in de andere tabbladen:
 * aanvragen, beoordelen, saldo bijhouden en inzet elders vastleggen. Het
 * goedkeuringstabblad staat er alleen voor wie mag beslissen; het verbergen is
 * hier niet de beveiliging — de kern weigert de beslissing sowieso — maar
 * voorkomt een knop die toch niet werkt.
 */
import { useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { endpoints, type Afwezigheid, type Gebruiker } from '../../lib/api.ts';
import { Verlofkalender } from '../Verlofkalender.tsx';
import { Aanvragen } from './Aanvragen.tsx';
import { Goedkeuren } from './Goedkeuren.tsx';
import { Saldo } from './Saldo.tsx';
import { Inzet } from './Inzet.tsx';

type Tab = 'kalender' | 'aanvragen' | 'goedkeuren' | 'saldo' | 'inzet';

export function Verlof({ ik }: { ik: Gebruiker }): JSX.Element {
  const [tab, setTab] = useState<Tab>('kalender');
  const magBeslissen = ik.role === 'manager' || ik.role === 'admin';

  // Het aantal op het tabblad zelf: anders moet een manager erheen klikken om
  // te ontdekken dat er niets ligt.
  const openstaand = useQuery({
    queryKey: ['openstaand-verlof'],
    queryFn: () =>
      endpoints.lijst<Afwezigheid>(
        'absences',
        `?filter=${btoa(JSON.stringify({ field: 'status', operator: 'eq', value: 'aangevraagd' }))}&pageSize=100`,
      ),
    enabled: magBeslissen,
  });

  const tabbladen: Array<{ sleutel: Tab; label: string; aantal?: number }> = [
    { sleutel: 'kalender', label: 'Kalender' },
    { sleutel: 'aanvragen', label: 'Aanvragen' },
    ...(magBeslissen
      ? [
          {
            sleutel: 'goedkeuren' as const,
            label: 'Goedkeuren',
            aantal: openstaand.data?.data.length ?? 0,
          },
        ]
      : []),
    { sleutel: 'saldo', label: 'Saldo' },
    { sleutel: 'inzet', label: 'Inzet elders' },
  ];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>Verlof &amp; inzet</h1>

      <div
        role="tablist"
        aria-label="Onderdelen van verlof en inzet"
        style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--rand)', flexWrap: 'wrap' }}
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
              {blad.aantal !== undefined && blad.aantal > 0 && (
                <span
                  style={{
                    marginLeft: 6,
                    background: 'var(--belasting)',
                    color: '#fff',
                    borderRadius: 9,
                    padding: '1px 6px',
                    fontSize: 11,
                  }}
                >
                  {blad.aantal}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {tab === 'kalender' && <Verlofkalender />}
        {tab === 'aanvragen' && <Aanvragen ik={ik} />}
        {tab === 'goedkeuren' && magBeslissen && <Goedkeuren />}
        {tab === 'saldo' && <Saldo ik={ik} />}
        {tab === 'inzet' && <Inzet ik={ik} />}
      </div>
    </div>
  );
}
