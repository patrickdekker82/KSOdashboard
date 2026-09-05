/**
 * Instellingen › Back-up & herstel (hoofdstuk 12).
 *
 * Het scherm dat je hoopt nooit nodig te hebben en waar dan alles van afhangt.
 * Daarom staat er meer uitleg dan elders, staat het herstelknopje niet naast
 * het maakknopje, en is de laatste geslaagde back-up het eerste wat je ziet.
 */
import { useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@showroom/shared';
import { ApiFout, endpoints, type Backupbestand } from '../../lib/api.ts';
import { Kaart } from '../Dashboard.tsx';
import { dialoogKnop, invoerStijl } from '../kansen/Dialoog.tsx';

/** `1536000` → `1,5 MB`. */
function grootte(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} MB`;
}

/** `2026-09-07T14:30:00.000Z` → `07-09-2026 14:30`. */
function moment(iso: string | null): string {
  if (iso === null || iso === '') return '—';
  const genormaliseerd = iso.includes('T') ? iso : iso.replace(' ', 'T');
  const datum = new Date(genormaliseerd.endsWith('Z') ? genormaliseerd : `${genormaliseerd}Z`);
  if (Number.isNaN(datum.getTime())) return iso;
  const uur = String(datum.getUTCHours()).padStart(2, '0');
  const minuut = String(datum.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(datum)} ${uur}:${minuut}`;
}

const SOORTEN: Record<string, string> = {
  handmatig: 'handmatig',
  automatisch: 'nachtelijk',
  voor_migratie: 'voor een migratie',
  voor_herstel: 'voor een herstel',
  onbekend: 'onbekend',
};

export function Backup({ onTerug }: { onTerug: () => void }): JSX.Element {
  const queryClient = useQueryClient();
  const [melding, setMelding] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [tebevestigen, setTeBevestigen] = useState<string | null>(null);
  const [doelmap, setDoelmap] = useState<string | null>(null);
  const [tijd, setTijd] = useState<string | null>(null);

  const overzicht = useQuery({ queryKey: ['backups'], queryFn: () => endpoints.backups() });
  const locatie = useQuery({ queryKey: ['backup-locatie'], queryFn: () => endpoints.backupLocatie() });

  const maken = useMutation({
    mutationFn: (naarDoelmap: boolean) => endpoints.backupMaken(naarDoelmap),
    onSuccess: (antwoord) => {
      setFout(null);
      setMelding(
        `${antwoord.data.bestandsnaam} gemaakt (${grootte(antwoord.data.bytes)}` +
          `${antwoord.data.opgeruimd > 0 ? `, ${antwoord.data.opgeruimd} oude opgeruimd` : ''}).`,
      );
      void queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'De back-up is niet gelukt.'),
  });

  const controleren = useMutation({
    mutationFn: (naam: string) => endpoints.backupControleren(naam),
    onSuccess: (antwoord) => {
      setFout(null);
      setMelding(`${antwoord.data.bestandsnaam} is gecontroleerd en bruikbaar.`);
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'De controle is niet gelukt.'),
  });

  const bewaren = useMutation({
    mutationFn: (wijziging: Record<string, unknown>) =>
      endpoints.instellingenOpslaan({ backup: { ...huidigeInstelling(), ...wijziging } }),
    onSuccess: () => {
      setFout(null);
      setMelding('De back-upinstellingen zijn opgeslagen.');
      setDoelmap(null);
      setTijd(null);
      void queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Opslaan lukte niet.'),
  });

  const gegevens = overzicht.data?.data;

  function huidigeInstelling(): Record<string, unknown> {
    return {
      automatisch: true,
      tijd: gegevens?.instellingen.tijd ?? '23:00',
      bewaar_dagelijks: gegevens?.instellingen.bewaarDagelijks ?? 30,
      bewaar_maandelijks: gegevens?.instellingen.bewaarMaandelijks ?? 12,
      doelmap: gegevens?.instellingen.doelmap ?? '',
    };
  }

  async function herstel(bestandsnaam: string): Promise<void> {
    if (!window.showroom) {
      setFout('Terugzetten werkt alleen in de desktop-applicatie.');
      return;
    }
    setTeBevestigen(null);
    try {
      const uitkomst = await window.showroom.backupHerstellen(bestandsnaam);
      if (uitkomst.hersteld) {
        setMelding('De back-up is teruggezet. De applicatie start opnieuw.');
      } else {
        setMelding('Terugzetten afgebroken.');
      }
    } catch (error) {
      setFout(error instanceof Error ? error.message : 'Terugzetten is niet gelukt.');
    }
  }

  const oordeel = locatie.data?.data.oordeel;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>Back-up &amp; herstel</h1>
        <button type="button" className="focus-ring" onClick={onTerug} style={dialoogKnop}>
          Terug naar instellingen
        </button>
      </div>

      {oordeel !== undefined && oordeel.ok === false && (
        <Kaart accent="var(--ziekte)">
          <h2 style={{ fontSize: 14, margin: '0 0 6px', color: 'var(--ziekte)' }}>
            De database staat op een riskante plek
          </h2>
          <p style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>{oordeel.message}</p>
        </Kaart>
      )}

      <Kaart accent={gegevens?.stand.laatsteMislukt === true ? 'var(--ziekte)' : 'var(--belasting)'}>
        <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>De stand</h2>
        <p style={{ fontSize: 12, margin: '0 0 4px' }}>
          Laatste geslaagde back-up: <strong>{moment(gegevens?.stand.laatsteGelukt ?? null)}</strong>
        </p>
        {gegevens?.stand.laatsteMislukt === true && (
          <p style={{ fontSize: 12, color: 'var(--ziekte)', margin: '0 0 4px' }}>
            De laatste poging mislukte: {gegevens.stand.fout ?? 'onbekende fout'}
          </p>
        )}
        <p style={{ fontSize: 11, color: 'var(--inkt-zacht)', margin: '6px 0 0', lineHeight: 1.5 }}>
          De nachtelijke back-up draait om {gegevens?.instellingen.tijd ?? '23:00'} en bewaart de
          laatste {gegevens?.instellingen.bewaarDagelijks ?? 30}. Back-ups staan in{' '}
          <code>{gegevens?.map ?? '…'}</code>.
        </p>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="focus-ring"
            disabled={maken.isPending}
            onClick={() => maken.mutate(false)}
            style={{ ...dialoogKnop, background: 'var(--belasting)', color: '#fff', borderColor: 'transparent' }}
          >
            {maken.isPending ? 'Bezig…' : 'Nu een back-up maken'}
          </button>
          {gegevens?.instellingen.doelmap !== null && gegevens?.instellingen.doelmap !== undefined && (
            <button
              type="button"
              className="focus-ring"
              disabled={maken.isPending}
              onClick={() => maken.mutate(true)}
              style={dialoogKnop}
            >
              Ook naar {gegevens.instellingen.doelmap}
            </button>
          )}
        </div>

        {melding !== null && (
          <p style={{ fontSize: 12, color: 'var(--belasting)', margin: '10px 0 0' }}>{melding}</p>
        )}
        {fout !== null && (
          <p style={{ fontSize: 12, color: 'var(--ziekte)', margin: '10px 0 0' }}>{fout}</p>
        )}
      </Kaart>

      <Kaart>
        <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>Instellingen</h2>
        <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '0 0 10px', lineHeight: 1.5 }}>
          De <strong>actieve database</strong> mag nooit op een netwerkschijf of in een
          gesynchroniseerde map staan; back-upkopieën juist wél. Zet hier de map van de
          netwerkschijf neer waar de nachtelijke kopie ook heen moet.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12 }}>
            Tijd van de nachtelijke back-up
            <input
              className="focus-ring"
              type="time"
              value={tijd ?? gegevens?.instellingen.tijd ?? '23:00'}
              onChange={(event) => setTijd(event.target.value)}
              style={{ ...invoerStijl, width: 120, marginTop: 3, display: 'block' }}
            />
          </label>

          <label style={{ fontSize: 12, flex: 1, minWidth: 260 }}>
            Extra doelmap (netwerkschijf)
            <input
              className="focus-ring"
              value={doelmap ?? gegevens?.instellingen.doelmap ?? ''}
              placeholder="\\\\server\\backups\\showroom"
              onChange={(event) => setDoelmap(event.target.value)}
              style={{ ...invoerStijl, width: '100%', marginTop: 3, display: 'block' }}
            />
          </label>

          <button
            type="button"
            className="focus-ring"
            disabled={bewaren.isPending || (doelmap === null && tijd === null)}
            onClick={() =>
              bewaren.mutate({
                ...(tijd === null ? {} : { tijd }),
                ...(doelmap === null ? {} : { doelmap }),
              })
            }
            style={dialoogKnop}
          >
            Opslaan
          </button>
        </div>
      </Kaart>

      <Kaart>
        <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>De back-ups die er staan</h2>
        <Lijst
          bestanden={gegevens?.backups ?? []}
          bezig={controleren.isPending}
          teBevestigen={tebevestigen}
          onControleer={(naam) => controleren.mutate(naam)}
          onHerstelVragen={setTeBevestigen}
          onHerstel={(naam) => void herstel(naam)}
        />
        <p style={{ fontSize: 11, color: 'var(--inkt-zacht)', margin: '10px 0 0', lineHeight: 1.5 }}>
          <strong>Controleren</strong> kijkt of de kopie heel is en echt van deze applicatie,
          zonder iets terug te zetten. Doe dat af en toe: een back-up die je nooit controleert is
          een aanname, geen back-up.
        </p>
      </Kaart>

      {(gegevens?.opDoelmap.length ?? 0) > 0 && (
        <Kaart>
          <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>
            Op {gegevens?.instellingen.doelmap}
          </h2>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
            <tbody>
              {(gegevens?.opDoelmap ?? []).map((bestand) => (
                <tr key={bestand.bestandsnaam}>
                  <td style={{ padding: '3px 8px 3px 0' }}>{bestand.bestandsnaam}</td>
                  <td style={{ padding: '3px 8px 3px 0', color: 'var(--inkt-zacht)' }}>
                    {grootte(bestand.bytes)}
                  </td>
                  <td style={{ padding: '3px 0', color: 'var(--inkt-zacht)' }}>
                    {moment(bestand.gemaaktOp)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Kaart>
      )}

      <Kaart>
        <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>Logboek</h2>
        {(gegevens?.logboek.length ?? 0) === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: 0 }}>Nog niets gedraaid.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead>
                <tr>
                  {['Wanneer', 'Soort', 'Wie', 'Grootte', 'Duur', 'Status'].map((kop) => (
                    <th
                      key={kop}
                      scope="col"
                      style={{
                        textAlign: 'left',
                        borderBottom: '1px solid var(--rand)',
                        padding: '4px 8px 4px 0',
                        color: 'var(--inkt-zacht)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {kop}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(gegevens?.logboek ?? []).map((loop) => (
                  <tr key={loop.id}>
                    <td style={{ padding: '4px 8px 4px 0', whiteSpace: 'nowrap' }}>
                      {moment(loop.created_at)}
                    </td>
                    <td style={{ padding: '4px 8px 4px 0' }}>{SOORTEN[loop.soort] ?? loop.soort}</td>
                    <td style={{ padding: '4px 8px 4px 0' }}>{loop.gebruiker ?? 'automatisch'}</td>
                    <td style={{ padding: '4px 8px 4px 0' }}>{grootte(loop.bytes)}</td>
                    <td style={{ padding: '4px 8px 4px 0' }}>
                      {loop.duur_ms === null ? '—' : `${loop.duur_ms} ms`}
                    </td>
                    <td
                      style={{
                        padding: '4px 0',
                        color: loop.status === 'ok' ? undefined : 'var(--ziekte)',
                      }}
                    >
                      {loop.status === 'ok' ? 'gelukt' : (loop.fout ?? 'fout')}
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

function Lijst({
  bestanden,
  bezig,
  teBevestigen,
  onControleer,
  onHerstelVragen,
  onHerstel,
}: {
  bestanden: Backupbestand[];
  bezig: boolean;
  teBevestigen: string | null;
  onControleer: (naam: string) => void;
  onHerstelVragen: (naam: string | null) => void;
  onHerstel: (naam: string) => void;
}): JSX.Element {
  if (bestanden.length === 0) {
    return (
      <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: 0 }}>
        Er staat nog geen back-up. Maak er nu een.
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {bestanden.map((bestand) => (
        <div
          key={bestand.bestandsnaam}
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
            fontSize: 12,
            borderBottom: '1px solid var(--rand)',
            paddingBottom: 6,
          }}
        >
          <span style={{ flex: 1, minWidth: 220 }}>
            {bestand.bestandsnaam}
            <span style={{ color: 'var(--inkt-zacht)' }}>
              {' '}
              · {SOORTEN[bestand.soort] ?? bestand.soort} · {grootte(bestand.bytes)}
            </span>
          </span>

          <button
            type="button"
            className="focus-ring"
            disabled={bezig}
            onClick={() => onControleer(bestand.bestandsnaam)}
            style={dialoogKnop}
          >
            Controleren
          </button>

          {teBevestigen === bestand.bestandsnaam ? (
            <>
              <span style={{ color: 'var(--ziekte)' }}>
                Alles ná deze back-up gaat verloren. Zeker weten?
              </span>
              <button
                type="button"
                className="focus-ring"
                onClick={() => onHerstel(bestand.bestandsnaam)}
                style={{ ...dialoogKnop, color: 'var(--ziekte)', borderColor: 'var(--ziekte)' }}
              >
                Ja, terugzetten
              </button>
              <button
                type="button"
                className="focus-ring"
                onClick={() => onHerstelVragen(null)}
                style={dialoogKnop}
              >
                Annuleren
              </button>
            </>
          ) : (
            <button
              type="button"
              className="focus-ring"
              onClick={() => onHerstelVragen(bestand.bestandsnaam)}
              style={dialoogKnop}
            >
              Terugzetten…
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
