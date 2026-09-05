/**
 * Beheer van de signaleringsregels (hoofdstuk 8.2).
 *
 * Een regel aan- of uitzetten, de ernst kiezen en de parameters aanpassen. Bij
 * elke regel staat wanneer hij voor het laatst is gedraaid en hoeveel er open
 * staat — en of hij al gebouwd is. Dat laatste is er bewust: een regel die in
 * de lijst staat maar nog niets doet, hoort dat te zeggen in plaats van
 * stilletjes nooit af te gaan.
 */
import { useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@showroom/shared';
import { ApiFout, endpoints, type Ernst } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { invoerStijl, dialoogKnop } from '../kansen/Dialoog.tsx';

const ERNST_LABEL: Record<Ernst, string> = {
  urgent: 'Urgent',
  let_op: 'Let op',
  info: 'Ter info',
};

export function Regels({ onTerug }: { onTerug: () => void }): JSX.Element {
  const queryClient = useQueryClient();
  const [bewerkt, setBewerkt] = useState<number | null>(null);
  const [parameters, setParameters] = useState('');
  const [melding, setMelding] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const regels = useQuery({ queryKey: ['meldingregels'], queryFn: () => endpoints.meldingRegels() });

  function ververs(): void {
    void queryClient.invalidateQueries({ queryKey: ['meldingregels'] });
    void queryClient.invalidateQueries({ queryKey: ['meldingen'] });
  }

  const wijzigen = useMutation({
    mutationFn: ({ id, velden }: { id: number; velden: Record<string, unknown> }) =>
      endpoints.bewaar('alert-rules', id, velden),
    onSuccess: () => {
      setFout(null);
      ververs();
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'De regel kon niet worden opgeslagen.'),
  });

  const opslaanParameters = useMutation({
    mutationFn: (id: number) => {
      let ontleed: unknown;
      try {
        ontleed = JSON.parse(parameters);
      } catch {
        throw new ApiFout(400, 'ongeldig', 'De parameters moeten geldige JSON zijn.');
      }
      if (ontleed === null || typeof ontleed !== 'object' || Array.isArray(ontleed)) {
        throw new ApiFout(400, 'ongeldig', 'De parameters moeten een object zijn, zoals {"days": 7}.');
      }
      return endpoints.bewaar('alert-rules', id, { params: JSON.stringify(ontleed) });
    },
    onSuccess: () => {
      setBewerkt(null);
      setFout(null);
      ververs();
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'De parameters konden niet worden opgeslagen.'),
  });

  const doorrekenen = useMutation({
    mutationFn: (regelId: number) => endpoints.meldingenDoorrekenen(regelId),
    onSuccess: (antwoord) => {
      const regel = antwoord.data.regels[0];
      setMelding(
        regel?.fout
          ? `Deze regel viel om: ${regel.fout}`
          : `Doorgerekend: ${antwoord.data.nieuw} nieuw, ${antwoord.data.opgelost} opgelost.`,
      );
      ververs();
    },
    onError: (error: unknown) =>
      setMelding(error instanceof ApiFout ? error.message : 'Doorrekenen lukte niet.'),
  });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" className="focus-ring" onClick={onTerug} style={dialoogKnop}>
          ← Instellingen
        </button>
        <h1 style={{ fontSize: 18, margin: 0 }}>Signaleringsregels</h1>
      </header>

      <p style={{ margin: 0, fontSize: 12, color: 'var(--inkt-stil)', lineHeight: 1.6 }}>
        De controle draait elk uur. Een regel die uit staat, levert geen nieuwe meldingen op; de
        meldingen die er al waren blijven staan tot ze zijn opgelost.
      </p>

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

      {regels.isLoading && (
        <Kaart>
          <Skelet hoogte={240} />
        </Kaart>
      )}

      {(regels.data?.data ?? []).map((regel) => (
        <Kaart key={regel.id} accent={regel.gebouwd ? undefined : 'var(--inkt-stil)'}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14 }}>{regel.name}</strong>
            <code style={{ fontSize: 11, color: 'var(--inkt-stil)' }}>{regel.type}</code>

            {!regel.gebouwd && (
              <span style={{ fontSize: 11, color: 'var(--inkt-stil)' }}>
                — nog niet gebouwd, deze regel gaat nooit af
              </span>
            )}

            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--inkt-stil)' }}>
              {regel.openstaand > 0 ? `${regel.openstaand} openstaand` : 'niets openstaand'}
              {regel.last_checked_at
                ? ` · laatst gedraaid ${formatDate(regel.last_checked_at.slice(0, 10))}`
                : ' · nog niet gedraaid'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12 }}>
              <input
                type="checkbox"
                checked={regel.active === 1}
                disabled={!regel.gebouwd}
                onChange={(event) =>
                  wijzigen.mutate({ id: regel.id, velden: { active: event.target.checked ? 1 : 0 } })
                }
              />{' '}
              Actief
            </label>

            <label style={{ fontSize: 12 }}>
              Ernst{' '}
              <select
                className="focus-ring"
                value={regel.severity}
                onChange={(event) =>
                  wijzigen.mutate({ id: regel.id, velden: { severity: event.target.value } })
                }
                style={invoerStijl}
              >
                {(Object.keys(ERNST_LABEL) as Ernst[]).map((ernst) => (
                  <option key={ernst} value={ernst}>
                    {ERNST_LABEL[ernst]}
                  </option>
                ))}
              </select>
            </label>

            {bewerkt === regel.id ? (
              <>
                <input
                  className="focus-ring"
                  aria-label={`Parameters van ${regel.name}`}
                  value={parameters}
                  onChange={(event) => setParameters(event.target.value)}
                  style={{ ...invoerStijl, flex: 1, minWidth: 220, fontFamily: 'monospace' }}
                />
                <button
                  type="button"
                  className="focus-ring"
                  onClick={() => opslaanParameters.mutate(regel.id)}
                  style={{ ...dialoogKnop, background: 'var(--belasting)', color: '#fff', border: 0 }}
                >
                  Opslaan
                </button>
                <button
                  type="button"
                  className="focus-ring"
                  onClick={() => setBewerkt(null)}
                  style={dialoogKnop}
                >
                  Annuleren
                </button>
              </>
            ) : (
              <>
                <code style={{ fontSize: 11, color: 'var(--inkt-zacht)', flex: 1, minWidth: 160 }}>
                  {regel.params}
                </code>
                <button
                  type="button"
                  className="focus-ring"
                  onClick={() => {
                    setBewerkt(regel.id);
                    setParameters(regel.params);
                    setFout(null);
                  }}
                  style={dialoogKnop}
                >
                  Parameters
                </button>
                <button
                  type="button"
                  className="focus-ring"
                  disabled={!regel.gebouwd || doorrekenen.isPending}
                  onClick={() => doorrekenen.mutate(regel.id)}
                  style={dialoogKnop}
                >
                  Nu draaien
                </button>
              </>
            )}
          </div>
        </Kaart>
      ))}
    </div>
  );
}
