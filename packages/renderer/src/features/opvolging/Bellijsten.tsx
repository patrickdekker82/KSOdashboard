/**
 * Bellijsten: een lijst waar iemand doorheen loopt (hoofdstuk 9).
 *
 * Afgevinkte regels verdwijnen niet maar zakken naar beneden. Zo is te zien
 * hoever de lijst is, en kan een vinkje terug als er per ongeluk iemand is
 * afgevinkt.
 */
import { useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@showroom/shared';
import { ApiFout, endpoints } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { dialoogKnop, invoerStijl } from '../kansen/Dialoog.tsx';

const ROUTE: Record<string, string> = {
  organizations: '/klanten',
  contacts: '/contactpersonen',
  projects: '/projecten',
  opportunities: '/kansen',
};

export function Bellijsten({ navigeer }: { navigeer: (pad: string) => void }): JSX.Element {
  const queryClient = useQueryClient();
  const [gekozen, setGekozen] = useState(0);
  const [notities, setNotities] = useState<Record<string, string>>({});
  const [fout, setFout] = useState<string | null>(null);

  const lijsten = useQuery({
    queryKey: ['lijst', 'call-lists'],
    queryFn: () =>
      endpoints.lijst<{ id: number; name: string; description: string | null }>(
        'call-lists',
        '?pageSize=100',
      ),
  });

  const eerste = lijsten.data?.data[0]?.id ?? 0;
  const lijstId = gekozen > 0 ? gekozen : eerste;

  const leden = useQuery({
    queryKey: ['bellijst', lijstId],
    queryFn: () => endpoints.bellijst(lijstId),
    enabled: lijstId > 0,
  });

  const markeren = useMutation({
    mutationFn: ({
      entiteit,
      recordId,
      gedaan,
      notitie,
    }: {
      entiteit: string;
      recordId: number;
      gedaan: boolean;
      notitie: string | null;
    }) => endpoints.belregelMarkeren(lijstId, entiteit, recordId, gedaan, notitie),
    onSuccess: () => {
      setFout(null);
      void queryClient.invalidateQueries({ queryKey: ['bellijst', lijstId] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Dat lukte niet.'),
  });

  const regels = leden.data?.data ?? [];
  const gedaan = regels.filter((regel) => regel.afgehandeld).length;

  if (lijsten.isLoading) {
    return (
      <Kaart>
        <Skelet hoogte={160} />
      </Kaart>
    );
  }

  if ((lijsten.data?.data.length ?? 0) === 0) {
    return (
      <Kaart>
        <p style={{ margin: 0, color: 'var(--inkt-zacht)' }}>
          Er zijn nog geen bellijsten. Een beheerder maakt ze aan onder Bellijsten in de
          gegevensbeheerschermen.
        </p>
      </Kaart>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Kaart>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: 'var(--inkt-zacht)' }}>
            Lijst{' '}
            <select
              className="focus-ring"
              value={lijstId}
              onChange={(event) => setGekozen(Number(event.target.value))}
              style={invoerStijl}
            >
              {(lijsten.data?.data ?? []).map((lijst) => (
                <option key={lijst.id} value={lijst.id}>
                  {lijst.name}
                </option>
              ))}
            </select>
          </label>

          <span style={{ fontSize: 12, color: 'var(--inkt-zacht)' }}>
            {gedaan} van {regels.length} afgehandeld
          </span>
        </div>

        {fout && (
          <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 12, marginTop: 8 }}>
            {fout}
          </p>
        )}
      </Kaart>

      <Kaart>
        {leden.isLoading && <Skelet hoogte={140} />}

        {!leden.isLoading && regels.length === 0 && (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--inkt-zacht)' }}>
            Deze lijst is leeg.
          </p>
        )}

        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
          {regels.map((regel) => {
            const sleutel = `${regel.entity_key}:${regel.record_id}`;
            const basis = ROUTE[regel.entity_key];

            return (
              <li
                key={sleutel}
                style={{
                  border: '1px solid var(--rand)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  opacity: regel.afgehandeld ? 0.6 : 1,
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <label style={{ display: 'inline-flex', gap: 8, alignItems: 'baseline' }}>
                    <input
                      type="checkbox"
                      checked={regel.afgehandeld}
                      onChange={(event) =>
                        markeren.mutate({
                          entiteit: regel.entity_key,
                          recordId: regel.record_id,
                          gedaan: event.target.checked,
                          notitie: notities[sleutel] ?? null,
                        })
                      }
                      aria-label={`${regel.titel} afgehandeld`}
                    />
                    <strong style={{ fontSize: 13 }}>{regel.titel}</strong>
                  </label>

                  {regel.done_at && (
                    <span style={{ fontSize: 11, color: 'var(--inkt-stil)' }}>
                      afgehandeld op {formatDate(regel.done_at.slice(0, 10))}
                    </span>
                  )}

                  {basis && (
                    <button
                      type="button"
                      className="focus-ring"
                      onClick={() => navigeer(`${basis}/${regel.record_id}`)}
                      style={{ ...dialoogKnop, marginLeft: 'auto' }}
                    >
                      Bekijken →
                    </button>
                  )}
                </div>

                {regel.note ? (
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--inkt-zacht)' }}>
                    {regel.note}
                  </p>
                ) : (
                  !regel.afgehandeld && (
                    <input
                      className="focus-ring"
                      placeholder="Notitie bij dit gesprek (optioneel)"
                      value={notities[sleutel] ?? ''}
                      onChange={(event) =>
                        setNotities((huidig) => ({ ...huidig, [sleutel]: event.target.value }))
                      }
                      style={{ ...invoerStijl, width: '100%', marginTop: 6 }}
                    />
                  )
                )}
              </li>
            );
          })}
        </ul>
      </Kaart>
    </div>
  );
}
