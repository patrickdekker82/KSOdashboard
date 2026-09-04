/**
 * Verlof aanvragen en je eigen aanvragen terugzien (hoofdstuk 6.4.3).
 *
 * Terwijl iemand de datums invult, laat het scherm zien wat de aanvraag met de
 * planning doet: "week 38: bezetting stijgt van 59% naar 94%". Dat is een
 * waarschuwing en geen blokkade — de kern weigert de aanvraag niet, en dit
 * scherm dus ook niet. Wie weet dat het druk wordt, mag alsnog vrij vragen; het
 * gesprek daarover hoort tussen mensen plaats te vinden, niet in een dialoog.
 */
import { useEffect, useMemo, useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, formatDecimal } from '@showroom/shared';
import {
  ApiFout,
  endpoints,
  type Afwezigheid,
  type Gebruiker,
  type VerlofConflict,
} from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { invoerStijl, dialoogKnop } from '../kansen/Dialoog.tsx';
import { STATUS_LABEL, statusKleur } from './status.ts';

const DAGDELEN = [
  { waarde: 'hele_dag', label: 'Hele dag(en)' },
  { waarde: 'ochtend', label: 'Alleen de ochtend' },
  { waarde: 'middag', label: 'Alleen de middag' },
] as const;

export function Aanvragen({ ik }: { ik: Gebruiker }): JSX.Element {
  const queryClient = useQueryClient();
  const [typeId, setTypeId] = useState(0);
  const [start, setStart] = useState('');
  const [eind, setEind] = useState('');
  const [dagdeel, setDagdeel] = useState<'hele_dag' | 'ochtend' | 'middag'>('hele_dag');
  const [notitie, setNotitie] = useState('');
  const [melding, setMelding] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const types = useQuery({
    queryKey: ['afwezigheidstypes'],
    queryFn: () => endpoints.afwezigheidstypes(),
  });

  const mijn = useQuery({
    queryKey: ['mijn-verlof', ik.id],
    queryFn: () =>
      endpoints.lijst<Afwezigheid>(
        'absences',
        `?filter=${btoa(JSON.stringify({ field: 'user_id', operator: 'eq', value: ik.id }))}&pageSize=100`,
      ),
  });

  // Het eerste type dat verlof is, staat voorgeselecteerd.
  useEffect(() => {
    if (typeId !== 0) return;
    const eerste = types.data?.data[0];
    if (eerste) setTypeId(eerste.id);
  }, [types.data, typeId]);

  const gekozenType = useMemo(
    () => (types.data?.data ?? []).find((type) => type.id === typeId) ?? null,
    [types.data, typeId],
  );

  const compleet = typeId > 0 && start !== '';
  const tot = eind === '' ? start : eind;

  // De waarschuwing loopt mee met wat er staat, dus zonder knop "controleren".
  const conflicten = useQuery({
    queryKey: ['verlofconflicten', ik.id, start, tot, dagdeel],
    queryFn: () => endpoints.verlofConflicten(ik.id, start, tot, dagdeel),
    enabled: compleet,
  });

  const aanvragen = useMutation({
    mutationFn: () =>
      endpoints.bewaar<Afwezigheid>('absences', null, {
        absence_type_id: typeId,
        start_date: start,
        end_date: tot,
        day_part: dagdeel,
        note: notitie.trim() === '' ? null : notitie.trim(),
      }),
    onSuccess: () => {
      setMelding(
        gekozenType && gekozenType.requires_approval === 0
          ? 'Vastgelegd.'
          : 'Aangevraagd. Een manager beoordeelt hem.',
      );
      setFout(null);
      setStart('');
      setEind('');
      setNotitie('');
      void queryClient.invalidateQueries({ queryKey: ['mijn-verlof'] });
      void queryClient.invalidateQueries({ queryKey: ['kalender'] });
      void queryClient.invalidateQueries({ queryKey: ['verlofsaldi'] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'De aanvraag kon niet worden opgeslagen.'),
  });

  const annuleren = useMutation({
    mutationFn: (id: number) => endpoints.verlofAnnuleren(id),
    onSuccess: () => {
      setMelding('Ingetrokken.');
      void queryClient.invalidateQueries({ queryKey: ['mijn-verlof'] });
      void queryClient.invalidateQueries({ queryKey: ['kalender'] });
      void queryClient.invalidateQueries({ queryKey: ['verlofsaldi'] });
    },
  });

  const typeNaam = (id: number): string =>
    (types.data?.data ?? []).find((type) => type.id === id)?.name ?? 'Afwezig';

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Kaart>
        <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>Verlof aanvragen</h2>

        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          }}
        >
          <label style={{ fontSize: 12 }}>
            Soort
            <select
              className="focus-ring"
              value={typeId}
              onChange={(event) => setTypeId(Number(event.target.value))}
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
              value={start}
              onChange={(event) => setStart(event.target.value)}
              style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
            />
          </label>

          <label style={{ fontSize: 12 }}>
            Tot en met
            <input
              type="date"
              className="focus-ring"
              value={eind}
              min={start || undefined}
              onChange={(event) => setEind(event.target.value)}
              style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
            />
            <span style={{ display: 'block', fontSize: 11, color: 'var(--inkt-stil)', marginTop: 2 }}>
              Leeg laten voor één dag.
            </span>
          </label>

          <label style={{ fontSize: 12 }}>
            Dagdeel
            <select
              className="focus-ring"
              value={dagdeel}
              disabled={gekozenType?.allow_half_days === 0}
              onChange={(event) =>
                setDagdeel(event.target.value as 'hele_dag' | 'ochtend' | 'middag')
              }
              style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
            >
              {DAGDELEN.map((optie) => (
                <option key={optie.waarde} value={optie.waarde}>
                  {optie.label}
                </option>
              ))}
            </select>
            {gekozenType?.allow_half_days === 0 && (
              <span style={{ display: 'block', fontSize: 11, color: 'var(--inkt-stil)', marginTop: 2 }}>
                Bij dit soort afwezigheid kan geen halve dag.
              </span>
            )}
          </label>
        </div>

        <label style={{ display: 'block', fontSize: 12, marginTop: 12 }}>
          Toelichting
          <input
            className="focus-ring"
            value={notitie}
            onChange={(event) => setNotitie(event.target.value)}
            placeholder="Optioneel"
            style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
          />
        </label>

        {gekozenType?.visibility === 'management' && (
          <p style={{ fontSize: 11, color: 'var(--inkt-stil)', margin: '8px 0 0', lineHeight: 1.6 }}>
            Collega's zien alleen dat u afwezig bent, niet wat voor soort afwezigheid het is.
            Noteer hier dus niets wat privé is.
          </p>
        )}

        {compleet && <Waarschuwing conflict={conflicten.data?.data} bezig={conflicten.isFetching} />}

        {fout && (
          <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 12, marginTop: 10 }}>
            {fout}
          </p>
        )}
        {melding && (
          <p role="status" style={{ color: 'var(--inkt-zacht)', fontSize: 12, marginTop: 10 }}>
            {melding}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button
            type="button"
            className="focus-ring"
            disabled={!compleet || aanvragen.isPending}
            onClick={() => aanvragen.mutate()}
            style={{ ...dialoogKnop, background: 'var(--belasting)', color: '#fff', border: 0 }}
          >
            {aanvragen.isPending ? 'Bezig…' : 'Aanvragen'}
          </button>
        </div>
      </Kaart>

      <Kaart>
        <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>Mijn aanvragen</h2>

        {mijn.isLoading && <Skelet hoogte={120} />}

        {mijn.data?.data.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--inkt-zacht)', margin: 0 }}>
            U heeft dit jaar nog geen verlof aangevraagd.
          </p>
        )}

        {(mijn.data?.data.length ?? 0) > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--rand)' }}>
                  <th scope="col" style={kop}>Soort</th>
                  <th scope="col" style={kop}>Van</th>
                  <th scope="col" style={kop}>Tot en met</th>
                  <th scope="col" style={kop}>Status</th>
                  <th scope="col" style={kop}>Toelichting</th>
                  <th scope="col" style={kop}><span className="alleen-voorlezen">Acties</span></th>
                </tr>
              </thead>
              <tbody>
                {(mijn.data?.data ?? []).map((rij) => (
                  <tr key={rij.id} style={{ borderBottom: '1px solid var(--rand)' }}>
                    <th scope="row" style={{ ...cel, textAlign: 'left', fontWeight: 500 }}>
                      {typeNaam(rij.absence_type_id)}
                      {rij.day_part !== 'hele_dag' && (
                        <span style={{ color: 'var(--inkt-stil)', fontWeight: 400 }}>
                          {' '}
                          ({rij.day_part === 'ochtend' ? 'ochtend' : 'middag'})
                        </span>
                      )}
                    </th>
                    <td style={cel}>{formatDate(rij.start_date)}</td>
                    <td style={cel}>
                      {rij.end_date === null ? 'tot nader order' : formatDate(rij.end_date)}
                    </td>
                    <td style={cel}>
                      <span style={{ color: statusKleur(rij.status) }}>
                        {STATUS_LABEL[rij.status] ?? rij.status}
                      </span>
                    </td>
                    <td style={{ ...cel, color: 'var(--inkt-stil)' }}>
                      {rij.decision_note ?? rij.note ?? '—'}
                    </td>
                    <td style={cel}>
                      {(rij.status === 'aangevraagd' || rij.status === 'goedgekeurd') && (
                        <button
                          type="button"
                          className="focus-ring"
                          onClick={() => annuleren.mutate(rij.id)}
                          style={dialoogKnop}
                        >
                          Intrekken
                        </button>
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

/** Wat de aanvraag met de planning doet. Waarschuwen, niet blokkeren. */
export function Waarschuwing({
  conflict,
  bezig,
}: {
  conflict: VerlofConflict | undefined;
  bezig: boolean;
}): JSX.Element {
  if (bezig && !conflict) {
    return (
      <p style={{ fontSize: 12, color: 'var(--inkt-stil)', marginTop: 12 }}>
        Bezig met doorrekenen…
      </p>
    );
  }
  if (!conflict) return <></>;

  const zorgen = conflict.weken.filter(
    (week) => week.overbezetting || week.teWeinigBegeleiders || week.alAfwezig.length > 0,
  );

  return (
    <div
      style={{
        marginTop: 12,
        border: '1px solid var(--rand)',
        borderLeft: `3px solid ${zorgen.length > 0 ? 'var(--ziekte)' : 'var(--capaciteit)'}`,
        borderRadius: 6,
        padding: 10,
      }}
    >
      <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>
        {zorgen.length === 0
          ? 'Dit past in de planning.'
          : `Let op: dit raakt ${zorgen.length} week${zorgen.length === 1 ? '' : 'en'}.`}
      </p>

      <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
        {conflict.weken.map((week) => (
          <li key={`${week.isoYear}-${week.isoWeek}`} style={{ fontSize: 12 }}>
            <strong>Week {week.isoWeek}:</strong> bezetting{' '}
            {formatDecimal(Math.round(week.bezettingVoor))}% →{' '}
            <span
              style={{
                color: week.overbezetting ? 'var(--ziekte)' : 'var(--inkt)',
                fontWeight: week.overbezetting ? 600 : 400,
              }}
            >
              {formatDecimal(Math.round(week.bezettingNa))}%
            </span>
            {week.teWeinigBegeleiders && (
              <span style={{ color: 'var(--ziekte)' }}>
                {' '}
                · te weinig begeleiders ({week.begeleidersBeschikbaar})
              </span>
            )}
            {week.alAfwezig.length > 0 && (
              <span style={{ color: 'var(--inkt-stil)' }}>
                {' '}
                · al weg: {week.alAfwezig.join(', ')}
              </span>
            )}
          </li>
        ))}
      </ul>

      {conflict.overlap.length > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ziekte)' }}>
          U heeft in deze periode al {conflict.overlap.length} registratie(s) staan.
        </p>
      )}

      <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--inkt-stil)', lineHeight: 1.6 }}>
        Dit is een waarschuwing, geen blokkade. Aanvragen mag; overleg het even als het krap wordt.
      </p>
    </div>
  );
}

const kop: React.CSSProperties = { padding: '4px 6px', fontWeight: 600 };
const cel: React.CSSProperties = { padding: '5px 6px' };
