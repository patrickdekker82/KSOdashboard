/**
 * De fasen van een project, met de balk die laat zien wanneer ze lopen.
 *
 * Alleen showroom en sluiting belasten de afdeling; start bouw en oplevering
 * staan er wel bij maar tellen niet mee in de capaciteit (hoofdstuk 1). Dat
 * verschil is aan de balk te zien én staat er in woorden bij, want een balk die
 * alleen op kleur verschilt zegt niets tegen wie kleuren niet onderscheidt.
 */
import { useMemo, useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, isoWeekOfDate } from '@showroom/shared';
import { ApiFout, endpoints, type Projectfase } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { invoerStijl, dialoogKnop } from '../kansen/Dialoog.tsx';

type Concept = {
  phase_type_id: number;
  start_date: string;
  end_date: string;
  unit_count_override: string;
  note: string;
  is_capacity_load: boolean;
};

/** Fasesoorten die de afdeling belasten; de rest is er ter informatie. */
const BELASTEND = new Set(['showroom', 'sluiting']);

export function Projectfasen({ projectId }: { projectId: number }): JSX.Element {
  const queryClient = useQueryClient();
  const [bewerkt, setBewerkt] = useState<number | 'nieuw' | null>(null);
  const [concept, setConcept] = useState<Concept | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const fasen = useQuery({
    queryKey: ['projectfasen', projectId],
    queryFn: () =>
      endpoints.lijst<Projectfase>(
        'project-phases',
        `?filter=${btoa(JSON.stringify({ field: 'project_id', operator: 'eq', value: projectId }))}&pageSize=100`,
      ),
  });

  const keuzelijsten = useQuery({ queryKey: ['keuzelijsten'], queryFn: () => endpoints.keuzelijsten() });
  const faselijst = useMemo(
    () => (keuzelijsten.data?.data ?? []).find((lijst) => lijst.key === 'projectfase') ?? null,
    [keuzelijsten.data],
  );
  const soorten = useQuery({
    queryKey: ['keuzelijstItems', faselijst?.id],
    queryFn: () => endpoints.keuzelijstItems(faselijst!.id),
    enabled: faselijst !== null,
  });

  const soortVan = (id: number): { label: string; value: string; color: string | null } | null =>
    (soorten.data?.data ?? []).find((item) => item.id === id) ?? null;

  function ververs(): void {
    void queryClient.invalidateQueries({ queryKey: ['projectfasen', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['weekbezetting'] });
    void queryClient.invalidateQueries({ queryKey: ['kalender'] });
  }

  const opslaan = useMutation({
    mutationFn: (id: number | null) => {
      if (!concept) throw new ApiFout(400, 'leeg', 'Er is niets om op te slaan.');
      if (concept.phase_type_id <= 0) throw new ApiFout(400, 'onvolledig', 'Kies een soort fase.');
      if (concept.start_date === '' || concept.end_date === '') {
        throw new ApiFout(400, 'onvolledig', 'Vul een begin- en einddatum in.');
      }
      if (concept.end_date < concept.start_date) {
        throw new ApiFout(400, 'ongeldig', 'De einddatum ligt voor de begindatum.');
      }
      const override = concept.unit_count_override.trim();
      if (override !== '' && !/^\d+$/.test(override)) {
        throw new ApiFout(400, 'ongeldig', 'Het afwijkende aantal woningen moet een heel getal zijn.');
      }

      return endpoints.bewaar<Projectfase>('project-phases', id, {
        project_id: projectId,
        phase_type_id: concept.phase_type_id,
        start_date: concept.start_date,
        end_date: concept.end_date,
        unit_count_override: override === '' ? null : Number(override),
        note: concept.note.trim() === '' ? null : concept.note.trim(),
        is_capacity_load: concept.is_capacity_load ? 1 : 0,
      });
    },
    onSuccess: () => {
      setBewerkt(null);
      setConcept(null);
      setFout(null);
      ververs();
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'De fase kon niet worden opgeslagen.'),
  });

  const verwijderen = useMutation({
    mutationFn: (id: number) => endpoints.verwijder('project-phases', id),
    onSuccess: ververs,
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'De fase kon niet worden verwijderd.'),
  });

  function begin(fase: Projectfase | null): void {
    setFout(null);
    if (fase === null) {
      const eerste = soorten.data?.data[0];
      setConcept({
        phase_type_id: eerste?.id ?? 0,
        start_date: '',
        end_date: '',
        unit_count_override: '',
        note: '',
        is_capacity_load: eerste ? BELASTEND.has(eerste.value) : false,
      });
      setBewerkt('nieuw');
      return;
    }
    setConcept({
      phase_type_id: fase.phase_type_id,
      start_date: fase.start_date,
      end_date: fase.end_date,
      unit_count_override:
        fase.unit_count_override === null ? '' : String(fase.unit_count_override),
      note: fase.note ?? '',
      is_capacity_load: fase.is_capacity_load === 1,
    });
    setBewerkt(fase.id);
  }

  const rijen = useMemo(
    () => [...(fasen.data?.data ?? [])].sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [fasen.data],
  );

  // De balk loopt van de vroegste tot de laatste datum van dit project.
  const bereik = useMemo(() => {
    if (rijen.length === 0) return null;
    const start = rijen.reduce((vroegste, fase) => (fase.start_date < vroegste ? fase.start_date : vroegste), rijen[0]!.start_date);
    const eind = rijen.reduce((laatste, fase) => (fase.end_date > laatste ? fase.end_date : laatste), rijen[0]!.end_date);
    const van = Date.parse(`${start}T00:00:00Z`);
    const tot = Date.parse(`${eind}T00:00:00Z`);
    return { van, tot: tot === van ? van + 86_400_000 : tot };
  }, [rijen]);

  return (
    <Kaart>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, margin: 0 }}>Fasering</h2>
        <span style={{ fontSize: 12, color: 'var(--inkt-stil)' }}>
          {rijen.length} fase{rijen.length === 1 ? '' : 'n'}
        </span>
        {bewerkt === null && (
          <button
            type="button"
            className="focus-ring"
            onClick={() => begin(null)}
            style={{ ...dialoogKnop, marginLeft: 'auto' }}
          >
            + Fase toevoegen
          </button>
        )}
      </div>

      {fasen.isLoading && <Skelet hoogte={120} />}

      {!fasen.isLoading && rijen.length === 0 && bewerkt === null && (
        <p style={{ fontSize: 13, color: 'var(--inkt-zacht)', margin: 0 }}>
          Dit project heeft nog geen fasering en geeft dus geen belasting op de planning.
        </p>
      )}

      {bereik && (
        <div style={{ display: 'grid', gap: 4, marginBottom: 12 }}>
          {rijen.map((fase) => {
            const soort = soortVan(fase.phase_type_id);
            const van = Date.parse(`${fase.start_date}T00:00:00Z`);
            const tot = Date.parse(`${fase.end_date}T00:00:00Z`);
            const breedte = bereik.tot === bereik.van ? 100 : ((tot - van) / (bereik.tot - bereik.van)) * 100;
            const links = bereik.tot === bereik.van ? 0 : ((van - bereik.van) / (bereik.tot - bereik.van)) * 100;
            const belast = fase.is_capacity_load === 1;

            return (
              <div key={fase.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, width: 120, color: 'var(--inkt-zacht)' }}>
                  {soort?.label ?? 'Fase'}
                </span>
                <div style={{ flex: 1, position: 'relative', height: 18, background: 'var(--rand)', borderRadius: 3 }}>
                  <div
                    title={`${soort?.label ?? 'Fase'}: ${formatDate(fase.start_date)} t/m ${formatDate(fase.end_date)}`}
                    className={belast ? undefined : 'arcering-gesloten'}
                    style={{
                      position: 'absolute',
                      left: `${links}%`,
                      width: `${Math.max(2, breedte)}%`,
                      top: 0,
                      bottom: 0,
                      background: belast ? (soort?.color ?? 'var(--belasting)') : 'var(--gesloten)',
                      border: belast ? 0 : '1px solid var(--rand)',
                      borderRadius: 3,
                    }}
                  />
                </div>
                <span style={{ fontSize: 11, color: 'var(--inkt-stil)', width: 190, textAlign: 'right' }}>
                  wk {isoWeekOfDate(fase.start_date).week}–{isoWeekOfDate(fase.end_date).week}
                  {belast ? ' · belast de planning' : ' · telt niet mee'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {concept && bewerkt !== null && (
        <div
          style={{
            border: '1px solid var(--rand)',
            borderLeft: '3px solid var(--belasting)',
            borderRadius: 6,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <h3 style={{ fontSize: 13, margin: '0 0 10px' }}>
            {bewerkt === 'nieuw' ? 'Nieuwe fase' : 'Fase wijzigen'}
          </h3>

          <div
            style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
          >
            <label style={{ fontSize: 12 }}>
              Soort
              <select
                className="focus-ring"
                value={concept.phase_type_id}
                onChange={(event) => {
                  const id = Number(event.target.value);
                  const soort = soortVan(id);
                  setConcept({
                    ...concept,
                    phase_type_id: id,
                    // De belastingvlag volgt de soort, maar blijft daarna
                    // aanpasbaar: een showroomfase die uitloopt en niet meer
                    // meetelt, komt voor.
                    is_capacity_load: soort ? BELASTEND.has(soort.value) : concept.is_capacity_load,
                  });
                }}
                style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
              >
                {(soorten.data?.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
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
              Afwijkend aantal woningen
              <input
                className="focus-ring"
                inputMode="numeric"
                placeholder="leeg = het hele project"
                value={concept.unit_count_override}
                onChange={(event) =>
                  setConcept({ ...concept, unit_count_override: event.target.value })
                }
                style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
              />
            </label>
          </div>

          <label style={{ display: 'block', fontSize: 12, marginTop: 10 }}>
            <input
              type="checkbox"
              checked={concept.is_capacity_load}
              onChange={(event) =>
                setConcept({ ...concept, is_capacity_load: event.target.checked })
              }
            />{' '}
            Deze fase belast de showroomplanning
          </label>

          <label style={{ display: 'block', fontSize: 12, marginTop: 10 }}>
            Notitie
            <input
              className="focus-ring"
              value={concept.note}
              onChange={(event) => setConcept({ ...concept, note: event.target.value })}
              style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
            />
          </label>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
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
        </div>
      )}

      {rijen.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--rand)' }}>
                <th scope="col" style={kop}>Soort</th>
                <th scope="col" style={kop}>Van</th>
                <th scope="col" style={kop}>Tot en met</th>
                <th scope="col" style={{ ...kop, textAlign: 'right' }}>Woningen</th>
                <th scope="col" style={kop}>Belast</th>
                <th scope="col" style={kop}>Notitie</th>
                <th scope="col" style={kop}>
                  <span className="alleen-voorlezen">Acties</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rijen.map((fase) => (
                <tr key={fase.id} style={{ borderBottom: '1px solid var(--rand)' }}>
                  <th scope="row" style={{ ...cel, textAlign: 'left', fontWeight: 500 }}>
                    {soortVan(fase.phase_type_id)?.label ?? `Fase ${fase.phase_type_id}`}
                  </th>
                  <td style={cel}>{formatDate(fase.start_date)}</td>
                  <td style={cel}>{formatDate(fase.end_date)}</td>
                  <td style={{ ...cel, textAlign: 'right' }}>
                    {fase.unit_count_override ?? '—'}
                  </td>
                  <td style={cel}>{fase.is_capacity_load === 1 ? 'ja' : 'nee'}</td>
                  <td style={{ ...cel, color: 'var(--inkt-stil)' }}>{fase.note ?? '—'}</td>
                  <td style={{ ...cel, whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      className="focus-ring"
                      onClick={() => begin(fase)}
                      style={dialoogKnop}
                    >
                      Bewerken
                    </button>{' '}
                    <button
                      type="button"
                      className="focus-ring"
                      onClick={() => verwijderen.mutate(fase.id)}
                      style={dialoogKnop}
                    >
                      Verwijderen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fout && (
        <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 12, marginTop: 10 }}>
          {fout}
        </p>
      )}
    </Kaart>
  );
}

const kop: React.CSSProperties = { padding: '4px 6px', fontWeight: 600 };
const cel: React.CSSProperties = { padding: '5px 6px' };
