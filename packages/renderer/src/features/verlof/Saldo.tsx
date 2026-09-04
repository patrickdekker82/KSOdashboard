/**
 * Verlofsaldo per medewerker (hoofdstuk 6.4.4).
 *
 * Alles staat in uren, want dat is de enige eenheid waarin een parttimer en een
 * voltijder in dezelfde tabel kunnen staan. Naast de uren staat de omrekening
 * naar dagen op basis van een achturige dag, want zo praten mensen erover.
 *
 * "Resterend" is wat er nog staat; "vrij te besteden" is wat er overblijft als
 * alle openstaande aanvragen worden goedgekeurd. Dat verschil is precies waar
 * een verkeerde toezegging vandaan komt.
 */
import { useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDecimal } from '@showroom/shared';
import { ApiFout, endpoints, type Gebruiker, type Verlofsaldo } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { invoerStijl, dialoogKnop } from '../kansen/Dialoog.tsx';
import { naarGetal, getalUit } from '../kansen/bedrag.ts';

/** Een werkdag van acht uur, alleen om uren leesbaar te maken. */
const UUR_PER_DAG = 8;

export function Saldo({ ik }: { ik: Gebruiker }): JSX.Element {
  const queryClient = useQueryClient();
  const [jaar, setJaar] = useState(new Date().getFullYear());
  const [bewerkt, setBewerkt] = useState<number | null>(null);
  const [recht, setRecht] = useState('');
  const [overgeheveld, setOvergeheveld] = useState('');
  const [fout, setFout] = useState<string | null>(null);

  const magBeheren = ik.role === 'manager' || ik.role === 'admin';

  const saldi = useQuery({
    queryKey: ['verlofsaldi', jaar],
    queryFn: () => endpoints.verlofsaldi(jaar),
  });

  // Het recht staat in leave_balances, dat geen soft delete kent: er is per
  // medewerker per jaar hooguit één rij, dus eerst kijken of hij er al is.
  const bestaandeRij = useQuery({
    queryKey: ['leave-balance-rijen', jaar],
    queryFn: () =>
      endpoints.lijst<{ id: number; user_id: number; year: number }>(
        'leave-balances',
        `?filter=${btoa(JSON.stringify({ field: 'year', operator: 'eq', value: jaar }))}&pageSize=200`,
      ),
    enabled: magBeheren,
  });

  const opslaan = useMutation({
    mutationFn: (userId: number) => {
      const rechtUren = naarGetal(recht);
      const overUren = naarGetal(overgeheveld);
      if (rechtUren === null || rechtUren < 0) {
        throw new ApiFout(400, 'ongeldig', 'Het recht moet een aantal uren zijn.');
      }
      if (overUren === null) {
        throw new ApiFout(400, 'ongeldig', 'De overheveling moet een aantal uren zijn.');
      }

      const bestaand = (bestaandeRij.data?.data ?? []).find((rij) => rij.user_id === userId);
      return endpoints.bewaar('leave-balances', bestaand?.id ?? null, {
        user_id: userId,
        year: jaar,
        entitlement_hours: rechtUren,
        carried_over_hours: overUren,
      });
    },
    onSuccess: () => {
      setBewerkt(null);
      setFout(null);
      void queryClient.invalidateQueries({ queryKey: ['verlofsaldi'] });
      void queryClient.invalidateQueries({ queryKey: ['leave-balance-rijen'] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Het recht kon niet worden opgeslagen.'),
  });

  function begin(saldo: Verlofsaldo): void {
    setBewerkt(saldo.userId);
    setRecht(getalUit(saldo.rechtUren));
    setOvergeheveld(getalUit(saldo.overgeheveldUren));
    setFout(null);
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Kaart>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Verlofsaldo</h2>
          <label style={{ fontSize: 12, color: 'var(--inkt-zacht)' }}>
            Jaar{' '}
            <select
              className="focus-ring"
              value={jaar}
              onChange={(event) => setJaar(Number(event.target.value))}
              style={invoerStijl}
            >
              {[jaar - 1, jaar, jaar + 1]
                .filter((waarde, index, alle) => alle.indexOf(waarde) === index)
                .map((waarde) => (
                  <option key={waarde} value={waarde}>
                    {waarde}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <p style={{ fontSize: 11, color: 'var(--inkt-stil)', margin: '8px 0 0', lineHeight: 1.6 }}>
          Alles in uren. "Resterend" is wat er nog staat; "vrij te besteden" is wat er overblijft
          als alle openstaande aanvragen worden goedgekeurd. Ziekte gaat niet van het verlof af.
        </p>

        {fout && (
          <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 12, marginTop: 8 }}>
            {fout}
          </p>
        )}
      </Kaart>

      <Kaart>
        {saldi.isLoading && <Skelet hoogte={160} />}

        {saldi.data && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--rand)' }}>
                  <th scope="col" style={kop}>Medewerker</th>
                  <th scope="col" style={{ ...kop, textAlign: 'right' }}>Recht</th>
                  <th scope="col" style={{ ...kop, textAlign: 'right' }}>Overgeheveld</th>
                  <th scope="col" style={{ ...kop, textAlign: 'right' }}>Opgenomen</th>
                  <th scope="col" style={{ ...kop, textAlign: 'right' }}>Aangevraagd</th>
                  <th scope="col" style={{ ...kop, textAlign: 'right' }}>Resterend</th>
                  <th scope="col" style={{ ...kop, textAlign: 'right' }}>Vrij te besteden</th>
                  {magBeheren && (
                    <th scope="col" style={kop}>
                      <span className="alleen-voorlezen">Acties</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {saldi.data.data.map((saldo) => (
                  <tr key={saldo.userId} style={{ borderBottom: '1px solid var(--rand)' }}>
                    <th scope="row" style={{ ...cel, textAlign: 'left', fontWeight: 500 }}>
                      {saldo.name}{' '}
                      <span style={{ color: 'var(--inkt-stil)', fontWeight: 400 }}>
                        ({saldo.initials})
                      </span>
                      {!saldo.rechtVastgelegd && (
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--inkt-stil)', fontWeight: 400 }}>
                          Geen recht vastgelegd voor {saldo.jaar}
                        </span>
                      )}
                    </th>

                    {bewerkt === saldo.userId ? (
                      <>
                        <td style={{ ...cel, textAlign: 'right' }}>
                          <input
                            className="focus-ring"
                            aria-label={`Recht in uren voor ${saldo.name}`}
                            inputMode="decimal"
                            value={recht}
                            onChange={(event) => setRecht(event.target.value)}
                            style={{ ...invoerStijl, width: 70, textAlign: 'right' }}
                          />
                        </td>
                        <td style={{ ...cel, textAlign: 'right' }}>
                          <input
                            className="focus-ring"
                            aria-label={`Overgeheveld in uren voor ${saldo.name}`}
                            inputMode="decimal"
                            value={overgeheveld}
                            onChange={(event) => setOvergeheveld(event.target.value)}
                            style={{ ...invoerStijl, width: 70, textAlign: 'right' }}
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ ...cel, textAlign: 'right' }}>
                          <Uren waarde={saldo.rechtUren} />
                        </td>
                        <td style={{ ...cel, textAlign: 'right' }}>
                          <Uren waarde={saldo.overgeheveldUren} />
                        </td>
                      </>
                    )}

                    <td style={{ ...cel, textAlign: 'right' }}>
                      <Uren waarde={saldo.opgenomenUren} />
                    </td>
                    <td style={{ ...cel, textAlign: 'right', color: 'var(--inkt-stil)' }}>
                      <Uren waarde={saldo.aangevraagdUren} />
                    </td>
                    <td
                      style={{
                        ...cel,
                        textAlign: 'right',
                        fontWeight: 600,
                        color: saldo.resterendUren < 0 ? 'var(--ziekte)' : undefined,
                      }}
                    >
                      <Uren waarde={saldo.resterendUren} />
                    </td>
                    <td
                      style={{
                        ...cel,
                        textAlign: 'right',
                        color: saldo.vrijTeBestedenUren < 0 ? 'var(--ziekte)' : undefined,
                      }}
                    >
                      <Uren waarde={saldo.vrijTeBestedenUren} />
                    </td>

                    {magBeheren && (
                      <td style={{ ...cel, whiteSpace: 'nowrap' }}>
                        {bewerkt === saldo.userId ? (
                          <>
                            <button
                              type="button"
                              className="focus-ring"
                              disabled={opslaan.isPending}
                              onClick={() => opslaan.mutate(saldo.userId)}
                              style={{ ...dialoogKnop, background: 'var(--belasting)', color: '#fff', border: 0 }}
                            >
                              Opslaan
                            </button>{' '}
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
                          <button
                            type="button"
                            className="focus-ring"
                            onClick={() => begin(saldo)}
                            style={dialoogKnop}
                          >
                            Recht instellen
                          </button>
                        )}
                      </td>
                    )}
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

/** Uren, met de omrekening naar dagen erachter want zo praten mensen erover. */
function Uren({ waarde }: { waarde: number }): JSX.Element {
  return (
    <>
      {formatDecimal(waarde)} uur
      <span style={{ display: 'block', fontSize: 10, color: 'var(--inkt-stil)' }}>
        {formatDecimal(Math.round((waarde / UUR_PER_DAG) * 4) / 4)} dag
      </span>
    </>
  );
}

const kop: React.CSSProperties = { padding: '4px 6px', fontWeight: 600 };
const cel: React.CSSProperties = { padding: '5px 6px', verticalAlign: 'top' };
