/**
 * De grafiek pas ophalen wanneer hij in beeld komt (hoofdstuk 2.9).
 *
 * Recharts sleept d3 mee en is bijna een megabyte. Dat is prima op het
 * dashboard, maar het inlogscherm hoeft er niet op te wachten — en op een
 * showroom-pc met een trage schijf scheelt dat merkbaar bij het opstarten.
 *
 * `lazy` splitst het bestand af; de terugval hieronder houdt de hoogte vast,
 * zodat de pagina niet opspringt zodra de grafiek binnen is.
 */
import { Suspense, lazy, type ComponentProps, type JSX } from 'react';
// Alleen het type: een type-import verdwijnt bij het bouwen en trekt de
// grafiekcode dus niet alsnog de hoofdbundel in.
import type { BezettingsGrafiek as Echte } from './BezettingsGrafiek.tsx';

const Echt = lazy(async () => ({
  default: (await import('./BezettingsGrafiek.tsx')).BezettingsGrafiek,
}));

/** Precies de eigenschappen van het echte component; niet overgeschreven. */
type Props = ComponentProps<typeof Echte>;

export function BezettingsGrafiek(eigenschappen: Props): JSX.Element {
  const hoogte = eigenschappen.hoogte ?? 320;

  return (
    <Suspense
      fallback={
        <div
          style={{
            height: hoogte,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--inkt-zacht)',
            fontSize: 12,
          }}
        >
          Grafiek wordt geladen…
        </div>
      }
    >
      <Echt {...eigenschappen} />
    </Suspense>
  );
}
