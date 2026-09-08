/**
 * Welke productdisciplines er in dit project zitten (hoofdstuk 4.4).
 *
 * Kansen kenden de disciplines al via hun regels; een project niet. Terwijl
 * juist daar de vraag speelt welke disciplines meelopen — badkamer, keuken,
 * tegelwerk — en wie er dus gebeld moet worden als de planning schuift.
 *
 * Veel-op-veel: een woning met een badkamer én een keuken is de gewone
 * situatie, niet de uitzondering.
 */
import { useMemo, useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiFout, endpoints, type Discipline, type Projectdiscipline } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { dialoogKnop, invoerStijl } from '../kansen/Dialoog.tsx';

export function Projectdisciplines({ projectId }: { projectId: number }): JSX.Element {
  const queryClient = useQueryClient();
  const [kiezen, setKiezen] = useState('');
  const [notitie, setNotitie] = useState('');
  const [fout, setFout] = useState<string | null>(null);

  const gekoppeld = useQuery({
    queryKey: ['projectdisciplines', projectId],
    queryFn: () =>
      endpoints.lijst<Projectdiscipline>(
        'project-disciplines',
        `?filter=${btoa(
          JSON.stringify({ field: 'project_id', operator: 'eq', value: projectId }),
        )}&pageSize=100`,
      ),
  });

  const alle = useQuery({
    queryKey: ['disciplines-keuze'],
    queryFn: () => endpoints.lijst<Discipline>('disciplines', '?pageSize=200'),
    staleTime: 5 * 60_000,
  });

  const perId = useMemo(() => new Map((alle.data?.data ?? []).map((d) => [d.id, d])), [alle.data]);

  const rijen = gekoppeld.data?.data ?? [];
  const alGekoppeld = new Set(rijen.map((rij) => rij.discipline_id));

  // Alleen actieve disciplines aanbieden die er nog niet aan hangen; een
  // dubbele koppeling weigert de database toch.
  const kiesbaar = (alle.data?.data ?? []).filter(
    (d) => d.active === 1 && d.archived_at === null && !alGekoppeld.has(d.id),
  );

  const koppelen = useMutation({
    mutationFn: () =>
      endpoints.bewaar('project-disciplines', null, {
        project_id: projectId,
        discipline_id: Number(kiezen),
        note: notitie.trim() || null,
      }),
    onSuccess: () => {
      setKiezen('');
      setNotitie('');
      setFout(null);
      void queryClient.invalidateQueries({ queryKey: ['projectdisciplines', projectId] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Koppelen lukte niet.'),
  });

  const ontkoppelen = useMutation({
    mutationFn: (id: number) => endpoints.verwijder('project-disciplines', id),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['projectdisciplines', projectId] }),
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Ontkoppelen lukte niet.'),
  });

  return (
    <Kaart>
      <h2 style={{ fontSize: 14, margin: '0 0 10px' }}>Disciplines</h2>

      {gekoppeld.isLoading || alle.isLoading ? (
        <Skelet hoogte={90} />
      ) : rijen.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--inkt-zacht)', margin: '0 0 12px' }}>
          Er hangen nog geen disciplines aan dit project.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: '0 0 12px', padding: 0, display: 'grid', gap: 6 }}>
          {rijen.map((rij) => {
            const discipline = perId.get(rij.discipline_id);
            return (
              <li
                key={rij.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  border: '1px solid var(--rand)',
                  borderRadius: 6,
                  padding: '6px 10px',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: discipline?.color ?? 'var(--rand)',
                    flexShrink: 0,
                  }}
                />
                <strong style={{ fontSize: 13 }}>
                  {discipline?.name ?? `Discipline #${String(rij.discipline_id)}`}
                </strong>
                {rij.note !== null && rij.note !== '' && (
                  <span style={{ fontSize: 12, color: 'var(--inkt-zacht)' }}>— {rij.note}</span>
                )}
                <button
                  type="button"
                  className="focus-ring"
                  onClick={() => ontkoppelen.mutate(rij.id)}
                  style={{ ...dialoogKnop, marginLeft: 'auto', color: 'var(--ziekte)' }}
                >
                  Ontkoppelen
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: 12 }}>
          <span style={{ color: 'var(--inkt-zacht)' }}>Discipline toevoegen</span>
          <select
            className="focus-ring"
            value={kiezen}
            onChange={(event) => setKiezen(event.target.value)}
            style={{ ...invoerStijl, width: 220, marginTop: 3, display: 'block' }}
          >
            <option value="">— kies —</option>
            {kiesbaar.map((discipline) => (
              <option key={discipline.id} value={discipline.id}>
                {discipline.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, flex: '1 1 220px' }}>
          <span style={{ color: 'var(--inkt-zacht)' }}>Notitie (optioneel)</span>
          <input
            className="focus-ring"
            value={notitie}
            onChange={(event) => setNotitie(event.target.value)}
            placeholder="bijvoorbeeld: alleen bouwnummer 1 t/m 20"
            style={{ ...invoerStijl, width: '100%', marginTop: 3, display: 'block' }}
          />
        </label>
        <button
          type="button"
          className="focus-ring"
          disabled={kiezen === '' || koppelen.isPending}
          onClick={() => koppelen.mutate()}
          style={{
            ...dialoogKnop,
            background: 'var(--belasting)',
            color: '#fff',
            borderColor: 'transparent',
            opacity: kiezen === '' ? 0.5 : 1,
          }}
        >
          {koppelen.isPending ? 'Bezig…' : 'Koppelen'}
        </button>
      </div>

      {kiesbaar.length === 0 && (alle.data?.data ?? []).length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--inkt-stil)', margin: '10px 0 0' }}>
          Er zijn nog geen disciplines. Maak ze aan bij Instellingen → Productdisciplines.
        </p>
      )}

      {fout !== null && (
        <p role="alert" style={{ fontSize: 12, color: 'var(--ziekte)', margin: '10px 0 0' }}>
          {fout}
        </p>
      )}
    </Kaart>
  );
}
