/**
 * De beheerschermen die op de bestaande API leunen (hoofdstuk 12).
 *
 * Gebruikers, werkroosters, keuzelijsten en de capaciteitsinstellingen. Voor de
 * eerste drie bestaat de generieke lijst al — die kan velden toevoegen,
 * hernoemen en verbergen, en dat hoeft hier niet nog eens. Wat er wél bij moet
 * is de uitleg: waaróm een rooster een geldigheidsdatum heeft, en wat er
 * gebeurt als je een rol verlaagt.
 *
 * De capaciteitsinstellingen zijn geen entiteit maar losse waarden uit de
 * settings-tabel; die krijgen een eigen formulier.
 */
import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiFout, endpoints } from '../../lib/api.ts';
import { GeneriekeLijst } from '../generiek/GeneriekeLijst.tsx';
import { Kaart } from '../Dashboard.tsx';
import { dialoogKnop, invoerStijl } from '../kansen/Dialoog.tsx';

/** Kop met een terugknop en een stuk uitleg erboven de lijst. */
function Blad({
  titel,
  uitleg,
  onTerug,
  children,
}: {
  titel: string;
  uitleg: ReactNode;
  onTerug: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>{titel}</h1>
        <button type="button" className="focus-ring" onClick={onTerug} style={dialoogKnop}>
          Terug naar instellingen
        </button>
      </div>
      <Kaart>
        <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: 0, lineHeight: 1.5 }}>
          {uitleg}
        </p>
      </Kaart>
      {children}
    </div>
  );
}

export function Gebruikers({ onTerug }: { onTerug: () => void }): JSX.Element {
  return (
    <Blad
      titel="Gebruikers &amp; rollen"
      onTerug={onTerug}
      uitleg={
        <>
          Vier rollen. Een <strong>meekijker</strong> ziet alles maar wijzigt niets. Een{' '}
          <strong>medewerker</strong> werkt met klanten, kansen en projecten en beheert zijn eigen
          verlof. Een <strong>manager</strong> keurt verlof goed, ziet het type afwezigheid en mag
          rapportages bewaren. Een <strong>beheerder</strong> mag daarnaast bij de velden, de
          back-up, de SQL-modus en de AI-sleutel.
          <br />
          <br />
          Vink <em>kopersbegeleider</em> aan bij iedereen die showroomafspraken doet: alleen zij
          tellen mee in de bezetting. Iemand die weggaat zet u op gearchiveerd; verwijderen kan
          niet, want dan verdwijnt ook wie wat gedaan heeft.
        </>
      }
    >
      <GeneriekeLijst entiteit="users" titel="Gebruikers" />
    </Blad>
  );
}

export function Werkroosters({ onTerug }: { onTerug: () => void }): JSX.Element {
  return (
    <Blad
      titel="Werkroosters"
      onTerug={onTerug}
      uitleg={
        <>
          Per medewerker de uren per dag, met een <strong>geldig vanaf</strong> en optioneel een{' '}
          <strong>geldig tot</strong>. Gaat iemand van vier naar vijf dagen, maak dan een nieuw
          rooster met de ingangsdatum in plaats van het oude aan te passen: anders verandert de
          bezetting van vorig jaar met terugwerkende kracht, en klopt elk rapport dat al gedeeld is
          ineens niet meer.
          <br />
          <br />
          <em>Afspraken per week</em> is hoeveel showroomafspraken deze medewerker in een volle week
          aankan. Dat getal stuurt rechtstreeks de bezettingsberekening.
        </>
      }
    >
      <GeneriekeLijst entiteit="work-schedules" titel="Werkroosters" />
    </Blad>
  );
}

export function Keuzelijsten({ onTerug }: { onTerug: () => void }): JSX.Element {
  const [gekozen, setGekozen] = useState<number | null>(null);

  const lijsten = useQuery({ queryKey: ['picklists'], queryFn: () => endpoints.keuzelijsten() });

  return (
    <Blad
      titel="Keuzelijsten"
      onTerug={onTerug}
      uitleg={
        <>
          De waarden achter de keuzevelden: projectstatus, bronnen, redenen van verlies,
          afwezigheidstypes. Een waarde die al gebruikt is kunt u beter <em>inactief</em> maken dan
          verwijderen — dan blijft hij staan op de records waar hij op stond, en kan niemand hem
          nog kiezen.
        </>
      }
    >
      <Kaart>
        <label style={{ fontSize: 12, display: 'block' }}>
          Welke lijst?
          <select
            className="focus-ring"
            value={gekozen ?? 0}
            onChange={(event) => setGekozen(Number(event.target.value) || null)}
            style={{ ...invoerStijl, width: 320, marginTop: 3, display: 'block' }}
          >
            <option value={0}>— kies een lijst —</option>
            {(lijsten.data?.data ?? []).map((lijst) => (
              <option key={lijst.id} value={lijst.id}>
                {lijst.name}
              </option>
            ))}
          </select>
        </label>
      </Kaart>

      {gekozen === null ? (
        <GeneriekeLijst entiteit="picklists" titel="Keuzelijsten" />
      ) : (
        <GeneriekeLijst entiteit="picklist-items" titel="Waarden" />
      )}
    </Blad>
  );
}

// ---------------------------------------------------------------------------
// Capaciteitsinstellingen
// ---------------------------------------------------------------------------

type Instelling = {
  sleutel: string;
  label: string;
  uitleg: string;
  /** Hoe de waarde op het scherm staat: als getal, of als tekst. */
  soort: 'getal' | 'tekst' | 'aan_uit';
  stap?: number;
};

const CAPACITEIT: Instelling[] = [
  {
    sleutel: 'appointments_per_unit',
    label: 'Afspraken per woning',
    uitleg:
      'Hoeveel showroomafspraken een gemiddelde woning kost. Dit is de V uit de ' +
      'capaciteitsberekening en het getal waar de hele bezetting op draait. Een project kan er ' +
      'zelf van afwijken.',
    soort: 'getal',
    stap: 0.1,
  },
  {
    sleutel: 'lead_time_weeks',
    label: 'Doorlooptijd in weken',
    uitleg:
      'Over hoeveel weken de afspraken van een project uitgesmeerd worden. Dit is de D uit de ' +
      'berekening; hij bepaalt hoe breed een piek wordt.',
    soort: 'getal',
    stap: 0.5,
  },
  {
    sleutel: 'min_bezetting_begeleiders',
    label: 'Minimaal aantal begeleiders tegelijk',
    uitleg:
      'Onder dit aantal gelijktijdig beschikbare kopersbegeleiders slaat de signalering aan. ' +
      'Bij één betekent dat: er mag nooit een dag zijn waarop niemand er is.',
    soort: 'getal',
    stap: 1,
  },
  {
    sleutel: 'minimum_marge_bp',
    label: 'Minimale marge (basispunten)',
    uitleg:
      'Onder deze marge waarschuwt de applicatie bij een offerte. 1500 basispunten is 15 procent.',
    soort: 'getal',
    stap: 100,
  },
  {
    sleutel: 'goedkeuring_verlof_verplicht',
    label: 'Verlof moet worden goedgekeurd',
    uitleg:
      'Staat dit uit, dan is een verlofaanvraag meteen definitief. Aan is de gewone stand: een ' +
      'manager keurt goed.',
    soort: 'aan_uit',
  },
  {
    sleutel: 'verlofsaldo_administratie',
    label: 'Verlofsaldo administratief bijhouden',
    uitleg:
      'Aan betekent dat de applicatie het saldo berekent en toont. Staat het uit, dan is de ' +
      'salarisadministratie leidend en toont de applicatie alleen de opgenomen uren.',
    soort: 'aan_uit',
  },
];

export function Capaciteit({ onTerug }: { onTerug: () => void }): JSX.Element {
  const queryClient = useQueryClient();
  const [concept, setConcept] = useState<Record<string, unknown>>({});
  const [melding, setMelding] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const instellingen = useQuery({
    queryKey: ['instellingen'],
    queryFn: () => endpoints.instellingenLezen(),
  });

  const opslaan = useMutation({
    mutationFn: () => endpoints.instellingenOpslaan(concept),
    onSuccess: () => {
      setFout(null);
      setMelding('Opgeslagen. De bezetting wordt bij de volgende berekening bijgewerkt.');
      setConcept({});
      void queryClient.invalidateQueries({ queryKey: ['instellingen'] });
      void queryClient.invalidateQueries({ queryKey: ['weekbezetting'] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Opslaan lukte niet.'),
  });

  // Zodra de instellingen binnen zijn, is het concept leeg: de velden tonen dan
  // de opgeslagen waarden totdat iemand iets typt.
  useEffect(() => {
    setConcept({});
  }, [instellingen.data]);

  const waarden = instellingen.data?.data ?? {};

  return (
    <Blad
      titel="Capaciteitsinstellingen"
      onTerug={onTerug}
      uitleg={
        <>
          De getallen waar de bezettingsberekening op staat. Ze gelden voor de hele afdeling; een
          project kan van de eerste twee afwijken op zijn eigen detailpagina. Verander ze met beleid
          — de hele planning schuift mee.
        </>
      }
    >
      <Kaart>
        <div style={{ display: 'grid', gap: 16 }}>
          {CAPACITEIT.map((instelling) => {
            const opgeslagen = waarden[instelling.sleutel];
            const huidig = concept[instelling.sleutel] ?? opgeslagen;

            return (
              <div key={instelling.sleutel}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block' }}>
                  {instelling.label}
                  {instelling.soort === 'aan_uit' ? (
                    <input
                      type="checkbox"
                      className="focus-ring"
                      checked={huidig === true}
                      onChange={(event) =>
                        setConcept((vorig) => ({
                          ...vorig,
                          [instelling.sleutel]: event.target.checked,
                        }))
                      }
                      style={{ marginLeft: 8 }}
                    />
                  ) : (
                    <input
                      className="focus-ring"
                      type="number"
                      step={instelling.stap ?? 1}
                      value={huidig === undefined || huidig === null ? '' : String(huidig)}
                      onChange={(event) =>
                        setConcept((vorig) => ({
                          ...vorig,
                          [instelling.sleutel]: Number(event.target.value),
                        }))
                      }
                      style={{ ...invoerStijl, width: 140, marginTop: 3, display: 'block' }}
                    />
                  )}
                </label>
                <p
                  style={{
                    fontSize: 11,
                    color: 'var(--inkt-zacht)',
                    margin: '4px 0 0',
                    lineHeight: 1.5,
                  }}
                >
                  {instelling.uitleg}
                </p>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="focus-ring"
            disabled={Object.keys(concept).length === 0 || opslaan.isPending}
            onClick={() => opslaan.mutate()}
            style={{ ...dialoogKnop, background: 'var(--belasting)', color: '#fff', borderColor: 'transparent' }}
          >
            Opslaan
          </button>
          {melding !== null && (
            <span style={{ fontSize: 12, color: 'var(--belasting)' }}>{melding}</span>
          )}
          {fout !== null && <span style={{ fontSize: 12, color: 'var(--ziekte)' }}>{fout}</span>}
        </div>
      </Kaart>
    </Blad>
  );
}
