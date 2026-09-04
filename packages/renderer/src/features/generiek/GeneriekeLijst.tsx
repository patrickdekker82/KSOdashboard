/**
 * Eén lijstcomponent voor elke entiteit (hoofdstuk 3.6 en 5).
 *
 * Kolommen, filters en sortering komen uit het veldenregister, dus een veld
 * dat een beheerder toevoegt verschijnt hier vanzelf — in de kolomkiezer, in
 * het filter en in de export.
 */
import { useMemo, useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { OPERATORS_BY_TYPE, type FieldDefinition } from '@showroom/shared';
import { endpoints } from '../../lib/api.ts';
import { useEntiteitSchema, waardeVan } from '../../lib/schema.ts';
import { VeldWaarde, uitlijning } from '../../components/velden/VeldWaarde.tsx';
import { Kaart, Skelet } from '../Dashboard.tsx';

type Rij = Record<string, unknown>;

export type Filter = { field: string; operator: string; value?: unknown };

const OPERATOR_LABEL: Record<string, string> = {
  eq: 'is',
  neq: 'is niet',
  contains: 'bevat',
  startsWith: 'begint met',
  gt: 'groter dan',
  gte: 'groter dan of gelijk aan',
  lt: 'kleiner dan',
  lte: 'kleiner dan of gelijk aan',
  isEmpty: 'is leeg',
  isNotEmpty: 'is niet leeg',
  in: 'is een van',
  notIn: 'is geen van',
  between: 'ligt tussen',
  dateWithin: 'binnen periode',
};

export function GeneriekeLijst({
  entiteit,
  titel,
  onOpen,
}: {
  entiteit: string;
  titel: string;
  onOpen?: (id: number) => void;
}): JSX.Element {
  const schema = useEntiteitSchema(entiteit);
  const [zoek, setZoek] = useState('');
  const [pagina, setPagina] = useState(1);
  const [sortering, setSortering] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [verborgen, setVerborgen] = useState<Set<string>>(new Set());
  const [kolomkiezerOpen, setKolomkiezerOpen] = useState(false);

  const kolommen = useMemo(
    () => schema.lijstVelden.filter((veld) => !verborgen.has(veld.fieldKey)),
    [schema.lijstVelden, verborgen],
  );

  const query = useMemo(() => {
    const delen = [`page=${pagina}`, 'pageSize=50'];
    if (zoek.trim()) delen.push(`q=${encodeURIComponent(zoek.trim())}`);
    if (sortering) delen.push(`sort=${encodeURIComponent(sortering)}`);
    const bruikbaar = filters.filter(
      (filter) =>
        filter.field &&
        (['isEmpty', 'isNotEmpty'].includes(filter.operator) ||
          (filter.value !== undefined && filter.value !== '')),
    );
    if (bruikbaar.length > 0) {
      const boom =
        bruikbaar.length === 1 ? bruikbaar[0]! : { op: 'and' as const, children: bruikbaar };
      delen.push(`filter=${encodeURIComponent(btoa(JSON.stringify(boom)))}`);
    }
    return `?${delen.join('&')}`;
  }, [pagina, zoek, sortering, filters]);

  const lijst = useQuery({
    queryKey: ['lijst', entiteit, query],
    queryFn: () => endpoints.lijst<Rij>(entiteit, query),
    enabled: !schema.bezig,
  });

  const meta = lijst.data?.meta as
    | { page: number; pageSize: number; total: number; totalPages: number }
    | undefined;

  function wisselSortering(veld: FieldDefinition): void {
    setPagina(1);
    setSortering((huidig) =>
      huidig === veld.fieldKey ? `-${veld.fieldKey}` : huidig === `-${veld.fieldKey}` ? null : veld.fieldKey,
    );
  }

  if (schema.bezig) {
    return (
      <Kaart>
        <Skelet hoogte={260} />
      </Kaart>
    );
  }

  if (schema.fout) {
    return (
      <Kaart>
        <p style={{ color: 'var(--ziekte)' }}>{schema.fout.message}</p>
      </Kaart>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>{titel}</h1>
        {meta && (
          <span style={{ color: 'var(--inkt-zacht)', fontSize: 13 }}>
            {meta.total} {meta.total === 1 ? 'record' : 'records'}
          </span>
        )}
      </div>

      <Kaart>
        {/* Filters staan op één rij boven de tabel. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="search"
            value={zoek}
            onChange={(event) => {
              setZoek(event.target.value);
              setPagina(1);
            }}
            placeholder="Zoeken..."
            aria-label={`Zoeken in ${titel}`}
            className="focus-ring"
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid var(--rand)',
              background: 'var(--oppervlak)',
              color: 'var(--inkt)',
              minWidth: 200,
            }}
          />

          {filters.map((filter, index) => (
            <FilterRegel
              key={index}
              filter={filter}
              velden={schema.lijstVelden}
              keuzesVoor={schema.keuzesVoor}
              onWijzig={(volgende) => {
                setFilters((huidig) => huidig.map((entry, i) => (i === index ? volgende : entry)));
                setPagina(1);
              }}
              onVerwijder={() => {
                setFilters((huidig) => huidig.filter((_, i) => i !== index));
                setPagina(1);
              }}
            />
          ))}

          <button
            type="button"
            className="focus-ring"
            onClick={() =>
              setFilters((huidig) => [
                ...huidig,
                { field: schema.lijstVelden[0]?.fieldKey ?? '', operator: 'eq', value: '' },
              ])
            }
            style={knopStijl}
          >
            + Filter
          </button>

          <div style={{ marginLeft: 'auto', position: 'relative' }}>
            <button
              type="button"
              className="focus-ring"
              onClick={() => setKolomkiezerOpen((open) => !open)}
              aria-expanded={kolomkiezerOpen}
              style={knopStijl}
            >
              Kolommen ({kolommen.length})
            </button>
            {kolomkiezerOpen && (
              <Kolomkiezer
                velden={schema.lijstVelden}
                verborgen={verborgen}
                onWissel={(sleutel) =>
                  setVerborgen((huidig) => {
                    const volgende = new Set(huidig);
                    if (volgende.has(sleutel)) volgende.delete(sleutel);
                    else volgende.add(sleutel);
                    return volgende;
                  })
                }
              />
            )}
          </div>
        </div>

        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table className="compact" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rand)' }}>
                {kolommen.map((veld) => {
                  const actief = sortering === veld.fieldKey || sortering === `-${veld.fieldKey}`;
                  return (
                    <th
                      key={veld.fieldKey}
                      scope="col"
                      style={{
                        textAlign: uitlijning(veld),
                        padding: '6px 8px',
                        whiteSpace: 'nowrap',
                        width: veld.columnWidth ?? undefined,
                      }}
                      aria-sort={
                        actief ? (sortering!.startsWith('-') ? 'descending' : 'ascending') : 'none'
                      }
                    >
                      <button
                        type="button"
                        className="focus-ring"
                        onClick={() => wisselSortering(veld)}
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          font: 'inherit',
                          fontWeight: 600,
                          color: 'var(--inkt-zacht)',
                          cursor: 'pointer',
                        }}
                      >
                        {veld.label}
                        {actief && (sortering!.startsWith('-') ? ' ↓' : ' ↑')}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {lijst.isLoading && (
                <tr>
                  <td colSpan={kolommen.length} style={{ padding: 16 }}>
                    <Skelet hoogte={80} />
                  </td>
                </tr>
              )}

              {!lijst.isLoading && (lijst.data?.data.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={kolommen.length} style={{ padding: 24, color: 'var(--inkt-zacht)' }}>
                    {zoek || filters.length > 0
                      ? 'Geen records gevonden met deze filters.'
                      : 'Er staat hier nog niets.'}
                  </td>
                </tr>
              )}

              {lijst.data?.data.map((rij) => (
                <tr
                  key={String(rij.id)}
                  onClick={() => onOpen?.(Number(rij.id))}
                  style={{
                    borderBottom: '1px solid var(--rand)',
                    cursor: onOpen ? 'pointer' : 'default',
                  }}
                >
                  {kolommen.map((veld) => (
                    <td
                      key={veld.fieldKey}
                      style={{ textAlign: uitlijning(veld), padding: '6px 8px' }}
                    >
                      <VeldWaarde veld={veld} waarde={waardeVan(rij, veld)} opzoeker={schema.opzoeker} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {meta && meta.totalPages > 1 && (
          <nav
            aria-label="Paginering"
            style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 13 }}
          >
            <button
              type="button"
              className="focus-ring"
              style={knopStijl}
              disabled={meta.page <= 1}
              onClick={() => setPagina((huidig) => huidig - 1)}
            >
              Vorige
            </button>
            <span style={{ color: 'var(--inkt-zacht)' }}>
              Pagina {meta.page} van {meta.totalPages}
            </span>
            <button
              type="button"
              className="focus-ring"
              style={knopStijl}
              disabled={meta.page >= meta.totalPages}
              onClick={() => setPagina((huidig) => huidig + 1)}
            >
              Volgende
            </button>
          </nav>
        )}
      </Kaart>
    </div>
  );
}

const knopStijl: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--rand)',
  borderRadius: 6,
  padding: '5px 10px',
  color: 'var(--inkt-zacht)',
  cursor: 'pointer',
  fontSize: 13,
};

function FilterRegel({
  filter,
  velden,
  keuzesVoor,
  onWijzig,
  onVerwijder,
}: {
  filter: Filter;
  velden: FieldDefinition[];
  keuzesVoor: (veld: FieldDefinition) => Array<{ value: string; label: string }>;
  onWijzig: (filter: Filter) => void;
  onVerwijder: () => void;
}): JSX.Element {
  const veld = velden.find((entry) => entry.fieldKey === filter.field);
  // Alleen operatoren die bij dit type passen (hoofdstuk 3.6).
  const operatoren = veld ? OPERATORS_BY_TYPE[veld.type] : ['eq'];
  const keuzes = veld ? keuzesVoor(veld) : [];
  const zonderWaarde = ['isEmpty', 'isNotEmpty'].includes(filter.operator);

  return (
    <span
      style={{
        display: 'inline-flex',
        gap: 4,
        alignItems: 'center',
        border: '1px solid var(--rand)',
        borderRadius: 6,
        padding: '2px 4px',
      }}
    >
      <select
        aria-label="Veld"
        className="focus-ring"
        value={filter.field}
        onChange={(event) => {
          const volgende = velden.find((entry) => entry.fieldKey === event.target.value);
          onWijzig({
            field: event.target.value,
            operator: volgende ? (OPERATORS_BY_TYPE[volgende.type][0] ?? 'eq') : 'eq',
            value: '',
          });
        }}
        style={selectStijl}
      >
        {velden.map((entry) => (
          <option key={entry.fieldKey} value={entry.fieldKey}>
            {entry.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Voorwaarde"
        className="focus-ring"
        value={filter.operator}
        onChange={(event) => onWijzig({ ...filter, operator: event.target.value })}
        style={selectStijl}
      >
        {operatoren.map((operator) => (
          <option key={operator} value={operator}>
            {OPERATOR_LABEL[operator] ?? operator}
          </option>
        ))}
      </select>

      {!zonderWaarde &&
        (keuzes.length > 0 ? (
          <select
            aria-label="Waarde"
            className="focus-ring"
            value={String(filter.value ?? '')}
            onChange={(event) => onWijzig({ ...filter, value: event.target.value })}
            style={selectStijl}
          >
            <option value="">—</option>
            {keuzes.map((keuze) => (
              <option key={keuze.value} value={keuze.value}>
                {keuze.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label="Waarde"
            className="focus-ring"
            value={String(filter.value ?? '')}
            onChange={(event) => onWijzig({ ...filter, value: event.target.value })}
            style={{ ...selectStijl, width: 110 }}
          />
        ))}

      <button
        type="button"
        className="focus-ring"
        aria-label="Filter verwijderen"
        onClick={onVerwijder}
        style={{ ...knopStijl, border: 0, padding: '2px 6px' }}
      >
        ×
      </button>
    </span>
  );
}

const selectStijl: React.CSSProperties = {
  background: 'var(--oppervlak)',
  border: '1px solid var(--rand)',
  borderRadius: 4,
  color: 'var(--inkt)',
  fontSize: 12,
  padding: '3px 4px',
};

function Kolomkiezer({
  velden,
  verborgen,
  onWissel,
}: {
  velden: FieldDefinition[];
  verborgen: Set<string>;
  onWissel: (sleutel: string) => void;
}): JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        right: 0,
        top: '100%',
        marginTop: 4,
        background: 'var(--oppervlak-2)',
        border: '1px solid var(--rand)',
        borderRadius: 8,
        padding: 10,
        minWidth: 200,
        maxHeight: 320,
        overflowY: 'auto',
        zIndex: 20,
        boxShadow: '0 6px 20px rgb(0 0 0 / 0.12)',
      }}
    >
      {velden.map((veld) => (
        <label
          key={veld.fieldKey}
          style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 13 }}
        >
          <input
            type="checkbox"
            checked={!verborgen.has(veld.fieldKey)}
            onChange={() => onWissel(veld.fieldKey)}
          />
          {veld.label}
          {veld.storage === 'json' && (
            <span style={{ color: 'var(--inkt-stil)', fontSize: 11 }}>maatwerk</span>
          )}
        </label>
      ))}
    </div>
  );
}
