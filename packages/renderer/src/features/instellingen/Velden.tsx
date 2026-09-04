/**
 * Veldbeheer (hoofdstuk 3.1 en 3.5).
 *
 * Hier voegt een beheerder zonder code een veld toe, hernoemt het, verplaatst
 * het naar een andere sectie, verbergt het of verwijdert het.
 *
 * Verplaatsen gebeurt met knoppen en een sectiekeuze in plaats van met slepen.
 * Dat is bewust: de opdracht vraagt volledige toetsenbordbediening (WCAG 2.1
 * AA), en dat is met knoppen zonder omweg te halen. Een sleeplaag kan er later
 * bovenop, zodra de UI met de muis getest kan worden.
 */
import { useMemo, useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FIELD_TYPE_INFO, type FieldDefinition, type FieldType } from '@showroom/shared';
import { ApiFout, endpoints } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';

const ENTITEIT_LABEL: Record<string, string> = {
  organizations: 'Klanten',
  contacts: 'Contactpersonen',
  projects: 'Projecten',
  opportunities: 'Kansen',
  absences: 'Verlof',
  'capacity-allocations': 'Inzet elders',
};

export function Velden(): JSX.Element {
  const [entiteit, setEntiteit] = useState('projects');
  const [toonGearchiveerd, setToonGearchiveerd] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [nieuwOpen, setNieuwOpen] = useState(false);
  const queryClient = useQueryClient();

  const register = useQuery({
    queryKey: ['velden', entiteit, toonGearchiveerd],
    queryFn: () => endpoints.velden(entiteit, toonGearchiveerd),
  });

  const velden = useMemo(() => register.data?.data.velden ?? [], [register.data]);
  const secties = useMemo(() => register.data?.data.secties ?? [], [register.data]);

  const ververs = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['velden'] });
    void queryClient.invalidateQueries({ queryKey: ['lijst'] });
    void queryClient.invalidateQueries({ queryKey: ['record'] });
  };

  const meld = (tekst: string): void => {
    setMelding(tekst);
    setFout(null);
  };
  const meldFout = (error: unknown): void => {
    setFout(error instanceof ApiFout ? error.message : 'Er ging iets mis.');
    setMelding(null);
  };

  const wijzigen = useMutation({
    mutationFn: ({ id, body }: { id: number; body: unknown }) => endpoints.veldWijzigen(id, body),
    onSuccess: () => {
      ververs();
      meld('Aangepast.');
    },
    onError: meldFout,
  });

  const verbergen = useMutation({
    mutationFn: (id: number) => endpoints.veldVerbergen(id),
    onSuccess: (antwoord) => {
      ververs();
      meld(antwoord.melding);
    },
    onError: meldFout,
  });

  const herstellen = useMutation({
    mutationFn: (id: number) => endpoints.veldHerstellen(id),
    onSuccess: () => {
      ververs();
      meld('Het veld staat weer in de schermen.');
    },
    onError: meldFout,
  });

  const herordenen = useMutation({
    mutationFn: (volgorde: Array<{ id: number; section_id: number | null; sort_order: number }>) =>
      endpoints.veldenHerordenen(entiteit, volgorde),
    onSuccess: () => ververs(),
    onError: meldFout,
  });

  function verplaats(veld: FieldDefinition, richting: -1 | 1): void {
    const zelfde = velden.filter((entry) => (entry.sectionId ?? null) === (veld.sectionId ?? null));
    const index = zelfde.findIndex((entry) => entry.id === veld.id);
    const buur = zelfde[index + richting];
    if (!buur) return;
    herordenen.mutate([
      { id: veld.id, section_id: veld.sectionId ?? null, sort_order: buur.sortOrder },
      { id: buur.id, section_id: buur.sectionId ?? null, sort_order: veld.sortOrder },
    ]);
  }

  if (register.isLoading) {
    return (
      <Kaart>
        <Skelet hoogte={300} />
      </Kaart>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>Velden &amp; layouts</h1>

      <Kaart>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13 }}>
            Entiteit{' '}
            <select
              className="focus-ring"
              value={entiteit}
              onChange={(event) => setEntiteit(event.target.value)}
              style={selectStijl}
            >
              {Object.entries(ENTITEIT_LABEL).map(([sleutel, label]) => (
                <option key={sleutel} value={sleutel}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={toonGearchiveerd}
              onChange={(event) => setToonGearchiveerd(event.target.checked)}
            />
            Gearchiveerde velden tonen
          </label>

          <button
            type="button"
            className="focus-ring"
            onClick={() => setNieuwOpen((open) => !open)}
            style={{ ...knopStijl, marginLeft: 'auto' }}
          >
            {nieuwOpen ? 'Sluiten' : '+ Veld toevoegen'}
          </button>
        </div>

        {melding && (
          <p role="status" style={{ color: 'var(--inkt-zacht)', fontSize: 13, marginBottom: 0 }}>
            {melding}
          </p>
        )}
        {fout && (
          <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 13, marginBottom: 0 }}>
            {fout}
          </p>
        )}
      </Kaart>

      {nieuwOpen && (
        <NieuwVeld
          entiteit={entiteit}
          secties={secties}
          onKlaar={(naam) => {
            setNieuwOpen(false);
            ververs();
            meld(`"${naam}" is toegevoegd en staat meteen in de formulieren en de lijst.`);
          }}
          onFout={meldFout}
        />
      )}

      <Kaart>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <caption style={{ textAlign: 'left', color: 'var(--inkt-zacht)', paddingBottom: 8 }}>
            {velden.length} velden. Systeemvelden hebben een eigen kolom en kunnen alleen worden
            verborgen; maatwerkvelden kunnen definitief weg.
          </caption>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rand)', textAlign: 'left' }}>
              <th scope="col" style={{ padding: '6px 8px' }}>Label</th>
              <th scope="col" style={{ padding: '6px 8px' }}>Sleutel</th>
              <th scope="col" style={{ padding: '6px 8px' }}>Soort</th>
              <th scope="col" style={{ padding: '6px 8px' }}>Sectie</th>
              <th scope="col" style={{ padding: '6px 8px' }}>Zichtbaar</th>
              <th scope="col" style={{ padding: '6px 8px' }}>Volgorde</th>
              <th scope="col" style={{ padding: '6px 8px' }}>Acties</th>
            </tr>
          </thead>
          <tbody>
            {velden.map((veld) => (
              <VeldRegel
                key={veld.id}
                veld={veld}
                secties={secties}
                onHernoem={(label) => wijzigen.mutate({ id: veld.id, body: { label } })}
                onSectie={(sectionId) =>
                  herordenen.mutate([
                    { id: veld.id, section_id: sectionId, sort_order: veld.sortOrder },
                  ])
                }
                onZichtbaar={(inLijst, inDetail) =>
                  wijzigen.mutate({
                    id: veld.id,
                    body: { visible_in_list: inLijst, visible_in_detail: inDetail },
                  })
                }
                onIndex={(indexed) => wijzigen.mutate({ id: veld.id, body: { indexed } })}
                onVerplaats={(richting) => verplaats(veld, richting)}
                onVerberg={() => verbergen.mutate(veld.id)}
                onHerstel={() => herstellen.mutate(veld.id)}
                onVerwijderd={(tekst) => {
                  ververs();
                  meld(tekst);
                }}
                onFout={meldFout}
              />
            ))}
          </tbody>
        </table>
      </Kaart>
    </div>
  );
}

function VeldRegel({
  veld,
  secties,
  onHernoem,
  onSectie,
  onZichtbaar,
  onIndex,
  onVerplaats,
  onVerberg,
  onHerstel,
  onVerwijderd,
  onFout,
}: {
  veld: FieldDefinition;
  secties: Array<{ id: number; name: string }>;
  onHernoem: (label: string) => void;
  onSectie: (sectionId: number | null) => void;
  onZichtbaar: (inLijst: boolean, inDetail: boolean) => void;
  onIndex: (indexed: boolean) => void;
  onVerplaats: (richting: -1 | 1) => void;
  onVerberg: () => void;
  onHerstel: () => void;
  onVerwijderd: (melding: string) => void;
  onFout: (error: unknown) => void;
}): JSX.Element {
  const [label, setLabel] = useState(veld.label);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const gearchiveerd = Boolean(veld.archivedAt);

  return (
    <tr style={{ borderBottom: '1px solid var(--rand)', opacity: gearchiveerd ? 0.55 : 1 }}>
      <td style={{ padding: '6px 8px' }}>
        {veld.isLocked ? (
          <span title="Vast veld: draagt de identiteit van het record">
            {veld.label} <span style={{ color: 'var(--inkt-stil)' }}>(vast)</span>
          </span>
        ) : (
          <input
            aria-label={`Label van ${veld.fieldKey}`}
            className="focus-ring"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            onBlur={() => label !== veld.label && onHernoem(label)}
            style={{ ...selectStijl, width: '100%' }}
          />
        )}
      </td>
      <td style={{ padding: '6px 8px', color: 'var(--inkt-stil)', fontFamily: 'monospace', fontSize: 11 }}>
        {veld.fieldKey}
      </td>
      <td style={{ padding: '6px 8px' }}>
        {FIELD_TYPE_INFO[veld.type].label}
        <br />
        <span style={{ color: 'var(--inkt-stil)', fontSize: 11 }}>
          {veld.storage === 'column' ? 'systeemveld' : 'maatwerk'}
        </span>
      </td>
      <td style={{ padding: '6px 8px' }}>
        <select
          aria-label={`Sectie van ${veld.label}`}
          className="focus-ring"
          value={veld.sectionId ?? ''}
          onChange={(event) => onSectie(event.target.value === '' ? null : Number(event.target.value))}
          style={selectStijl}
        >
          <option value="">— geen —</option>
          {secties.map((sectie) => (
            <option key={sectie.id} value={sectie.id}>
              {sectie.name}
            </option>
          ))}
        </select>
      </td>
      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
        <label style={{ fontSize: 12, marginRight: 8 }}>
          <input
            type="checkbox"
            checked={veld.visibleInList}
            disabled={veld.isLocked}
            onChange={(event) => onZichtbaar(event.target.checked, veld.visibleInDetail)}
          />{' '}
          lijst
        </label>
        <label style={{ fontSize: 12 }}>
          <input
            type="checkbox"
            checked={veld.visibleInDetail}
            disabled={veld.isLocked}
            onChange={(event) => onZichtbaar(veld.visibleInList, event.target.checked)}
          />{' '}
          detail
        </label>
        {veld.storage === 'json' && (
          <label style={{ fontSize: 12, display: 'block', marginTop: 3 }} title="Sneller filteren en sorteren">
            <input type="checkbox" checked={veld.indexed} onChange={(event) => onIndex(event.target.checked)} />{' '}
            index
          </label>
        )}
      </td>
      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
        <button
          type="button"
          className="focus-ring"
          aria-label={`${veld.label} omhoog`}
          onClick={() => onVerplaats(-1)}
          style={miniKnop}
        >
          ↑
        </button>
        <button
          type="button"
          className="focus-ring"
          aria-label={`${veld.label} omlaag`}
          onClick={() => onVerplaats(1)}
          style={miniKnop}
        >
          ↓
        </button>
      </td>
      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
        {gearchiveerd ? (
          <button type="button" className="focus-ring" onClick={onHerstel} style={knopStijl}>
            Terughalen
          </button>
        ) : (
          <button
            type="button"
            className="focus-ring"
            onClick={onVerberg}
            disabled={veld.isLocked}
            style={knopStijl}
          >
            {veld.storage === 'column' ? 'Verbergen' : 'Archiveren'}
          </button>
        )}
        {veld.storage === 'json' && (
          <>
            <button
              type="button"
              className="focus-ring"
              onClick={() => setPurgeOpen(true)}
              style={{ ...knopStijl, marginLeft: 4, color: 'var(--ziekte)' }}
            >
              Definitief
            </button>
            {purgeOpen && (
              <DefinitiefVerwijderen
                veld={veld}
                onSluit={() => setPurgeOpen(false)}
                onKlaar={(melding) => {
                  setPurgeOpen(false);
                  onVerwijderd(melding);
                }}
                onFout={onFout}
              />
            )}
          </>
        )}
      </td>
    </tr>
  );
}

/** De dubbele bevestiging uit hoofdstuk 3.1: de sleutel moet worden overgetypt. */
function DefinitiefVerwijderen({
  veld,
  onSluit,
  onKlaar,
  onFout,
}: {
  veld: FieldDefinition;
  onSluit: () => void;
  onKlaar: (melding: string) => void;
  onFout: (error: unknown) => void;
}): JSX.Element {
  const [bevestiging, setBevestiging] = useState('');
  const verwijderen = useMutation({
    mutationFn: () => endpoints.veldDefinitiefVerwijderen(veld.id, bevestiging),
    onSuccess: (antwoord) => onKlaar(antwoord.melding),
    onError: onFout,
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${veld.label} definitief verwijderen`}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgb(0 0 0 / 0.45)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 50,
      }}
      onClick={onSluit}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          background: 'var(--oppervlak-2)',
          border: '1px solid var(--rand)',
          borderRadius: 10,
          padding: 20,
          width: 420,
        }}
      >
        <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Definitief verwijderen</h2>
        <p style={{ fontSize: 13, color: 'var(--inkt-zacht)', lineHeight: 1.6 }}>
          Hiermee verdwijnt <strong>{veld.label}</strong> uit alle schermen én worden de
          ingevoerde waarden uit alle records gehaald. Dit kan niet ongedaan gemaakt worden.
        </p>
        <p style={{ fontSize: 13, margin: '12px 0 4px' }}>
          Typ <code style={{ background: 'var(--rand)', padding: '1px 5px' }}>{veld.fieldKey}</code>{' '}
          over om te bevestigen:
        </p>
        <input
          className="focus-ring"
          value={bevestiging}
          onChange={(event) => setBevestiging(event.target.value)}
          aria-label="Bevestiging"
          style={{ ...selectStijl, width: '100%', padding: '7px 9px' }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="focus-ring" onClick={onSluit} style={knopStijl}>
            Annuleren
          </button>
          <button
            type="button"
            className="focus-ring"
            disabled={bevestiging !== veld.fieldKey || verwijderen.isPending}
            onClick={() => verwijderen.mutate()}
            style={{
              ...knopStijl,
              background: bevestiging === veld.fieldKey ? 'var(--ziekte)' : 'var(--rand)',
              color: bevestiging === veld.fieldKey ? '#fff' : 'var(--inkt-stil)',
              border: 0,
            }}
          >
            Definitief verwijderen
          </button>
        </div>
      </div>
    </div>
  );
}

function NieuwVeld({
  entiteit,
  secties,
  onKlaar,
  onFout,
}: {
  entiteit: string;
  secties: Array<{ id: number; name: string }>;
  onKlaar: (label: string) => void;
  onFout: (error: unknown) => void;
}): JSX.Element {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<FieldType>('text');
  const [sectie, setSectie] = useState<number | ''>('');
  const [verplicht, setVerplicht] = useState(false);
  const [geindexeerd, setGeindexeerd] = useState(false);
  const [opties, setOpties] = useState('');
  const [formule, setFormule] = useState('');
  const [formuleFout, setFormuleFout] = useState<string | null>(null);

  const types = useQuery({ queryKey: ['veldtypes'], queryFn: () => endpoints.veldtypes() });

  const controleer = useMutation({
    mutationFn: () => endpoints.formuleControleren(formule),
    onSuccess: (antwoord) =>
      setFormuleFout(antwoord.data.ok ? null : (antwoord.data.fout ?? 'De formule klopt niet.')),
  });

  const toevoegen = useMutation({
    mutationFn: () => {
      const heeftOpties = type === 'select' || type === 'multiselect';
      return endpoints.veldToevoegen({
        entity_key: entiteit,
        label,
        type,
        required: verplicht,
        indexed: geindexeerd,
        section_id: sectie === '' ? null : sectie,
        options_source: heeftOpties ? 'static' : null,
        validation: {
          ...(heeftOpties
            ? {
                options: opties
                  .split('\n')
                  .map((regel) => regel.trim())
                  .filter(Boolean)
                  .map((regel) => {
                    const [waarde, tekst] = regel.split('|').map((deel) => deel.trim());
                    return { value: waarde!, label: tekst || waarde! };
                  }),
              }
            : {}),
          ...(type === 'formula' ? { expression: formule } : {}),
        },
      });
    },
    onSuccess: () => onKlaar(label),
    onError: onFout,
  });

  return (
    <Kaart accent="var(--belasting)">
      <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>Nieuw veld</h2>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <label style={{ fontSize: 12, color: 'var(--inkt-zacht)' }}>
          Label
          <input
            className="focus-ring"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            style={{ ...selectStijl, width: '100%', marginTop: 3 }}
          />
        </label>

        <label style={{ fontSize: 12, color: 'var(--inkt-zacht)' }}>
          Soort
          <select
            className="focus-ring"
            value={type}
            onChange={(event) => setType(event.target.value as FieldType)}
            style={{ ...selectStijl, width: '100%', marginTop: 3 }}
          >
            {(types.data?.data.types ?? []).map((entry) => (
              <option key={entry.type} value={entry.type}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: 12, color: 'var(--inkt-zacht)' }}>
          Sectie
          <select
            className="focus-ring"
            value={sectie}
            onChange={(event) => setSectie(event.target.value === '' ? '' : Number(event.target.value))}
            style={{ ...selectStijl, width: '100%', marginTop: 3 }}
          >
            <option value="">— geen —</option>
            {secties.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {(type === 'select' || type === 'multiselect') && (
        <label style={{ fontSize: 12, color: 'var(--inkt-zacht)', display: 'block', marginTop: 12 }}>
          Keuzes, één per regel. Gebruik <code>waarde | label</code> als ze verschillen.
          <textarea
            className="focus-ring"
            rows={4}
            value={opties}
            onChange={(event) => setOpties(event.target.value)}
            placeholder={'A | Bouwstroom A\nB | Bouwstroom B'}
            style={{ ...selectStijl, width: '100%', marginTop: 3, fontFamily: 'monospace' }}
          />
        </label>
      )}

      {type === 'formula' && (
        <label style={{ fontSize: 12, color: 'var(--inkt-zacht)', display: 'block', marginTop: 12 }}>
          Formule over de velden van dit record, bijvoorbeeld{' '}
          <code>ROND(contract_value_cents / unit_count / 100, 2)</code>
          <textarea
            className="focus-ring"
            rows={2}
            value={formule}
            onChange={(event) => setFormule(event.target.value)}
            onBlur={() => formule.trim() && controleer.mutate()}
            style={{ ...selectStijl, width: '100%', marginTop: 3, fontFamily: 'monospace' }}
          />
          {formuleFout && (
            <span role="alert" style={{ color: 'var(--ziekte)' }}>
              {formuleFout}
            </span>
          )}
          {!formuleFout && controleer.isSuccess && (
            <span style={{ color: 'var(--capaciteit)' }}>De formule klopt.</span>
          )}
        </label>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 12, fontSize: 13 }}>
        <label>
          <input type="checkbox" checked={verplicht} onChange={(event) => setVerplicht(event.target.checked)} />{' '}
          Verplicht
        </label>
        <label title="Sneller filteren en sorteren op dit veld">
          <input
            type="checkbox"
            checked={geindexeerd}
            onChange={(event) => setGeindexeerd(event.target.checked)}
          />{' '}
          Indexeren
        </label>

        <button
          type="button"
          className="focus-ring"
          disabled={!label.trim() || toevoegen.isPending}
          onClick={() => toevoegen.mutate()}
          style={{
            ...knopStijl,
            marginLeft: 'auto',
            background: label.trim() ? 'var(--belasting)' : 'var(--rand)',
            color: label.trim() ? '#fff' : 'var(--inkt-stil)',
            border: 0,
          }}
        >
          {toevoegen.isPending ? 'Bezig...' : 'Veld toevoegen'}
        </button>
      </div>
    </Kaart>
  );
}

const knopStijl: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--rand)',
  borderRadius: 6,
  padding: '4px 10px',
  color: 'var(--inkt-zacht)',
  cursor: 'pointer',
  fontSize: 12,
};

const miniKnop: React.CSSProperties = { ...knopStijl, padding: '2px 7px', marginRight: 3 };

const selectStijl: React.CSSProperties = {
  background: 'var(--oppervlak)',
  border: '1px solid var(--rand)',
  borderRadius: 4,
  color: 'var(--inkt)',
  fontSize: 12,
  padding: '4px 6px',
};
