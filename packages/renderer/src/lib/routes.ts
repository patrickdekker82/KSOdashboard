/**
 * Routes van de schil.
 *
 * Het venster laadt in productie een `file://`-URL, dus de navigatie loopt via
 * de hash. Dat houdt diepe links (`showroom://klant/123`) en de mobiele
 * weergave in de hostmodus op precies dezelfde paden.
 */
import { useCallback, useEffect, useState } from 'react';

export type Route = {
  pad: string;
  label: string;
  groep: 'werk' | 'beheer';
};

export const ROUTES: Route[] = [
  { pad: '/dashboard', label: 'Dashboard', groep: 'werk' },
  { pad: '/klanten', label: 'Klanten', groep: 'werk' },
  { pad: '/contactpersonen', label: 'Contactpersonen', groep: 'werk' },
  { pad: '/kansen', label: 'Kansen', groep: 'werk' },
  { pad: '/projecten', label: 'Projecten', groep: 'werk' },
  { pad: '/planning', label: 'Planning', groep: 'werk' },
  { pad: '/verlof', label: 'Verlof & inzet', groep: 'werk' },
  { pad: '/duurzaamheid', label: 'Duurzaamheid', groep: 'werk' },
  { pad: '/opvolging', label: 'Opvolging', groep: 'werk' },
  { pad: '/dubbelen', label: 'Dubbelen', groep: 'beheer' },
  { pad: '/rapportages', label: 'Rapportages', groep: 'beheer' },
  { pad: '/instellingen', label: 'Instellingen', groep: 'beheer' },
];

function huidigPad(): string {
  const hash = window.location.hash.replace(/^#/, '');
  return hash.startsWith('/') ? hash : '/dashboard';
}

/** Leest en zet de route. Luistert ook naar diepe links uit het hoofdproces. */
export function useRoute(): [string, (pad: string) => void] {
  const [pad, setPad] = useState(huidigPad);

  const navigeer = useCallback((doel: string) => {
    window.location.hash = doel;
    setPad(doel);
  }, []);

  useEffect(() => {
    const onHash = (): void => setPad(huidigPad());
    window.addEventListener('hashchange', onHash);

    // Menu, systeemvak en diepe links sturen hun route via preload hierheen.
    const stop = window.showroom?.onNavigatie((doel) => {
      if (doel.startsWith('#')) return; // paneel openen, geen route
      navigeer(doel);
    });

    return () => {
      window.removeEventListener('hashchange', onHash);
      stop?.();
    };
  }, [navigeer]);

  return [pad, navigeer];
}
