/**
 * Een kans winnen (hoofdstuk 6.2).
 *
 * Winnen gaat per discipline: het bedrag dat daadwerkelijk is gescoord kan
 * afwijken van wat er in de offerte stond, en een kans kan op tegelwerk wél
 * doorgaan en op keukens niet. Regels die hier op nul blijven staan, boekt de
 * kern als verloren weg — anders klopt de omzet per discipline later niet.
 */
import { useEffect, useMemo, useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@showroom/shared';
import { ApiFout, endpoints, type Kansregel } from '../../lib/api.ts';
import { Dialoog, dialoogKnop, invoerStijl } from './Dialoog.tsx';
import { centenUit, naarCenten } from './bedrag.ts';

export function WinDialoog({
  kansId,
  kansnaam,
  onSluit,
  onKlaar,
}: {
  kansId: number;
  kansnaam: string;
  onSluit: () => void;
  onKlaar: (melding: string) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [bedragen, setBedragen] = useState<Record<number, string>>({});
  const [maakProject, setMaakProject] = useState(true);
  const [fout, setFout] = useState<string | null>(null);

  const regels = useQuery({
    queryKey: ['kansregels', kansId],
    queryFn: () =>
      endpoints.lijst<Kansregel>(
        'opportunity-lines',
        `?filter=${btoa(JSON.stringify({ field: 'opportunity_id', operator: 'eq', value: kansId }))}&pageSize=200`,
      ),
  });
  const disciplines = useQuery({
    queryKey: ['disciplines'],
    queryFn: () => endpoints.lijst<{ id: number; name: string }>('disciplines', '?pageSize=200'),
  });

  const naamPerDiscipline = useMemo(() => {
    const kaart = new Map<number, string>();
    for (const rij of disciplines.data?.data ?? []) kaart.set(rij.id, rij.name);
    return kaart;
  }, [disciplines.data]);

  // Het offertebedrag is het vertrekpunt; wie er iets anders scoorde, past aan.
  useEffect(() => {
    const rijen = regels.data?.data;
    if (!rijen) return;
    setBedragen(
      Object.fromEntries(rijen.map((regel) => [regel.id, centenUit(regel.amount_cents)])),
    );
  }, [regels.data]);

  const totaal = Object.values(bedragen).reduce((som, tekst) => som + (naarCenten(tekst) ?? 0), 0);

  const winnen = useMutation({
    mutationFn: () => {
      const invoer = (regels.data?.data ?? []).map((regel) => ({
        lineId: regel.id,
        wonAmountCents: naarCenten(bedragen[regel.id] ?? '') ?? 0,
      }));
      // Regels op nul laten we weg: de kern markeert wat niet meekomt als
      // verloren, en dat is precies wat "niet gescoord" betekent.
      return endpoints.kansWinnen(
        kansId,
        invoer.filter((regel) => regel.wonAmountCents > 0),
        maakProject,
      );
    },
    onSuccess: (antwoord) => {
      void queryClient.invalidateQueries({ queryKey: ['kansenbord'] });
      void queryClient.invalidateQueries({ queryKey: ['record', 'opportunities', kansId] });
      void queryClient.invalidateQueries({ queryKey: ['lijst', 'opportunities'] });
      void queryClient.invalidateQueries({ queryKey: ['lijst', 'projects'] });
      onKlaar(
        antwoord.data.projectId === null
          ? `Gewonnen voor ${formatCurrency(antwoord.data.wonAmountCents)}.`
          : `Gewonnen voor ${formatCurrency(antwoord.data.wonAmountCents)}. Showroomproject #${antwoord.data.projectId} aangemaakt.`,
      );
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'De kans kon niet worden gewonnen.'),
  });

  const rijen = regels.data?.data ?? [];

  return (
    <Dialoog titel={`Kans winnen — ${kansnaam}`} onSluit={onSluit}>
      {regels.isLoading && <p style={{ fontSize: 13, color: 'var(--inkt-zacht)' }}>Bezig…</p>}

      {!regels.isLoading && rijen.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--inkt-zacht)' }}>
          Deze kans heeft nog geen disciplineregels. Voeg er eerst een toe, anders is er niets om
          per discipline te scoren.
        </p>
      )}

      {rijen.length > 0 && (
        <>
          <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '0 0 8px', lineHeight: 1.6 }}>
            Vul per discipline in wat er daadwerkelijk is gescoord. Wat u op nul laat staan, wordt
            als verloren geboekt.
          </p>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--rand)' }}>
                <th scope="col" style={{ padding: '4px 6px' }}>Discipline</th>
                <th scope="col" style={{ padding: '4px 6px', textAlign: 'right' }}>Offerte</th>
                <th scope="col" style={{ padding: '4px 6px', textAlign: 'right' }}>Gescoord (€)</th>
              </tr>
            </thead>
            <tbody>
              {rijen.map((regel) => (
                <tr key={regel.id} style={{ borderBottom: '1px solid var(--rand)' }}>
                  <th scope="row" style={{ textAlign: 'left', padding: '5px 6px', fontWeight: 500 }}>
                    {naamPerDiscipline.get(regel.discipline_id) ?? `Discipline ${regel.discipline_id}`}
                    {regel.description && (
                      <span style={{ color: 'var(--inkt-stil)', fontWeight: 400 }}>
                        {' '}
                        — {regel.description}
                      </span>
                    )}
                  </th>
                  <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--inkt-stil)' }}>
                    {formatCurrency(regel.amount_cents)}
                  </td>
                  <td style={{ padding: '5px 6px', textAlign: 'right' }}>
                    <input
                      className="focus-ring"
                      inputMode="decimal"
                      aria-label={`Gescoord bedrag voor ${naamPerDiscipline.get(regel.discipline_id) ?? 'deze regel'}`}
                      value={bedragen[regel.id] ?? ''}
                      onChange={(event) =>
                        setBedragen((huidig) => ({ ...huidig, [regel.id]: event.target.value }))
                      }
                      style={{ ...invoerStijl, width: 110, textAlign: 'right' }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2} style={{ textAlign: 'right', padding: '6px' }}>
                  Totaal gescoord
                </th>
                <td style={{ padding: '6px', textAlign: 'right', fontWeight: 600 }}>
                  {formatCurrency(totaal)}
                </td>
              </tr>
            </tfoot>
          </table>

          <label style={{ display: 'block', marginTop: 12, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={maakProject}
              onChange={(event) => setMaakProject(event.target.checked)}
            />{' '}
            Meteen een showroomproject aanmaken
          </label>
          <p style={{ fontSize: 11, color: 'var(--inkt-stil)', margin: '4px 0 0', lineHeight: 1.6 }}>
            Het project krijgt de klant, het aantal woningen en de verwachte showroomperiode van
            deze kans. Zonder verwachte periode blijft de fasering leeg en plant u die later zelf.
          </p>
        </>
      )}

      {fout && (
        <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 12, marginTop: 12 }}>
          {fout}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" className="focus-ring" onClick={onSluit} style={dialoogKnop}>
          Annuleren
        </button>
        <button
          type="button"
          className="focus-ring"
          disabled={winnen.isPending || rijen.length === 0}
          onClick={() => winnen.mutate()}
          style={{ ...dialoogKnop, background: 'var(--capaciteit)', color: '#fff', border: 0 }}
        >
          {winnen.isPending ? 'Bezig…' : 'Winnen'}
        </button>
      </div>
    </Dialoog>
  );
}
