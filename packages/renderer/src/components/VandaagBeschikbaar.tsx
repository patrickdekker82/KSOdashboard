/**
 * "Vandaag beschikbaar: DM ✓ · PD ✓ · RB verlof" (hoofdstuk 9).
 *
 * Toont per begeleider of hij deze week beschikbaar is. Nooit alleen kleur:
 * elke begeleider draagt een woord of een vinkje.
 */
import { useQuery } from '@tanstack/react-query';
import { endpoints } from '../lib/api.ts';
import type { JSX } from 'react';

export function VandaagBeschikbaar(): JSX.Element | null {
  const week = useQuery({
    queryKey: ['beschikbaarheid', 'deze-week'],
    queryFn: () => endpoints.beschikbaarheid(),
  });

  const eerste = week.data?.data?.[0];
  if (!eerste) return null;

  return (
    <div
      style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}
      aria-label="Beschikbaarheid deze week"
    >
      <span style={{ color: 'var(--inkt-stil)' }}>Deze week:</span>
      {eerste.gebruikers.map((gebruiker) => {
        const vrijwelWeg = gebruiker.availabilityFactor < 0.25;
        const deelsWeg = !vrijwelWeg && gebruiker.availabilityFactor < 0.95;
        const woord = vrijwelWeg ? 'afwezig' : deelsWeg ? 'deels' : '✓';
        return (
          <span
            key={gebruiker.userId}
            title={`${gebruiker.initials}: ${Math.round(gebruiker.availabilityFactor * 100)}% beschikbaar`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: vrijwelWeg ? 'var(--verlof)' : 'var(--inkt-zacht)',
            }}
          >
            <strong style={{ fontWeight: 600 }}>{gebruiker.initials}</strong>
            <span>{woord}</span>
          </span>
        );
      })}
    </div>
  );
}
