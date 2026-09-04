/**
 * Globale zoekbalk (Ctrl+K).
 *
 * Zoekt terwijl je typt over klanten, contactpersonen, projecten en kansen.
 * Volledig met het toetsenbord te bedienen: pijltjes om te kiezen, Enter om te
 * openen, Escape om te sluiten — want dat is waar een zoekbalk voor bedoeld is.
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { endpoints, type ZoekTreffer } from '../lib/api.ts';

/** Waar een treffer heen linkt. */
const ROUTE_PER_ENTITEIT: Record<string, string> = {
  organizations: '/klanten',
  contacts: '/contactpersonen',
  projects: '/projecten',
  opportunities: '/kansen',
};

export function Zoekbalk({ navigeer }: { navigeer: (pad: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [gekozen, setGekozen] = useState(0);
  const invoer = useRef<HTMLInputElement>(null);

  // Ctrl+K opent de balk, waar je ook bent.
  useEffect(() => {
    const opToets = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', opToets);

    // Het menu en het systeemvak sturen "#zoeken" hierheen.
    const stop = window.showroom?.onNavigatie((route) => {
      if (route === '#zoeken') setOpen(true);
    });

    return () => {
      window.removeEventListener('keydown', opToets);
      stop?.();
    };
  }, []);

  useEffect(() => {
    if (open) invoer.current?.focus();
    else {
      setTerm('');
      setGekozen(0);
    }
  }, [open]);

  const resultaat = useQuery({
    queryKey: ['zoeken', term],
    queryFn: () => endpoints.zoek(term),
    enabled: open && term.trim().length >= 2,
    staleTime: 10_000,
  });

  const treffers = useMemo<ZoekTreffer[]>(() => resultaat.data?.data.treffers ?? [], [resultaat.data]);

  function ga(treffer: ZoekTreffer): void {
    const basis = ROUTE_PER_ENTITEIT[treffer.entiteit];
    if (!basis) return;
    navigeer(`${basis}/${treffer.id}`);
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        className="focus-ring"
        onClick={() => setOpen(true)}
        aria-label="Zoeken (Ctrl+K)"
        style={{
          flex: '0 1 320px',
          textAlign: 'left',
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid var(--rand)',
          background: 'var(--oppervlak)',
          color: 'var(--inkt-stil)',
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        Zoeken… <span style={{ float: 'right', fontSize: 11 }}>Ctrl+K</span>
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Zoeken"
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgb(0 0 0 / 0.35)',
        display: 'grid',
        justifyItems: 'center',
        alignItems: 'start',
        paddingTop: '12vh',
        zIndex: 100,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(560px, 92vw)',
          background: 'var(--oppervlak-2)',
          border: '1px solid var(--rand)',
          borderRadius: 10,
          boxShadow: '0 16px 48px rgb(0 0 0 / 0.25)',
          overflow: 'hidden',
        }}
      >
        <input
          ref={invoer}
          type="search"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setGekozen(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') return setOpen(false);
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setGekozen((huidig) => Math.min(huidig + 1, treffers.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setGekozen((huidig) => Math.max(huidig - 1, 0));
            }
            if (event.key === 'Enter' && treffers[gekozen]) ga(treffers[gekozen]!);
          }}
          placeholder="Zoek een klant, contactpersoon, project of kans…"
          aria-label="Zoekterm"
          aria-autocomplete="list"
          aria-controls="zoekresultaten"
          style={{
            width: '100%',
            padding: '14px 16px',
            border: 0,
            borderBottom: '1px solid var(--rand)',
            background: 'transparent',
            color: 'var(--inkt)',
            fontSize: 15,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        <ul
          id="zoekresultaten"
          role="listbox"
          style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 380, overflowY: 'auto' }}
        >
          {term.trim().length < 2 && (
            <li style={{ padding: 16, color: 'var(--inkt-stil)', fontSize: 13 }}>
              Typ minimaal twee letters. Pijltjes om te kiezen, Enter om te openen.
            </li>
          )}

          {term.trim().length >= 2 && resultaat.isLoading && (
            <li style={{ padding: 16, color: 'var(--inkt-stil)', fontSize: 13 }}>Zoeken…</li>
          )}

          {term.trim().length >= 2 && !resultaat.isLoading && treffers.length === 0 && (
            <li style={{ padding: 16, color: 'var(--inkt-zacht)', fontSize: 13 }}>
              Niets gevonden voor “{term}”.
            </li>
          )}

          {treffers.map((treffer, index) => (
            <li key={`${treffer.entiteit}-${treffer.id}`} role="option" aria-selected={index === gekozen}>
              <button
                type="button"
                onClick={() => ga(treffer)}
                onMouseEnter={() => setGekozen(index)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '9px 16px',
                  border: 0,
                  background: index === gekozen ? 'var(--rand)' : 'transparent',
                  color: 'var(--inkt)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 10,
                  font: 'inherit',
                  fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 500 }}>{treffer.titel}</span>
                {treffer.ondertitel && (
                  <span style={{ color: 'var(--inkt-zacht)' }}>{treffer.ondertitel}</span>
                )}
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 11,
                    color: 'var(--inkt-stil)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {treffer.soort}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
