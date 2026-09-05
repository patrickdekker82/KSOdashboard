/**
 * Wat er vandaag te doen is (hoofdstuk 9).
 *
 * Vier bakjes en niet meer: te laat, vandaag, komend en zonder datum. Een
 * scherm met tien secties is een scherm dat niemand afwerkt.
 *
 * "Zonder datum" staat er met opzet bij. Dat zijn taken die iemand ooit heeft
 * aangemaakt en nooit heeft ingepland; zonder eigen bakje verdwijnen ze uit
 * beeld en is de takenlijst een plek waar dingen heen gaan om te sterven.
 */
import { useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@showroom/shared';
import { ApiFout, endpoints, type Activiteit, type Gebruiker } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { Dialoog, dialoogKnop, invoerStijl } from '../kansen/Dialoog.tsx';
import { Bellijsten } from './Bellijsten.tsx';

const SOORT: Record<string, string> = {
  bellen: 'Bellen',
  'e-mail': 'E-mail',
  afspraak: 'Afspraak',
  taak: 'Taak',
  notitie: 'Notitie',
  whatsapp: 'WhatsApp',
};

/** Waar een activiteit heen wijst, per entiteit uit de kern. */
const ROUTE: Record<string, string> = {
  organizations: '/klanten',
  contacts: '/contactpersonen',
  projects: '/projecten',
  opportunities: '/kansen',
  'package-quotes': '/duurzaamheid/offerte',
};

type Tab = 'taken' | 'bellijsten';

export function Opvolging({
  ik,
  navigeer,
}: {
  ik: Gebruiker;
  navigeer: (pad: string) => void;
}): JSX.Element {
  const [tab, setTab] = useState<Tab>('taken');

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>Opvolging</h1>

      <div
        role="tablist"
        aria-label="Onderdelen van opvolging"
        style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--rand)' }}
      >
        {(
          [
            { sleutel: 'taken' as const, label: 'Mijn werk' },
            { sleutel: 'bellijsten' as const, label: 'Bellijsten' },
          ]
        ).map((blad) => {
          const actief = tab === blad.sleutel;
          return (
            <button
              key={blad.sleutel}
              type="button"
              role="tab"
              aria-selected={actief}
              className="focus-ring"
              onClick={() => setTab(blad.sleutel)}
              style={{
                background: 'transparent',
                border: 0,
                borderBottom: `2px solid ${actief ? 'var(--belasting)' : 'transparent'}`,
                color: actief ? 'var(--inkt)' : 'var(--inkt-zacht)',
                fontWeight: actief ? 600 : 400,
                fontSize: 13,
                padding: '6px 10px',
                cursor: 'pointer',
              }}
            >
              {blad.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {tab === 'taken' && <MijnWerk ik={ik} navigeer={navigeer} />}
        {tab === 'bellijsten' && <Bellijsten navigeer={navigeer} />}
      </div>
    </div>
  );
}

function MijnWerk({
  ik,
  navigeer,
}: {
  ik: Gebruiker;
  navigeer: (pad: string) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [gekozenGebruiker, setGekozenGebruiker] = useState(ik.id);
  const [afronden, setAfronden] = useState<Activiteit | null>(null);
  const [melding, setMelding] = useState<string | null>(null);

  const magAndersZien = ik.role === 'manager' || ik.role === 'admin';

  const lijst = useQuery({
    queryKey: ['werklijst', gekozenGebruiker],
    queryFn: () => endpoints.werklijst(gekozenGebruiker),
  });
  const gebruikers = useQuery({
    queryKey: ['gebruikers'],
    queryFn: () => endpoints.gebruikers(),
    enabled: magAndersZien,
  });

  const data = lijst.data?.data;
  const totaal = data
    ? data.teLaat.length + data.vandaag.length + data.komend.length + data.zonderDatum.length
    : 0;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Kaart>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Mijn werk</h2>
          <span style={{ fontSize: 12, color: 'var(--inkt-zacht)' }}>
            {totaal === 0 ? 'niets openstaand' : `${totaal} open`}
            {data && data.teLaat.length > 0 && (
              <span style={{ color: 'var(--ziekte)' }}> · {data.teLaat.length} te laat</span>
            )}
          </span>

          {magAndersZien && (
            <label style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--inkt-zacht)' }}>
              Van{' '}
              <select
                className="focus-ring"
                value={gekozenGebruiker}
                onChange={(event) => setGekozenGebruiker(Number(event.target.value))}
                style={invoerStijl}
              >
                {(gebruikers.data?.data ?? []).map((gebruiker) => (
                  <option key={gebruiker.id} value={gebruiker.id}>
                    {gebruiker.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {melding && (
          <p role="status" style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '8px 0 0' }}>
            {melding}
          </p>
        )}
      </Kaart>

      {lijst.isLoading && (
        <Kaart>
          <Skelet hoogte={200} />
        </Kaart>
      )}

      {data && totaal === 0 && (
        <Kaart>
          <p style={{ margin: 0, color: 'var(--inkt-zacht)' }}>
            Er staat niets open. Nieuwe taken maakt u aan vanaf de tijdlijn van een klant, project
            of kans.
          </p>
        </Kaart>
      )}

      {data && (
        <>
          <Bakje
            titel="Te laat"
            kleur="var(--ziekte)"
            taken={data.teLaat}
            navigeer={navigeer}
            onAfronden={setAfronden}
          />
          <Bakje
            titel="Vandaag"
            kleur="var(--belasting)"
            taken={data.vandaag}
            navigeer={navigeer}
            onAfronden={setAfronden}
          />
          <Bakje
            titel="Komende twee weken"
            kleur="var(--rand)"
            taken={data.komend}
            navigeer={navigeer}
            onAfronden={setAfronden}
          />
          <Bakje
            titel="Zonder datum"
            kleur="var(--rand)"
            taken={data.zonderDatum}
            navigeer={navigeer}
            onAfronden={setAfronden}
            uitleg="Deze taken staan nergens ingepland. Geef ze een datum, of rond ze af."
          />
        </>
      )}

      {afronden && (
        <AfrondDialoog
          activiteit={afronden}
          onSluit={() => setAfronden(null)}
          onKlaar={(tekst) => {
            setAfronden(null);
            setMelding(tekst);
            void queryClient.invalidateQueries({ queryKey: ['werklijst'] });
            void queryClient.invalidateQueries({ queryKey: ['tijdlijn'] });
            void queryClient.invalidateQueries({ queryKey: ['meldingen'] });
          }}
        />
      )}
    </div>
  );
}

function Bakje({
  titel,
  kleur,
  taken,
  navigeer,
  onAfronden,
  uitleg,
}: {
  titel: string;
  kleur: string;
  taken: Activiteit[];
  navigeer: (pad: string) => void;
  onAfronden: (taak: Activiteit) => void;
  uitleg?: string;
}): JSX.Element | null {
  if (taken.length === 0) return null;

  return (
    <Kaart accent={kleur}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>{titel}</h3>
        <span style={{ fontSize: 12, color: 'var(--inkt-stil)' }}>{taken.length}</span>
      </div>

      {uitleg && (
        <p style={{ fontSize: 11, color: 'var(--inkt-stil)', margin: '4px 0 0' }}>{uitleg}</p>
      )}

      <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
        {taken.map((taak) => {
          const basis = taak.entiteit ? ROUTE[taak.entiteit] : undefined;
          return (
            <li
              key={taak.id}
              style={{
                border: '1px solid var(--rand)',
                borderRadius: 6,
                padding: '7px 10px',
                display: 'flex',
                gap: 10,
                alignItems: 'baseline',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 11, color: 'var(--inkt-stil)', minWidth: 60 }}>
                {SOORT[taak.type] ?? taak.type}
              </span>
              <strong style={{ fontSize: 13 }}>{taak.subject}</strong>
              {taak.due_at && (
                <span style={{ fontSize: 11, color: 'var(--inkt-stil)' }}>
                  {formatDate(taak.due_at.slice(0, 10))}
                </span>
              )}
              {taak.priority === 'hoog' && (
                <span style={{ fontSize: 11, color: 'var(--ziekte)', fontWeight: 600 }}>hoog</span>
              )}

              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {basis && taak.record_id !== null && (
                  <button
                    type="button"
                    className="focus-ring"
                    onClick={() => navigeer(`${basis}/${taak.record_id}`)}
                    style={dialoogKnop}
                  >
                    Bekijken →
                  </button>
                )}
                <button
                  type="button"
                  className="focus-ring"
                  onClick={() => onAfronden(taak)}
                  style={dialoogKnop}
                >
                  Afronden…
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </Kaart>
  );
}

/**
 * Afronden, met meteen de vervolgactie.
 *
 * Die twee in één dialoog is het hele punt: een gesprek dat eindigt met "ik bel
 * over twee weken terug" en waar niemand iets voor inplant, krijgt geen vervolg.
 */
function AfrondDialoog({
  activiteit,
  onSluit,
  onKlaar,
}: {
  activiteit: Activiteit;
  onSluit: () => void;
  onKlaar: (melding: string) => void;
}): JSX.Element {
  const [uitkomst, setUitkomst] = useState('');
  const [vervolg, setVervolg] = useState(false);
  const [soort, setSoort] = useState('bellen');
  const [onderwerp, setOnderwerp] = useState(`${activiteit.subject} — vervolg`);
  const [datum, setDatum] = useState(overTweeWeken());
  const [fout, setFout] = useState<string | null>(null);

  const afronden = useMutation({
    mutationFn: () =>
      endpoints.activiteitAfronden(activiteit.id, {
        uitkomst: uitkomst.trim() === '' ? null : uitkomst.trim(),
        vervolg: vervolg
          ? { type: soort, subject: onderwerp.trim(), dueAt: `${datum} 09:00:00` }
          : null,
      }),
    onSuccess: (antwoord) =>
      onKlaar(
        antwoord.data.vervolgId === null
          ? 'Afgerond.'
          : 'Afgerond, en de vervolgactie staat ingepland.',
      ),
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Afronden lukte niet.'),
  });

  return (
    <Dialoog titel={`Afronden — ${activiteit.subject}`} onSluit={onSluit}>
      <label style={{ display: 'block', fontSize: 12 }}>
        Wat kwam eruit?
        <textarea
          className="focus-ring"
          rows={3}
          value={uitkomst}
          onChange={(event) => setUitkomst(event.target.value)}
          placeholder="Komt in de tijdlijn van het record"
          style={{ ...invoerStijl, width: '100%', marginTop: 3, resize: 'vertical' }}
        />
      </label>

      <label style={{ display: 'block', fontSize: 13, marginTop: 12 }}>
        <input type="checkbox" checked={vervolg} onChange={(event) => setVervolg(event.target.checked)} />{' '}
        Meteen een vervolgactie inplannen
      </label>

      {vervolg && (
        <div
          style={{
            display: 'grid',
            gap: 10,
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            marginTop: 10,
            paddingLeft: 20,
          }}
        >
          <label style={{ fontSize: 12 }}>
            Soort
            <select
              className="focus-ring"
              value={soort}
              onChange={(event) => setSoort(event.target.value)}
              style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
            >
              {Object.entries(SOORT).map(([waarde, label]) => (
                <option key={waarde} value={waarde}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: 12 }}>
            Wanneer
            <input
              type="date"
              className="focus-ring"
              value={datum}
              onChange={(event) => setDatum(event.target.value)}
              style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
            />
          </label>

          <label style={{ fontSize: 12, gridColumn: '1 / -1' }}>
            Waarover
            <input
              className="focus-ring"
              value={onderwerp}
              onChange={(event) => setOnderwerp(event.target.value)}
              style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
            />
          </label>
        </div>
      )}

      {fout && (
        <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 12, marginTop: 10 }}>
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
          disabled={afronden.isPending || (vervolg && onderwerp.trim() === '')}
          onClick={() => afronden.mutate()}
          style={{ ...dialoogKnop, background: 'var(--capaciteit)', color: '#fff', border: 0 }}
        >
          {afronden.isPending ? 'Bezig…' : 'Afronden'}
        </button>
      </div>
    </Dialoog>
  );
}

/** De datum over twee weken, als voorstel voor de vervolgactie. */
function overTweeWeken(): string {
  const datum = new Date(Date.now() + 14 * 86_400_000);
  return datum.toISOString().slice(0, 10);
}
