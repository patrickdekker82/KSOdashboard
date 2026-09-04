/**
 * De goedkeuringswerklijst van de manager (hoofdstuk 6.4.3).
 *
 * Bij elke aanvraag staat meteen wat hij met de planning doet, want dat is de
 * vraag die een manager stelt: kan die week dit hebben? Goedkeuren en afwijzen
 * kunnen allebei met een notitie, en die notitie ziet de aanvrager terug.
 */
import { useMemo, useState, type JSX } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@showroom/shared';
import { ApiFout, endpoints, type Afwezigheid } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { invoerStijl, dialoogKnop } from '../kansen/Dialoog.tsx';
import { Waarschuwing } from './Aanvragen.tsx';

export function Goedkeuren(): JSX.Element {
  const queryClient = useQueryClient();
  const [notities, setNotities] = useState<Record<number, string>>({});
  const [melding, setMelding] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const aanvragen = useQuery({
    queryKey: ['openstaand-verlof'],
    queryFn: () =>
      endpoints.lijst<Afwezigheid>(
        'absences',
        `?filter=${btoa(JSON.stringify({ field: 'status', operator: 'eq', value: 'aangevraagd' }))}&pageSize=100`,
      ),
  });
  const gebruikers = useQuery({ queryKey: ['gebruikers'], queryFn: () => endpoints.gebruikers() });
  const types = useQuery({
    queryKey: ['afwezigheidstypes'],
    queryFn: () => endpoints.afwezigheidstypes(),
  });

  const rijen = useMemo(() => aanvragen.data?.data ?? [], [aanvragen.data]);

  // Per aanvraag wat hij met de planning doet. Eén query per rij, want de kern
  // rekent per medewerker en per periode.
  const gevolgen = useQueries({
    queries: rijen.map((rij) => ({
      queryKey: [
        'verlofconflicten',
        rij.user_id,
        rij.start_date,
        rij.end_date ?? rij.start_date,
        rij.day_part,
      ],
      queryFn: () =>
        endpoints.verlofConflicten(
          rij.user_id,
          rij.start_date,
          rij.end_date ?? rij.start_date,
          rij.day_part,
        ),
    })),
  });

  function ververs(): void {
    void queryClient.invalidateQueries({ queryKey: ['openstaand-verlof'] });
    void queryClient.invalidateQueries({ queryKey: ['mijn-verlof'] });
    void queryClient.invalidateQueries({ queryKey: ['kalender'] });
    void queryClient.invalidateQueries({ queryKey: ['verlofsaldi'] });
  }

  const beslissen = useMutation({
    mutationFn: ({ id, akkoord }: { id: number; akkoord: boolean }) =>
      akkoord
        ? endpoints.verlofGoedkeuren(id, notities[id] ?? '')
        : endpoints.verlofAfwijzen(id, notities[id] ?? ''),
    onSuccess: (antwoord) => {
      setFout(null);
      setMelding(antwoord.status === 'goedgekeurd' ? 'Goedgekeurd.' : 'Afgewezen.');
      ververs();
    },
    onError: (error: unknown) =>
      setFout(
        error instanceof ApiFout
          ? error.message
          : 'De beslissing kon niet worden vastgelegd.',
      ),
  });

  const naam = (id: number): string =>
    (gebruikers.data?.data ?? []).find((gebruiker) => gebruiker.id === id)?.name ?? `#${id}`;
  const typeNaam = (id: number): string =>
    (types.data?.data ?? []).find((type) => type.id === id)?.name ?? 'Afwezig';

  if (aanvragen.isLoading) {
    return (
      <Kaart>
        <Skelet hoogte={160} />
      </Kaart>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {melding && (
        <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--inkt-zacht)' }}>
          {melding}
        </p>
      )}
      {fout && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--ziekte)' }}>
          {fout}
        </p>
      )}

      {rijen.length === 0 && (
        <Kaart>
          <p style={{ margin: 0, color: 'var(--inkt-zacht)' }}>
            Er wacht niets op goedkeuring.
          </p>
        </Kaart>
      )}

      {rijen.map((rij, index) => (
        <Kaart key={rij.id}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14 }}>{naam(rij.user_id)}</strong>
            <span style={{ fontSize: 13, color: 'var(--inkt-zacht)' }}>
              {typeNaam(rij.absence_type_id)} · {formatDate(rij.start_date)}
              {rij.end_date && rij.end_date !== rij.start_date
                ? ` t/m ${formatDate(rij.end_date)}`
                : ''}
              {rij.day_part !== 'hele_dag' ? ` (${rij.day_part})` : ''}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--inkt-stil)' }}>
              aangevraagd op {formatDate(rij.requested_at.slice(0, 10))}
            </span>
          </div>

          {rij.note && (
            <p style={{ margin: '6px 0 0', fontSize: 13 }}>
              <span style={{ color: 'var(--inkt-stil)' }}>Toelichting:</span> {rij.note}
            </p>
          )}

          <Waarschuwing
            conflict={gevolgen[index]?.data?.data}
            bezig={gevolgen[index]?.isFetching ?? false}
          />

          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="focus-ring"
              placeholder="Notitie bij de beslissing (optioneel)"
              value={notities[rij.id] ?? ''}
              onChange={(event) =>
                setNotities((huidig) => ({ ...huidig, [rij.id]: event.target.value }))
              }
              style={{ ...invoerStijl, flex: 1, minWidth: 200 }}
            />
            <button
              type="button"
              className="focus-ring"
              disabled={beslissen.isPending}
              onClick={() => beslissen.mutate({ id: rij.id, akkoord: false })}
              style={dialoogKnop}
            >
              Afwijzen
            </button>
            <button
              type="button"
              className="focus-ring"
              disabled={beslissen.isPending}
              onClick={() => beslissen.mutate({ id: rij.id, akkoord: true })}
              style={{ ...dialoogKnop, background: 'var(--capaciteit)', color: '#fff', border: 0 }}
            >
              Goedkeuren
            </button>
          </div>
        </Kaart>
      ))}
    </div>
  );
}
