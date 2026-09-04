/**
 * Inzet op andere projecten (hoofdstuk 6.4.2).
 *
 * Inzet elders is geen verlof: er is geen goedkeuringsstroom, wel een omvang.
 * Die omvang kan op drie manieren worden uitgedrukt — een percentage, dagen per
 * week of uren per week — omdat afdelingen dat verschillend afspreken. De
 * capaciteitsengine rekent ze alle drie naar uren om.
 */
import { useMemo, useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, formatDecimal } from '@showroom/shared';
import { ApiFout, endpoints, type Gebruiker, type Inzet as InzetRij } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { invoerStijl, dialoogKnop } from '../kansen/Dialoog.tsx';
import { naarGetal, getalUit } from '../kansen/bedrag.ts';

const OMVANG = [
  { waarde: 'percentage', label: 'procent van de week', eenheid: '%' },
  { waarde: 'dagen_per_week', label: 'dagen per week', eenheid: ' dg' },
  { waarde: 'uren_per_week', label: 'uren per week', eenheid: ' uur' },
] as const;

const STATUS = ['gepland', 'actief', 'afgerond', 'geannuleerd'] as const;

type Concept = {
  user_id: number;
  allocation_type_id: number;
  title: string;
  external_project_name: string;
  start_date: string;
  end_date: string;
  allocation_mode: (typeof OMVANG)[number]['waarde'];
  allocation_value: string;
  status: (typeof STATUS)[number];
  note: string;
};

export function Inzet({ ik }: { ik: Gebruiker }): JSX.Element {
  const queryClient = useQueryClient();
  const magVoorIedereen = ik.role === 'manager' || ik.role === 'admin';
  const [bewerkt, setBewerkt] = useState<number | 'nieuw' | null>(null);
  const [concept, setConcept] = useState<Concept | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const inzet = useQuery({
    queryKey: ['inzet'],
    queryFn: () => endpoints.lijst<InzetRij>('capacity-allocations', '?pageSize=200'),
  });
  const types = useQuery({ queryKey: ['inzettypes'], queryFn: () => endpoints.inzettypes() });
  const gebruikers = useQuery({ queryKey: ['gebruikers'], queryFn: () => endpoints.gebruikers() });

  const naam = (id: number): string =>
    (gebruikers.data?.data ?? []).find((gebruiker) => gebruiker.id === id)?.name ?? `#${id}`;
  const typeNaam = (id: number): string =>
    (types.data?.data ?? []).find((type) => type.id === id)?.name ?? 'Inzet';

  const rijen = useMemo(() => inzet.data?.data ?? [], [inzet.data]);

  function ververs(): void {
    void queryClient.invalidateQueries({ queryKey: ['inzet'] });
    void queryClient.invalidateQueries({ queryKey: ['kalender'] });
    void queryClient.invalidateQueries({ queryKey: ['weekbezetting'] });
  }

  const opslaan = useMutation({
    mutationFn: (id: number | null) => {
      if (!concept) throw new ApiFout(400, 'leeg', 'Er is niets om op te slaan.');
      const omvang = naarGetal(concept.allocation_value);
      if (concept.title.trim() === '') {
        throw new ApiFout(400, 'onvolledig', 'Geef aan waar deze inzet over gaat.');
      }
      if (concept.start_date === '' || concept.end_date === '') {
        throw new ApiFout(400, 'onvolledig', 'Vul een begin- en einddatum in.');
      }
      if (concept.end_date < concept.start_date) {
        throw new ApiFout(400, 'ongeldig', 'De einddatum ligt voor de begindatum.');
      }
      if (omvang === null || omvang <= 0) {
        throw new ApiFout(400, 'ongeldig', 'De omvang moet groter dan nul zijn.');
      }
      if (concept.allocation_mode === 'percentage' && omvang > 100) {
        throw new ApiFout(400, 'ongeldig', 'Een percentage kan niet boven de honderd uitkomen.');
      }

      return endpoints.bewaar<InzetRij>('capacity-allocations', id, {
        user_id: concept.user_id,
        allocation_type_id: concept.allocation_type_id,
        title: concept.title.trim(),
        external_project_name:
          concept.external_project_name.trim() === '' ? null : concept.external_project_name.trim(),
        start_date: concept.start_date,
        end_date: concept.end_date,
        allocation_mode: concept.allocation_mode,
        allocation_value: omvang,
        status: concept.status,
        note: concept.note.trim() === '' ? null : concept.note.trim(),
      });
    },
    onSuccess: () => {
      setBewerkt(null);
      setConcept(null);
      setFout(null);
      ververs();
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'De inzet kon niet worden opgeslagen.'),
  });

  const verwijderen = useMutation({
    mutationFn: (id: number) => endpoints.verwijder('capacity-allocations', id),
    onSuccess: ververs,
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'De inzet kon niet worden verwijderd.'),
  });

  function begin(rij: InzetRij | null): void {
    setFout(null);
    if (rij === null) {
      setConcept({
        user_id: ik.id,
        allocation_type_id: types.data?.data[0]?.id ?? 0,
        title: '',
        external_project_name: '',
        start_date: '',
        end_date: '',
        allocation_mode: 'percentage',
        allocation_value: '40',
        status: 'gepland',
        note: '',
      });
      setBewerkt('nieuw');
      return;
    }
    setConcept({
      user_id: rij.user_id,
      allocation_type_id: rij.allocation_type_id,
      title: rij.title,
      external_project_name: rij.external_project_name ?? '',
      start_date: rij.start_date,
      end_date: rij.end_date,
      allocation_mode: rij.allocation_mode,
      allocation_value: getalUit(rij.allocation_value),
      status: rij.status,
      note: rij.note ?? '',
    });
    setBewerkt(rij.id);
  }

  const eenheid = (modus: InzetRij['allocation_mode']): string =>
    OMVANG.find((optie) => optie.waarde === modus)?.eenheid ?? '';

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Kaart>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Inzet op andere projecten</h2>
          {bewerkt === null && (
            <button
              type="button"
              className="focus-ring"
              onClick={() => begin(null)}
              style={{ ...dialoogKnop, marginLeft: 'auto' }}
            >
              + Inzet vastleggen
            </button>
          )}
        </div>
        <p style={{ fontSize: 11, color: 'var(--inkt-stil)', margin: '8px 0 0', lineHeight: 1.6 }}>
          Inzet elders gaat van de showroomcapaciteit af zodra hij op "gepland" of "actief" staat.
          {magVoorIedereen ? '' : ' U kunt alleen uw eigen inzet vastleggen.'}
        </p>

        {fout && (
          <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 12, marginTop: 8 }}>
            {fout}
          </p>
        )}
      </Kaart>

      {concept && bewerkt !== null && (
        <Kaart accent="var(--inzet)">
          <h3 style={{ fontSize: 14, margin: '0 0 12px' }}>
            {bewerkt === 'nieuw' ? 'Nieuwe inzet' : 'Inzet wijzigen'}
          </h3>

          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            }}
          >
            <label style={{ fontSize: 12 }}>
              Medewerker
              <select
                className="focus-ring"
                value={concept.user_id}
                disabled={!magVoorIedereen}
                onChange={(event) =>
                  setConcept({ ...concept, user_id: Number(event.target.value) })
                }
                style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
              >
                {(gebruikers.data?.data ?? []).map((gebruiker) => (
                  <option key={gebruiker.id} value={gebruiker.id}>
                    {gebruiker.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ fontSize: 12 }}>
              Soort
              <select
                className="focus-ring"
                value={concept.allocation_type_id}
                onChange={(event) =>
                  setConcept({ ...concept, allocation_type_id: Number(event.target.value) })
                }
                style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
              >
                {(types.data?.data ?? []).map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ fontSize: 12 }}>
              Van
              <input
                type="date"
                className="focus-ring"
                value={concept.start_date}
                onChange={(event) => setConcept({ ...concept, start_date: event.target.value })}
                style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
              />
            </label>

            <label style={{ fontSize: 12 }}>
              Tot en met
              <input
                type="date"
                className="focus-ring"
                value={concept.end_date}
                min={concept.start_date || undefined}
                onChange={(event) => setConcept({ ...concept, end_date: event.target.value })}
                style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
              />
            </label>

            <label style={{ fontSize: 12 }}>
              Omvang
              <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                <input
                  className="focus-ring"
                  inputMode="decimal"
                  aria-label="Omvang van de inzet"
                  value={concept.allocation_value}
                  onChange={(event) =>
                    setConcept({ ...concept, allocation_value: event.target.value })
                  }
                  style={{ ...invoerStijl, width: 70, textAlign: 'right' }}
                />
                <select
                  className="focus-ring"
                  aria-label="Eenheid van de omvang"
                  value={concept.allocation_mode}
                  onChange={(event) =>
                    setConcept({
                      ...concept,
                      allocation_mode: event.target.value as Concept['allocation_mode'],
                    })
                  }
                  style={{ ...invoerStijl, flex: 1 }}
                >
                  {OMVANG.map((optie) => (
                    <option key={optie.waarde} value={optie.waarde}>
                      {optie.label}
                    </option>
                  ))}
                </select>
              </div>
            </label>

            <label style={{ fontSize: 12 }}>
              Status
              <select
                className="focus-ring"
                value={concept.status}
                onChange={(event) =>
                  setConcept({ ...concept, status: event.target.value as Concept['status'] })
                }
                style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
              >
                {STATUS.map((waarde) => (
                  <option key={waarde} value={waarde}>
                    {waarde}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label style={{ display: 'block', fontSize: 12, marginTop: 12 }}>
            Waar gaat het over
            <input
              className="focus-ring"
              value={concept.title}
              placeholder="Bijvoorbeeld: begeleiding nieuwbouwshowroom"
              onChange={(event) => setConcept({ ...concept, title: event.target.value })}
              style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
            />
          </label>

          <label style={{ display: 'block', fontSize: 12, marginTop: 12 }}>
            Project buiten het systeem
            <input
              className="focus-ring"
              value={concept.external_project_name}
              placeholder="Optioneel, als het project hier niet in staat"
              onChange={(event) =>
                setConcept({ ...concept, external_project_name: event.target.value })
              }
              style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
            />
          </label>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <button
              type="button"
              className="focus-ring"
              onClick={() => {
                setBewerkt(null);
                setConcept(null);
              }}
              style={dialoogKnop}
            >
              Annuleren
            </button>
            <button
              type="button"
              className="focus-ring"
              disabled={opslaan.isPending}
              onClick={() => opslaan.mutate(bewerkt === 'nieuw' ? null : bewerkt)}
              style={{ ...dialoogKnop, background: 'var(--belasting)', color: '#fff', border: 0 }}
            >
              {opslaan.isPending ? 'Bezig…' : 'Opslaan'}
            </button>
          </div>
        </Kaart>
      )}

      <Kaart>
        {inzet.isLoading && <Skelet hoogte={140} />}

        {!inzet.isLoading && rijen.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--inkt-zacht)', margin: 0 }}>
            Er staat geen inzet elders geregistreerd.
          </p>
        )}

        {rijen.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--rand)' }}>
                  <th scope="col" style={kop}>Medewerker</th>
                  <th scope="col" style={kop}>Waarover</th>
                  <th scope="col" style={kop}>Soort</th>
                  <th scope="col" style={kop}>Van</th>
                  <th scope="col" style={kop}>Tot en met</th>
                  <th scope="col" style={{ ...kop, textAlign: 'right' }}>Omvang</th>
                  <th scope="col" style={kop}>Status</th>
                  <th scope="col" style={kop}>
                    <span className="alleen-voorlezen">Acties</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rijen.map((rij) => (
                  <tr key={rij.id} style={{ borderBottom: '1px solid var(--rand)' }}>
                    <th scope="row" style={{ ...cel, textAlign: 'left', fontWeight: 500 }}>
                      {naam(rij.user_id)}
                    </th>
                    <td style={cel}>
                      {rij.title}
                      {rij.external_project_name && (
                        <span style={{ display: 'block', color: 'var(--inkt-stil)' }}>
                          {rij.external_project_name}
                        </span>
                      )}
                    </td>
                    <td style={cel}>{typeNaam(rij.allocation_type_id)}</td>
                    <td style={cel}>{formatDate(rij.start_date)}</td>
                    <td style={cel}>{formatDate(rij.end_date)}</td>
                    <td style={{ ...cel, textAlign: 'right' }}>
                      {formatDecimal(rij.allocation_value)}
                      {eenheid(rij.allocation_mode)}
                    </td>
                    <td style={cel}>{rij.status}</td>
                    <td style={{ ...cel, whiteSpace: 'nowrap' }}>
                      {(magVoorIedereen || rij.user_id === ik.id) && (
                        <>
                          <button
                            type="button"
                            className="focus-ring"
                            onClick={() => begin(rij)}
                            style={dialoogKnop}
                          >
                            Bewerken
                          </button>{' '}
                          <button
                            type="button"
                            className="focus-ring"
                            onClick={() => verwijderen.mutate(rij.id)}
                            style={dialoogKnop}
                          >
                            Verwijderen
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Kaart>
    </div>
  );
}

const kop: React.CSSProperties = { padding: '4px 6px', fontWeight: 600 };
const cel: React.CSSProperties = { padding: '5px 6px', verticalAlign: 'top' };
