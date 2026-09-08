/**
 * Een verwijzing kiezen door te typen (hoofdstuk 3.2).
 *
 * Verwijzingsvelden waren een keuzelijst met alles erin. Bij een handvol
 * waarden werkt dat; bij een paar honderd klanten scrol je jezelf suf, en
 * boven de 500 stond een klant er niet eens meer in — zoveel laadt het scherm
 * er namelijk maar.
 *
 * Daarom wordt er twee kanten op gezocht: meteen in wat al geladen is, zodat
 * er geen wachttijd tussen typen en zien zit, én bij de kern, zodat ook een
 * klant buiten die eerste vijfhonderd gevonden wordt. De treffers worden
 * samengevoegd, dubbelen eruit.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FieldDefinition } from '@showroom/shared';
import { endpoints } from '../../lib/api.ts';
import { labelVanRij, verwijsEntiteit } from '../../lib/schema.ts';
import type { Keuze } from './VeldInvoer.tsx';

const MAX_TREFFERS = 25;

export function Verwijzingskiezer({
  veld,
  waarde,
  keuzes,
  onWijzig,
  id,
  stijl,
  beschrijfBij,
  fout,
}: {
  veld: FieldDefinition;
  waarde: unknown;
  keuzes: Keuze[];
  onWijzig: (waarde: unknown) => void;
  id: string;
  stijl: CSSProperties;
  beschrijfBij?: string;
  fout?: string | null;
}): JSX.Element {
  const entiteit = verwijsEntiteit(veld);
  const gekozenId = waarde === null || waarde === undefined ? null : Number(waarde);
  const gekozenLabel = useMemo(
    () => keuzes.find((keuze) => Number(keuze.value) === gekozenId)?.label ?? null,
    [keuzes, gekozenId],
  );

  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [actief, setActief] = useState(0);
  const omhulsel = useRef<HTMLDivElement>(null);

  // Buiten klikken sluit de lijst; anders blijft hij over de pagina hangen.
  useEffect(() => {
    if (!open) return;
    const opKlik = (gebeurtenis: MouseEvent): void => {
      if (!omhulsel.current?.contains(gebeurtenis.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', opKlik);
    return () => document.removeEventListener('mousedown', opKlik);
  }, [open]);

  const zoekterm = term.trim();

  // Bij de kern zoeken zodra er iets staat om op te zoeken.
  const opServer = useQuery({
    queryKey: ['verwijzing-zoek', entiteit, zoekterm],
    queryFn: () =>
      endpoints.lijst<Record<string, unknown>>(
        entiteit,
        `?pageSize=${MAX_TREFFERS}&q=${encodeURIComponent(zoekterm)}`,
      ),
    enabled: open && zoekterm.length >= 2,
    staleTime: 30_000,
  });

  const treffers = useMemo(() => {
    const laag = zoekterm.toLowerCase();
    const uit = new Map<string, Keuze>();

    for (const keuze of keuzes) {
      if (laag === '' || keuze.label.toLowerCase().includes(laag)) uit.set(keuze.value, keuze);
      if (uit.size >= MAX_TREFFERS) break;
    }

    for (const rij of opServer.data?.data ?? []) {
      const sleutel = String(rij.id);
      if (!uit.has(sleutel))
        uit.set(sleutel, { value: sleutel, label: labelVanRij(entiteit, rij) });
    }

    return [...uit.values()].slice(0, MAX_TREFFERS);
  }, [keuzes, opServer.data, zoekterm, entiteit]);

  function kies(keuze: Keuze): void {
    onWijzig(Number(keuze.value));
    setTerm('');
    setOpen(false);
  }

  function opToets(gebeurtenis: React.KeyboardEvent<HTMLInputElement>): void {
    if (gebeurtenis.key === 'ArrowDown') {
      gebeurtenis.preventDefault();
      setOpen(true);
      setActief((huidig) => Math.min(huidig + 1, treffers.length - 1));
    } else if (gebeurtenis.key === 'ArrowUp') {
      gebeurtenis.preventDefault();
      setActief((huidig) => Math.max(huidig - 1, 0));
    } else if (gebeurtenis.key === 'Enter') {
      if (open && treffers[actief]) {
        gebeurtenis.preventDefault();
        kies(treffers[actief]);
      }
    } else if (gebeurtenis.key === 'Escape') {
      setOpen(false);
    }
  }

  const lijstId = `${id}-treffers`;

  return (
    <div ref={omhulsel} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          id={id}
          className="focus-ring"
          style={stijl}
          role="combobox"
          aria-expanded={open}
          aria-controls={lijstId}
          aria-autocomplete="list"
          aria-invalid={fout ? true : undefined}
          aria-describedby={beschrijfBij}
          disabled={!veld.editable}
          // Zolang de lijst dicht is staat de gekozen waarde er; gaat hij open,
          // dan typ je een zoekterm.
          value={open ? term : (gekozenLabel ?? '')}
          placeholder={gekozenLabel === null ? 'Typ om te zoeken…' : undefined}
          onFocus={() => {
            setOpen(true);
            setActief(0);
          }}
          onChange={(gebeurtenis) => {
            setTerm(gebeurtenis.target.value);
            setActief(0);
            setOpen(true);
          }}
          onKeyDown={opToets}
        />
        {gekozenId !== null && veld.editable && (
          <button
            type="button"
            className="focus-ring"
            aria-label={`${veld.label} leegmaken`}
            onClick={() => {
              onWijzig(null);
              setTerm('');
            }}
            style={{
              border: '1px solid var(--rand)',
              background: 'transparent',
              color: 'var(--inkt-zacht)',
              borderRadius: 6,
              cursor: 'pointer',
              padding: '0 8px',
            }}
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <ul
          id={lijstId}
          role="listbox"
          style={{
            position: 'absolute',
            zIndex: 40,
            left: 0,
            right: 0,
            margin: '2px 0 0',
            padding: 0,
            listStyle: 'none',
            maxHeight: 240,
            overflowY: 'auto',
            background: 'var(--oppervlak-2)',
            border: '1px solid var(--rand)',
            borderRadius: 6,
            boxShadow: '0 10px 30px rgb(0 0 0 / 0.18)',
          }}
        >
          {treffers.length === 0 && (
            <li style={{ padding: '8px 10px', fontSize: 12, color: 'var(--inkt-stil)' }}>
              {opServer.isFetching ? 'Zoeken…' : 'Niets gevonden.'}
            </li>
          )}
          {treffers.map((keuze, index) => (
            <li key={keuze.value} role="option" aria-selected={index === actief}>
              <button
                type="button"
                onMouseEnter={() => setActief(index)}
                onClick={() => kies(keuze)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '7px 10px',
                  border: 0,
                  cursor: 'pointer',
                  fontSize: 13,
                  background: index === actief ? 'var(--rand)' : 'transparent',
                  color: 'var(--inkt)',
                }}
              >
                {keuze.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
