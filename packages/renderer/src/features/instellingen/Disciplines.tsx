/**
 * Productdisciplines beheren (hoofdstuk 4.4).
 *
 * Badkamer, keuken, tegelwerk: waar een kans en een project uit opgebouwd
 * zijn. De tabel en de API bestonden al — kansen rekenen er met hun regels mee
 * — maar er was geen scherm om er zelf een toe te voegen of een marge bij te
 * stellen.
 *
 * Een eigen scherm en niet de generieke lijst: die leunt op het veldenregister,
 * en daar staan disciplines niet in. Een bestaande installatie zou dan een leeg
 * scherm krijgen, want velddefinities komen uit de seed en die draait maar één
 * keer.
 */
import { useState, type JSX, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiFout, endpoints, type Discipline } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { Dialoog, dialoogKnop, invoerStijl } from '../kansen/Dialoog.tsx';

type Concept = {
  code: string;
  name: string;
  description: string;
  color: string;
  /** Op het scherm in procenten; in de database in basispunten. */
  marge: string;
  doorlooptijd: string;
  sort_order: string;
  active: boolean;
};

const LEEG: Concept = {
  code: '',
  name: '',
  description: '',
  color: '#2563eb',
  marge: '15',
  doorlooptijd: '',
  sort_order: '0',
  active: true,
};

function naarConcept(discipline: Discipline): Concept {
  return {
    code: discipline.code,
    name: discipline.name,
    description: discipline.description ?? '',
    color: discipline.color ?? '#2563eb',
    marge: String(discipline.default_margin_bp / 100),
    doorlooptijd:
      discipline.default_lead_weeks === null ? '' : String(discipline.default_lead_weeks),
    sort_order: String(discipline.sort_order),
    active: discipline.active === 1,
  };
}

function naarPayload(concept: Concept): Record<string, unknown> {
  const marge = Number(concept.marge.replace(',', '.'));
  const weken = concept.doorlooptijd.trim();
  return {
    code: concept.code.trim(),
    name: concept.name.trim(),
    description: concept.description.trim() || null,
    color: concept.color || null,
    // Procenten naar basispunten: 15% is 1500. Afronden, want een halve
    // basispunt bestaat niet.
    default_margin_bp: Number.isFinite(marge) ? Math.round(marge * 100) : 0,
    default_lead_weeks: weken === '' ? null : Number(weken),
    sort_order: Number(concept.sort_order) || 0,
    active: concept.active ? 1 : 0,
  };
}

export function Disciplines({ onTerug }: { onTerug: () => void }): JSX.Element {
  const queryClient = useQueryClient();
  const [bewerkt, setBewerkt] = useState<Discipline | 'nieuw' | null>(null);
  const [concept, setConcept] = useState<Concept>(LEEG);
  const [fout, setFout] = useState<string | null>(null);

  const lijst = useQuery({
    queryKey: ['disciplines-beheer'],
    queryFn: () => endpoints.lijst<Discipline>('disciplines', '?pageSize=200'),
  });

  const bewaren = useMutation({
    mutationFn: () =>
      endpoints.bewaar<Discipline>(
        'disciplines',
        bewerkt === 'nieuw' || bewerkt === null ? null : bewerkt.id,
        naarPayload(concept),
      ),
    onSuccess: () => {
      setBewerkt(null);
      setFout(null);
      void queryClient.invalidateQueries({ queryKey: ['disciplines-beheer'] });
      // De keuzelijsten elders in de applicatie kennen de nieuwe waarde nog niet.
      void queryClient.invalidateQueries({ queryKey: ['verwijzing', 'disciplines'] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Opslaan lukte niet.'),
  });

  const archiveren = useMutation({
    mutationFn: (id: number) => endpoints.verwijder('disciplines', id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['disciplines-beheer'] }),
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Archiveren lukte niet.'),
  });

  function open(discipline: Discipline | 'nieuw'): void {
    setBewerkt(discipline);
    setConcept(discipline === 'nieuw' ? LEEG : naarConcept(discipline));
    setFout(null);
  }

  const rijen = lijst.data?.data ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>Productdisciplines</h1>
        <button type="button" className="focus-ring" onClick={onTerug} style={dialoogKnop}>
          Terug naar instellingen
        </button>
        <button
          type="button"
          className="focus-ring"
          onClick={() => open('nieuw')}
          style={{
            ...dialoogKnop,
            background: 'var(--belasting)',
            color: '#fff',
            borderColor: 'transparent',
            marginLeft: 'auto',
          }}
        >
          + Nieuwe discipline
        </button>
      </div>

      <Kaart>
        <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: 0, lineHeight: 1.55 }}>
          Waar een kans en een project uit opgebouwd zijn: badkamer, keuken, tegelwerk. Een kans
          krijgt per discipline een regel met een bedrag en een marge; een project krijgt ze op de
          projectpagina onder <em>Disciplines</em>.
          <br />
          <br />
          De <strong>standaardmarge</strong> is wat een nieuwe kansregel voorstelt — daarna kan hij
          per regel afwijken. Een discipline die u niet meer gebruikt zet u op inactief of
          archiveert u; verwijderen kan niet, want dan verdwijnt hij ook uit de kansen van vorig
          jaar.
        </p>
      </Kaart>

      {fout !== null && (
        <Kaart>
          <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 13, margin: 0 }}>
            {fout}
          </p>
        </Kaart>
      )}

      <Kaart>
        {lijst.isLoading ? (
          <Skelet hoogte={180} />
        ) : rijen.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--inkt-zacht)', margin: 0 }}>
            Er staan nog geen disciplines. Maak er een aan met de knop hierboven.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--inkt-zacht)', fontSize: 12 }}>
                <Th>Code</Th>
                <Th>Naam</Th>
                <Th>Marge</Th>
                <Th>Doorlooptijd</Th>
                <Th>Volgorde</Th>
                <Th>Actief</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {rijen.map((discipline) => (
                <tr key={discipline.id} style={{ borderTop: '1px solid var(--rand)' }}>
                  <Td>
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        marginRight: 6,
                        background: discipline.color ?? 'var(--rand)',
                      }}
                    />
                    {discipline.code}
                  </Td>
                  <Td>{discipline.name}</Td>
                  <Td>{(discipline.default_margin_bp / 100).toLocaleString('nl-NL')} %</Td>
                  <Td>
                    {discipline.default_lead_weeks === null
                      ? '—'
                      : `${String(discipline.default_lead_weeks)} wk`}
                  </Td>
                  <Td>{discipline.sort_order}</Td>
                  <Td>{discipline.active === 1 ? 'ja' : 'nee'}</Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="focus-ring"
                        onClick={() => open(discipline)}
                        style={dialoogKnop}
                      >
                        Bewerken
                      </button>
                      <button
                        type="button"
                        className="focus-ring"
                        onClick={() => archiveren.mutate(discipline.id)}
                        style={{ ...dialoogKnop, color: 'var(--ziekte)' }}
                      >
                        Archiveren
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Kaart>

      {bewerkt !== null && (
        <Dialoog
          titel={bewerkt === 'nieuw' ? 'Nieuwe discipline' : `Discipline: ${bewerkt.name}`}
          onSluit={() => setBewerkt(null)}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
            }}
          >
            <Veld id="disc-code" label="Code" hulp="Kort en uniek, bijvoorbeeld BAD of KEU.">
              {(props) => (
                <input
                  {...props}
                  className="focus-ring"
                  value={concept.code}
                  onChange={(e) => setConcept((h) => ({ ...h, code: e.target.value }))}
                  style={invoerStijl}
                />
              )}
            </Veld>
            <Veld id="disc-naam" label="Naam">
              {(props) => (
                <input
                  {...props}
                  className="focus-ring"
                  value={concept.name}
                  onChange={(e) => setConcept((h) => ({ ...h, name: e.target.value }))}
                  style={invoerStijl}
                />
              )}
            </Veld>
            <Veld id="disc-marge" label="Standaardmarge (%)">
              {(props) => (
                <input
                  {...props}
                  className="focus-ring"
                  type="number"
                  step={0.5}
                  value={concept.marge}
                  onChange={(e) => setConcept((h) => ({ ...h, marge: e.target.value }))}
                  style={invoerStijl}
                />
              )}
            </Veld>
            <Veld
              id="disc-weken"
              label="Doorlooptijd (weken)"
              hulp="Leeg laten = de instelling van de afdeling."
            >
              {(props) => (
                <input
                  {...props}
                  className="focus-ring"
                  type="number"
                  value={concept.doorlooptijd}
                  onChange={(e) => setConcept((h) => ({ ...h, doorlooptijd: e.target.value }))}
                  style={invoerStijl}
                />
              )}
            </Veld>
            <Veld id="disc-volgorde" label="Volgorde">
              {(props) => (
                <input
                  {...props}
                  className="focus-ring"
                  type="number"
                  value={concept.sort_order}
                  onChange={(e) => setConcept((h) => ({ ...h, sort_order: e.target.value }))}
                  style={invoerStijl}
                />
              )}
            </Veld>
            <Veld id="disc-kleur" label="Kleur">
              {(props) => (
                <input
                  {...props}
                  className="focus-ring"
                  type="color"
                  value={concept.color}
                  onChange={(e) => setConcept((h) => ({ ...h, color: e.target.value }))}
                  style={{ ...invoerStijl, padding: 2, height: 32 }}
                />
              )}
            </Veld>
          </div>

          <div style={{ marginTop: 12 }}>
            <Veld id="disc-omschrijving" label="Omschrijving">
              {(props) => (
                <textarea
                  {...props}
                  className="focus-ring"
                  rows={2}
                  value={concept.description}
                  onChange={(e) => setConcept((h) => ({ ...h, description: e.target.value }))}
                  style={{ ...invoerStijl, width: '100%', resize: 'vertical' }}
                />
              )}
            </Veld>
          </div>

          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 12 }}
          >
            <input
              type="checkbox"
              className="focus-ring"
              checked={concept.active}
              onChange={(e) => setConcept((h) => ({ ...h, active: e.target.checked }))}
            />
            Actief — inactieve disciplines zijn niet meer te kiezen, maar blijven op bestaande
            kansen en projecten staan
          </label>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              type="button"
              className="focus-ring"
              onClick={() => setBewerkt(null)}
              style={dialoogKnop}
            >
              Annuleren
            </button>
            <button
              type="button"
              className="focus-ring"
              disabled={bewaren.isPending || !concept.code.trim() || !concept.name.trim()}
              onClick={() => bewaren.mutate()}
              style={{
                ...dialoogKnop,
                background: 'var(--belasting)',
                color: '#fff',
                borderColor: 'transparent',
                opacity: !concept.code.trim() || !concept.name.trim() ? 0.5 : 1,
              }}
            >
              {bewaren.isPending ? 'Bezig…' : 'Opslaan'}
            </button>
          </div>
        </Dialoog>
      )}
    </div>
  );
}

function Th({ children }: { children: ReactNode }): JSX.Element {
  return <th style={{ padding: '6px 8px', fontWeight: 600 }}>{children}</th>;
}

function Td({ children }: { children: ReactNode }): JSX.Element {
  return <td style={{ padding: '7px 8px' }}>{children}</td>;
}

/**
 * Label, invoer en hulptekst.
 *
 * De hulptekst hangt aan `aria-describedby` en staat bewust niet ín het label:
 * anders leest een schermlezer "Code Kort en uniek, bijvoorbeeld BAD of KEU"
 * als de naam van het veld, en dat is geen naam maar een uitleg.
 */
function Veld({
  id,
  label,
  hulp,
  children,
}: {
  id: string;
  label: string;
  hulp?: string;
  children: (eigenschappen: { id: string; 'aria-describedby'?: string }) => ReactNode;
}): JSX.Element {
  const hulpId = hulp === undefined ? undefined : `${id}-hulp`;
  return (
    <div style={{ fontSize: 12 }}>
      <label htmlFor={id} style={{ display: 'block', color: 'var(--inkt-zacht)' }}>
        {label}
      </label>
      <div style={{ marginTop: 3 }}>{children({ id, 'aria-describedby': hulpId })}</div>
      {hulp !== undefined && (
        <span id={hulpId} style={{ fontSize: 11, color: 'var(--inkt-stil)' }}>
          {hulp}
        </span>
      )}
    </div>
  );
}
