/**
 * De planningimport in vier stappen (hoofdstuk 11).
 *
 *   bestand kiezen → kolommen koppelen → voorbeeld beoordelen → doorvoeren
 *
 * De gebruiker ziet vóór het doorvoeren precies wat er gaat gebeuren: per regel
 * of hij nieuw is, wordt bijgewerkt of wordt overgeslagen, en bij bijwerken ook
 * welke kolommen veranderen. Dat is de hele reden dat de import in twee stappen
 * loopt — een planning die er ineens anders uitziet zonder dat iemand weet
 * waarom, is erger dan geen import.
 */
import { useMemo, useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@showroom/shared';
import {
  ApiFout,
  endpoints,
  importVoorbeeld,
  type ImportRij,
  type ImportVoorbeeld,
  type Koppeling,
  type ImportVeldSleutel,
} from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { invoerStijl, dialoogKnop } from '../kansen/Dialoog.tsx';

const OORDEEL: Record<ImportRij['oordeel'], { label: string; kleur: string }> = {
  nieuw: { label: 'Nieuw', kleur: 'var(--capaciteit)' },
  bijwerken: { label: 'Bijwerken', kleur: 'var(--belasting)' },
  ongewijzigd: { label: 'Ongewijzigd', kleur: 'var(--inkt-stil)' },
  fout: { label: 'Fout', kleur: 'var(--ziekte)' },
};

export function Importwizard({ navigeer }: { navigeer: (pad: string) => void }): JSX.Element {
  const queryClient = useQueryClient();
  const [bestand, setBestand] = useState<File | null>(null);
  const [kopregel, setKopregel] = useState(1);
  const [bestaandeBijwerken, setBestaandeBijwerken] = useState(true);
  const [koppeling, setKoppeling] = useState<Koppeling>({});
  const [voorbeeld, setVoorbeeld] = useState<ImportVoorbeeld | null>(null);
  const [uitkomst, setUitkomst] = useState<ImportVoorbeeld | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const velden = useQuery({ queryKey: ['importvelden'], queryFn: () => endpoints.importVelden() });
  const geschiedenis = useQuery({ queryKey: ['imports'], queryFn: () => endpoints.imports() });

  const inlezen = useMutation({
    mutationFn: (eigenKoppeling?: Koppeling) => {
      if (!bestand) throw new ApiFout(400, 'geen_bestand', 'Kies eerst een bestand.');
      return importVoorbeeld(bestand, {
        kopregel,
        koppeling: eigenKoppeling,
        bestaandeBijwerken,
      });
    },
    onSuccess: (antwoord) => {
      setVoorbeeld(antwoord);
      setKoppeling(antwoord.koppeling);
      setUitkomst(null);
      setFout(null);
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Het bestand kon niet worden ingelezen.'),
  });

  const doorvoeren = useMutation({
    mutationFn: () => {
      if (!voorbeeld) throw new ApiFout(400, 'geen_voorbeeld', 'Lees eerst een bestand in.');
      return endpoints.importDoorvoeren(voorbeeld.batchId, koppeling, bestaandeBijwerken, kopregel);
    },
    onSuccess: (antwoord) => {
      setUitkomst({ ...voorbeeld!, ...antwoord.data });
      setVoorbeeld(null);
      void queryClient.invalidateQueries({ queryKey: ['imports'] });
      void queryClient.invalidateQueries({ queryKey: ['lijst', 'projects'] });
      void queryClient.invalidateQueries({ queryKey: ['weekbezetting'] });
      void queryClient.invalidateQueries({ queryKey: ['kalender'] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'De import kon niet worden doorgevoerd.'),
  });

  const gekoppeldeKolommen = useMemo(() => new Set(Object.values(koppeling)), [koppeling]);

  function wijzigKoppeling(veld: ImportVeldSleutel, kolom: number | null): void {
    const nieuw: Koppeling = { ...koppeling };
    if (kolom === null) delete nieuw[veld];
    else nieuw[veld] = kolom;
    setKoppeling(nieuw);
    inlezen.mutate(nieuw);
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header>
        <h1 style={{ fontSize: 18, margin: 0 }}>Planning importeren</h1>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--inkt-stil)', lineHeight: 1.6 }}>
          Uit een Excel-bestand (.xlsx) of een CSV. Er wordt niets weggeschreven voordat u het
          voorbeeld heeft gezien en op "Doorvoeren" klikt.
        </p>
      </header>

      <Kaart>
        <h2 style={{ fontSize: 14, margin: '0 0 10px' }}>1. Bestand kiezen</h2>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12 }}>
            Bestand
            <input
              type="file"
              className="focus-ring"
              accept=".xlsx,.xlsm,.csv,.txt"
              onChange={(event) => {
                setBestand(event.target.files?.[0] ?? null);
                setVoorbeeld(null);
                setUitkomst(null);
                setFout(null);
              }}
              style={{ ...invoerStijl, display: 'block', marginTop: 3 }}
            />
          </label>

          <label style={{ fontSize: 12 }}>
            Kopregel
            <input
              type="number"
              min={1}
              className="focus-ring"
              value={kopregel}
              onChange={(event) => setKopregel(Math.max(1, Number(event.target.value)))}
              style={{ ...invoerStijl, display: 'block', marginTop: 3, width: 70 }}
            />
          </label>

          <label style={{ fontSize: 12, paddingBottom: 5 }}>
            <input
              type="checkbox"
              checked={bestaandeBijwerken}
              onChange={(event) => setBestaandeBijwerken(event.target.checked)}
            />{' '}
            Bestaande projecten bijwerken
          </label>

          <button
            type="button"
            className="focus-ring"
            disabled={!bestand || inlezen.isPending}
            onClick={() => inlezen.mutate(undefined)}
            style={{
              ...dialoogKnop,
              background: 'var(--belasting)',
              color: '#fff',
              border: 0,
              marginBottom: 3,
            }}
          >
            {inlezen.isPending ? 'Bezig…' : 'Inlezen'}
          </button>
        </div>

        <p style={{ fontSize: 11, color: 'var(--inkt-stil)', margin: '10px 0 0', lineHeight: 1.6 }}>
          De kopregel is de regel met de kolomnamen; alles daarboven wordt genegeerd. Staat
          "Bestaande projecten bijwerken" uit, dan worden alleen nieuwe projecten aangemaakt.
        </p>

        {fout && (
          <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 12, marginTop: 10 }}>
            {fout}
          </p>
        )}
      </Kaart>

      {voorbeeld && (
        <>
          <Kaart>
            <h2 style={{ fontSize: 14, margin: '0 0 4px' }}>2. Kolommen koppelen</h2>
            <p style={{ fontSize: 12, color: 'var(--inkt-stil)', margin: '0 0 12px' }}>
              {voorbeeld.tabblad ? `Tabblad "${voorbeeld.tabblad}". ` : ''}
              De koppeling is een voorstel op basis van de kolomnamen; pas hem gerust aan.
            </p>

            <div
              style={{
                display: 'grid',
                gap: 10,
                gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              }}
            >
              {(velden.data?.data ?? []).map((veld) => {
                const gekozen = koppeling[veld.veld];
                return (
                  <label key={veld.veld} style={{ fontSize: 12 }}>
                    {veld.label}
                    {veld.verplicht && <span style={{ color: 'var(--ziekte)' }}> *</span>}
                    <select
                      className="focus-ring"
                      value={gekozen === undefined ? '' : gekozen}
                      onChange={(event) =>
                        wijzigKoppeling(
                          veld.veld,
                          event.target.value === '' ? null : Number(event.target.value),
                        )
                      }
                      style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
                    >
                      <option value="">— niet importeren —</option>
                      {voorbeeld.koppen.map((kop, index) => (
                        <option
                          key={index}
                          value={index}
                          // Een kolom die al ergens anders aan hangt, blijft
                          // kiesbaar maar wordt gemarkeerd.
                        >
                          {kolomLabel(index, kop)}
                          {gekoppeldeKolommen.has(index) && gekozen !== index ? ' (al gebruikt)' : ''}
                        </option>
                      ))}
                    </select>
                    {veld.uitleg && (
                      <span style={{ display: 'block', fontSize: 10, color: 'var(--inkt-stil)', marginTop: 2 }}>
                        {veld.uitleg}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </Kaart>

          <Kaart>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 14, margin: 0 }}>3. Voorbeeld</h2>
              <Telling voorbeeld={voorbeeld} />
              <button
                type="button"
                className="focus-ring"
                disabled={doorvoeren.isPending || voorbeeld.nieuw + voorbeeld.bijwerken === 0}
                onClick={() => doorvoeren.mutate()}
                style={{
                  ...dialoogKnop,
                  marginLeft: 'auto',
                  background: 'var(--capaciteit)',
                  color: '#fff',
                  border: 0,
                }}
              >
                {doorvoeren.isPending ? 'Bezig…' : 'Doorvoeren'}
              </button>
            </div>

            {voorbeeld.nieuw + voorbeeld.bijwerken === 0 && (
              <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '10px 0 0' }}>
                Er valt niets door te voeren: geen enkele regel levert een nieuw of gewijzigd
                project op.
              </p>
            )}

            <Rijen rijen={voorbeeld.rijen} />
          </Kaart>
        </>
      )}

      {uitkomst && (
        <Kaart accent="var(--capaciteit)">
          <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>Doorgevoerd</h2>
          <Telling voorbeeld={uitkomst} />
          <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '10px 0 0' }}>
            De bezetting is meteen bijgewerkt.{' '}
            <button
              type="button"
              className="focus-ring"
              onClick={() => navigeer('/planning')}
              style={{
                background: 'none',
                border: 0,
                padding: 0,
                font: 'inherit',
                color: 'var(--belasting)',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Naar de planning
            </button>
          </p>
          <Rijen rijen={uitkomst.rijen} />
        </Kaart>
      )}

      <Kaart>
        <h2 style={{ fontSize: 14, margin: '0 0 10px' }}>Eerdere imports</h2>
        {geschiedenis.isLoading && <Skelet hoogte={80} />}
        {geschiedenis.data?.data.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--inkt-zacht)', margin: 0 }}>
            Er is nog niets geïmporteerd.
          </p>
        )}
        {(geschiedenis.data?.data.length ?? 0) > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--rand)' }}>
                  <th scope="col" style={kop}>Bestand</th>
                  <th scope="col" style={kop}>Wanneer</th>
                  <th scope="col" style={kop}>Door</th>
                  <th scope="col" style={kop}>Status</th>
                  <th scope="col" style={{ ...kop, textAlign: 'right' }}>Nieuw</th>
                  <th scope="col" style={{ ...kop, textAlign: 'right' }}>Bijgewerkt</th>
                  <th scope="col" style={{ ...kop, textAlign: 'right' }}>Fout</th>
                </tr>
              </thead>
              <tbody>
                {(geschiedenis.data?.data ?? []).map((batch) => (
                  <tr key={batch.id} style={{ borderBottom: '1px solid var(--rand)' }}>
                    <th scope="row" style={{ ...cel, textAlign: 'left', fontWeight: 500 }}>
                      {batch.bestandsnaam}
                      {batch.tabblad && (
                        <span style={{ color: 'var(--inkt-stil)', fontWeight: 400 }}>
                          {' '}
                          · {batch.tabblad}
                        </span>
                      )}
                    </th>
                    <td style={cel}>{formatDate(batch.created_at.slice(0, 10))}</td>
                    <td style={cel}>{batch.door ?? '—'}</td>
                    <td style={cel}>
                      {batch.status === 'doorgevoerd' ? 'Doorgevoerd' : 'Alleen bekeken'}
                    </td>
                    <td style={{ ...cel, textAlign: 'right' }}>{batch.rijen_nieuw}</td>
                    <td style={{ ...cel, textAlign: 'right' }}>{batch.rijen_bijgewerkt}</td>
                    <td
                      style={{
                        ...cel,
                        textAlign: 'right',
                        color: batch.rijen_fout > 0 ? 'var(--ziekte)' : undefined,
                      }}
                    >
                      {batch.rijen_fout}
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

function Telling({ voorbeeld }: { voorbeeld: { nieuw: number; bijwerken: number; ongewijzigd: number; fout: number; totaal: number } }): JSX.Element {
  return (
    <span style={{ fontSize: 12, color: 'var(--inkt-zacht)' }}>
      {voorbeeld.totaal} regel{voorbeeld.totaal === 1 ? '' : 's'} ·{' '}
      <strong style={{ color: 'var(--capaciteit)' }}>{voorbeeld.nieuw} nieuw</strong> ·{' '}
      <strong style={{ color: 'var(--belasting)' }}>{voorbeeld.bijwerken} bijwerken</strong> ·{' '}
      {voorbeeld.ongewijzigd} ongewijzigd ·{' '}
      <strong style={{ color: voorbeeld.fout > 0 ? 'var(--ziekte)' : 'inherit' }}>
        {voorbeeld.fout} fout
      </strong>
    </span>
  );
}

function Rijen({ rijen }: { rijen: ImportRij[] }): JSX.Element {
  if (rijen.length === 0) {
    return (
      <p style={{ fontSize: 13, color: 'var(--inkt-zacht)', margin: '10px 0 0' }}>
        In dit bestand staat geen enkele regel met gegevens.
      </p>
    );
  }

  return (
    <div style={{ overflowX: 'auto', marginTop: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--rand)' }}>
            <th scope="col" style={kop}>Regel</th>
            <th scope="col" style={kop}>Wat er gebeurt</th>
            <th scope="col" style={kop}>Project</th>
            <th scope="col" style={{ ...kop, textAlign: 'right' }}>Woningen</th>
            <th scope="col" style={kop}>Showroomperiode</th>
            <th scope="col" style={kop}>Meldingen</th>
          </tr>
        </thead>
        <tbody>
          {rijen.map((rij) => {
            const oordeel = OORDEEL[rij.oordeel];
            return (
              <tr key={rij.bronregel} style={{ borderBottom: '1px solid var(--rand)' }}>
                <th scope="row" style={{ ...cel, textAlign: 'left', fontWeight: 500 }}>
                  {rij.bronregel}
                </th>
                <td style={{ ...cel, color: oordeel.kleur, fontWeight: 600 }}>{oordeel.label}</td>
                <td style={cel}>
                  {String(rij.waarden.naam ?? '—')}
                  {rij.waarden.nummer && (
                    <span style={{ color: 'var(--inkt-stil)' }}> ({String(rij.waarden.nummer)})</span>
                  )}
                  {rij.wijzigingen.length > 0 && (
                    <ul style={{ margin: '3px 0 0', paddingLeft: 14, color: 'var(--inkt-stil)' }}>
                      {rij.wijzigingen.map((wijziging) => (
                        <li key={wijziging.kolom}>
                          {wijziging.kolom}: {String(wijziging.van ?? '—')} →{' '}
                          <strong>{String(wijziging.naar)}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td style={{ ...cel, textAlign: 'right' }}>{String(rij.waarden.aantal ?? '—')}</td>
                <td style={cel}>
                  {rij.waarden.showroom_start
                    ? `${formatDate(String(rij.waarden.showroom_start))} t/m ${
                        rij.waarden.showroom_eind
                          ? formatDate(String(rij.waarden.showroom_eind))
                          : '?'
                      }`
                    : '—'}
                </td>
                <td style={cel}>
                  {rij.meldingen.length === 0 ? (
                    <span style={{ color: 'var(--inkt-stil)' }}>—</span>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 14 }}>
                      {rij.meldingen.map((melding, index) => (
                        <li
                          key={index}
                          style={{
                            color: melding.ernst === 'fout' ? 'var(--ziekte)' : 'var(--inkt-zacht)',
                          }}
                        >
                          {melding.tekst}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** "A — Projectnummer", zodat een kolom ook zonder kop herkenbaar blijft. */
function kolomLabel(index: number, kop: string | number | boolean | null): string {
  let letters = '';
  let rest = index;
  do {
    letters = String.fromCharCode(65 + (rest % 26)) + letters;
    rest = Math.floor(rest / 26) - 1;
  } while (rest >= 0);

  const tekst = kop === null || kop === undefined || String(kop).trim() === '' ? '(leeg)' : String(kop);
  return `${letters} — ${tekst}`;
}

const kop: React.CSSProperties = { padding: '4px 6px', fontWeight: 600 };
const cel: React.CSSProperties = { padding: '5px 6px', verticalAlign: 'top' };
