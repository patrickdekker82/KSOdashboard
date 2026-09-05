/**
 * Weten of het scherm smal is (hoofdstuk 12).
 *
 * Nodig omdat de layout niet met CSS alleen te doen is: op een telefoon moet
 * het menu een lade worden die over de inhoud schuift, en dat is een andere
 * component-opzet en niet alleen een andere breedte.
 *
 * Via `matchMedia` en niet via `window.innerWidth` met een resize-luisteraar:
 * de browser vertelt het zelf zodra de grens gepasseerd wordt, zonder dat er
 * bij elke pixel een render volgt.
 */
import { useEffect, useState } from 'react';

/** Onder deze breedte gaat de applicatie in de mobiele opzet. */
export const SMAL_TOT = 720;

export function useSmalScherm(grens = SMAL_TOT): boolean {
  const [smal, setSmal] = useState(() => meet(grens));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const vraag = window.matchMedia(`(max-width: ${grens}px)`);
    const luister = (gebeurtenis: MediaQueryListEvent): void => setSmal(gebeurtenis.matches);

    setSmal(vraag.matches);
    vraag.addEventListener('change', luister);
    return () => vraag.removeEventListener('change', luister);
  }, [grens]);

  return smal;
}

function meet(grens: number): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(`(max-width: ${grens}px)`).matches;
  }
  return window.innerWidth <= grens;
}
