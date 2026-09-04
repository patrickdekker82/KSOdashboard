/**
 * De detailpagina van een kans.
 *
 * De velden zelf komen uit de generieke detailpagina, want ook op een kans mag
 * een beheerder velden toevoegen en verplaatsen. Wat een kans eigen is, hangt
 * daaromheen: de disciplineregels, de knoppen om te winnen of te verliezen, en
 * de fasehistorie.
 */
import { useState, type JSX } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@showroom/shared';
import { endpoints } from '../../lib/api.ts';
import { GeneriekDetail } from '../generiek/GeneriekDetail.tsx';
import { Kaart } from '../Dashboard.tsx';
import { Kansregels } from './Kansregels.tsx';
import { WinDialoog } from './WinDialoog.tsx';
import { VerliesDialoog } from './VerliesDialoog.tsx';
import { dialoogKnop } from './Dialoog.tsx';

type Rij = Record<string, unknown>;

export function KansDetail({
  id,
  onTerug,
  navigeer,
}: {
  id: number;
  onTerug: () => void;
  navigeer: (pad: string) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [dialoog, setDialoog] = useState<'winnen' | 'verliezen' | null>(null);
  const [melding, setMelding] = useState<string | null>(null);

  const record = useQuery({
    queryKey: ['record', 'opportunities', id],
    queryFn: () => endpoints.record<Rij>('opportunities', id),
  });
  const historie = useQuery({
    queryKey: ['kanshistorie', id],
    queryFn: () => endpoints.kansHistorie(id),
  });

  const kans = record.data?.data;
  const status = String(kans?.status ?? 'open');
  const naam = String(kans?.name ?? `Kans ${id}`);
  const projectId = typeof kans?.project_id === 'number' ? kans.project_id : null;

  function klaar(tekst: string): void {
    setDialoog(null);
    setMelding(tekst);
    void queryClient.invalidateQueries({ queryKey: ['kanshistorie', id] });
  }

  return (
    <>
      <GeneriekDetail
        entiteit="opportunities"
        id={id}
        titel="Kansen"
        onTerug={onTerug}
        acties={
          status === 'open' ? (
            <>
              <button
                type="button"
                className="focus-ring"
                onClick={() => setDialoog('verliezen')}
                style={dialoogKnop}
              >
                Verloren…
              </button>
              <button
                type="button"
                className="focus-ring"
                onClick={() => setDialoog('winnen')}
                style={{ ...dialoogKnop, background: 'var(--capaciteit)', color: '#fff', border: 0 }}
              >
                Gewonnen…
              </button>
            </>
          ) : projectId !== null ? (
            <button
              type="button"
              className="focus-ring"
              onClick={() => navigeer(`/projecten/${projectId}`)}
              style={dialoogKnop}
            >
              Naar het project →
            </button>
          ) : null
        }
        extra={
          <>
            {melding && (
              <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--inkt-zacht)' }}>
                {melding}
              </p>
            )}

            <Kansregels kansId={id} bewerkbaar={status === 'open'} />

            <Kaart>
              <h2 style={{ fontSize: 14, margin: '0 0 10px' }}>Fasehistorie</h2>
              {(historie.data?.data ?? []).length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--inkt-zacht)', margin: 0 }}>
                  Deze kans heeft nog geen fasewisselingen.
                </p>
              ) : (
                <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                  {(historie.data?.data ?? []).map((entry) => (
                    <li key={entry.id} style={{ fontSize: 12, display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--inkt-stil)', minWidth: 84 }}>
                        {formatDate(entry.at.slice(0, 10))}
                      </span>
                      <span>
                        {entry.van_fase ?? 'nieuw'} → <strong>{entry.naar_fase ?? '—'}</strong>
                        {entry.days_in_stage !== null && (
                          <span style={{ color: 'var(--inkt-stil)' }}>
                            {' '}
                            · {entry.days_in_stage} dag{entry.days_in_stage === 1 ? '' : 'en'} in de
                            vorige fase
                          </span>
                        )}
                        {entry.door && (
                          <span style={{ color: 'var(--inkt-stil)' }}> · {entry.door}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Kaart>
          </>
        }
      />

      {dialoog === 'winnen' && (
        <WinDialoog
          kansId={id}
          kansnaam={naam}
          onSluit={() => setDialoog(null)}
          onKlaar={klaar}
        />
      )}
      {dialoog === 'verliezen' && (
        <VerliesDialoog
          kansId={id}
          kansnaam={naam}
          onSluit={() => setDialoog(null)}
          onKlaar={klaar}
        />
      )}
    </>
  );
}
